#!/usr/bin/env python3
"""
Pokémon Den data builder
==========================
Reads the PriceCharting collection export (.xlsx) and produces data/collection.json:
a clean, enriched record per card with card images (TCGdex, EN + JA), P/L, a
PriceCharting deep-link by id, and a normalized search query the web app uses to
build live eBay / TCGplayer / Mercari comp links.

No API keys required. Card images come from TCGdex (https://tcgdex.dev), a free,
open Pokemon card API covering English AND Japanese sets.

When POKECHEST_HOME is set (e.g. when bundled read-only inside the .app), all
output (data/collection.json) and the TCGdex cache go under POKECHEST_HOME, and
the source .xlsx is searched in POKECHEST_HOME, the project root, and
~/Downloads — newest wins.

At the very end prints one machine-readable line for the in-app refresh:
  REPORT_JSON={"entries":...,"cards":...,"value":...,"imagesMatched":...}

Run:  python3 scripts/build_data.py
(or just double-click refresh-data.command in the project folder)
"""
import os, re, json, sys, unicodedata, datetime, urllib.request, urllib.error, urllib.parse

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
_home_env = (os.environ.get("POKECHEST_HOME") or "").strip()
HOME = os.path.abspath(_home_env) if _home_env else None
OUT_DIR = os.path.join(HOME, "data") if HOME else os.path.join(ROOT, "data")
CACHE = os.path.join(HOME, "cache") if HOME else os.path.join(HERE, "cache")
os.makedirs(CACHE, exist_ok=True)
os.makedirs(OUT_DIR, exist_ok=True)

# ---- locate the newest PriceCharting export ---------------------------------
# Searched in POKECHEST_HOME (when set), the project root, and ~/Downloads —
# the newest matching file across all of them wins.
def find_source():
    dirs = []
    if HOME:
        dirs.append(HOME)
    dirs.append(ROOT)
    dirs.append(os.path.expanduser("~/Downloads"))
    seen, files = set(), []
    for d in dirs:
        d = os.path.abspath(d)
        if d in seen or not os.path.isdir(d):
            continue
        seen.add(d)
        try:
            names = os.listdir(d)
        except OSError:
            continue
        for f in names:
            if f.lower().endswith(".xlsx") and not f.startswith("~$"):
                files.append(os.path.join(d, f))
    cands = [p for p in files if "pricecharting" in os.path.basename(p).lower()]
    if not cands:
        # fall back to any .xlsx, but only in our own folders (never grab a
        # random spreadsheet out of ~/Downloads)
        own = {os.path.abspath(x) for x in ([HOME] if HOME else []) + [ROOT]}
        cands = [p for p in files if os.path.dirname(p) in own]
    if not cands:
        sys.exit("No PriceCharting .xlsx export found in POKECHEST_HOME, the "
                 "project folder, or ~/Downloads.")
    return max(cands, key=os.path.getmtime)

SRC = find_source()

try:
    import openpyxl
except ImportError:
    sys.exit("openpyxl is required.  Install with:  python3 -m pip install --user openpyxl")

# ---- TCGdex set lists (cached) ---------------------------------------------
def fetch_json(url, cache_name, ttl_days=30):
    path = os.path.join(CACHE, cache_name)
    if os.path.exists(path):
        age = (datetime.datetime.now().timestamp() - os.path.getmtime(path)) / 86400
        if age < ttl_days:
            try:
                return json.load(open(path, encoding="utf-8"))
            except Exception:
                pass
    req = urllib.request.Request(url, headers={"User-Agent": "PokemonChest/1.0"})
    with urllib.request.urlopen(req, timeout=30) as r:
        data = json.load(r)
    json.dump(data, open(path, "w", encoding="utf-8"))
    return data

def norm(s):
    if not s:
        return ""
    s = unicodedata.normalize("NFKD", s)
    s = "".join(c for c in s if not unicodedata.combining(c))
    s = s.lower().replace("&", " and ").replace("’", "'")
    return re.sub(r"[^a-z0-9]+", "", s)

print("Loading TCGdex set indexes ...")
EN_SETS = fetch_json("https://api.tcgdex.net/v2/en/sets", "en_sets.json")
JA_SETS = fetch_json("https://api.tcgdex.net/v2/ja/sets", "ja_sets.json")
EN_BY_NORM = {}
for s in EN_SETS:
    EN_BY_NORM.setdefault(norm(s.get("name", "")), s["id"])
EN_BY_ID = {s["id"]: s for s in EN_SETS}
JA_BY_ID = {s["id"]: s for s in JA_SETS}

# ---- English set name overrides (collection console-name -> TCGdex EN id) ---
# Only where the PriceCharting name doesn't normalize to the TCGdex name. Every
# id here was confirmed against the TCGdex EN index; everything else auto-matches.
EN_OVERRIDE = {
    "Pokemon Scarlet & Violet 151": "sv03.5",   # TCGdex name is just "151"
    "Pokemon Go": "swsh10.5",                    # TCGdex "Pokémon GO"
    "Pokemon McDonalds 2022": "2022swsh",        # (no card images on TCGdex)
    "Pokemon Expedition": "ecard1",              # "Expedition Base Set"
    "Pokemon HeartGold & SoulSilver": "hgss1",
    "Pokemon Scarlet & Violet Energy": None,     # special energies, skip image
    "Pokemon Promo": None,                        # mixed-era catch-all, skip image
}

# ---- Japanese set map (collection console-name -> TCGdex JA id) -------------
# Curated + verified against the TCGdex JA index (names are Japanese-only there).
JA_MAP = {
    "Pokemon Japanese VSTAR Universe": "S12a",
    "Pokemon Japanese White Flare": "SV11W",
    "Pokemon Japanese Scarlet & Violet 151": "SV2a",
    "Pokemon Japanese Black Bolt": "SV11B",
    "Pokemon Japanese Glory of Team Rocket": "SV10",
    "Pokemon Japanese VMAX Climax": "S8b",
    "Pokemon Japanese Incandescent Arcana": "S11a",
    "Pokemon Japanese Shiny Treasure ex": "SV4a",
    "Pokemon Japanese Future Flash": "SV4M",
    "Pokemon Japanese Super Electric Breaker": "SV8",
    "Pokemon Japanese Ancient Roar": "SV4K",
    "Pokemon Japanese Gold, Silver, New World": "neo1",
    "Pokemon Japanese Mega Symphonia": "M1S",
    "Pokemon Japanese Paradigm Trigger": "S12",
    "Pokemon Japanese Mega Brave": "M1L",
    "Pokemon Japanese 25th Anniversary Collection": "S8a",
    "Pokemon Japanese Raging Surf": "SV3a",
    "Pokemon Japanese Shiny Star V": "S4a",
    "Pokemon Japanese Go": "S10b",
    "Pokemon Japanese Rapid Strike Master": "S5R",
    "Pokemon Japanese Time Gazer": "S10D",
    "Pokemon Japanese Inferno X": "M2",
    "Pokemon Japanese Paradise Dragona": "SV7a",
    "Pokemon Japanese Mega Brave ": "M1L",
    "Pokemon Japanese Challenge from the Darkness": "PMCG6",
    "Pokemon Japanese Rocket Gang": "PMCG4",
}

def resolve_set(console):
    """Return (lang, tcgdex_set_id) or (lang, None)."""
    if "Japanese" in console:
        return "ja", JA_MAP.get(console.strip())
    if console in EN_OVERRIDE:
        sid = EN_OVERRIDE[console]
        if sid and sid in EN_BY_ID:
            return "en", sid
        if sid is None:
            return "en", None
        # fall through to name match if override id invalid
    if not console.startswith("Pokemon"):
        return None, None  # non-Pokemon game (no TCGdex image)
    short = console[len("Pokemon"):].strip()
    return "en", EN_BY_NORM.get(norm(short))

# ---- per-set card image maps (cached) --------------------------------------
def name_key(s):
    """Normalize a card name for comparison (drop brackets, suffixes, accents)."""
    s = unicodedata.normalize("NFKD", s or "")
    s = "".join(c for c in s if not unicodedata.combining(c)).lower()
    s = re.sub(r"\[[^\]]*\]", " ", s)          # drop [Reverse Holo] etc.
    return re.sub(r"[^a-z0-9]+", "", s)

def name_matches(a, b):
    """True if two card names plausibly refer to the same card (lenient)."""
    ka, kb = name_key(a), name_key(b)
    if not ka or not kb:
        return False
    if ka == kb or ka.startswith(kb) or kb.startswith(ka):
        return True
    # share the leading species token (e.g. "charizardex" vs "charizard")
    ta = re.match(r"[a-z]+", ka); tb = re.match(r"[a-z]+", kb)
    return bool(ta and tb and ta.group() == tb.group() and len(ta.group()) >= 4)

_set_cards = {}
def set_card_index(lang, set_id):
    """Return (idx, name, year). idx[localId] = {"img":..., "name":...}."""
    key = (lang, set_id)
    if key in _set_cards:
        return _set_cards[key]
    try:
        data = fetch_json(f"https://api.tcgdex.net/v2/{lang}/sets/{set_id}",
                          f"{lang}_set_{set_id}.json")
    except Exception as e:
        print(f"   ! failed to fetch {lang}/{set_id}: {e}")
        _set_cards[key] = ({}, "", None)
        return _set_cards[key]
    idx = {}
    for c in data.get("cards", []):
        lid = str(c.get("localId", "")).strip()
        if lid and c.get("image"):
            entry = {"img": c["image"], "name": c.get("name", "")}
            idx[lid] = entry
            idx[lid.lstrip("0") or "0"] = entry
    rd = data.get("releaseDate") or ""
    year = int(rd[:4]) if rd[:4].isdigit() else None
    _set_cards[key] = (idx, data.get("name", ""), year)
    return _set_cards[key]

# ---- "classic reprint" resolver (Celebrations Classic Collection etc.) -------
# These subsets reprint original WOTC/Neo/LC card faces but TCGdex doesn't carry
# the subset, so when a number-match fails the name check we look the card up by
# NAME in the original sets — the artwork is identical.
CLASSIC_SETS = ["base1", "base2", "base3", "base4", "base5",
                "gym1", "gym2", "neo1", "neo2", "neo3", "neo4", "lc", "si1"]
CLASSIC_CONSOLES = {"Pokemon Celebrations"}
_classic_by_name = None
def classic_image(card_name):
    global _classic_by_name
    if _classic_by_name is None:
        _classic_by_name = {}
        for sid in CLASSIC_SETS:
            idx, _n, _y = set_card_index("en", sid)
            for entry in idx.values():
                _classic_by_name.setdefault(name_key(entry["name"]), entry["img"])
    return _classic_by_name.get(name_key(card_name))

# ---- parse the export -------------------------------------------------------
HDR = ['PRICE','product-name','console-name','price-in-pennies','id','include-string',
       'condition-string','sku','notes','cost-basis-in-pennies','quantity','date-entered',
       'date-purchased','grading-company','grading-cert-id','folder']
NUM_RE = re.compile(r"#\s*([A-Za-z0-9/\-]+)\s*$")

def iso(d):
    if isinstance(d, datetime.datetime):
        return d.date().isoformat()
    if isinstance(d, datetime.date):
        return d.isoformat()
    return None

print(f"Reading {os.path.basename(SRC)} ...")
wb = openpyxl.load_workbook(SRC, read_only=True, data_only=True)
ws = wb.active
rows = [dict(zip(HDR, r)) for r in ws.iter_rows(min_row=2, values_only=True)]

cards = []
set_report = {}      # console -> [matched, total]
for i, d in enumerate(rows):
    console = (d["console-name"] or "").strip()
    raw_name = (d["product-name"] or "").strip()
    m = NUM_RE.search(raw_name)
    number = m.group(1) if m else None
    disp = NUM_RE.sub("", raw_name).strip() if m else raw_name

    price = float(d["PRICE"]) if d["PRICE"] is not None else None
    cost = (d["cost-basis-in-pennies"] or 0) / 100.0
    qty = int(d["quantity"] or 1)
    inc = (d["include-string"] or "Ungraded").strip()
    grader = d["grading-company"]
    graded = bool(grader) or inc.lower() != "ungraded"
    gm = re.search(r"(\d+(?:\.\d)?)", inc)
    grade = float(gm.group(1)) if (graded and gm) else None

    lang = "ja" if "Japanese" in console else "en"
    is_pokemon = console.startswith("Pokemon")
    game = "Pokémon" if is_pokemon else (console.split()[0] if console else "Other")

    # display set name (drop the "Pokemon " / "Pokemon Japanese " prefix)
    set_disp = console
    for p in ("Pokemon Japanese ", "Pokemon "):
        if set_disp.startswith(p):
            set_disp = set_disp[len(p):]
            break

    # image via TCGdex
    img = None
    rl, sid = resolve_set(console)
    tcg_name = ""
    set_year = None
    matched = False
    if sid:
        idx, tcg_name, set_year = set_card_index(rl, sid)
        if number:
            entry = idx.get(number) or idx.get(number.lstrip("0"))
            # Name-verify English only (JA TCGdex names are Japanese script, so
            # we trust the curated JA set map + number there).
            if entry and (rl == "ja" or name_matches(disp, entry["name"])):
                img = entry["img"] + "/high.webp"          # number (+ name) agree
                matched = True
            elif console in CLASSIC_CONSOLES:
                ci = classic_image(disp)                    # subset reprint → original art
                if ci:
                    img = ci + "/high.webp"
                    matched = True
            # else: English number hit but name disagrees (or no hit) → leave img
            #       None rather than show the wrong card's art.
    # NB: user-saved card-art is NOT baked into `img` here. The app layers it at
    # runtime (localStorage override + GET /api/cardart hydration) and keeps the
    # catalog art separate, so "Reset to catalog image" still works after a
    # rebuild. Baking it in would overwrite the true catalog art irreversibly.
    # era classification for the grading recommendation engine
    if set_year is None:
        era = "unknown"
    elif set_year <= 2010:
        era = "vintage"
    elif set_year <= 2019:
        era = "retro"
    else:
        era = "modern"
    rep = set_report.setdefault(console, {"m": 0, "t": 0, "lang": rl, "sid": sid, "tcg": tcg_name})
    rep["t"] += 1
    if matched:
        rep["m"] += 1
    if tcg_name and not rep["tcg"]:
        rep["tcg"] = tcg_name

    # clean search query for live comps (app builds the marketplace URLs)
    q_bits = [disp]
    if number and not number.startswith(("SV", "BW", "XY", "SM", "HGSS")):
        q_bits.append(number)
    elif number:
        q_bits.append(number)
    set_for_q = set_disp
    q = " ".join(q_bits + [set_for_q]).strip()
    if lang == "ja":
        q = "Japanese " + q

    pl = (price - cost) if price is not None else None
    cards.append({
        "i": i,
        "name": disp,
        "fullName": raw_name,
        "number": number,
        "set": set_disp,
        "setRaw": console,
        "setId": sid,
        "setYear": set_year,
        "era": era,
        "game": game,
        "lang": lang,
        "price": round(price, 2) if price is not None else None,
        "cost": round(cost, 2),
        "qty": qty,
        "value": round((price or 0) * qty, 2),
        "pl": round(pl, 2) if pl is not None else None,
        "plPct": round((pl / cost * 100), 1) if (pl is not None and cost > 0) else None,
        "graded": graded,
        "grader": grader,
        "grade": grade,
        "condition": inc,
        "wear": d["condition-string"],
        "certId": d["grading-cert-id"],
        "pcId": d["id"],
        "pcUrl": f"https://www.pricecharting.com/game/{d['id']}" if d["id"] else None,
        "q": q,
        "img": img,
        "dateAdded": iso(d["date-entered"]),
        "datePurchased": iso(d["date-purchased"]),
    })

# ---- aggregates -------------------------------------------------------------
def agg():
    tot_val = sum(c["value"] for c in cards)
    tot_cost = sum(c["cost"] * c["qty"] for c in cards)
    by_lang = {}
    by_set = {}
    by_game = {}
    for c in cards:
        by_lang[c["lang"]] = by_lang.get(c["lang"], 0) + c["value"]
        by_set[c["set"]] = by_set.get(c["set"], 0) + c["value"]
        by_game[c["game"]] = by_game.get(c["game"], 0) + c["value"]
    return {
        "totalCards": sum(c["qty"] for c in cards),
        "totalEntries": len(cards),
        "totalValue": round(tot_val, 2),
        "totalCost": round(tot_cost, 2),
        "totalPL": round(tot_val - tot_cost, 2),
        "imagesMatched": sum(1 for c in cards if c["img"]),
        "byLang": {k: round(v, 2) for k, v in by_lang.items()},
        "byGame": {k: round(v, 2) for k, v in sorted(by_game.items(), key=lambda x: -x[1])},
        "topSets": sorted(({"set": k, "value": round(v, 2)} for k, v in by_set.items()),
                          key=lambda x: -x["value"])[:15],
        "sets": sorted(set(c["set"] for c in cards)),
    }

out = {
    "generatedAt": datetime.datetime.now().isoformat(timespec="seconds"),
    "source": os.path.basename(SRC),
    "meta": agg(),
    "cards": cards,
}
OUT_PATH = os.path.join(OUT_DIR, "collection.json")
# atomic write: a reader (or a second concurrent refresh) never sees a half-written file
TMP_PATH = OUT_PATH + ".tmp"
with open(TMP_PATH, "w", encoding="utf-8") as f:
    json.dump(out, f, ensure_ascii=False, indent=None)
os.replace(TMP_PATH, OUT_PATH)

# ---- report -----------------------------------------------------------------
m = out["meta"]
print(f"\nWrote {OUT_PATH}")
print(f"  entries: {m['totalEntries']}  cards: {m['totalCards']}")
print(f"  value: ${m['totalValue']:,.2f}  cost: ${m['totalCost']:,.2f}  P/L: ${m['totalPL']:,.2f}")
if m['totalEntries']:
    print(f"  images matched: {m['imagesMatched']}/{m['totalEntries']} "
          f"({100*m['imagesMatched']//m['totalEntries']}%)")
print("\nAUDIT — console -> resolved TCGdex set (verify names line up):")
rows_rep = sorted(set_report.items(), key=lambda kv: -kv[1]["t"])
for console, r in rows_rep:
    flag = "ok " if r["m"] == r["t"] else ("MISS" if r["m"] == 0 else "part")
    print(f"  [{flag}] {r['m']:3d}/{r['t']:3d}  {console:42s} -> "
          f"{(r['lang'] or '--')}/{r['sid'] or '----':10s} {r['tcg']}")

# ---- machine-readable report (parsed by server.py /api/refresh) --------------
print("REPORT_JSON=" + json.dumps({
    "entries": m["totalEntries"],
    "cards": m["totalCards"],
    "value": m["totalValue"],
    "imagesMatched": m["imagesMatched"],
}), flush=True)
