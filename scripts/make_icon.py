#!/usr/bin/env python3
"""Generate the Pokémon Den app icon (1024x1024 PNG) with no dependencies.

A gold treasure chest with a pokéball clasp on a dark rounded-square tile —
matches the in-app dark "vault" theme. Output: icon-source.png in the project
root, ready for `npx tauri icon`.
"""
import os, struct, zlib, math

W = H = 1024
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "icon-source.png")

# palette
BG_TOP = (16, 22, 36)
BG_BOT = (8, 11, 20)
GOLD = (255, 206, 77)
GOLD_DARK = (138, 111, 37)
GOLD_HI = (255, 232, 150)
WOOD = (122, 82, 38)
WOOD_DARK = (84, 55, 24)
RED = (226, 59, 59)
WHITE = (240, 244, 252)
BLACK = (10, 14, 22)

px = bytearray(W * H * 4)

def put(x, y, c, a=255):
    if 0 <= x < W and 0 <= y < H:
        i = (y * W + x) * 4
        sa = a / 255.0
        px[i] = min(255, max(0, int(c[0] * sa + px[i] * (1 - sa))))
        px[i + 1] = min(255, max(0, int(c[1] * sa + px[i + 1] * (1 - sa))))
        px[i + 2] = min(255, max(0, int(c[2] * sa + px[i + 2] * (1 - sa))))
        px[i + 3] = max(px[i + 3], a)

def in_rounded(x, y, x0, y0, x1, y1, r):
    if x < x0 or x > x1 or y < y0 or y > y1:
        return False
    cx = min(max(x, x0 + r), x1 - r)
    cy = min(max(y, y0 + r), y1 - r)
    return (x - cx) ** 2 + (y - cy) ** 2 <= r * r

# --- background tile (rounded square, vertical gradient, thin gold rim) ------
TILE_R = 200
for y in range(H):
    t = y / H
    bg = tuple(int(BG_TOP[i] * (1 - t) + BG_BOT[i] * t) for i in range(3))
    for x in range(W):
        if in_rounded(x, y, 8, 8, W - 9, H - 9, TILE_R):
            put(x, y, bg)
            if not in_rounded(x, y, 22, 22, W - 23, H - 23, TILE_R - 12):
                put(x, y, GOLD_DARK, 160)

# --- chest geometry -----------------------------------------------------------
CX = W // 2
BODY_X0, BODY_X1 = 192, W - 192
BODY_Y0, BODY_Y1 = 520, 840
LID_Y0 = 330

def chest_pix(x, y):
    """Return base color for chest at (x,y) or None."""
    # lid: half-ellipse arch from LID_Y0 to BODY_Y0
    if LID_Y0 <= y < BODY_Y0 + 24:
        rx = (BODY_X1 - BODY_X0) / 2
        ry = (BODY_Y0 + 24 - LID_Y0)
        dx = (x - CX) / rx
        dy = (y - (BODY_Y0 + 24)) / ry
        if dx * dx + dy * dy <= 1.0 and y <= BODY_Y0 + 24:
            return WOOD
    # body
    if in_rounded(x, y, BODY_X0, BODY_Y0, BODY_X1, BODY_Y1, 36):
        return WOOD
    return None

for y in range(LID_Y0 - 4, BODY_Y1 + 5):
    for x in range(BODY_X0 - 4, BODY_X1 + 5):
        c = chest_pix(x, y)
        if c is None:
            continue
        col = c
        # wood shading: darker at edges/bottom
        t = (y - LID_Y0) / (BODY_Y1 - LID_Y0)
        col = tuple(int(c[i] * (1.08 - 0.35 * t)) for i in range(3))
        # plank lines on body
        if y > BODY_Y0 + 30 and (y - BODY_Y0) % 86 < 7:
            col = WOOD_DARK
        put(x, y, col)

# gold bands: lid rim, body top edge, two vertical straps, bottom rim
def band(x0, y0, x1, y1):
    for y in range(y0, y1):
        for x in range(x0, x1):
            if chest_pix(x, y) is not None or (BODY_Y0 <= y < BODY_Y1):
                t = abs(y - (y0 + y1) / 2) / max(1, (y1 - y0) / 2)
                col = tuple(int(GOLD[i] * (1 - 0.35 * t) + GOLD_HI[i] * 0.18 * (1 - t)) for i in range(3))
                if chest_pix(x, y) is not None:
                    put(x, y, col)

band(BODY_X0 - 4, BODY_Y0 - 14, BODY_X1 + 4, BODY_Y0 + 26)   # lid/body seam
band(BODY_X0 - 4, BODY_Y1 - 40, BODY_X1 + 4, BODY_Y1 + 1)    # bottom rim
for sx in (BODY_X0 + 118, BODY_X1 - 118 - 56):
    for y in range(LID_Y0 + 6, BODY_Y1):
        for x in range(sx, sx + 56):
            if chest_pix(x, y) is not None:
                t = abs(x - (sx + 28)) / 28
                col = tuple(int(GOLD[i] * (1 - 0.3 * t)) for i in range(3))
                put(x, y, col)
# lid arch gold trim (outline)
for y in range(LID_Y0, BODY_Y0 + 24):
    for x in range(BODY_X0 - 4, BODY_X1 + 5):
        if chest_pix(x, y) is not None:
            inside = all(chest_pix(x + dx, y + dy) is not None
                         for dx in (-14, 14) for dy in (-14, 0))
            if not inside:
                put(x, y, GOLD)

# --- pokéball clasp -----------------------------------------------------------
BCX, BCY, BR = CX, BODY_Y0 + 10, 118
for y in range(BCY - BR - 6, BCY + BR + 7):
    for x in range(BCX - BR - 6, BCX + BR + 7):
        d = math.hypot(x - BCX, y - BCY)
        if d <= BR + 6:
            if d > BR:
                put(x, y, BLACK)              # outer ring
            elif d > BR - 14:
                put(x, y, BLACK)
            else:
                col = RED if y < BCY else WHITE
                # subtle sphere shading
                sh = 1.0 - 0.35 * (d / BR) ** 2
                hi = max(0.0, 1 - math.hypot(x - (BCX - 36), y - (BCY - 36)) / 90) * 0.5
                col = tuple(min(255, int(c * sh + 255 * hi)) for c in col)
                put(x, y, col)
# belt + button
for y in range(BCY - 12, BCY + 13):
    for x in range(BCX - BR + 2, BCX + BR - 1):
        if math.hypot(x - BCX, y - BCY) <= BR - 8:
            put(x, y, BLACK)
for y in range(BCY - 34, BCY + 35):
    for x in range(BCX - 34, BCX + 35):
        d = math.hypot(x - BCX, y - BCY)
        if d <= 34:
            put(x, y, BLACK)
        if d <= 22:
            put(x, y, WHITE)
        if d <= 10:
            put(x, y, (200, 208, 222))

# --- glow under lid (gold light leaking out) -----------------------------------
for y in range(BODY_Y0 - 40, BODY_Y0 + 12):
    for x in range(BODY_X0 + 30, BODY_X1 - 30):
        if abs(x - CX) > BR + 10:
            fade = 1 - abs(y - (BODY_Y0 - 6)) / 44
            if fade > 0:
                put(x, y, GOLD_HI, int(70 * fade))

# --- write PNG ------------------------------------------------------------------
def chunk(tag, data):
    c = tag + data
    return struct.pack(">I", len(data)) + c + struct.pack(">I", zlib.crc32(c) & 0xFFFFFFFF)

raw = b"".join(b"\x00" + bytes(px[y * W * 4:(y + 1) * W * 4]) for y in range(H))
png = (b"\x89PNG\r\n\x1a\n"
       + chunk(b"IHDR", struct.pack(">IIBBBBB", W, H, 8, 6, 0, 0, 0))
       + chunk(b"IDAT", zlib.compress(raw, 9))
       + chunk(b"IEND", b""))
open(OUT, "wb").write(png)
print(f"wrote {OUT} ({len(png)//1024} KB)")
