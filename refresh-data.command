#!/bin/bash
# ── Pokémon Chest data refresh (fallback) ────────────────────────────
# NOTE: the ↻ Refresh button inside the app now does this same rebuild for
# you — this script is the Terminal fallback if the app isn't running.
# 1. Export a fresh collection from PriceCharting.com (Collection → Download).
# 2. Drop the .xlsx into THIS folder (keep the name containing "PriceCharting").
# 3. Double-click this file. It rebuilds data/collection.json with new prices
#    and any new cards, re-fetching card images as needed.
cd "$(dirname "$0")" || exit 1
PY="$(command -v python3 || echo /usr/bin/python3)"

echo "Checking for openpyxl (needed to read the .xlsx)…"
if ! "$PY" -c "import openpyxl" 2>/dev/null; then
  echo "Installing openpyxl (one-time)…"
  "$PY" -m pip install --user openpyxl || { echo "Could not install openpyxl."; read -r -p "Press Enter to close."; exit 1; }
fi

echo "Rebuilding data from the newest PriceCharting .xlsx in this folder…"
"$PY" scripts/build_data.py

echo "Refreshing the iPhone Pocket Edition…"
"$PY" scripts/build_pocket.py

echo ""
echo "✅ Done. Reload Pokémon Chest (or just use the in-app ↻ Refresh next time)."
echo "   📱 'Pokémon Chest — Pocket.html' is updated — AirDrop it to your iPhone."
read -r -p "Press Enter to close."
