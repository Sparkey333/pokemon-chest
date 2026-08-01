#!/usr/bin/env python3
"""
Pokémon Chest — Card Codex builder
==================================
Builds data/codex.json: a searchable index of every English + Japanese Pokémon
TCG release set and card on TCGdex (including secret / special rares past the
official set count). Used by the in-app Scanner to identify cards beyond your
PriceCharting collection export.

No API keys required. Source: https://api.tcgdex.net

Run:  python3 scripts/build_codex.py
"""
from __future__ import annotations

import datetime
import json
import os
import re
import sys
import urllib.error
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
_home_env = (os.environ.get("POKECHEST_HOME") or "").strip()
HOME = os.path.abspath(_home_env) if _home_env else None
OUT_DIR = os.path.join(HOME, "data") if HOME else os.path.join(ROOT, "data")
CACHE = os.path.join(HOME, "cache") if HOME else os.path.join(HERE, "cache")
os.makedirs(CACHE, exist_ok=True)
os.makedirs(OUT_DIR, exist_ok=True)

UA = {"User-Agent": "PokemonChest/1.14 (codex builder; +https://github.com/sparkey333/pokemon-chest)"}


def fetch_json(url, cache_name, ttl_hours=24):
    path = os.path.join(CACHE, cache_name)
    if os.path.exists(path):
        age_h = (datetime.datetime.now().timestamp() - os.path.getmtime(path)) / 3600
        if age_h < ttl_hours:
            try:
                with open(path, encoding="utf-8") as f:
                    return json.load(f)
            except Exception:
                pass
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=120) as r:
        data = json.load(r)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False)
    return data


def set_id_from_card(card_id: str) -> str:
    """TCGdex card ids are '{setId}-{localId}'. Set ids may contain hyphens/dots."""
    if not card_id or "-" not in card_id:
        return ""
    return card_id.rsplit("-", 1)[0]


def is_special(local_id: str, official: int | None) -> bool:
    """True for secret/special rares past the official printed set size, or lettered extras."""
    if not local_id:
        return False
    s = str(local_id).strip()
    if re.fullmatch(r"\d+", s):
        n = int(s)
        if official and n > official:
            return True
        return False
    # TG / GG / SV / letter suffixes and promo codes often mark special slots
    return bool(re.search(r"[A-Za-z]", s))


def build_lang(lang: str):
    print(f"Fetching {lang} sets + cards …")
    sets = fetch_json(f"https://api.tcgdex.net/v2/{lang}/sets", f"codex_{lang}_sets.json")
    cards = fetch_json(f"https://api.tcgdex.net/v2/{lang}/cards", f"codex_{lang}_cards.json")
    set_meta = {}
    for s in sets:
        cc = s.get("cardCount") or {}
        rd = s.get("releaseDate") or ""
        year = int(rd[:4]) if rd[:4].isdigit() else None
        set_meta[s["id"]] = {
            "id": s["id"],
            "name": s.get("name") or s["id"],
            "lang": lang,
            "official": cc.get("official"),
            "total": cc.get("total"),
            "year": year,
            "serie": (s.get("serie") or {}).get("name") if isinstance(s.get("serie"), dict) else s.get("serie"),
        }
    out_sets = list(set_meta.values())
    out_cards = []
    specials = 0
    for c in cards:
        cid = c.get("id") or ""
        sid = set_id_from_card(cid)
        sm = set_meta.get(sid) or {}
        lid = str(c.get("localId") or "").strip()
        sp = is_special(lid, sm.get("official"))
        if sp:
            specials += 1
        img = c.get("image")
        # Prefer sharp webp; bare asset URLs redirect to HTML.
        if img and not img.endswith((".webp", ".png", ".jpg", ".jpeg")):
            img = img.rstrip("/") + "/high.webp"
        out_cards.append({
            "id": cid,
            "name": c.get("name") or "",
            "number": lid,
            "setId": sid,
            "set": sm.get("name") or sid,
            "lang": lang,
            "year": sm.get("year"),
            "special": sp,
            "img": img,
        })
    print(f"  {lang}: {len(out_sets)} sets · {len(out_cards)} cards · {specials} special/secret-ish")
    return out_sets, out_cards


def main():
    en_sets, en_cards = build_lang("en")
    ja_sets, ja_cards = build_lang("ja")
    sets = en_sets + ja_sets
    cards = en_cards + ja_cards
    # Search haystack precomputed for fast server filtering
    for c in cards:
        bits = [
            c["name"], c["number"], c["set"], c["setId"], c["id"],
            "special" if c["special"] else "",
            "japanese" if c["lang"] == "ja" else "english",
            str(c["year"] or ""),
        ]
        c["q"] = " ".join(bits).lower()

    payload = {
        "generatedAt": datetime.datetime.now().isoformat(timespec="seconds"),
        "source": "TCGdex EN+JA",
        "meta": {
            "sets": len(sets),
            "cards": len(cards),
            "enCards": len(en_cards),
            "jaCards": len(ja_cards),
            "specialCards": sum(1 for c in cards if c["special"]),
            "enSets": len(en_sets),
            "jaSets": len(ja_sets),
        },
        "sets": sorted(sets, key=lambda s: (-(s.get("year") or 0), s.get("name") or "")),
        "cards": cards,
    }
    out = os.path.join(OUT_DIR, "codex.json")
    tmp = out + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, separators=(",", ":"))
    os.replace(tmp, out)
    kb = os.path.getsize(out) // 1024
    print(f"Wrote {out} ({kb} KB) — {payload['meta']}")
    print("REPORT_JSON=" + json.dumps(payload["meta"], separators=(",", ":")))
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except urllib.error.URLError as e:
        sys.exit(f"Network error building codex: {e}")
    except Exception as e:
        sys.exit(f"Codex build failed: {e}")
