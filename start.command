#!/bin/bash
# ── Pokémon Den launcher ───────────────────────────────────────────
# Double-click this file to open your collection in the browser.
# (Prefer the native "Pokémon Den.app" once built — same app, no Terminal.)
cd "$(dirname "$0")" || exit 1
PORT=8787
PY="$(command -v python3 || echo /usr/bin/python3)"

# If something is already serving the port, just open it.
if curl -s -o /dev/null "http://localhost:$PORT/index.html"; then
  open "http://localhost:$PORT/index.html"; exit 0
fi

echo "┌──────────────────────────────────────────────┐"
echo "│  Pokémon Den is running at                 │"
echo "│  http://localhost:$PORT                        │"
echo "│                                              │"
echo "│  Keep this window open while you browse.     │"
echo "│  Close it (or press Ctrl-C) to stop.         │"
echo "└──────────────────────────────────────────────┘"

( sleep 1; open "http://localhost:$PORT/index.html" ) &
# server.py adds the optional BYOK live-data backend; with no keys set it serves
# the static app exactly like a plain file server.
exec "$PY" server.py
