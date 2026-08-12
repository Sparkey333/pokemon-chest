# GradeStage — 3D-printed card imaging & pre-grading rig

© 2026 DarkHearts · companion hardware for **Pokémon DenZ** (Grade Lab tab)

Photograph cards the way a PSA grader sees them: a fixed stage with **20° raking
light** (exposes print lines and holo scratches — the 10-killers), **45° even
light** (true color, centering shots), and a phone tower at fixed height so every
photo is framed identically — which makes the in-app centering calculator
repeatable.

## Files

| File | What | Print |
|---|---|---|
| `gradestage.scad` | Parametric source — open in [OpenSCAD](https://openscad.org) (free), tweak any dimension, F6 → export STL | — |
| `stl/gradestage-base.stl` | The stage: card bay (raw / penny sleeve / Card Saver 1), crosshairs, LED sockets, tower sockets | ×1 |
| `stl/gradestage-ledbar.stl` | Snap-in LED bar (channel fits 10mm COB strip) | ×2 |
| `stl/gradestage-column.stl` | Stacking tower column (60mm each) | ×4 |
| `stl/gradestage-bridge.stl` | Phone crossbar with camera window | ×1 |

PLA is fine (PETG for LED bars if your strips run warm). 0.2mm layers, 15-20%
infill, no supports (print the bridge flat-side down).

## Assembly

1. Cut two ~110mm segments of LED strip, stick into the bar channels, route wires
   out the end holes.
2. Bars drop into the **inner** sockets for 20° raking light (flaw-hunting) or the
   **outer** sockets for 45° even light (color/centering).
3. Stack four columns per side into the corner sockets, seat the bridge on top,
   phone in the slot — camera over the window.
4. Holo cards: polarizing film over the strips + a CPL (or second film rotated
   90°) over the lens kills glare completely (cross-polarization).

The full bill of materials, verified lighting specs, and the R&D roadmap live in
the app: **🛠 Admin** tab.
