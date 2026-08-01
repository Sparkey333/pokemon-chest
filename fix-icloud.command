#!/bin/bash
# ── Pokémon Chest · fix iCloud / Mac folder connections ──────────────
# Double-click after migrating the project (or PriceCharting exports) into
# iCloud Drive. Scans Desktop / Documents / Downloads / iCloud Drive, seeds
# a local writable home under Application Support, and reports what it found.
set -e
ROOT="$(cd "$(dirname "$0")" && pwd -P)"
export POKECHEST_ROOT="$ROOT"
# shellcheck source=scripts/pokechest-env.sh
source "$ROOT/scripts/pokechest-env.sh"
cd "$ROOT"

PY="$(command -v python3 || echo /usr/bin/python3)"
echo "┌──────────────────────────────────────────────┐"
echo "│  Pokémon Chest · iCloud / path repair        │"
echo "└──────────────────────────────────────────────┘"
echo

"$PY" "$ROOT/scripts/mac_paths.py" "$ROOT"
STATUS=$?

echo
if [ "$STATUS" -eq 0 ]; then
  echo "✅ PriceCharting export found and paths look healthy."
  echo "   Next: double-click start.command (or open the .app)."
else
  echo "⚠️  Could not find a downloaded PriceCharting .xlsx yet."
  echo "   • Export from PriceCharting → Collection → Download"
  echo "   • Drop it into this folder, ~/Downloads, or iCloud Drive"
  echo "   • If you see a cloud icon in Finder, open the file once to download it"
fi
echo
read -r -p "Press Enter to close."
exit "$STATUS"
