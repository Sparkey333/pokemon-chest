#!/bin/bash
# ─────────────────────────────────────────────────────────────────────────────
# Pokémon Den — one-command display-name rename.
#
#   bash scripts/rename.sh "Card Den"
#
# Swaps the DISPLAY NAME everywhere the user sees it (app header, window/product
# titles, DMG, launchers, README, LEGAL, generated editions) — and NOTHING else.
# Internal identifiers are deliberately left untouched so no saved data breaks:
#   • localStorage keys      pokechest.*
#   • bundle identifier      com.darkhearts.pokemonchest
#   • env vars               POKECHEST_PORT / POKECHEST_HOME
#   • keychain service       com.darkhearts.pokemonchest.secret
# Those contain no "Pokémon Den" / "Pokemon Den" literal, so the literal
# string-replace below can never reach them.
#
# IP-safe ship-name candidates (see ROADMAP-TO-PUBLISH.md §1): "Card Den"
# (recommended), "The Amber Den", "DenKeeper". A public store listing must not
# carry "Pokémon" in the name.
#
# Idempotent: a second run finds nothing to change. Personal builds can keep
# "Pokémon Den"; run this only when preparing a public/ship build.
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

NEW="${1:-}"
if [ -z "$NEW" ]; then
  echo 'usage: bash scripts/rename.sh "New Display Name"'
  echo 'examples: "Card Den" · "The Amber Den" · "DenKeeper"'
  exit 1
fi

# operate from the repo root regardless of where we were invoked
cd "$(dirname "$0")/.."

NEW="$NEW" python3 - <<'PY'
import os
new = os.environ["NEW"]
words = new.split()
# keep the gold-accent <span> on the last word of the header (single word → whole name)
if len(words) > 1:
    span = " ".join(words[:-1]) + " <span>" + words[-1] + "</span>"
else:
    span = "<span>" + new + "</span>"

files = [
    "index.html", "tauri-shell/index.html",
    "assets/app.js", "assets/revamp.js", "assets/mobile.html",
    "server.py", "package.json", "src-tauri/tauri.conf.json",
    ".github/workflows/build-dmg.yml",
    "build-app.command", "start.command", "refresh-data.command",
    "README.md", "LEGAL.md",
    "scripts/build_mobile.py", "scripts/build_pocket.py",
    "scripts/build_data.py", "scripts/make_icon.py",
    "hardware/gradestage/README.md",
]
# NOT renamed on purpose: ROADMAP-TO-PUBLISH.md (strategy doc), data/parity.json
# (dev tracking data — its ship-rename item references this exact literal), and
# this script itself (the matcher). A public/ship build should also hide the
# dev-only Parity tab, so those references never reach shipped chrome.
# split-markup header forms FIRST, then the plain string (independent substrings)
import urllib.parse
# Percent-encoded forms too. The Admin panel links to the generated Pocket
# Edition by URL, so the old name survives there as "Pok%C3%A9mon%20Den..." —
# invisible to a plain string replace, which is exactly how that link ended up
# 404-ing after the Chest -> Den rename.
def _enc(s): return urllib.parse.quote(s)

reps = [
    ("Pokémon <span>Den</span>", span),
    ("Pokemon <span>Den</span>", span),
    (_enc("Pokémon Den"), _enc(new)),
    (_enc("Pokemon Den"), _enc(new)),
    ("Pokémon Den", new),
    ("Pokemon Den", new),
]
# Guard against a new name that CONTAINS the old one ("Pokémon Den" ->
# "Pokémon DenZ"): a naive replace turns DenZ into DenZZ, and DenZZZ on the
# run after that. Park anything already reading as the new name behind a
# sentinel, do the replace, then put it back — which is what actually makes
# this idempotent, as the header above promises.
SENTINEL = "\u0000RENAMED\u0000"

import unicodedata
def _fold(s):
    """Transliterate accents away: 'Pokémon DenZ' -> 'Pokemon DenZ'.
    NOT encode('ascii','ignore'), which DROPS the é and yields 'Pokmon'."""
    return "".join(c for c in unicodedata.normalize("NFKD", s)
                   if not unicodedata.combining(c)).encode("ascii", "ignore").decode()

ASCII_NEW = _fold(new) or new

def apply(text, path=None):
    # tauri.conf.json's productName becomes the .app and .dmg filename, and
    # GitHub strips non-ASCII from release asset names on upload — which
    # desyncs SHA256SUMS.txt from the file people actually download and makes
    # the `shasum -a 256 -c` line in the release notes fail. Keep it ASCII.
    if path == "src-tauri/tauri.conf.json":
        text = text.replace(f'"productName": "{new}"', f'"productName": "{ASCII_NEW}"')
        text = text.replace('"productName": "' + ASCII_NEW + '"', SENTINEL + "N")
    text = text.replace(span, SENTINEL + "S")
    text = text.replace(_enc(new), SENTINEL + "E")
    text = text.replace(new, SENTINEL + "P")
    for a, b in reps:
        text = text.replace(a, b)
    text = text.replace(SENTINEL + "P", new)
    text = text.replace(SENTINEL + "E", _enc(new))
    text = text.replace(SENTINEL + "S", span)
    text = text.replace(SENTINEL + "N", '"productName": "' + ASCII_NEW + '"')
    return text

changed = 0
for f in files:
    if not os.path.isfile(f):
        continue
    orig = open(f, encoding="utf-8").read()
    s = apply(orig, f)
    if s != orig:
        open(f, "w", encoding="utf-8").write(s)
        changed += 1
print(f"Renamed display name → {new!r}  ({changed} files changed; internal ids untouched)")
PY

echo "Next: rebuild the app (build-app.command) and regenerate icon/DMG art if the name changed."
