#!/usr/bin/env python3
"""
Build the Pokémon Chest MOBILE app — a single self-contained .html you AirDrop /
email / drop in iCloud, open on iPhone, and "Add to Home Screen" so it runs like
a native app (full-screen, offline, its own icon).

It's the game side: swipe your deck, build a deck, and a 3D swirling-stadium
battle buildup. GATE: only cards you've CAUGHT with a real photo (Photo Studio →
listing-photos/, or a card-art image you added) are battle-playable; the rest
show as "wild — catch it". Caught cards embed your real photo; a handful of top
wild cards embed a small catalog thumbnail so the deck looks full.

Run:  python3 scripts/build_mobile.py     (or POST /api/mobile from the app)
Output: "Pokémon Chest — Deck.html" in POKECHEST_HOME.
"""
import os, sys, json, base64, datetime, urllib.request, urllib.parse

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
HOME = os.path.abspath(os.environ.get("POKECHEST_HOME") or ROOT)
CARD_ART = os.path.join(HOME, "card-art")
BUNDLED_ART = os.path.join(ROOT, "card-art")
LISTING = os.path.join(HOME, "listing-photos")
CACHE = os.path.join(HOME, "cache")
os.makedirs(CACHE, exist_ok=True)
TEMPLATE = os.path.join(ROOT, "assets", "mobile.html")
OUT = os.path.join(HOME, "Pokémon Chest — Deck.html")
WILD_MAX = 60           # how many wild catalog thumbnails to embed
_MIME = {".webp": "image/webp", ".png": "image/png", ".jpg": "image/jpeg",
         ".jpeg": "image/jpeg", ".gif": "image/gif", ".avif": "image/avif"}
_OK = tuple(_MIME)

def load_collection():
    for base in (HOME, ROOT):
        p = os.path.join(base, "data", "collection.json")
        if os.path.isfile(p):
            try:
                return json.load(open(p, encoding="utf-8"))
            except Exception:
                pass
    sys.exit("No data/collection.json — run build_data.py first.")

def data_uri_from_file(path):
    ext = os.path.splitext(path)[1].lower()
    mime = _MIME.get(ext)
    if not mime:
        return None
    try:
        with open(path, "rb") as f:
            b = f.read()
        return f"data:{mime};base64," + base64.b64encode(b).decode()
    except Exception:
        return None

def data_uri_capped(path, maxpx=1000, quality=80):
    """Downscale + re-encode a (possibly huge iPhone) photo to a small webp data
    URI so the self-contained file stays AirDrop/email-friendly. Falls back to
    raw bytes only if Pillow can't handle it AND the file is already small."""
    try:
        from PIL import Image
        import io
        im = Image.open(path)
        im = im.convert("RGB")
        w, h = im.size
        scale = min(1.0, maxpx / float(max(w, h)))
        if scale < 1.0:
            im = im.resize((max(1, int(w * scale)), max(1, int(h * scale))))
        buf = io.BytesIO()
        im.save(buf, "WEBP", quality=quality, method=4)
        return "data:image/webp;base64," + base64.b64encode(buf.getvalue()).decode()
    except Exception:
        try:
            if os.path.getsize(path) <= 500_000:
                return data_uri_from_file(path)
        except OSError:
            pass
        return None

def caught_image(pcid):
    """A real photo of the card the user provided → its data URI, or None.
    Priority: listing-photos 'front', any listing photo, then a card-art image."""
    d = os.path.join(LISTING, str(pcid))
    if os.path.isdir(d):
        try:
            files = [f for f in sorted(os.listdir(d)) if os.path.splitext(f)[1].lower() in _OK]
        except OSError:
            files = []
        front = [f for f in files if os.path.splitext(f)[0] == "front"]
        for f in (front + files):
            uri = data_uri_capped(os.path.join(d, f))
            if uri:
                return uri
    for base in (CARD_ART, BUNDLED_ART):
        try:
            for f in os.listdir(base):
                if os.path.splitext(f)[0] == str(pcid) and os.path.splitext(f)[1].lower() in _OK:
                    uri = data_uri_capped(os.path.join(base, f))
                    if uri:
                        return uri
        except OSError:
            pass
    return None

def wild_thumb(url):
    """Fetch a SMALL catalog thumbnail for a wild card → data URI (cached).
    Only remote TCGdex catalog art; skips anything else."""
    if not (url and url.startswith(("https://", "http://"))):
        return None
    low = url.replace("/high.webp", "/low.webp")
    key = "wild_" + urllib.parse.quote(low, safe="") + ".b64"
    cp = os.path.join(CACHE, key[:180])
    if os.path.isfile(cp):
        try:
            return open(cp, encoding="utf-8").read()
        except Exception:
            pass
    try:
        req = urllib.request.Request(low, headers={"User-Agent": "PokemonChest/1.0", "Accept": "image/*"})
        with urllib.request.urlopen(req, timeout=20) as r:
            b = r.read(400_000)
        uri = "data:image/webp;base64," + base64.b64encode(b).decode()
        try:
            open(cp, "w", encoding="utf-8").write(uri)
        except Exception:
            pass
        return uri
    except Exception:
        return None

def tier_of(v):
    v = v or 0
    return ("legendary" if v >= 300 else "epic" if v >= 100 else
            "rare" if v >= 25 else "uncommon" if v >= 5 else "common")

def icon_uri():
    for p in (os.path.join(ROOT, "src-tauri", "icons", "128x128@2x.png"),
              os.path.join(ROOT, "src-tauri", "icons", "128x128.png"),
              os.path.join(ROOT, "icon-source.png")):
        if os.path.isfile(p):
            u = data_uri_from_file(p)
            if u:
                return u
    return ""

def build():
    col = load_collection()
    cards = col["cards"]
    out_cards, portfolio = [], 0.0
    caught_n = 0

    # caught first (embed real photos)
    caught_ids = set()
    for c in cards:
        pcid = c.get("pcId")
        if pcid is None:
            continue
        img = caught_image(pcid)
        if not img:
            continue
        if pcid in caught_ids:      # dedupe repeated pcIds (raw/graded variants)
            continue
        caught_ids.add(pcid)
        caught_n += 1
        portfolio += (c.get("value") or 0)
        out_cards.append({
            "id": pcid, "name": c.get("name"), "set": c.get("set"),
            "number": c.get("number"), "value": c.get("value"),
            "tier": tier_of(c.get("price")), "lang": c.get("lang"),
            "graded": (f"{c.get('grader') or 'PSA'} {c.get('grade') or ''}".strip()
                       if c.get("graded") else None),
            "caught": True, "img": img,
        })

    # wild: top-value cards with a catalog image, not already caught
    wild_src = sorted((c for c in cards if c.get("pcId") not in caught_ids
                       and (c.get("img") or "").startswith("http")),
                      key=lambda c: -(c.get("value") or 0))
    seen = set()
    wild_n = 0
    for c in wild_src:
        if wild_n >= WILD_MAX:
            break
        pcid = c.get("pcId")
        if pcid in seen:
            continue
        seen.add(pcid)
        thumb = wild_thumb(c.get("img"))
        out_cards.append({
            "id": pcid, "name": c.get("name"), "set": c.get("set"),
            "number": c.get("number"), "value": c.get("value"),
            "tier": tier_of(c.get("price")), "lang": c.get("lang"),
            "graded": (f"{c.get('grader') or 'PSA'} {c.get('grade') or ''}".strip()
                       if c.get("graded") else None),
            "caught": False, "img": thumb,
        })
        wild_n += 1

    payload = {
        "generatedAt": datetime.datetime.now().isoformat(timespec="seconds"),
        "portfolio": round(portfolio, 2),
        "caughtCount": caught_n,
        "wildCount": wild_n,
        "cards": out_cards,
    }
    if not os.path.isfile(TEMPLATE):
        sys.exit(f"template missing: {TEMPLATE}")
    tmpl = open(TEMPLATE, encoding="utf-8").read()
    # JSON is embedded inside a <script> tag; escape so a card name containing
    # "</script>" (or the line separators) can't break out. Stays valid JS/JSON.
    data_js = (json.dumps(payload, ensure_ascii=False)
               .replace("<", "\\u003c").replace(">", "\\u003e")
               .replace(" ", "\\u2028").replace(" ", "\\u2029"))
    html = tmpl.replace("@@MOBILE_DATA@@", data_js)
    html = html.replace("@@ICON@@", icon_uri())
    tmp = OUT + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        f.write(html)
    os.replace(tmp, OUT)
    kb = os.path.getsize(OUT) // 1024
    report = {"caught": caught_n, "wild": wild_n, "cards": len(out_cards), "kb": kb, "file": os.path.basename(OUT)}
    print("REPORT_JSON=" + json.dumps(report))
    return report

if __name__ == "__main__":
    r = build()
    print(f"Wrote {OUT}\n  caught: {r['caught']}  wild: {r['wild']}  total: {r['cards']}  size: {r['kb']} KB")
