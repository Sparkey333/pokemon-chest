#!/bin/bash
# ─────────────────────────────────────────────────────────────────────────────
# Pokémon Den — Mac app builder
# Double-click me on your Mac: regenerates the app icon set from
# icon-source.png, then builds "Pokemon Den.app" and the styled .dmg
# (Amber Den background, drag-to-Applications layout) via Tauri.
# ─────────────────────────────────────────────────────────────────────────────
set -e
cd "$(dirname "$0")"
echo "── Pokémon Den · Mac app builder ──"

if ! command -v cargo >/dev/null 2>&1; then
  echo "✗ Rust isn't installed (needed once). Install it, then re-run me:"
  echo "    curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh"
  read -n 1 -s -r -p "Press any key to close…"; exit 1
fi

if command -v npx >/dev/null 2>&1; then
  echo "→ regenerating the full icon set (icns/ico/all sizes) from icon-source.png"
  npx --yes "@tauri-apps/cli@^2" icon icon-source.png \
    || echo "  (icon regen skipped — building with the checked-in PNGs)"
else
  echo "  (npx not found — building with the checked-in PNGs; install Node to regen the .icns)"
fi

echo "→ building the app + dmg (the first build compiles Rust — takes a while)"
if cargo tauri --version >/dev/null 2>&1; then
  (cd src-tauri && cargo tauri build)
elif command -v npx >/dev/null 2>&1; then
  npx --yes "@tauri-apps/cli@^2" build
else
  echo "✗ Need the Tauri CLI:  cargo install tauri-cli --locked"; exit 1
fi

BUNDLE="src-tauri/target/release/bundle"
echo "✓ Done. Your fresh dmg:"
ls -1 "$BUNDLE/dmg/"*.dmg 2>/dev/null || true
open "$BUNDLE/dmg" 2>/dev/null || open "$BUNDLE" 2>/dev/null || true
