#!/usr/bin/env python3
"""
Pokémon Chest local backend
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
  GET  /api/products?q=…      -> PriceCharting product catalog search (same API they use)
  GET  /api/codex?q=…         -> search the local TCGdex EN+JA card codex (all sets/rares)
  GET  /api/codex/meta        -> codex coverage stats
  POST /api/codex/refresh     -> rebuild data/codex.json from TCGdex
  POST /api/comps             -> live sold comps (eBay/TCGplayer/JP) via a comps API
  POST /api/ai                -> a written sell/grade recommendation (Claude or OpenAI)
  POST /api/ai/identify       -> identify a card from a photo (vision AI, BYOK)
  GET|/POST /api/lan          -> phone-mode LAN status / enable (iPhone scan on same Wi-Fi)
  POST /api/refresh           -> rebuild data/collection.json from the newest export
  GET  /data/collection.json  -> POKECHEST_HOME copy when present, else bundled file

Env:  POKECHEST_HOME (writable home; default: this script's directory, or
                      ~/Library/Application Support/PokemonChest when the
                      project lives in iCloud Drive)
      POKECHEST_PORT (port; POKEVAULT_PORT kept as a legacy fallback)

Run:  python3 server.py     (or double-click start.command)
"""
import os, sys, re, json, html, base64, socket, ipaddress, subprocess, threading, shutil, shlex, ssl, urllib.request, urllib.error, urllib.parse
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

VERSION = "1.15.0"
ROOT = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(ROOT, "scripts"))
try:
    from mac_paths import (  # noqa: E402
        resolve_writable_home, seed_home_from_root, path_report,
        deliver_destinations, is_under_icloud,
    )
except ImportError:
    resolve_writable_home = seed_home_from_root = path_report = None
    deliver_destinations = is_under_icloud = None

def _resolve_home():
    env = (os.environ.get("POKECHEST_HOME") or "").strip()
    if env:
        return os.path.abspath(env), "POKECHEST_HOME env"
    if resolve_writable_home:
        home, why = resolve_writable_home(ROOT)
        if home != ROOT and seed_home_from_root:
            seeded = seed_home_from_root(home, ROOT)
            if seeded:
                print(f"  Seeded Application Support from iCloud project: {', '.join(seeded)}", flush=True)
            os.environ["POKECHEST_HOME"] = home
        return home, why
    return ROOT, "project folder"

HOME, _HOME_REASON = _resolve_home()
SETTINGS = os.path.join(HOME, "settings.local.json")
CARD_ART_DIR = os.path.join(HOME, "card-art")           # your live saves (writable)
BUNDLED_ART_DIR = os.path.join(ROOT, "card-art")        # baked-in defaults (ship with the build)
LISTING_DIR = os.path.join(HOME, "listing-photos")      # YOUR OWN photos of each card, for selling
PORT = int(os.environ.get("POKECHEST_PORT") or os.environ.get("POKEVAULT_PORT") or "8787")
POCKET_NAME = "Pokémon Chest — Pocket.html"
MOBILE_NAME = "Pokémon Chest — Deck.html"

# ---------------------------------------------------------------- settings ---
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

# --------------------------------------------------------------- card codex ---
# Full EN+JA Pokémon TCG release index (TCGdex). Powers Scanner search when you
# don't have a PriceCharting token, and complements /api/products when you do.
_CODEX = {"data": None, "mtime": None, "path": None}
_CODEX_LOCK = threading.Lock()

def _codex_paths():
    """Prefer a rebuilt copy under HOME, else the bundled data/codex.json."""
    live = os.path.join(HOME, "data", "codex.json")
    bundled = os.path.join(ROOT, "data", "codex.json")
    return live if os.path.isfile(live) else bundled

def _load_codex(force=False):
    path = _codex_paths()
    if not os.path.isfile(path):
        return None
    try:
        mtime = os.path.getmtime(path)
    except OSError:
        return None
    with _CODEX_LOCK:
        if (not force and _CODEX["data"] is not None
                and _CODEX["path"] == path and _CODEX["mtime"] == mtime):
            return _CODEX["data"]
        try:
            with open(path, encoding="utf-8") as f:
                data = json.load(f)
        except Exception:
            return _CODEX["data"]
        _CODEX.update(data=data, mtime=mtime, path=path)
        return data

def codex_meta():
    d = _load_codex()
    if not d:
        return {"ok": False, "error": "Codex not built yet — open Scanner and click Rebuild Codex, or run scripts/build_codex.py."}
    return {"ok": True, "meta": d.get("meta") or {}, "generatedAt": d.get("generatedAt"),
            "source": d.get("source"), "path": _CODEX.get("path")}

def codex_search(q, *, lang=None, special=None, limit=24):
    """Token search over the local TCGdex codex. No keys required.

    Ranking prefers exact collector-number hits and name-prefix matches so
    queries like "charizard 4" surface Base Set #4 ahead of unrelated #1s.
    Number tokens may match the card's localId even when other tokens only
    partially hit (helps special rares and sparse JA name coverage).
    """
    d = _load_codex()
    if not d:
        return {"ok": False, "error": "Codex missing — run Rebuild Codex first.", "results": []}
    q = (q or "").strip().lower()
    if not q:
        return {"ok": True, "results": [], "meta": d.get("meta")}
    toks = [t for t in re.split(r"\s+", q) if t]
    num_toks = [t for t in toks if re.fullmatch(r"[a-z]{0,4}\d+[a-z]?\d*", t) or re.fullmatch(r"\d+[a-z]?", t)]
    text_toks = [t for t in toks if t not in num_toks]

    def _hay_has_token(hay, t):
        """Substring match, but bare digits must be whole tokens (avoid '4' ∈ '2024')."""
        if not t:
            return False
        if t.isdigit():
            return bool(re.search(rf"(?<!\d){re.escape(t)}(?!\d)", hay))
        return t in hay

    scored = []
    for c in d.get("cards") or []:
        if lang and c.get("lang") != lang:
            continue
        if special is True and not c.get("special"):
            continue
        hay = c.get("q") or ""
        name = (c.get("name") or "").lower()
        num = str(c.get("number") or "").lower()
        num_compact = num.lstrip("0") or num
        # Number-like tokens must hit the collector number (not set ids like swsh4.5).
        # Text tokens match the full haystack (name/set/id).
        ok = True
        for t in num_toks:
            tc = t.lstrip("0") or t
            # Exact collector-number match only (never substring: "4" must not hit "74").
            if t == num or tc == num_compact:
                continue
            ok = False
            break
        if not ok:
            continue
        for t in text_toks:
            if not _hay_has_token(hay, t):
                ok = False
                break
        if not ok:
            continue
        score = 0
        if num_toks and any((t == num or (t.lstrip("0") or t) == num_compact) for t in num_toks):
            score += 50
        if text_toks and all(t in name for t in text_toks):
            score += 30
        if text_toks and name.startswith(text_toks[0]):
            score += 10
        if c.get("special"):
            score += 2
        if c.get("img"):
            score += 1
        scored.append((score, c))
    scored.sort(key=lambda x: -x[0])
    out = []
    for score, c in scored[:limit]:
        out.append({
            "id": c.get("id"), "name": c.get("name"), "number": c.get("number"),
            "set": c.get("set"), "setId": c.get("setId"), "lang": c.get("lang"),
            "year": c.get("year"), "special": bool(c.get("special")),
            "img": c.get("img"),
            "source": "codex",
        })
    return {"ok": True, "results": out, "count": len(out), "q": q}

def refresh_codex():
    """Rebuild data/codex.json from TCGdex (EN+JA)."""
    script = os.path.join(ROOT, "scripts", "build_codex.py")
    if not os.path.isfile(script):
        return {"ok": False, "error": f"builder not found: {script}"}
    env = dict(os.environ)
    env["POKECHEST_HOME"] = HOME
    try:
        os.makedirs(os.path.join(HOME, "data"), exist_ok=True)
        proc = subprocess.run(
            [sys.executable, script],
            capture_output=True, text=True, env=env, cwd=HOME, timeout=600)
    except subprocess.TimeoutExpired:
        return {"ok": False, "error": "codex rebuild timed out after 10 minutes"}
    except Exception as e:
        return {"ok": False, "error": str(e)}
    report = None
    for line in (proc.stdout or "").splitlines():
        if line.startswith("REPORT_JSON="):
            try:
                report = json.loads(line[len("REPORT_JSON="):])
            except Exception:
                pass
    if proc.returncode != 0:
        err = (proc.stderr or proc.stdout or "codex rebuild failed").strip()[-800:]
        return {"ok": False, "error": err}
    _load_codex(force=True)
    return {"ok": True, "report": report or codex_meta().get("meta")}

def pc_search(q, token):
    """Search PriceCharting's /api/products — the same catalog their site/app uses."""
    q = (q or "").strip()
    if not q:
        return {"ok": True, "products": []}
    url = "https://www.pricecharting.com/api/products?" + urllib.parse.urlencode({"t": token, "q": q})
    d = http_json(url)
    if d.get("status") == "error":
        return {"ok": False, "error": d.get("error-message", "PriceCharting error")}
    out = []
    for p in (d.get("products") or [])[:20]:
        name = p.get("product-name") or ""
        m = re.search(r"#\s*([A-Za-z0-9/\-]+)\s*$", name)
        pid = p.get("id")
        out.append({
            "id": pid,
            "pcId": pid,
            "name": re.sub(r"\s*#\s*[A-Za-z0-9/\-]+\s*$", "", name).strip() or name,
            "number": m.group(1) if m else None,
            "set": p.get("console-name") or "",
            "price": cents(p.get("loose-price")),
            "pcUrl": f"https://www.pricecharting.com/game/{pid}" if pid else None,
            "source": "pricecharting",
        })
    return {"ok": True, "products": out}

AI_IDENTIFY_SYSTEM = (
    "You identify trading cards from a photo. Look at the card and respond with ONLY a JSON object, "
    "no prose, no code fences: {\"name\": card name, \"number\": collector number without the set-size "
    "denominator, \"set\": set name, \"lang\": \"en\" or \"ja\", \"game\": e.g. \"Pokémon\", "
    "\"graded\": true/false (is it in a grading slab), \"rarity\": rarity if visible or null, "
    "\"confidence\": 0-1}. Use null for anything unreadable."
)

def ai_identify(payload, settings):
    """Vision identify — BYOK Claude/OpenAI. Used by Scanner after a Mac/iPhone snap."""
    provider = settings.get("ai_provider", "anthropic")
    key = settings.get("ai_key")
    model = settings.get("ai_model") or ("claude-sonnet-4-6" if provider == "anthropic" else "gpt-4o")
    data_url = (payload.get("dataUrl") or "")
    m = re.match(r"data:(image/[a-z+.-]+);base64,(.+)$", data_url, re.S)
    if not m:
        return {"ok": False, "error": "Send the photo as a data URL."}
    media_type, b64 = m.group(1), m.group(2).strip()
    if len(b64) > 12 * 1024 * 1024:
        return {"ok": False, "error": "Photo too large (12 MB max)."}
    prompt = "Identify this trading card. Prefer Pokémon TCG when ambiguous."
    if provider == "anthropic":
        d = http_json(
            "https://api.anthropic.com/v1/messages", method="POST",
            headers={"x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json"},
            body={"model": model, "max_tokens": 300, "system": AI_IDENTIFY_SYSTEM,
                  "messages": [{"role": "user", "content": [
                      {"type": "image", "source": {"type": "base64", "media_type": media_type, "data": b64}},
                      {"type": "text", "text": prompt}]}]})
        text = "".join(b.get("text", "") for b in d.get("content", []) if b.get("type") == "text")
    elif provider == "openai":
        d = http_json(
            "https://api.openai.com/v1/chat/completions", method="POST",
            headers={"Authorization": f"Bearer {key}", "content-type": "application/json"},
            body={"model": model, "max_tokens": 300,
                  "messages": [{"role": "system", "content": AI_IDENTIFY_SYSTEM},
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
        guess = json.loads(j.group(0))
    except Exception:
        return {"ok": False, "error": "Could not parse the model's JSON.", "raw": text[:300]}
    return {"ok": True, "guess": guess, "provider": provider, "model": model}

# ------------------------------------------------------ LAN / phone access ---
# Opt-in second listener on 0.0.0.0 so your iPhone (same Wi-Fi) can open the app
# and scan cards. HTTPS via a local self-signed cert when openssl is available
# (live camera needs a secure context on phones). Home networks only.
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
    ips = []
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.settimeout(2)
        s.connect(("8.8.8.8", 80))
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
    cert, key = os.path.join(TLS_DIR, "cert.pem"), os.path.join(TLS_DIR, "key.pem")
    if os.path.isfile(cert) and os.path.isfile(key):
        return cert, key
    openssl = shutil.which("openssl")
    if not openssl:
        return None
    os.makedirs(TLS_DIR, exist_ok=True)
    san = ",".join(["DNS:localhost", "IP:127.0.0.1"] + [f"IP:{ip}" for ip in ips])
    base = [openssl, "req", "-x509", "-newkey", "rsa:2048", "-sha256", "-nodes",
            "-days", "825", "-keyout", key, "-out", cert, "-subj", "/CN=Pokemon Chest LAN"]
    try:
        subprocess.run(base + ["-addext", f"subjectAltName={san}"],
                       check=True, capture_output=True, timeout=60)
        return cert, key
    except Exception:
        try:
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
        out = os.path.join(HOME, "Pokémon Chest — Pocket.html")
        kb = os.path.getsize(out) // 1024 if os.path.isfile(out) else 0
        return {"ok": True, "file": "Pokémon Chest — Pocket.html", "kb": kb}
    except Exception as e:
        return {"ok": False, "error": str(e)}

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
    """Copy the built mobile app to Desktop / iCloud Drive / Documents so the
    Files app on iPhone (and AirDrop) can pick it up — works after iCloud migration."""
    out = os.path.join(HOME, MOBILE_NAME)
    if not os.path.isfile(out):
        r = build_mobile()
        if not r.get("ok"):
            return r
    delivered = []
    targets = deliver_destinations(MOBILE_NAME) if deliver_destinations else [
        ("Desktop (AirDrop it)", os.path.join(os.path.expanduser("~/Desktop"), MOBILE_NAME)),
    ]
    seen = set()
    for label, dst in targets:
        key = os.path.realpath(dst) if os.path.exists(os.path.dirname(dst)) else dst
        if key in seen:
            continue
        seen.add(key)
        try:
            os.makedirs(os.path.dirname(dst), exist_ok=True)
            shutil.copy2(out, dst)
            delivered.append({"where": label, "path": dst})
        except Exception as e:
            delivered.append({"where": label, "error": str(e)})
    ok = any("path" in d for d in delivered)
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
             "-a", label, "-j", "Pokémon Chest secure input", "-w", value],
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
            prompt = "Pokémon Chest needs your Mac password once to install the Game Boy Advance toolchain (devkitARM)."
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
                    f.write("\n# Added by Pokémon Chest — Emerald Lab\n" + add)
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
class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *a, **k):
        super().__init__(*a, directory=ROOT, **k)

    def log_message(self, *a):  # quieter console
        pass

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
        return json.loads(self.rfile.read(n) or b"{}") if n else {}

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

        Host must be localhost (defeats DNS rebinding), OR — when phone-mode LAN
        is enabled — a private LAN IP so the iPhone on the same Wi-Fi can scan.
        Origin, when present, must match the same rule.
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
        if path == "/api/health":
            payload = {"ok": True, "version": VERSION, "home": HOME, "homeReason": _HOME_REASON,
                       "projectInICloud": bool(is_under_icloud and is_under_icloud(ROOT))}
            if path_report:
                try:
                    payload["paths"] = path_report(ROOT, HOME)
                except Exception as e:
                    payload["pathsError"] = str(e)
            return self._json(payload)
        if path == "/api/config":
            return self._json(config_view(load_settings()))
        if path == "/api/emerald/status":
            return self._json(emerald_status())
        if path == "/api/emerald/log":
            qs = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
            return self._json(emerald_log((qs.get("since") or ["0"])[0]))
        if path == "/api/secrets":
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
        if path == "/api/products":
            s = load_settings()
            if not self._guard(s.get("pricecharting_token"), "pricecharting_token"):
                return
            qs = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
            q = (qs.get("q") or [""])[0]
            try:
                return self._json(pc_search(q, s["pricecharting_token"]))
            except Exception as e:
                return self._json({"ok": False, "error": str(e)}, 200)
        if path == "/api/codex/meta":
            return self._json(codex_meta())
        if path == "/api/codex":
            qs = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
            q = (qs.get("q") or [""])[0]
            lang = (qs.get("lang") or [""])[0] or None
            if lang == "all":
                lang = None
            special = None
            if (qs.get("special") or [""])[0] in ("1", "true", "yes"):
                special = True
            try:
                limit = min(60, max(1, int((qs.get("limit") or ["24"])[0])))
            except ValueError:
                limit = 24
            return self._json(codex_search(q, lang=lang, special=special, limit=limit))
        if path == "/api/lan":
            return self._json(lan_status())
        if path == "/data/codex.json":
            live = os.path.join(HOME, "data", "codex.json")
            if self._serve_file(live, "application/json"):
                return
        return super().do_GET()  # static files

    def do_POST(self):
        path = urllib.parse.urlparse(self.path).path
        if not self._local_ok():
            return
        try:
            payload = self._read_body()
        except Exception:
            return self._json({"ok": False, "error": "bad JSON body"}, 400)
        if path == "/api/config":
            return self._json(config_view(save_settings(payload)))
        if path == "/api/refresh":
            try:
                return self._json(refresh_data())
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
        if path == "/api/codex/refresh":
            try:
                return self._json(refresh_codex())
            except Exception as e:
                return self._json({"ok": False, "error": str(e)}, 200)
        if path == "/api/lan":
            try:
                return self._json(lan_start() if payload.get("enabled") else lan_stop())
            except Exception as e:
                return self._json({"ok": False, "error": str(e)}, 200)
        return self._json({"ok": False, "error": "not found"}, 404)


if __name__ == "__main__":
    server = ThreadingHTTPServer(("127.0.0.1", PORT), Handler)  # binds here
    # Ensure the iPhone Pocket Edition exists in the writable home so the Admin
    # "Open Pocket Edition" link works on first launch of the bundled app.
    if not os.path.isfile(os.path.join(HOME, POCKET_NAME)):
        try:
            threading.Thread(target=build_pocket, daemon=True).start()
        except Exception:
            pass
    # Warm the card codex in the background so the first Scanner search is fast.
    try:
        threading.Thread(target=lambda: _load_codex(), daemon=True).start()
    except Exception:
        pass
    if load_settings().get("lan_mode"):
        try:
            st = lan_start()
            for u in st.get("urls") or []:
                print(f"  LAN (phone) → {u}")
        except Exception:
            pass
    print("┌──────────────────────────────────────────────┐")
    print(f"│  Pokémon Chest running → http://localhost:{PORT} │")
    print("│  Keep this window open. Close it to stop.    │")
    print("└──────────────────────────────────────────────┘")
    if HOME != ROOT:
        print(f"  Writable home → {HOME}")
        print(f"  ({_HOME_REASON})")
    print(f"POKECHEST_READY port={PORT}", flush=True)
    server.serve_forever()
