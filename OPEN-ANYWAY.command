#!/bin/bash
# ─────────────────────────────────────────────────────────────────────────────
# Pokémon Chest — unblock Gatekeeper after a GitHub / browser DMG download
# Double-click me on your Mac (or: right-click → Open the first time).
# ─────────────────────────────────────────────────────────────────────────────
set -e
APP=""
for cand in \
  "/Applications/Pokemon Chest.app" \
  "/Applications/Pokémon Chest.app" \
  "$HOME/Applications/Pokemon Chest.app" \
  "$HOME/Applications/Pokémon Chest.app" \
  "$HOME/Desktop/Pokemon Chest.app" \
  "$HOME/Desktop/Pokémon Chest.app" \
  "$HOME/Library/Mobile Documents/com~apple~CloudDocs/Pokemon Chest.app" \
  "$HOME/Library/Mobile Documents/com~apple~CloudDocs/Pokémon Chest.app" \
  "$HOME/Library/Mobile Documents/com~apple~CloudDocs/Desktop/Pokemon Chest.app" \
  "$HOME/Library/Mobile Documents/com~apple~CloudDocs/Applications/Pokemon Chest.app"
do
  if [ -d "$cand" ]; then APP="$cand"; break; fi
done

# Also accept a .app dropped onto this script / passed as $1
if [ -z "$APP" ] && [ -d "$1" ]; then APP="$1"; fi

echo "── Pokémon Chest · Open Anyway ──"
if [ -z "$APP" ]; then
  echo "✗ Could not find Pokemon Chest.app in /Applications."
  echo "  Install from the DMG first (drag the app into Applications), then run me again."
  echo
  echo "Or paste the full path when prompted:"
  read -r -p "Path to .app: " APP
fi
if [ ! -d "$APP" ]; then
  echo "✗ Not found: $APP"
  read -n 1 -s -r -p "Press any key to close…"; exit 1
fi

echo "→ Clearing macOS quarantine flags on:"
echo "   $APP"
# Removes the "downloaded from internet" bit Safari/Chrome/GitHub put on the file.
xattr -cr "$APP" 2>/dev/null || true
xattr -d com.apple.quarantine "$APP" 2>/dev/null || true

echo "→ Opening…"
open "$APP" && echo "✓ Launched." && exit 0

echo
echo "If macOS still shows “Not Opened” with only Done:"
echo "  1) Click Done"
echo "  2) Apple menu → System Settings → Privacy & Security"
echo "  3) Scroll to Security → “Pokemon Chest was blocked…” → Open Anyway"
echo "  4) Confirm with password / Touch ID, then Open"
read -n 1 -s -r -p "Press any key to close…"
exit 1
