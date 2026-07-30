#!/bin/bash
# Shared Mac / iCloud bootstrap for Pokémon Chest .command launchers.
# Launchers must set POKECHEST_ROOT (absolute project dir) before sourcing:
#
#   ROOT="$(cd "$(dirname "$0")" && pwd -P)"
#   export POKECHEST_ROOT="$ROOT"
#   source "$ROOT/scripts/pokechest-env.sh"
#   cd "$ROOT"
#
# When the checkout lives under iCloud Drive, points writes at:
#   ~/Library/Application Support/PokemonChest

if [ -z "${POKECHEST_ROOT:-}" ]; then
  # Fallback: directory containing this file's parent (…/scripts → project)
  POKECHEST_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
  export POKECHEST_ROOT
fi

cd "$POKECHEST_ROOT" || return 1 2>/dev/null || exit 1

case "$POKECHEST_ROOT" in
  *"Mobile Documents"*|*"CloudDocs"*|*/Library/Mobile\ Documents/*)
    _support="${POKECHEST_HOME:-$HOME/Library/Application Support/PokemonChest}"
    mkdir -p "$_support/data" "$_support/cache" "$_support/card-art" "$_support/listing-photos"
    export POKECHEST_HOME="$_support"
    echo "iCloud project detected."
    echo "  Project (read)  → $POKECHEST_ROOT"
    echo "  Writable home   → $POKECHEST_HOME"
    if command -v python3 >/dev/null 2>&1; then
      python3 - "$POKECHEST_ROOT" "$POKECHEST_HOME" <<'PY' 2>/dev/null || true
import os, sys, shutil
root, home = sys.argv[1], sys.argv[2]
for rel in (
    "settings.local.json",
    "data/collection.json",
    "data/codex.json",
    "data/selling-intel.json",
    "data/grade-intel.json",
    "data/game-plan.json",
):
    src, dst = os.path.join(root, rel), os.path.join(home, rel)
    if not os.path.isfile(src):
        continue
    if os.path.isfile(dst) and os.path.getmtime(dst) >= os.path.getmtime(src):
        continue
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    try:
        shutil.copy2(src, dst)
        print(f"  seeded {rel}")
    except OSError:
        pass
xlsx = []
try:
    for f in os.listdir(root):
        if f.lower().endswith(".xlsx") and "pricecharting" in f.lower() and not f.startswith("~$"):
            xlsx.append(os.path.join(root, f))
except OSError:
    pass
if xlsx:
    newest = max(xlsx, key=os.path.getmtime)
    dst = os.path.join(home, os.path.basename(newest))
    if not os.path.isfile(dst):
        try:
            shutil.copy2(newest, dst)
            print(f"  seeded {os.path.basename(newest)}")
        except OSError:
            pass
PY
    fi
    unset _support
    ;;
esac
