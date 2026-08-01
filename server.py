#!/usr/bin/env python3
"""
Pokémon Den local backend
===========================
Serves the static app AND proxies the optional BYOK live-data integrations so
your API keys never touch the browser and never hit CORS. With no keys set, the
app runs exactly as the free static version (TCGdex images + your export prices +
deep-links).

Designed to run both from a dev checkout AND bundled read-only inside a macOS
.app: set POKECHEST_HOME to a writable directory and ALL writes (settings,
rebuilt data, cache) go there; the bundle itself is never written to.

Keys live in settings.local.json (gitignored, never bundled). Endpoints:
  GET  /api/health            -> {ok:true, version}
  GET  /api/config            -> which integrations are configured (booleans only)
  POST /api/config            -> save keys / provider choices
  GET  /api/price?id=<pcId>   -> PriceCharting price+graded tiers for one card
  POST /api/comps             -> live sold comps (eBay/TCGplayer/JP) via a comps API
  POST /api/ai                -> a written sell/grade recommendation (Claude or OpenAI)
  POST /api/refresh           -> rebuild data/collection.json from the newest export
  POST /api/import            -> save an uploaded .xlsx export + rebuild (first-run onboarding)
  GET  /data/collection.json  -> POKECHEST_HOME copy when present, else bundled file

Env:  POKECHEST_HOME (writable home; default: this script's directory)
      POKECHEST_PORT (port; POKEVAULT_PORT kept as a legacy fallback)

Run:  python3 server.py     (or double-click start.command)
"""
import os, sys, re, json, html, base64, socket, ssl, time, datetime, ipaddress, subprocess, threading, shutil, shlex, urllib.request, urllib.error, urllib.parse
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

VERSION = "2.3.0"
ROOT = os.path.dirname(os.path.abspath(__file__))

# Writable-home resolution. Normally that's the project folder, but once
# Desktop/Documents (or the whole checkout) migrate into iCloud Drive, writing
# there is unreliable — files become cloud-only *.icloud placeholders. When the
# project is detected inside iCloud we fall back to
# ~/Library/Application Support/PokemonChest and seed it from the project once.
# POKECHEST_HOME always wins if set, so every existing launcher and every test
# harness behaves exactly as before. The import is optional: without
# scripts/mac_paths.py the old ROOT behaviour is kept verbatim.
sys.path.insert(0, os.path.join(ROOT, "scripts"))
try:
    from mac_paths import (  # noqa: E402
        resolve_writable_home, seed_home_from_root, path_report, is_under_icloud,
        find_pricecharting_xlsx as _find_pc_xlsx,
    )
except ImportError:
    resolve_writable_home = seed_home_from_root = path_report = is_under_icloud = None
    _find_pc_xlsx = None

def _resolve_home():
    env = (os.environ.get("POKECHEST_HOME") or "").strip()
    if env:
        return os.path.abspath(env), "POKECHEST_HOME env"
    if resolve_writable_home:
        try:
            home, why = resolve_writable_home(ROOT)
            if home != ROOT and seed_home_from_root:
                seeded = seed_home_from_root(home, ROOT)
                if seeded:
                    print(f"  Seeded Application Support from iCloud project: {', '.join(seeded)}", flush=True)
                os.environ["POKECHEST_HOME"] = home
            return home, why
        except Exception:
            pass                                    # never let path probing stop the app
    return ROOT, "project folder"

HOME, _HOME_REASON = _resolve_home()
SETTINGS = os.path.join(HOME, "settings.local.json")
CARD_ART_DIR = os.path.join(HOME, "card-art")           # your live saves (writable)
BUNDLED_ART_DIR = os.path.join(ROOT, "card-art")        # baked-in defaults (ship with the build)
LISTING_DIR = os.path.join(HOME, "listing-photos")      # YOUR OWN photos of each card, for selling
PORT = int(os.environ.get("POKECHEST_PORT") or os.environ.get("POKEVAULT_PORT") or "8787")
POCKET_NAME = "Pokémon Den — Pocket.html"

# ---------------------------------------------------------------- settings ---
def build_flags():
    """data/build-flags.json — the build profile. shipBuild:true marks an
    App-Store/public build, where the Emerald Lab routes are refused outright
    (it compiles + runs a GBA decompilation: an automatic store rejection).

    Read from ROOT (the app bundle) ONLY, never from the writable HOME: a
    build profile is a property of the build, not a user preference, so
    dropping a file in ~ must not be able to turn a ship build back into a
    personal one. The browser reads the same bundled file over HTTP."""
    try:
        with open(os.path.join(ROOT, "data", "build-flags.json"), encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return {}

def ship_build():
    return bool(build_flags().get("shipBuild"))

def load_settings():
    try:
        with open(SETTINGS, encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return {}

def save_settings(patch):
    s = load_settings()
    # only persist known keys; empty string clears one
    for k in ("pricecharting_token", "comps_provider", "comps_key",
              "ai_provider", "ai_key", "ai_model"):
        if k in patch:
            v = (patch[k] or "").strip()
            if v:
                s[k] = v
            else:
                s.pop(k, None)
    os.makedirs(HOME, exist_ok=True)  # writes always go to the writable home
    # owner-only from the first byte (no umask window), swapped in atomically
    tmp = SETTINGS + ".tmp"
    fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w", encoding="utf-8") as f:
        json.dump(s, f, indent=2)
    os.replace(tmp, SETTINGS)
    return s

def config_view(s):
    return {
        "priceCharting": bool(s.get("pricecharting_token")),
        "comps": {"enabled": bool(s.get("comps_key")), "provider": s.get("comps_provider", "pokemonpricetracker")},
        "ai": {"enabled": bool(s.get("ai_key")), "provider": s.get("ai_provider", "anthropic"),
               "model": s.get("ai_model") or ("claude-sonnet-4-6" if s.get("ai_provider", "anthropic") == "anthropic" else "gpt-4o")},
    }

# ---------------------------------------------------------------- http util ---
def http_json(url, *, method="GET", headers=None, body=None, timeout=40):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method, headers=headers or {})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode("utf-8", "replace"))

def cents(v):
    try:
        return round(int(v) / 100.0, 2)
    except (TypeError, ValueError):
        return None

# ------------------------------------------------------------ search cache ---
# The Scanner (single-card + 9-pocket binder) and the Add & Sold ledger all
# funnel card lookups through the same PriceCharting catalog search. Caching
# results locally means: (1) repeat/similar searches across a scan session
# are instant instead of round-tripping every keystroke, (2) a stale-but-
# present cache still resolves a search when the network is flaky mid-scan,
# and (3) fewer live PriceCharting calls overall. Keyed by normalized query,
# capped and LRU-evicted by last-used time so a long scanning session doesn't
# grow the file unbounded.
SEARCH_CACHE_FILE = os.path.join(HOME, "search-cache.json")
SEARCH_CACHE_TTL = 7 * 24 * 3600      # catalog names/sets barely change; prices drift, so...
SEARCH_CACHE_PRICE_TTL = 6 * 3600     # ...refresh just the price fields sooner than a full re-search
SEARCH_CACHE_MAX = 400
_search_cache_lock = threading.Lock()

def _search_cache_load():
    try:
        with open(SEARCH_CACHE_FILE, encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return {}

def _search_cache_save(cache):
    os.makedirs(HOME, exist_ok=True)
    tmp = SEARCH_CACHE_FILE + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(cache, f)
    os.replace(tmp, SEARCH_CACHE_FILE)

def _search_cache_key(q):
    return re.sub(r"\s+", " ", (q or "").strip().lower())

def search_cache_get(q):
    """Returns (products, stale) from cache, or (None, False) on a miss."""
    key = _search_cache_key(q)
    if not key:
        return None, False
    with _search_cache_lock:
        cache = _search_cache_load()
        entry = cache.get(key)
        if not entry:
            return None, False
        age = time.time() - entry.get("ts", 0)
        entry["lastUsed"] = time.time()
        cache[key] = entry
        _search_cache_save(cache)
    return entry.get("products"), age > SEARCH_CACHE_PRICE_TTL

def search_cache_put(q, products):
    key = _search_cache_key(q)
    if not key:
        return
    with _search_cache_lock:
        cache = _search_cache_load()
        cache[key] = {"products": products, "ts": time.time(), "lastUsed": time.time()}
        if len(cache) > SEARCH_CACHE_MAX:
            for k in sorted(cache, key=lambda k: cache[k].get("lastUsed", 0))[:len(cache) - SEARCH_CACHE_MAX]:
                cache.pop(k, None)
        _search_cache_save(cache)

# ------------------------------------------------------------- integrations ---
def pricecharting_price(pc_id, token):
    """PriceCharting Product endpoint. Keys mirror the CSV price-guide columns;
    prices are integer pennies. Returns ungraded + graded tiers we can map."""
    url = f"https://www.pricecharting.com/api/product?{urllib.parse.urlencode({'t': token, 'id': pc_id})}"
    d = http_json(url)
    if d.get("status") == "error":
        return {"ok": False, "error": d.get("error-message", "PriceCharting error")}
    # CSV/price-guide column names → friendly tiers (graded columns reuse the
    # collectibles vocabulary; we surface the raw object too so nothing is lost).
    tiers = {
        "ungraded":  cents(d.get("loose-price")),
        "grade7to8": cents(d.get("complete-price") or d.get("cib-price")),
        "grade9":    cents(d.get("new-price")),
        "grade9_5":  cents(d.get("graded-price")),
        "psa10":     cents(d.get("box-only-price") or d.get("manual-only-price")),
    }
    return {"ok": True, "name": d.get("product-name"), "set": d.get("console-name"),
            "tiers": {k: v for k, v in tiers.items() if v is not None},
            "raw": d}

def save_reference_image(payload):
    """Download a card's catalog image into a local 'listing-photos' folder so the
    seller has a starting image file. Restricted to the TCGdex catalog source —
    this is a reference image, not a scraper for arbitrary web photos."""
    url = (payload.get("url") or "").strip()
    name = (payload.get("name") or "card").strip()
    host = urllib.parse.urlparse(url).hostname or ""
    if not (url.startswith("https://") and host.endswith("tcgdex.net")):
        return {"ok": False, "error": "Only the card's catalog image can be saved here. For a real listing, shoot a photo of your actual card."}
    safe = (re.sub(r"[^A-Za-z0-9 _.#-]+", "", name)[:70].strip() or "card")
    ext = ".webp" if url.lower().endswith(".webp") else ".png"
    outdir = os.path.join(HOME, "listing-photos")
    os.makedirs(outdir, exist_ok=True)
    out = os.path.join(outdir, safe + ext)
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "PokemonChest/1.0"})
        with urllib.request.urlopen(req, timeout=30) as r:
            data = r.read()
        with open(out, "wb") as f:
            f.write(data)
        return {"ok": True, "path": out, "folder": outdir, "file": os.path.basename(out), "kb": len(data) // 1024}
    except Exception as e:
        return {"ok": False, "error": str(e)}

# --------------------------------------------------------------- card art ---
# User-supplied card images for cards the free TCGdex catalog can't match —
# e.g. Japanese special/secret rares numbered beyond their set (Team Rocket's
# Mewtwo ex #125), Mew 25th-anniversary promos, McDonald's promos. The user
# finds the art (Google Images) and pastes it or its URL; we save ONE file per
# card, named by its PriceCharting id, into a writable card-art/ folder. These
# are the user's own reference images for their own collection — never uploaded.
_ART_EXT = {"image/webp": ".webp", "image/png": ".png", "image/jpeg": ".jpg",
            "image/jpg": ".jpg", "image/gif": ".gif", "image/avif": ".avif"}
_ART_OK_EXT = (".webp", ".png", ".jpg", ".jpeg", ".gif", ".avif")
_ART_MAX = 12 * 1024 * 1024  # 12 MB safety cap

def _host_is_public(host):
    """True only if EVERY IP `host` resolves to is a normal public address.
    Blocks SSRF to loopback / link-local / private / reserved ranges (e.g. the
    169.254.169.254 cloud-metadata endpoint or a LAN router admin page)."""
    try:
        infos = socket.getaddrinfo(host, None)
    except Exception:
        return False
    if not infos:
        return False
    for info in infos:
        try:
            a = ipaddress.ip_address(str(info[4][0]).split("%")[0])
        except ValueError:
            return False
        if (a.is_private or a.is_loopback or a.is_link_local or a.is_reserved
                or a.is_multicast or a.is_unspecified):
            return False
    return True

class _SafeRedirect(urllib.request.HTTPRedirectHandler):
    """Follow redirects (legit image CDNs use them) but re-validate every hop so
    a public URL can't 30x-bounce into an internal address."""
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        if not _host_is_public(urllib.parse.urlparse(newurl).hostname or ""):
            raise urllib.error.HTTPError(newurl, code, "redirect to a blocked address", headers, fp)
        return super().redirect_request(req, fp, code, msg, headers, newurl)
_ART_OPENER = urllib.request.build_opener(_SafeRedirect)

def img_ctype(fname):
    return {".webp": "image/webp", ".png": "image/png", ".jpg": "image/jpeg",
            ".jpeg": "image/jpeg", ".gif": "image/gif",
            ".avif": "image/avif"}.get(os.path.splitext(fname)[1].lower(), "application/octet-stream")

def _art_pcid(payload):
    pid = str(payload.get("pcId") or payload.get("id") or "").strip()
    return pid if re.fullmatch(r"[A-Za-z0-9_-]{1,40}", pid) else None

def _art_clear(pcid):
    """Remove any existing art file(s) for this card (one card = one image)."""
    try:
        for f in os.listdir(CARD_ART_DIR):
            if os.path.splitext(f)[0] == pcid:
                try:
                    os.remove(os.path.join(CARD_ART_DIR, f))
                except OSError:
                    pass
    except OSError:
        pass

def save_card_art(payload):
    pcid = _art_pcid(payload)
    if not pcid:
        return {"ok": False, "error": "Missing or invalid card id."}
    data, ext = None, None
    data_url = (payload.get("dataUrl") or "").strip()
    url = (payload.get("url") or "").strip()
    if data_url.startswith("data:"):
        m = re.match(r"data:([^;,]*)(;base64)?,(.*)$", data_url, re.S)
        if not m:
            return {"ok": False, "error": "Bad image data."}
        ext = _ART_EXT.get((m.group(1) or "").lower().strip())
        if not ext:
            return {"ok": False, "error": f"Unsupported image type: {m.group(1) or 'unknown'}."}
        try:
            data = base64.b64decode(m.group(3)) if m.group(2) else urllib.parse.unquote_to_bytes(m.group(3))
        except Exception:
            return {"ok": False, "error": "Could not decode the pasted image."}
    elif url.startswith(("https://", "http://")):
        host = urllib.parse.urlparse(url).hostname or ""
        if not host:
            return {"ok": False, "error": "Bad image URL."}
        if not _host_is_public(host):
            return {"ok": False, "error": "That address is blocked (local/private hosts aren't allowed). Paste a public image URL."}
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "PokemonChest/1.0", "Accept": "image/*"})
            with _ART_OPENER.open(req, timeout=30) as r:
                ctype = (r.headers.get("Content-Type") or "").split(";")[0].lower().strip()
                data = r.read(_ART_MAX + 1)
        except urllib.error.HTTPError as e:
            return {"ok": False, "error": f"Could not download that image (HTTP {e.code})."}
        except Exception as e:
            return {"ok": False, "error": f"Could not download that image: {e}"}
        ext = _ART_EXT.get(ctype)
        if not ext:
            pe = os.path.splitext(urllib.parse.urlparse(url).path)[1].lower()
            ext = ".jpg" if pe == ".jpeg" else (pe if pe in _ART_OK_EXT else None)
        if not ext:
            return {"ok": False, "error": "That link isn't a direct image (it should end in .jpg / .png / .webp)."}
    else:
        return {"ok": False, "error": "Paste an image, choose a file, or give a direct https image URL."}
    if not data:
        return {"ok": False, "error": "Empty image."}
    if len(data) > _ART_MAX:
        return {"ok": False, "error": "Image is too large (max 12 MB)."}
    os.makedirs(CARD_ART_DIR, exist_ok=True)
    _art_clear(pcid)
    fname = pcid + ext
    out = os.path.join(CARD_ART_DIR, fname)
    try:
        with open(out, "wb") as f:
            f.write(data)
    except Exception as e:
        return {"ok": False, "error": str(e)}
    return {"ok": True, "pcId": pcid, "path": f"/card-art/{urllib.parse.quote(fname)}",
            "file": fname, "kb": len(data) // 1024}

def _art_scan(d):
    m = {}
    try:
        for f in sorted(os.listdir(d)):
            base, ext = os.path.splitext(f)
            if ext.lower() in _ART_OK_EXT:
                m[base] = f"/card-art/{urllib.parse.quote(f)}"
    except OSError:
        pass
    return m

def card_art_list():
    # Bundled/baked-in defaults first, then your live saves override them.
    out = _art_scan(BUNDLED_ART_DIR)
    out.update(_art_scan(CARD_ART_DIR))
    return {"ok": True, "art": out}

def card_art_delete(payload):
    pcid = _art_pcid(payload)
    if not pcid:
        return {"ok": False, "error": "Missing card id."}
    _art_clear(pcid)
    return {"ok": True, "pcId": pcid}

def card_art_stats():
    live = _art_scan(CARD_ART_DIR)
    bundled = _art_scan(BUNDLED_ART_DIR)
    kb = 0
    try:
        for f in os.listdir(CARD_ART_DIR):
            p = os.path.join(CARD_ART_DIR, f)
            if os.path.isfile(p):
                kb += os.path.getsize(p)
    except OSError:
        pass
    return {"ok": True, "saved": len(live), "bundled": len(bundled),
            "kb": kb // 1024, "dir": CARD_ART_DIR,
            "bakeable": os.access(ROOT, os.W_OK)}

def card_art_bake():
    """Copy your live card-art saves into the project's source folder so the NEXT
    build ships with them baked in. Only works from a dev checkout (writable
    source); a read-only .app bundle can't rewrite itself — there we just reveal
    the folder so you can back it up / drop it into source yourself."""
    live = _art_scan(CARD_ART_DIR)
    if not live:
        return {"ok": False, "error": "No saved card images yet — add some first."}
    if not os.access(ROOT, os.W_OK):
        return {"ok": False, "readonly": True, "dir": CARD_ART_DIR,
                "error": "This is the packaged app (its files are read-only). Your images are already safe in the card-art vault — use “Reveal folder” to back them up or drop them into the project source before a rebuild."}
    os.makedirs(BUNDLED_ART_DIR, exist_ok=True)
    n = 0
    try:
        for f in os.listdir(CARD_ART_DIR):
            src = os.path.join(CARD_ART_DIR, f)
            # regular image files only — never follow a symlink (could point at a secret)
            if (os.path.isfile(src) and not os.path.islink(src)
                    and os.path.splitext(f)[1].lower() in _ART_OK_EXT):
                shutil.copy2(src, os.path.join(BUNDLED_ART_DIR, f), follow_symlinks=False)
                n += 1
    except Exception as e:
        return {"ok": False, "error": str(e)}
    return {"ok": True, "baked": n, "dir": BUNDLED_ART_DIR}

def card_art_reveal():
    d = CARD_ART_DIR
    os.makedirs(d, exist_ok=True)
    try:
        subprocess.Popen(["open", d])
        return {"ok": True, "dir": d}
    except Exception as e:
        return {"ok": False, "error": str(e), "dir": d}

# ----------------------------------------------------- seller listing photos ---
# The seller's OWN photos of each real card (front/back/corners/surface/flaw),
# saved one file per angle-slot under listing-photos/<pcId>/. These are what go
# into a real listing — distinct from the catalog card-art image above.
_SLOT_RE = re.compile(r"[a-z0-9_-]{1,24}")

def _image_from_payload(payload):
    """Shared image reader for pasted data-URLs / uploaded files / public URLs.
    Returns (data_bytes, ext, error). SSRF-guarded for URLs."""
    data_url = (payload.get("dataUrl") or "").strip()
    url = (payload.get("url") or "").strip()
    if data_url.startswith("data:"):
        m = re.match(r"data:([^;,]*)(;base64)?,(.*)$", data_url, re.S)
        if not m:
            return None, None, "Bad image data."
        ext = _ART_EXT.get((m.group(1) or "").lower().strip())
        if not ext:
            return None, None, f"Unsupported image type: {m.group(1) or 'unknown'}."
        try:
            data = base64.b64decode(m.group(3)) if m.group(2) else urllib.parse.unquote_to_bytes(m.group(3))
        except Exception:
            return None, None, "Could not decode the image."
        return data, ext, None
    if url.startswith(("https://", "http://")):
        host = urllib.parse.urlparse(url).hostname or ""
        if not host:
            return None, None, "Bad image URL."
        if not _host_is_public(host):
            return None, None, "That address is blocked (local/private hosts aren't allowed)."
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "PokemonChest/1.0", "Accept": "image/*"})
            with _ART_OPENER.open(req, timeout=30) as r:
                ctype = (r.headers.get("Content-Type") or "").split(";")[0].lower().strip()
                data = r.read(_ART_MAX + 1)
        except urllib.error.HTTPError as e:
            return None, None, f"Could not download that image (HTTP {e.code})."
        except Exception as e:
            return None, None, f"Could not download that image: {e}"
        ext = _ART_EXT.get(ctype)
        if not ext:
            pe = os.path.splitext(urllib.parse.urlparse(url).path)[1].lower()
            ext = ".jpg" if pe == ".jpeg" else (pe if pe in _ART_OK_EXT else None)
        if not ext:
            return None, None, "That link isn't a direct image."
        return data, ext, None
    return None, None, "Paste an image, choose a file, or give a direct https image URL."

def _slot_ok(s):
    s = (s or "").strip()
    return s if _SLOT_RE.fullmatch(s) else None

def _listing_card_dir(pcid):
    return os.path.join(LISTING_DIR, pcid)

def save_listing_photo(payload):
    pcid = _art_pcid(payload)
    slot = _slot_ok(payload.get("slot"))
    if not pcid:
        return {"ok": False, "error": "Missing or invalid card id."}
    if not slot:
        return {"ok": False, "error": "Missing photo slot."}
    data, ext, err = _image_from_payload(payload)
    if err:
        return {"ok": False, "error": err}
    if not data:
        return {"ok": False, "error": "Empty image."}
    if len(data) > _ART_MAX:
        return {"ok": False, "error": "Image is too large (max 12 MB)."}
    d = _listing_card_dir(pcid)
    os.makedirs(d, exist_ok=True)
    for f in os.listdir(d):                      # one file per slot — clear old ext
        if os.path.splitext(f)[0] == slot:
            try:
                os.remove(os.path.join(d, f))
            except OSError:
                pass
    fname = slot + ext
    with open(os.path.join(d, fname), "wb") as fh:
        fh.write(data)
    q = urllib.parse.quote
    return {"ok": True, "pcId": pcid, "slot": slot,
            "path": f"/listing-photos/{q(pcid)}/{q(fname)}", "kb": len(data) // 1024}

def listing_photos_list(pcid):
    pcid = _art_pcid({"pcId": pcid})
    out = {}
    if pcid:
        d = _listing_card_dir(pcid)
        try:
            for f in sorted(os.listdir(d)):
                base, ext = os.path.splitext(f)
                if ext.lower() in _ART_OK_EXT:
                    out[base] = f"/listing-photos/{urllib.parse.quote(pcid)}/{urllib.parse.quote(f)}"
        except OSError:
            pass
    return {"ok": True, "pcId": pcid, "photos": out,
            "dir": _listing_card_dir(pcid) if pcid else None}

def listing_photo_delete(payload):
    pcid = _art_pcid(payload)
    slot = _slot_ok(payload.get("slot"))
    if not pcid or not slot:
        return {"ok": False, "error": "Missing card id or slot."}
    d = _listing_card_dir(pcid)
    try:
        for f in os.listdir(d):
            if os.path.splitext(f)[0] == slot:
                try:
                    os.remove(os.path.join(d, f))
                except OSError:
                    pass
    except OSError:
        pass
    return {"ok": True}

def listing_photos_reveal(payload):
    pcid = _art_pcid(payload)
    if not pcid:
        return {"ok": False, "error": "Missing card id."}
    d = _listing_card_dir(pcid)
    os.makedirs(d, exist_ok=True)
    try:
        subprocess.Popen(["open", d])
        return {"ok": True, "dir": d}
    except Exception as e:
        return {"ok": False, "error": str(e), "dir": d}

def comps_lookup(payload, settings):
    """Live sold comps via a Pokémon comps API (BYOK). Provider-agnostic shell —
    normalization finalized per provider once a real key is present."""
    provider = settings.get("comps_provider", "pokemonpricetracker")
    key = settings.get("comps_key")
    q = payload.get("q", "")
    if provider == "pokemonpricetracker":
        url = "https://www.pokemonpricetracker.com/api/v1/prices?" + urllib.parse.urlencode({"search": q})
        raw = http_json(url, headers={"Authorization": f"Bearer {key}", "Accept": "application/json"})
    elif provider == "pokemon-api":
        url = "https://www.pokemon-api.com/api/v1/cards?" + urllib.parse.urlencode({"q": q})
        raw = http_json(url, headers={"x-api-key": key, "Accept": "application/json"})
    else:
        return {"ok": False, "error": f"Unknown comps provider: {provider}"}
    return {"ok": True, "provider": provider, "raw": raw}

AI_SYSTEM = (
    "You are a sharp, honest Pokémon-card selling advisor. Given one card with its "
    "values and (optionally) live sold comps, give a tight recommendation: sell now vs "
    "hold, raw vs grade-first (name the cheapest sensible grader and rough break-even), "
    "and the single best venue for the most NET money after fees (eBay ~13.6%, "
    "TCGplayer/Mercari ~11%, Cardmarket cheapest in EU). If a gradingCostAllIn value is "
    "given in the input, USE it as the all-in grading cost — do NOT invent a different "
    "grading fee. Be concrete with numbers, 4-6 sentences, no fluff, never overpromise. "
    "End with one clear action."
)

AI_LISTING_SYSTEM = (
    "You write high-converting, honest eBay listings for trading cards and collectibles. "
    "Given item facts (name, set, number, language, condition, price, any pre-grade notes), "
    "return EXACTLY two parts separated by a line containing only '---':\n"
    "1) A keyword-optimized eBay title, 80 characters MAX (lead with the most-searched "
    "terms: franchise, card name, number, set, language, grade/condition; no filler words, "
    "no emoji, no ALL CAPS spam).\n"
    "2) A clean listing description: a strong opening line, a short bulleted facts block "
    "(set, number, year, language, condition as stated), a condition paragraph that is "
    "honest and only claims what the seller stated, and a closing block about careful "
    "packaging (penny sleeve + semi-rigid holder, bubble mailer, tracked shipping). "
    "Plain text only, no HTML. Never invent flaws or grades the seller didn't state; "
    "never guarantee a future PSA grade."
)

def ai_recommend(payload, settings):
    provider = settings.get("ai_provider", "anthropic")
    key = settings.get("ai_key")
    model = settings.get("ai_model") or ("claude-sonnet-4-6" if provider == "anthropic" else "gpt-4o")
    mode = payload.pop("mode", None) if isinstance(payload, dict) else None
    system = AI_LISTING_SYSTEM if mode == "listing" else AI_SYSTEM
    user = ("Item facts:\n" if mode == "listing" else "Card and context:\n") + json.dumps(payload, ensure_ascii=False, indent=2)
    if provider == "anthropic":
        d = http_json(
            "https://api.anthropic.com/v1/messages", method="POST",
            headers={"x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json"},
            body={"model": model, "max_tokens": 900, "system": system,
                  "messages": [{"role": "user", "content": user}]})
        text = "".join(b.get("text", "") for b in d.get("content", []) if b.get("type") == "text")
        return {"ok": True, "provider": provider, "model": model, "text": text.strip()}
    elif provider == "openai":
        d = http_json(
            "https://api.openai.com/v1/chat/completions", method="POST",
            headers={"Authorization": f"Bearer {key}", "content-type": "application/json"},
            body={"model": model, "max_tokens": 900,
                  "messages": [{"role": "system", "content": system},
                               {"role": "user", "content": user}]})
        text = d["choices"][0]["message"]["content"]
        return {"ok": True, "provider": provider, "model": model, "text": text.strip()}
    return {"ok": False, "error": f"Unknown AI provider: {provider}"}

# ----------------------------------------------------------------- refresh ---
def import_export(payload):
    """First-run onboarding: accept an uploaded PriceCharting .xlsx export,
    save it into HOME, and rebuild the collection from it. Returns
    {ok:true, report:{...}} on success or {ok:false, error} — never raises."""
    name = (payload.get("name") or "").strip()
    data_b64 = payload.get("dataB64") or ""
    if not name or "/" in name or "\\" in name or ".." in name or name.startswith("."):
        return {"ok": False, "error": "Invalid file name."}
    if not name.lower().endswith(".xlsx"):
        return {"ok": False, "error": "Only a PriceCharting .xlsx export is supported here — for a plain CSV, use ➕ Add & Sold to add cards by hand for now."}
    try:
        raw = base64.b64decode(data_b64, validate=True)
    except Exception:
        return {"ok": False, "error": "Could not decode the uploaded file."}
    if not raw:
        return {"ok": False, "error": "The uploaded file is empty."}
    if len(raw) > 25 * 1024 * 1024:
        return {"ok": False, "error": "File is too large (max 25 MB)."}
    try:
        os.makedirs(HOME, exist_ok=True)
        dest = os.path.join(HOME, name)
        tmp = dest + ".tmp"
        with open(tmp, "wb") as f:
            f.write(raw)
        os.replace(tmp, dest)
    except Exception as e:
        return {"ok": False, "error": f"Could not save the file: {e}"}
    return refresh_data()

def refresh_data():
    """Rebuild collection data by running scripts/build_data.py as a subprocess.
    Always returns a JSON-able dict — {ok:true, report:{...}} or {ok:false, error}."""
    script = os.path.join(ROOT, "scripts", "build_data.py")
    if not os.path.isfile(script):
        return {"ok": False, "error": f"builder not found: {script}"}
    env = dict(os.environ)
    env["POKECHEST_HOME"] = HOME
    try:
        os.makedirs(HOME, exist_ok=True)
        proc = subprocess.run(
            [sys.executable, script],
            capture_output=True, text=True, env=env, cwd=HOME, timeout=600)
    except subprocess.TimeoutExpired:
        return {"ok": False, "error": "data rebuild timed out after 10 minutes"}
    except Exception as e:
        return {"ok": False, "error": str(e)}
    combined = (proc.stdout or "") + "\n" + (proc.stderr or "")
    if proc.returncode != 0:
        lines = [l for l in (proc.stderr or proc.stdout or "").strip().splitlines() if l.strip()]
        msg = lines[-1] if lines else f"builder exited with code {proc.returncode}"
        if "openpyxl" in combined:
            msg += "  Hint: install it with:  pip3 install --user openpyxl"
        return {"ok": False, "error": msg}
    report = None
    for line in (proc.stdout or "").splitlines():
        if line.startswith("REPORT_JSON="):
            try:
                report = json.loads(line[len("REPORT_JSON="):])
            except Exception:
                report = None
    if not isinstance(report, dict):
        return {"ok": False, "error": "builder finished but produced no REPORT_JSON line"}
    build_pocket()  # keep the iPhone Pocket Edition in sync with fresh data
    return {"ok": True, "report": {
        "entries": report.get("entries"),
        "cards": report.get("cards"),
        "value": report.get("value"),
        "imagesMatched": report.get("imagesMatched"),
    }}

def build_pocket():
    """Regenerate the self-contained iPhone Pocket Edition HTML. Best-effort —
    never raises into a request handler."""
    script = os.path.join(ROOT, "scripts", "build_pocket.py")
    if not os.path.isfile(script):
        return {"ok": False, "error": "pocket builder not found"}
    env = dict(os.environ); env["POKECHEST_HOME"] = HOME
    try:
        proc = subprocess.run([sys.executable, script],
                              capture_output=True, text=True, env=env, cwd=HOME, timeout=120)
        if proc.returncode != 0:
            return {"ok": False, "error": (proc.stderr or proc.stdout or "pocket build failed").strip().splitlines()[-1]}
        out = os.path.join(HOME, "Pokémon Den — Pocket.html")
        kb = os.path.getsize(out) // 1024 if os.path.isfile(out) else 0
        return {"ok": True, "file": "Pokémon Den — Pocket.html", "kb": kb}
    except Exception as e:
        return {"ok": False, "error": str(e)}

MOBILE_NAME = "Pokémon Den — Deck.html"

def build_mobile():
    """Build the self-contained MOBILE app (swipe deck + deck builder + 3D battle
    buildup), embedding your CAUGHT cards' real photos + a few wild thumbnails."""
    script = os.path.join(ROOT, "scripts", "build_mobile.py")
    if not os.path.isfile(script):
        return {"ok": False, "error": "mobile builder not found"}
    env = dict(os.environ); env["POKECHEST_HOME"] = HOME
    try:
        proc = subprocess.run([sys.executable, script],
                              capture_output=True, text=True, env=env, cwd=HOME, timeout=180)
    except Exception as e:
        return {"ok": False, "error": str(e)}
    if proc.returncode != 0:
        return {"ok": False, "error": (proc.stderr or proc.stdout or "mobile build failed").strip().splitlines()[-1]}
    report = None
    for line in (proc.stdout or "").splitlines():
        if line.startswith("REPORT_JSON="):
            try:
                report = json.loads(line[len("REPORT_JSON="):])
            except Exception:
                report = None
    out = os.path.join(HOME, MOBILE_NAME)
    kb = os.path.getsize(out) // 1024 if os.path.isfile(out) else 0
    return {"ok": True, "file": MOBILE_NAME, "path": out, "kb": kb, "report": report or {}}

def deliver_mobile():
    """Copy the built mobile app to the user's own devices/paths: iCloud Drive
    (→ Files app on iPhone) and the Desktop (→ AirDrop). Local copies only."""
    out = os.path.join(HOME, MOBILE_NAME)
    if not os.path.isfile(out):
        r = build_mobile()
        if not r.get("ok"):
            return r
    delivered = []
    desk = os.path.join(os.path.expanduser("~/Desktop"), MOBILE_NAME)
    try:
        shutil.copy2(out, desk); delivered.append({"where": "Desktop (AirDrop it)", "path": desk})
    except Exception as e:
        delivered.append({"where": "Desktop", "error": str(e)})
    icloud = os.path.expanduser("~/Library/Mobile Documents/com~apple~CloudDocs")
    if os.path.isdir(icloud):
        dst = os.path.join(icloud, MOBILE_NAME)
        try:
            shutil.copy2(out, dst); delivered.append({"where": "iCloud Drive (Files app on iPhone)", "path": dst})
        except Exception as e:
            delivered.append({"where": "iCloud Drive", "error": str(e)})
    ok = any("path" in d for d in delivered)     # honest: true only if a copy landed
    return {"ok": ok, "delivered": delivered,
            **({} if ok else {"error": "Could not copy anywhere — use “Reveal file” and move it manually."})}

def reveal_mobile():
    out = os.path.join(HOME, MOBILE_NAME)
    if not os.path.isfile(out):
        return {"ok": False, "error": "Build it first."}
    try:
        subprocess.Popen(["open", "-R", out])
        return {"ok": True, "path": out}
    except Exception as e:
        return {"ok": False, "error": str(e)}

def _write_settings(s):
    """Persist the FULL settings dict (owner-only, atomic). Unlike save_settings()
    this preserves every key — used by the secure-input + Emerald features."""
    os.makedirs(HOME, exist_ok=True)
    tmp = SETTINGS + ".tmp"
    fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w", encoding="utf-8") as f:
        json.dump(s, f, indent=2)
    os.replace(tmp, SETTINGS)
    return s

# ----------------------------------------------------------- secure inputs ---
# Values live in the macOS login Keychain (encrypted at rest, OS-guarded). We
# keep only a list of LABELS in settings (never the values) so the dashboard can
# show what's saved without ever holding a secret. Nothing here is returned to
# the browser or written to any log.
KEYCHAIN_SERVICE = "com.darkhearts.pokemonchest.secret"

def secret_save(label, value):
    label = (label or "").strip()
    value = value or ""
    if not label or "\x00" in label:
        return {"ok": False, "error": "Give the input a name."}
    if not value:
        return {"ok": False, "error": "Nothing to save — the value is empty."}
    try:
        subprocess.run(
            ["security", "add-generic-password", "-U", "-s", KEYCHAIN_SERVICE,
             "-a", label, "-j", "Pokémon Den secure input", "-w", value],
            check=True, capture_output=True, text=True, timeout=20)
    except FileNotFoundError:
        return {"ok": False, "error": "macOS 'security' tool not found (this feature is macOS-only)."}
    except subprocess.CalledProcessError as e:
        return {"ok": False, "error": (e.stderr or "Keychain write failed").strip()}
    s = load_settings()
    labels = s.get("secret_labels") if isinstance(s.get("secret_labels"), list) else []
    if label not in labels:
        labels.append(label)
    s["secret_labels"] = sorted(set(labels))
    _write_settings(s)
    return {"ok": True, "label": label}

def secret_list():
    s = load_settings()
    raw = s.get("secret_labels") if isinstance(s.get("secret_labels"), list) else []
    out = []
    for label in raw:
        present = False
        try:
            r = subprocess.run(["security", "find-generic-password", "-s", KEYCHAIN_SERVICE,
                                "-a", label], capture_output=True, text=True, timeout=15)
            present = (r.returncode == 0)
        except Exception:
            present = False
        out.append({"label": label, "present": present})
    return {"ok": True, "secrets": out}

def secret_delete(label):
    label = (label or "").strip()
    if not label:
        return {"ok": False, "error": "No label."}
    try:
        subprocess.run(["security", "delete-generic-password", "-s", KEYCHAIN_SERVICE,
                        "-a", label], capture_output=True, text=True, timeout=15)
    except Exception:
        pass
    s = load_settings()
    s["secret_labels"] = [l for l in (s.get("secret_labels") or []) if l != label]
    _write_settings(s)
    return {"ok": True}

def secret_copy(label):
    """Copy a stored secret to the clipboard WITHOUT it passing through the browser
    or any log: read from Keychain, pipe straight to pbcopy, return only ok."""
    label = (label or "").strip()
    try:
        r = subprocess.run(["security", "find-generic-password", "-w", "-s", KEYCHAIN_SERVICE,
                            "-a", label], capture_output=True, text=True, timeout=15)
        if r.returncode != 0:
            return {"ok": False, "error": "Not found in Keychain."}
        value = r.stdout[:-1] if r.stdout.endswith("\n") else r.stdout
        p = subprocess.run(["pbcopy"], input=value, text=True, timeout=10)
        return {"ok": p.returncode == 0, "label": label} if p.returncode == 0 \
            else {"ok": False, "error": "Clipboard copy failed."}
    except Exception as e:
        return {"ok": False, "error": str(e)}

# ------------------------------------------------------ LAN / phone access ---
# Opt-in second listener on 0.0.0.0 so your phone (same Wi-Fi) can open the app
# and scan cards straight into the collection. HTTPS via a locally generated
# self-signed cert when the openssl CLI is available (live camera preview on
# phones requires a secure context); plain-HTTP LAN still works for the
# file-input "take photo" flow. Never expose this port beyond your home router.
LAN = {"enabled": False, "server": None, "thread": None, "port": PORT + 1,
       "scheme": "http", "tls": False, "error": None}
LAN_LOCK = threading.Lock()
TLS_DIR = os.path.join(HOME, "lan-tls")

def _is_private_ip(ip):
    try:
        a = ipaddress.ip_address(ip.strip("[]"))
        return a.is_private or a.is_loopback or a.is_link_local
    except ValueError:
        return False

def _lan_ips():
    """Best-effort list of this machine's private IPv4 addresses."""
    ips = []
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.settimeout(2)
        s.connect(("8.8.8.8", 80))          # no packets sent — just picks a route
        ip = s.getsockname()[0]
        s.close()
        if ip and not ip.startswith("127."):
            ips.append(ip)
    except Exception:
        pass
    try:
        for info in socket.getaddrinfo(socket.gethostname(), None, socket.AF_INET):
            ip = info[4][0]
            if ip not in ips and not ip.startswith("127."):
                ips.append(ip)
    except Exception:
        pass
    priv = [ip for ip in ips if _is_private_ip(ip)]
    return priv or ips

def _ensure_lan_cert(ips):
    """Self-signed cert for LAN HTTPS. Returns (cert, key) paths or None."""
    cert, key = os.path.join(TLS_DIR, "cert.pem"), os.path.join(TLS_DIR, "key.pem")
    if os.path.isfile(cert) and os.path.isfile(key):
        return cert, key
    openssl = shutil.which("openssl")
    if not openssl:
        return None
    os.makedirs(TLS_DIR, exist_ok=True)
    san = ",".join(["DNS:localhost", "IP:127.0.0.1"] + [f"IP:{ip}" for ip in ips])
    base = [openssl, "req", "-x509", "-newkey", "rsa:2048", "-sha256", "-nodes",
            "-days", "825", "-keyout", key, "-out", cert, "-subj", "/CN=Pokemon Den LAN"]
    try:
        subprocess.run(base + ["-addext", f"subjectAltName={san}"],
                       check=True, capture_output=True, timeout=60)
        return cert, key
    except Exception:
        try:  # older LibreSSL without -addext — cert still enables HTTPS
            subprocess.run(base, check=True, capture_output=True, timeout=60)
            return cert, key
        except Exception:
            return None

def lan_start():
    with LAN_LOCK:
        if LAN["server"] is not None:
            LAN["enabled"] = True
            return lan_status()
        LAN["error"] = None
        ips = _lan_ips()
        try:
            srv = ThreadingHTTPServer(("0.0.0.0", LAN["port"]), Handler)
            pair = _ensure_lan_cert(ips)
            if pair:
                ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
                ctx.load_cert_chain(pair[0], pair[1])
                srv.socket = ctx.wrap_socket(srv.socket, server_side=True)
                LAN["scheme"], LAN["tls"] = "https", True
            else:
                LAN["scheme"], LAN["tls"] = "http", False
            t = threading.Thread(target=srv.serve_forever, daemon=True)
            t.start()
            LAN.update(server=srv, thread=t, enabled=True)
        except Exception as e:
            LAN.update(server=None, thread=None, enabled=False, error=str(e))
    s = load_settings()
    s["lan_mode"] = bool(LAN["enabled"])
    _write_settings(s)
    return lan_status()

def lan_stop():
    with LAN_LOCK:
        srv = LAN["server"]
        LAN.update(server=None, thread=None, enabled=False, error=None)
        if srv is not None:
            try:
                threading.Thread(target=srv.shutdown, daemon=True).start()
            except Exception:
                pass
    s = load_settings()
    s["lan_mode"] = False
    _write_settings(s)
    return lan_status()

def lan_status():
    ips = _lan_ips()
    urls = [f"{LAN['scheme']}://{ip}:{LAN['port']}" for ip in ips] if LAN["enabled"] else []
    return {"ok": True, "enabled": LAN["enabled"], "port": LAN["port"],
            "scheme": LAN["scheme"], "tls": LAN["tls"], "ips": ips, "urls": urls,
            "error": LAN["error"]}

# ------------------------------------------------- PriceCharting bulk sync ---
# With your own PriceCharting API token, re-price the WHOLE collection straight
# from their Product API (no export download needed) and rewrite the live
# data/collection.json. The xlsx export flow stays as the no-key fallback.
PC_SYNC = {"running": False, "total": 0, "done": 0, "updated": 0, "errors": 0,
           "startedAt": None, "finishedAt": None, "value": None, "lastError": None}
PC_LOCK = threading.Lock()

def _live_collection_path():
    p = os.path.join(HOME, "data", "collection.json")
    return p if os.path.isfile(p) else os.path.join(ROOT, "data", "collection.json")

def _pc_pick_price(card, tiers):
    """Map PriceCharting graded tiers onto this card's actual condition."""
    def first(*keys):
        for k in keys:
            v = tiers.get(k)
            if v:
                return v
        return None
    if card.get("graded"):
        try:
            g = float(card.get("grade") or 0)
        except (TypeError, ValueError):
            g = 0
        if g >= 10:
            return first("psa10", "grade9_5", "grade9", "ungraded")
        if g >= 9.5:
            return first("grade9_5", "psa10", "grade9", "ungraded")
        if g >= 9:
            return first("grade9", "grade9_5", "ungraded")
        if g >= 7:
            return first("grade7to8", "grade9", "ungraded")
        return first("ungraded", "grade7to8")
    return first("ungraded")

def _pc_recompute_meta(cards, old_meta):
    tot_val = sum(c.get("value") or 0 for c in cards)
    tot_cost = sum((c.get("cost") or 0) * (c.get("qty") or 1) for c in cards)
    by_lang, by_set, by_game = {}, {}, {}
    for c in cards:
        v = c.get("value") or 0
        by_lang[c.get("lang") or "en"] = by_lang.get(c.get("lang") or "en", 0) + v
        by_set[c.get("set") or "?"] = by_set.get(c.get("set") or "?", 0) + v
        by_game[c.get("game") or "?"] = by_game.get(c.get("game") or "?", 0) + v
    m = dict(old_meta or {})
    m.update({
        "totalCards": sum(c.get("qty") or 1 for c in cards),
        "totalEntries": len(cards),
        "totalValue": round(tot_val, 2),
        "totalCost": round(tot_cost, 2),
        "totalPL": round(tot_val - tot_cost, 2),
        "byLang": {k: round(v, 2) for k, v in by_lang.items()},
        "byGame": {k: round(v, 2) for k, v in sorted(by_game.items(), key=lambda x: -x[1])},
        "topSets": sorted(({"set": k, "value": round(v, 2)} for k, v in by_set.items()),
                          key=lambda x: -x["value"])[:15],
    })
    return m

def _pc_sync_worker(token):
    try:
        with open(_live_collection_path(), encoding="utf-8") as f:
            col = json.load(f)
        cards = col.get("cards") or []
        with PC_LOCK:
            PC_SYNC["total"] = len(cards)
        for c in cards:
            with PC_LOCK:
                PC_SYNC["done"] += 1
            pcid = c.get("pcId")
            if not pcid:
                continue
            try:
                r = pricecharting_price(str(pcid), token)
                if r.get("ok"):
                    p = _pc_pick_price(c, r.get("tiers") or {})
                    if p is not None and p != c.get("price"):
                        qty = c.get("qty") or 1
                        cost = (c.get("cost") or 0) * qty
                        c["price"] = p
                        c["value"] = round(p * qty, 2)
                        c["pl"] = round(c["value"] - cost, 2)
                        c["plPct"] = round(c["pl"] / cost * 100, 1) if cost else None
                        with PC_LOCK:
                            PC_SYNC["updated"] += 1
                else:
                    with PC_LOCK:
                        PC_SYNC["errors"] += 1
                        PC_SYNC["lastError"] = r.get("error")
            except Exception as e:
                with PC_LOCK:
                    PC_SYNC["errors"] += 1
                    PC_SYNC["lastError"] = str(e)
            time.sleep(0.12)          # be polite to the API (~8 req/s)
        col["meta"] = _pc_recompute_meta(cards, col.get("meta"))
        col["pcSyncedAt"] = datetime.datetime.now().isoformat(timespec="seconds")
        out = os.path.join(HOME, "data", "collection.json")
        os.makedirs(os.path.dirname(out), exist_ok=True)
        tmp = out + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(col, f, ensure_ascii=False)
        os.replace(tmp, out)
        with PC_LOCK:
            PC_SYNC["value"] = col["meta"]["totalValue"]
    except Exception as e:
        with PC_LOCK:
            PC_SYNC["lastError"] = str(e)
    finally:
        with PC_LOCK:
            PC_SYNC["running"] = False
            PC_SYNC["finishedAt"] = datetime.datetime.now().isoformat(timespec="seconds")

def pc_sync_start():
    s = load_settings()
    token = s.get("pricecharting_token")
    if not token:
        return {"ok": False, "error": "Add your PriceCharting token in ⚙ Live first."}
    with PC_LOCK:
        if PC_SYNC["running"]:
            return dict(PC_SYNC, ok=True, alreadyRunning=True)
        PC_SYNC.update(running=True, total=0, done=0, updated=0, errors=0,
                       startedAt=datetime.datetime.now().isoformat(timespec="seconds"),
                       finishedAt=None, value=None, lastError=None)
    threading.Thread(target=_pc_sync_worker, args=(token,), daemon=True).start()
    return dict(PC_SYNC, ok=True)

def pc_sync_status():
    with PC_LOCK:
        return dict(PC_SYNC, ok=True)

# ---------------------------------------------------------------- card codex ---
# data/codex.json: every EN + JA Pokémon TCG set and card from TCGdex
# (395 sets / 31,603 cards, secret + special rares included). Built by
# scripts/build_codex.py, no API key required. This is the ONLY card lookup
# that needs neither a PriceCharting token nor a network connection, so it
# backstops both the collection search and the paid catalog search.
CODEX = {"data": None, "loaded": False}
CODEX_LOCK = threading.Lock()

def _codex_load():
    """Lazy-load + memoize codex.json (7.6 MB) on first search, not at boot."""
    with CODEX_LOCK:
        if CODEX["loaded"]:
            return CODEX["data"]
        CODEX["loaded"] = True
        for p in (os.path.join(HOME, "data", "codex.json"),
                  os.path.join(ROOT, "data", "codex.json")):
            try:
                with open(p, encoding="utf-8") as f:
                    CODEX["data"] = json.load(f)
                break
            except Exception:
                continue
        return CODEX["data"]

CODEX_IDX = {"bySet": None, "sets": None}

def _codex_index():
    """Memoized {lang:setId -> [cards]} and {lang:setId -> set meta} views."""
    if CODEX_IDX["bySet"] is not None:
        return CODEX_IDX["bySet"], CODEX_IDX["sets"]
    d = _codex_load()
    by_set, sets = {}, {}
    if d:
        for c in d.get("cards", []):
            by_set.setdefault(f"{c.get('lang')}:{c.get('setId')}", []).append(c)
        for s in d.get("sets", []):
            sets[f"{s.get('lang')}:{s.get('id')}"] = s
    CODEX_IDX["bySet"], CODEX_IDX["sets"] = by_set, sets
    return by_set, sets

def _num_key(n):
    """Match build_data.py's set_card_index(): strip leading zeros so '004',
    '4' and 4 all collide."""
    s = str(n if n is not None else "").strip().lstrip("0")
    return s or "0"

def codex_completion(payload):
    """Given {owned: {'<lang>:<setId>': [numbers…]}} return per-set completion
    computed entirely from the bundled codex — no network, no API key. Each
    card is returned already flagged owned/not so the client can render both
    the official-set and master-set views without a second round trip."""
    d = _codex_load()
    if not d:
        return {"ok": False, "error": "codex.json not found — run scripts/build_codex.py"}
    by_set, sets = _codex_index()
    owned = (payload or {}).get("owned") or {}
    out = []
    for key, nums in owned.items():
        meta, cards = sets.get(key), by_set.get(key)
        if not meta:
            continue
        have = {_num_key(n) for n in (nums or [])}
        # 111 of the codex's 395 sets carry set metadata but no card list (the
        # codex build couldn't fetch their cards). Those are still reported —
        # with the real denominator and an owned count — flagged partial, so a
        # set never silently vanishes from the tracker just because we can't
        # enumerate which specific cards are missing.
        out.append({
            "key": key, "id": meta.get("id"), "lang": meta.get("lang"),
            "name": meta.get("name"), "year": meta.get("year"),
            "official": meta.get("official"), "total": meta.get("total"),
            "partial": not cards,
            "ownedCount": len(have),
            "cards": [{"n": c.get("number"), "name": c.get("name"),
                       "sp": bool(c.get("special")),
                       "own": _num_key(c.get("number")) in have} for c in (cards or [])],
        })
    out.sort(key=lambda s: -(sum(1 for c in s["cards"] if c["own"]) or s["ownedCount"]))
    return {"ok": True, "sets": out,
            "partialSets": sum(1 for s in out if s["partial"])}

def codex_search(q, limit=25, special_only=False):
    """Token-AND over each card's prebuilt lowercase `q` field — same matching
    rule the collection search uses, so results feel identical."""
    d = _codex_load()
    if not d:
        return {"ok": False, "error": "codex.json not found — run scripts/build_codex.py"}
    terms = [t for t in re.split(r"\s+", (q or "").strip().lower()) if t]
    if not terms:
        return {"ok": True, "cards": [], "meta": d.get("meta", {})}
    out = []
    for c in d.get("cards", []):
        if special_only and not c.get("special"):
            continue
        hay = c.get("q") or ""
        if all(t in hay for t in terms):
            out.append(c)
            if len(out) >= limit:
                break
    return {"ok": True, "cards": out, "meta": d.get("meta", {})}

def pc_search(q, token):
    """Search PriceCharting's product catalog — powers no-typing card adds,
    the AI-identify -> catalog-match handoff in the Scanner, and binder-scan
    add. Backed by search_cache_get/put: a fresh cache hit skips the network
    entirely; a stale hit still answers immediately (stale:True) and a
    background refresh brings it current for next time; a miss searches live
    and seeds the cache for every future scan session."""
    q = (q or "").strip()
    if not q:
        return {"ok": True, "products": []}
    cached, stale = search_cache_get(q)
    if cached is not None and not stale:
        return {"ok": True, "products": cached, "cached": True}
    try:
        url = "https://www.pricecharting.com/api/products?" + urllib.parse.urlencode({"t": token, "q": q})
        d = http_json(url)
        if d.get("status") == "error":
            if cached is not None:
                return {"ok": True, "products": cached, "cached": True, "stale": True}
            return {"ok": False, "error": d.get("error-message", "PriceCharting error")}
        out = []
        for p in (d.get("products") or [])[:12]:
            name = p.get("product-name") or ""
            m = re.search(r"#\s*([A-Za-z0-9-]+)\s*$", name)
            out.append({
                "id": p.get("id"),
                "name": re.sub(r"\s*#\s*[A-Za-z0-9-]+\s*$", "", name).strip(),
                "number": m.group(1) if m else None,
                "set": p.get("console-name") or "",
                "price": cents(p.get("loose-price")),
            })
        search_cache_put(q, out)
        return {"ok": True, "products": out}
    except Exception:
        # Network hiccup mid-scan: a stale cache hit beats a hard failure.
        if cached is not None:
            return {"ok": True, "products": cached, "cached": True, "stale": True}
        raise

# ------------------------------------------------- AI card identification ---
AI_IDENTIFY_SYSTEM = (
    "You identify trading cards from a photo. Look at the card and respond with ONLY a JSON object, "
    "no prose, no code fences: {\"name\": card name, \"number\": collector number without the set-size "
    "denominator, \"set\": set name, \"lang\": \"en\" or \"ja\", \"game\": e.g. \"Pokémon\", "
    "\"graded\": true/false (is it in a grading slab), \"confidence\": 0-1}. Use null for anything unreadable.")

AI_IDENTIFY_GRID_SYSTEM = (
    "You identify trading cards from a photo of a 9-pocket binder page (3x3 grid). Respond with ONLY a "
    "JSON array, no prose, no code fences: up to 9 objects, one per occupied pocket, row-major starting "
    "top-left: {\"slot\": 1-9, \"name\": card name, \"number\": collector number without the set-size "
    "denominator, \"set\": set name, \"lang\": \"en\" or \"ja\", \"game\": e.g. \"Pokémon\", "
    "\"graded\": true/false, \"confidence\": 0-1}. Omit empty pockets entirely. Use null for anything "
    "unreadable on a card you can otherwise see.")

def ai_identify(payload, settings):
    provider = settings.get("ai_provider", "anthropic")
    key = settings.get("ai_key")
    model = settings.get("ai_model") or ("claude-sonnet-4-6" if provider == "anthropic" else "gpt-4o")
    data_url = (payload.get("dataUrl") or "")
    m = re.match(r"data:(image/[a-z+.-]+);base64,(.+)$", data_url, re.S)
    if not m:
        return {"ok": False, "error": "Send the photo as a data URL."}
    media_type, b64 = m.group(1), m.group(2).strip()
    grid = payload.get("mode") == "grid"
    system = AI_IDENTIFY_GRID_SYSTEM if grid else AI_IDENTIFY_SYSTEM
    prompt = "Identify every card in this 3x3 binder-page photo." if grid else "Identify this trading card."
    max_tokens = 2000 if grid else 300
    if provider == "anthropic":
        d = http_json(
            "https://api.anthropic.com/v1/messages", method="POST",
            headers={"x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json"},
            body={"model": model, "max_tokens": max_tokens, "system": system,
                  "messages": [{"role": "user", "content": [
                      {"type": "image", "source": {"type": "base64", "media_type": media_type, "data": b64}},
                      {"type": "text", "text": prompt}]}]})
        text = "".join(b.get("text", "") for b in d.get("content", []) if b.get("type") == "text")
    elif provider == "openai":
        d = http_json(
            "https://api.openai.com/v1/chat/completions", method="POST",
            headers={"Authorization": f"Bearer {key}", "content-type": "application/json"},
            body={"model": model, "max_tokens": max_tokens,
                  "messages": [{"role": "system", "content": system},
                               {"role": "user", "content": [
                                   {"type": "image_url", "image_url": {"url": data_url}},
                                   {"type": "text", "text": prompt}]}]})
        text = d["choices"][0]["message"]["content"]
    else:
        return {"ok": False, "error": f"Unknown AI provider: {provider}"}
    if grid:
        j = re.search(r"\[.*\]", text, re.S)
        if not j:
            return {"ok": False, "error": "The model returned no JSON.", "raw": text[:300]}
        try:
            guesses = json.loads(j.group(0))
        except Exception:
            return {"ok": False, "error": "Could not parse the model's JSON.", "raw": text[:300]}
        if not isinstance(guesses, list):
            return {"ok": False, "error": "Model returned JSON, but not an array.", "raw": text[:300]}
        return {"ok": True, "guesses": guesses, "provider": provider, "model": model}
    j = re.search(r"\{.*\}", text, re.S)
    if not j:
        return {"ok": False, "error": "The model returned no JSON.", "raw": text[:300]}
    try:
        guess = json.loads(j.group(0))
    except Exception:
        return {"ok": False, "error": "Could not parse the model's JSON.", "raw": text[:300]}
    return {"ok": True, "guess": guess, "provider": provider, "model": model}

# ------------------------------------------------------- AI condition pre-grade ---
AI_GRADE_SYSTEM = (
    "You pre-grade trading cards from a photo like a PSA grader. Respond with ONLY a JSON "
    "object, no prose: {\"centering\":{\"lr\":\"55/45\",\"tb\":\"60/40\",\"worstPct\":60},"
    "\"corners\":0-10,\"edges\":0-10,\"surface\":0-10,\"flaws\":[short strings],\"estGrade\":1-10,"
    "\"confidence\":0-1}. worstPct is the worst-axis border percentage. Use null for anything unreadable.")

def ai_grade(payload, settings):
    """Modeled exactly on ai_identify: same provider branches, same data-url regex,
    same error shape — only the system prompt, token budget, and JSON-object (not
    array) parsing differ."""
    provider = settings.get("ai_provider", "anthropic")
    key = settings.get("ai_key")
    model = settings.get("ai_model") or ("claude-sonnet-4-6" if provider == "anthropic" else "gpt-4o")
    data_url = (payload.get("dataUrl") or "")
    m = re.match(r"data:(image/[a-z+.-]+);base64,(.+)$", data_url, re.S)
    if not m:
        return {"ok": False, "error": "Send the photo as a data URL."}
    media_type, b64 = m.group(1), m.group(2).strip()
    system = AI_GRADE_SYSTEM
    prompt = "Pre-grade this trading card."
    max_tokens = 500
    if provider == "anthropic":
        d = http_json(
            "https://api.anthropic.com/v1/messages", method="POST",
            headers={"x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json"},
            body={"model": model, "max_tokens": max_tokens, "system": system,
                  "messages": [{"role": "user", "content": [
                      {"type": "image", "source": {"type": "base64", "media_type": media_type, "data": b64}},
                      {"type": "text", "text": prompt}]}]})
        text = "".join(b.get("text", "") for b in d.get("content", []) if b.get("type") == "text")
    elif provider == "openai":
        d = http_json(
            "https://api.openai.com/v1/chat/completions", method="POST",
            headers={"Authorization": f"Bearer {key}", "content-type": "application/json"},
            body={"model": model, "max_tokens": max_tokens,
                  "messages": [{"role": "system", "content": system},
                               {"role": "user", "content": [
                                   {"type": "image_url", "image_url": {"url": data_url}},
                                   {"type": "text", "text": prompt}]}]})
        text = d["choices"][0]["message"]["content"]
    else:
        return {"ok": False, "error": f"Unknown AI provider: {provider}"}
    j = re.search(r"\{.*\}", text, re.S)
    if not j:
        return {"ok": False, "error": "The model returned no JSON.", "raw": text[:300]}
    try:
        grade = json.loads(j.group(0))
    except Exception:
        return {"ok": False, "error": "Could not parse the model's JSON.", "raw": text[:300]}
    return {"ok": True, "grade": grade, "provider": provider, "model": model}

# --------------------------------------------------- auto inventory import ---
# Watches for a new/updated PriceCharting export (project folder, POKECHEST_HOME,
# ~/Downloads) and rebuilds the collection automatically — download the export,
# and the app pulls the new inventory in on its own, no clicks, no typing.
AUTOSYNC = {"enabled": True, "running": False, "lastCheck": None, "lastImport": None,
            "lastReport": None, "lastError": None, "source": None, "seq": 0}
AUTOSYNC_LOCK = threading.Lock()

def _newest_export():
    """Newest PriceCharting .xlsx. Prefers the iCloud-aware finder, which also
    searches Desktop/Documents/iCloud Drive and forces cloud-only *.icloud
    placeholders to download before reading them — without that, an export that
    migrated into iCloud is invisible to the watcher. Falls back to the original
    HOME/ROOT/~Downloads scan if mac_paths isn't present or errors."""
    if _find_pc_xlsx:
        try:
            best, _diag = _find_pc_xlsx(ROOT, HOME)
            if best:
                return best
        except Exception:
            pass
    files = []
    seen = set()
    for d in (HOME, ROOT, os.path.expanduser("~/Downloads")):
        d = os.path.abspath(d)
        if d in seen or not os.path.isdir(d):
            continue
        seen.add(d)
        try:
            names = os.listdir(d)
        except OSError:
            continue
        for f in names:
            if f.lower().endswith(".xlsx") and not f.startswith("~$") \
                    and "pricecharting" in f.lower():
                files.append(os.path.join(d, f))
    return max(files, key=os.path.getmtime) if files else None

def _built_mtime():
    for p in (os.path.join(HOME, "data", "collection.json"),
              os.path.join(ROOT, "data", "collection.json")):
        if os.path.isfile(p):
            return os.path.getmtime(p)
    return 0

def _autosync_tick():
    src = _newest_export()
    AUTOSYNC["lastCheck"] = datetime.datetime.now().isoformat(timespec="seconds")
    if not src or os.path.getmtime(src) <= _built_mtime():
        return
    with PC_LOCK:
        if PC_SYNC["running"]:      # don't fight the price-sync writer
            return
    AUTOSYNC["running"] = True
    try:
        r = refresh_data()
        if r.get("ok"):
            AUTOSYNC.update(source=os.path.basename(src), lastReport=r.get("report"),
                            lastImport=datetime.datetime.now().isoformat(timespec="seconds"),
                            lastError=None)
            AUTOSYNC["seq"] += 1
        else:
            AUTOSYNC["lastError"] = r.get("error")
    finally:
        AUTOSYNC["running"] = False

def _autosync_loop():
    time.sleep(6)                   # let the server settle before the first pass
    while True:
        try:
            AUTOSYNC["enabled"] = bool(load_settings().get("autosync", True))
            if AUTOSYNC["enabled"]:
                with AUTOSYNC_LOCK:
                    _autosync_tick()
        except Exception as e:
            AUTOSYNC["lastError"] = str(e)
        time.sleep(20)

def autosync_status():
    return dict(AUTOSYNC, ok=True)

def autosync_set(enabled):
    s = load_settings()
    s["autosync"] = bool(enabled)
    _write_settings(s)
    AUTOSYNC["enabled"] = bool(enabled)
    return autosync_status()

# ------------------------------------------------------------- emerald lab ---
# Build the open-source pokeemerald decompilation into a fresh, legal ROM and run
# it — entirely from the dashboard, no Terminal. The only privileged step is the
# one-time devkitARM install, which goes through a native macOS admin prompt
# (osascript). The password is never seen, stored, or logged by this app.
DEFAULT_EMERALD_REPO = os.path.expanduser("~/EmeraldLab/pokeemerald")
DEVKITARM_GCC = "/opt/devkitpro/devkitARM/bin/arm-none-eabi-gcc"
DKP_PACMAN = "/usr/local/bin/dkp-pacman"

EMERALD = {"running": False, "phase": "idle", "log": [], "ok": None}
EMERALD_LOCK = threading.Lock()
EMERALD_LOG_FILE = os.path.join(HOME, "emerald-build.log")

def _emerald_repo():
    s = load_settings()
    return os.path.expanduser((s.get("emerald_repo") or "").strip() or DEFAULT_EMERALD_REPO)

def _which_mgba():
    for c in ("/opt/homebrew/bin/mgba", "/usr/local/bin/mgba",
              "/opt/homebrew/bin/mgba-qt", "/usr/local/bin/mgba-qt"):
        if os.path.exists(c):
            return c
    return shutil.which("mgba") or shutil.which("mgba-qt")

def _emerald_rom(repo):
    for name in ("pokeemerald.gba", "pokeemerald_modern.gba"):
        p = os.path.join(repo, name)
        if os.path.isfile(p):
            return p
    try:
        for f in sorted(os.listdir(repo)):
            if f.endswith(".gba"):
                return os.path.join(repo, f)
    except Exception:
        pass
    return None

def emerald_status():
    repo = _emerald_repo()
    rom = _emerald_rom(repo)
    with EMERALD_LOCK:
        running, phase, ok, logn = EMERALD["running"], EMERALD["phase"], EMERALD["ok"], len(EMERALD["log"])
    return {"ok": True, "repo": repo,
            "repoFound": os.path.isfile(os.path.join(repo, "Makefile")),
            "toolchain": os.path.exists(DEVKITARM_GCC),
            "rom": rom, "romFound": bool(rom), "emulator": bool(_which_mgba()),
            "running": running, "phase": phase, "lastOk": ok, "logLen": logn}

def _log(line):
    parts = str(line).rstrip("\n").split("\n")
    with EMERALD_LOCK:
        EMERALD["log"].extend(parts)
        if len(EMERALD["log"]) > 600:
            EMERALD["log"] = EMERALD["log"][-600:]
    try:
        with open(EMERALD_LOG_FILE, "a", encoding="utf-8") as f:
            f.write("\n".join(parts) + "\n")
    except Exception:
        pass

def _run_stream(cmd, *, shell_login=False, label=""):
    if label:
        _log(f"$ {label}")
    argv = ["/bin/zsh", "-lc", cmd] if shell_login else cmd
    try:
        proc = subprocess.Popen(argv, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                                text=True, bufsize=1)
    except Exception as e:
        _log(f"could not start: {e}")
        return 127
    for line in proc.stdout:
        _log(line)
    proc.wait()
    return proc.returncode

def _emerald_install_worker():
    try:
        with EMERALD_LOCK:
            EMERALD["log"] = []
        _log("=== Installing build prerequisites ===")
        _log("Installing pkg-config + libpng via Homebrew (no password needed)…")
        _run_stream("brew install pkg-config libpng 2>&1 || true",
                    shell_login=True, label="brew install pkg-config libpng")
        if os.path.exists(DEVKITARM_GCC):
            _log("devkitARM (GBA toolchain) already installed ✓")
        else:
            _log("Installing the Game Boy Advance toolchain (devkitARM).")
            _log("macOS will ask for your password ONCE — it goes straight to the")
            _log("system installer and is never seen or stored by this app.")
            inner = f"{DKP_PACMAN} -Sy --noconfirm && {DKP_PACMAN} -S --noconfirm gba-dev devkitarm-rules"
            prompt = "Pokémon Den needs your Mac password once to install the Game Boy Advance toolchain (devkitARM)."
            esc_cmd = inner.replace("\\", "\\\\").replace('"', '\\"')
            esc_prompt = prompt.replace("\\", "\\\\").replace('"', '\\"')
            osa = f'do shell script "{esc_cmd}" with administrator privileges with prompt "{esc_prompt}"'
            rc = _run_stream(["/usr/bin/osascript", "-e", osa], label="install devkitARM (admin)")
            if rc != 0 and not os.path.exists(DEVKITARM_GCC):
                _log(f"Toolchain install did not complete (exit {rc}).")
                with EMERALD_LOCK:
                    EMERALD["ok"], EMERALD["phase"] = False, "install-failed"
                return
        zshrc = os.path.expanduser("~/.zshrc")
        try:
            existing = open(zshrc, encoding="utf-8").read() if os.path.isfile(zshrc) else ""
            add = ""
            if "DEVKITPRO=" not in existing:
                add += "export DEVKITPRO=/opt/devkitpro\n"
            if "DEVKITARM=" not in existing:
                add += "export DEVKITARM=/opt/devkitpro/devkitARM\n"
            if add:
                with open(zshrc, "a", encoding="utf-8") as f:
                    f.write("\n# Added by Pokémon Den — Emerald Lab\n" + add)
                _log("Added DEVKITPRO/DEVKITARM to ~/.zshrc ✓")
        except Exception as e:
            _log(f"(could not update ~/.zshrc: {e})")
        ok = os.path.exists(DEVKITARM_GCC)
        _log("✓ Toolchain ready — now hit ② Build ROM." if ok else "Toolchain still not found — see log above.")
        with EMERALD_LOCK:
            EMERALD["ok"], EMERALD["phase"] = ok, ("ready" if ok else "install-failed")
    finally:
        with EMERALD_LOCK:
            EMERALD["running"] = False

def _emerald_build_worker():
    try:
        repo = _emerald_repo()
        with EMERALD_LOCK:
            EMERALD["log"] = []
        if not os.path.isfile(os.path.join(repo, "Makefile")):
            _log(f"No pokeemerald Makefile at: {repo}")
            _log("Set the correct folder in the box above and try again.")
            with EMERALD_LOCK:
                EMERALD["ok"], EMERALD["phase"] = False, "build-failed"
            return
        if not os.path.exists(DEVKITARM_GCC):
            _log("GBA toolchain (devkitARM) isn't installed yet — run ① Install first.")
            with EMERALD_LOCK:
                EMERALD["ok"], EMERALD["phase"] = False, "build-failed"
            return
        _log("=== Building Pokémon Emerald from source ===")
        _log(f"Repo: {repo}")
        _log("Compiling the open-source decompilation into a fresh, legal ROM. No ROM download.")
        cmd = ("export DEVKITPRO=/opt/devkitpro DEVKITARM=/opt/devkitpro/devkitARM; "
               f"cd {shlex.quote(repo)} && make modern -j$(sysctl -n hw.ncpu)")
        rc = _run_stream(cmd, shell_login=True, label="make modern")
        rom = _emerald_rom(repo)
        ok = (rc == 0 and bool(rom))
        _log(f"✓ BUILD DONE — ROM: {rom}" if ok else f"Build failed (exit {rc}). The last lines above show why.")
        with EMERALD_LOCK:
            EMERALD["ok"], EMERALD["phase"] = ok, ("built" if ok else "build-failed")
    finally:
        with EMERALD_LOCK:
            EMERALD["running"] = False

def emerald_start(kind):
    with EMERALD_LOCK:
        if EMERALD["running"]:
            return {"ok": False, "error": "Already running — watch the log below."}
        EMERALD["running"], EMERALD["ok"] = True, None
        EMERALD["phase"] = "installing" if kind == "install" else "building"
        phase = EMERALD["phase"]
    threading.Thread(target=_emerald_install_worker if kind == "install" else _emerald_build_worker,
                     daemon=True).start()
    return {"ok": True, "phase": phase}

def emerald_play():
    repo = _emerald_repo()
    rom = _emerald_rom(repo)
    if not rom:
        return {"ok": False, "error": "No built ROM yet — build it first (step ②)."}
    mgba = _which_mgba()
    if not mgba:
        return {"ok": False, "error": "mGBA not found. Install it with:  brew install mgba"}
    try:
        subprocess.Popen([mgba, rom], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                         start_new_session=True)
        return {"ok": True, "rom": rom, "emulator": mgba}
    except Exception as e:
        return {"ok": False, "error": str(e)}

def emerald_log(since):
    with EMERALD_LOCK:
        log = EMERALD["log"]
        total = len(log)
        try:
            since = max(0, int(since))
        except Exception:
            since = 0
        return {"ok": True, "lines": log[since:], "next": total,
                "running": EMERALD["running"], "phase": EMERALD["phase"], "lastOk": EMERALD["ok"]}

# ----------------------------------------------------------------- handler ---
# Hardening: request bodies are capped (an image-upload xlsx/base64 payload
# tops out well under this), and endpoints that touch the Keychain, run
# subprocesses, open Finder, or reconfigure the server itself only answer to
# connections from this Mac — a phone on the LAN listener gets 403 for those.
BODY_MAX = 48 * 1024 * 1024

class PayloadTooLarge(Exception):
    pass

# Paths the static file server must never serve, even to localhost: BYOK keys,
# the LAN TLS private key, the raw export, and any dot-path (.git, .DS_Store…).
def _static_blocked(path):
    parts = [p for p in urllib.parse.unquote(path).split("/") if p]
    if any(p.startswith(".") for p in parts):
        return True
    low = [p.lower() for p in parts]
    if low and (low[0].startswith("settings.local.json") or low[0] == "lan-tls"):
        return True
    if low and low[-1].endswith(".xlsx"):
        return True
    return False

class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *a, **k):
        super().__init__(*a, directory=ROOT, **k)

    def log_message(self, *a):  # quieter console
        pass

    def end_headers(self):
        # On every response, static files included.
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("X-Frame-Options", "DENY")
        self.send_header("Referrer-Policy", "no-referrer")
        super().end_headers()

    def _json(self, obj, code=200):
        body = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def _read_body(self):
        n = int(self.headers.get("Content-Length", 0))
        if n > BODY_MAX:
            raise PayloadTooLarge()
        return json.loads(self.rfile.read(n) or b"{}") if n else {}

    def _ship_blocked(self, path):
        """Emerald Lab is stripped from ship builds — refuse its routes there
        so the flag isn't just a hidden UI panel."""
        if path.startswith("/api/emerald") and ship_build():
            self._json({"ok": False, "error": "not available in this build"}, 404)
            return True
        return False

    def _loopback_only(self):
        """This-Mac-only controls: Keychain, subprocess runners, Finder reveals,
        key writes, LAN on/off. The phone (LAN listener) can browse and scan,
        never administer."""
        if self.client_address[0] in ("127.0.0.1", "::1", "::ffff:127.0.0.1"):
            return True
        self._json({"ok": False, "error": "forbidden: only available on the Mac itself, not over LAN"}, 403)
        return False

    def _guard(self, ok, what):
        if not ok:
            self._json({"enabled": False, "needs": what}, 200)
            return False
        return True

    def _serve_file(self, fpath, ctype):
        """Serve a file from the writable home if it exists. Returns True if served."""
        if not os.path.isfile(fpath):
            return False
        try:
            with open(fpath, "rb") as f:
                body = f.read()
            self.send_response(200)
            self.send_header("Content-Type", ctype)
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(body)
            return True
        except Exception:
            return False

    def _local_ok(self):
        """Reject API calls that don't come from this machine's own app.

        Host must be localhost (defeats DNS rebinding); if the browser attached
        an Origin header (it always does on cross-origin requests), it must be
        a localhost origin too (defeats cross-site requests from web pages).
        Non-browser local tools (curl) send no Origin and pass.
        """
        host = (self.headers.get("Host") or "").split(":")[0].strip("[]").lower()
        host_ok = host in ("127.0.0.1", "localhost", "::1") \
            or (LAN["enabled"] and _is_private_ip(host))
        if not host_ok:
            self._json({"ok": False, "error": "forbidden: non-local request"}, 403)
            return False
        origin = (self.headers.get("Origin") or "").lower()
        if origin:
            ohost = (urllib.parse.urlparse(origin).hostname or "").strip("[]")
            origin_ok = ohost in ("127.0.0.1", "localhost", "::1") \
                or (LAN["enabled"] and _is_private_ip(ohost))
            if not origin_ok:
                self._json({"ok": False, "error": "forbidden: cross-site request"}, 403)
                return False
        return True

    def do_GET(self):
        path = urllib.parse.urlparse(self.path).path
        if path.startswith("/api/") and not self._local_ok():
            return
        if self._ship_blocked(path):
            return
        if path == "/api/health":
            return self._json({"ok": True, "version": VERSION})
        if path == "/api/config":
            return self._json(config_view(load_settings()))
        if path == "/api/emerald/status":
            return self._json(emerald_status())
        if path == "/api/emerald/log":
            qs = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
            return self._json(emerald_log((qs.get("since") or ["0"])[0]))
        if path == "/api/lan":
            return self._json(lan_status())
        if path == "/api/pc/sync/status":
            return self._json(pc_sync_status())
        if path == "/api/autosync":
            return self._json(autosync_status())
        if path == "/api/pc/search":
            s = load_settings()
            if not self._guard(s.get("pricecharting_token"), "pricecharting_token"):
                return
            qs = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
            try:
                return self._json(pc_search((qs.get("q") or [""])[0], s["pricecharting_token"]))
            except Exception as e:
                return self._json({"ok": False, "error": str(e)}, 200)
        if path == "/api/codex/search":
            # No guard: the codex is bundled local data, needs no key and no network.
            qs = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
            try:
                return self._json(codex_search(
                    (qs.get("q") or [""])[0],
                    limit=min(100, max(1, int((qs.get("limit") or ["25"])[0] or 25))),
                    special_only=(qs.get("special") or [""])[0] in ("1", "true", "yes")))
            except Exception as e:
                return self._json({"ok": False, "error": str(e)}, 200)
        if path == "/api/secrets":
            if not self._loopback_only():
                return
            return self._json(secret_list())
        if path == "/api/cardart":
            return self._json(card_art_list())
        if path == "/api/cardart/stats":
            return self._json(card_art_stats())
        if path == "/api/listingphotos":
            qs = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
            return self._json(listing_photos_list((qs.get("pcId") or [""])[0]))
        if path.startswith("/listing-photos/"):
            rest = urllib.parse.unquote(path[len("/listing-photos/"):])
            parts = [p for p in rest.split("/") if p]
            if (len(parts) == 2 and re.fullmatch(r"[A-Za-z0-9_-]{1,40}", parts[0])
                    and parts[1] and ".." not in parts[1] and not parts[1].startswith(".")):
                if self._serve_file(os.path.join(LISTING_DIR, parts[0], parts[1]), img_ctype(parts[1])):
                    return
            return self._json({"ok": False, "error": "not found"}, 404)
        if path.startswith("/card-art/"):
            fname = urllib.parse.unquote(path[len("/card-art/"):])
            if not fname or "/" in fname or "\\" in fname or fname.startswith("."):
                return self._json({"ok": False, "error": "bad path"}, 400)
            # your live save wins; otherwise fall back to a baked-in default
            if self._serve_file(os.path.join(CARD_ART_DIR, fname), img_ctype(fname)):
                return
            if self._serve_file(os.path.join(BUNDLED_ART_DIR, fname), img_ctype(fname)):
                return
            return self._json({"ok": False, "error": "not found"}, 404)
        if path == "/data/collection.json":
            # Serve the rebuilt copy from the writable home when it exists;
            # otherwise fall through to the bundled static file.
            live = os.path.join(HOME, "data", "collection.json")
            if self._serve_file(live, "application/json"):
                return
        if path == "/" + POCKET_NAME or path == "/" + urllib.parse.quote(POCKET_NAME):
            # The iPhone Pocket Edition is a generated artifact in the writable
            # home (the bundle is read-only), so serve it from there.
            if self._serve_file(os.path.join(HOME, POCKET_NAME), "text/html; charset=utf-8"):
                return
            return self._json({"ok": False, "error": "Pocket Edition not generated yet — click Regenerate in the Admin tab."}, 404)
        if path == "/" + MOBILE_NAME or path == "/" + urllib.parse.quote(MOBILE_NAME):
            if self._serve_file(os.path.join(HOME, MOBILE_NAME), "text/html; charset=utf-8"):
                return
            return self._json({"ok": False, "error": "Mobile app not built yet — click Build in the Admin tab."}, 404)
        if path == "/api/price":
            s = load_settings()
            if not self._guard(s.get("pricecharting_token"), "pricecharting_token"):
                return
            qs = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
            pid = (qs.get("id") or [""])[0]
            try:
                return self._json(pricecharting_price(pid, s["pricecharting_token"]))
            except Exception as e:
                return self._json({"ok": False, "error": str(e)}, 200)
        if _static_blocked(path):
            return self._json({"ok": False, "error": "forbidden"}, 403)
        return super().do_GET()  # static files

    def do_POST(self):
        path = urllib.parse.urlparse(self.path).path
        if not self._local_ok():
            return
        if self._ship_blocked(path):
            return
        if (path.startswith(("/api/secrets", "/api/emerald")) or path.endswith("/reveal")
                or path in ("/api/config", "/api/lan", "/api/import", "/api/mobile/deliver")):
            if not self._loopback_only():
                return
        try:
            payload = self._read_body()
        except PayloadTooLarge:
            return self._json({"ok": False, "error": "payload too large"}, 413)
        except Exception:
            return self._json({"ok": False, "error": "bad JSON body"}, 400)
        if path == "/api/config":
            return self._json(config_view(save_settings(payload)))
        if path == "/api/refresh":
            try:
                return self._json(refresh_data())
            except Exception as e:
                return self._json({"ok": False, "error": str(e)}, 200)
        if path == "/api/import":
            try:
                return self._json(import_export(payload))
            except Exception as e:
                return self._json({"ok": False, "error": str(e)}, 200)
        if path == "/api/lan":
            try:
                return self._json(lan_start() if payload.get("enabled") else lan_stop())
            except Exception as e:
                return self._json({"ok": False, "error": str(e)}, 200)
        if path == "/api/pc/sync":
            try:
                return self._json(pc_sync_start())
            except Exception as e:
                return self._json({"ok": False, "error": str(e)}, 200)
        if path == "/api/autosync":
            return self._json(autosync_set(payload.get("enabled", True)))
        if path == "/api/codex/completion":
            # Bundled local data — no key, no network, so no _guard here.
            try:
                return self._json(codex_completion(payload))
            except Exception as e:
                return self._json({"ok": False, "error": str(e)}, 200)
        if path == "/api/ai/identify":
            s = load_settings()
            if not self._guard(s.get("ai_key"), "ai_key"):
                return
            try:
                return self._json(ai_identify(payload, s))
            except urllib.error.HTTPError as e:
                detail = e.read().decode("utf-8", "replace")[:400]
                return self._json({"ok": False, "error": f"{e.code} {detail}"}, 200)
            except Exception as e:
                return self._json({"ok": False, "error": str(e)}, 200)
        if path == "/api/ai/grade":
            s = load_settings()
            if not self._guard(s.get("ai_key"), "ai_key"):
                return
            try:
                return self._json(ai_grade(payload, s))
            except urllib.error.HTTPError as e:
                detail = e.read().decode("utf-8", "replace")[:400]
                return self._json({"ok": False, "error": f"{e.code} {detail}"}, 200)
            except Exception as e:
                return self._json({"ok": False, "error": str(e)}, 200)
        if path == "/api/pocket":
            return self._json(build_pocket())
        if path == "/api/mobile":
            try:
                return self._json(build_mobile())
            except Exception as e:
                return self._json({"ok": False, "error": str(e)}, 200)
        if path == "/api/mobile/deliver":
            try:
                return self._json(deliver_mobile())
            except Exception as e:
                return self._json({"ok": False, "error": str(e)}, 200)
        if path == "/api/mobile/reveal":
            return self._json(reveal_mobile())
        if path == "/api/emerald/install":
            return self._json(emerald_start("install"))
        if path == "/api/emerald/build":
            return self._json(emerald_start("build"))
        if path == "/api/emerald/play":
            return self._json(emerald_play())
        if path == "/api/emerald/config":
            s = load_settings()
            repo = (payload.get("repo") or "").strip()
            if repo:
                s["emerald_repo"] = repo
            else:
                s.pop("emerald_repo", None)
            _write_settings(s)
            return self._json(emerald_status())
        if path == "/api/secrets":
            return self._json(secret_save(payload.get("label"), payload.get("value")))
        if path == "/api/secrets/delete":
            return self._json(secret_delete(payload.get("label")))
        if path == "/api/secrets/copy":
            return self._json(secret_copy(payload.get("label")))
        if path == "/api/saveimg":
            try:
                return self._json(save_reference_image(payload))
            except Exception as e:
                return self._json({"ok": False, "error": str(e)}, 200)
        if path == "/api/cardart":
            try:
                return self._json(save_card_art(payload))
            except Exception as e:
                return self._json({"ok": False, "error": str(e)}, 200)
        if path == "/api/cardart/delete":
            return self._json(card_art_delete(payload))
        if path == "/api/cardart/bake":
            try:
                return self._json(card_art_bake())
            except Exception as e:
                return self._json({"ok": False, "error": str(e)}, 200)
        if path == "/api/cardart/reveal":
            return self._json(card_art_reveal())
        if path == "/api/listingphoto":
            try:
                return self._json(save_listing_photo(payload))
            except Exception as e:
                return self._json({"ok": False, "error": str(e)}, 200)
        if path == "/api/listingphoto/delete":
            return self._json(listing_photo_delete(payload))
        if path == "/api/listingphotos/reveal":
            return self._json(listing_photos_reveal(payload))
        if path == "/api/comps":
            s = load_settings()
            if not self._guard(s.get("comps_key"), "comps_key"):
                return
            try:
                return self._json(comps_lookup(payload, s))
            except Exception as e:
                return self._json({"ok": False, "error": str(e)}, 200)
        if path == "/api/ai":
            s = load_settings()
            if not self._guard(s.get("ai_key"), "ai_key"):
                return
            try:
                return self._json(ai_recommend(payload, s))
            except urllib.error.HTTPError as e:
                detail = e.read().decode("utf-8", "replace")[:400]
                return self._json({"ok": False, "error": f"{e.code} {detail}"}, 200)
            except Exception as e:
                return self._json({"ok": False, "error": str(e)}, 200)
        return self._json({"ok": False, "error": "not found"}, 404)


if __name__ == "__main__":
    server = ThreadingHTTPServer(("127.0.0.1", PORT), Handler)  # binds here
    # Ensure the iPhone Pocket Edition exists in the writable home so the Admin
    # "Open Pocket Edition" link works on first launch of the bundled app.
    if not os.path.isfile(os.path.join(HOME, POCKET_NAME)):
        try:
            import threading
            threading.Thread(target=build_pocket, daemon=True).start()
        except Exception:
            pass
    print("┌──────────────────────────────────────────────┐")
    print(f"│  Pokémon Den running → http://localhost:{PORT} │")
    print("│  Keep this window open. Close it to stop.    │")
    print("└──────────────────────────────────────────────┘")
    # Phone/LAN mode survives restarts: re-arm it if it was on last time.
    if load_settings().get("lan_mode"):
        st = lan_start()
        for u in st.get("urls", []):
            print(f"  LAN (phone) → {u}")
    # Auto inventory import: new PriceCharting exports are pulled in on their own.
    threading.Thread(target=_autosync_loop, daemon=True).start()
    print(f"POKECHEST_READY port={PORT}", flush=True)
    server.serve_forever()
