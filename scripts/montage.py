#!/usr/bin/env python3
"""Build the Fantasy Racer evolution montage — a 3x2 timeline of stages."""
from PIL import Image, ImageDraw, ImageFont
import os

ROOT = "/Users/srikarmk/Programming/fantasy-racer"
SHOTS = os.path.join(ROOT, "docs/screenshots")

# --- fonts ---
ARIAL_BLACK = "/System/Library/Fonts/Supplemental/Arial Black.ttf"
ARIAL_BOLD  = "/System/Library/Fonts/Supplemental/Arial Bold.ttf"
ARIAL       = "/System/Library/Fonts/Supplemental/Arial.ttf"
MENLO       = "/System/Library/Fonts/Menlo.ttc"
def font(path, size, idx=0):
    try:
        return ImageFont.truetype(path, size, index=idx)
    except Exception:
        return ImageFont.load_default()

f_title   = font(ARIAL_BLACK, 62)
f_sub     = font(ARIAL, 27)
f_stage   = font(MENLO, 24, 1)   # bold
f_cap     = font(ARIAL_BOLD, 23)
f_foot    = font(MENLO, 22, 0)

# --- palette (from the game) ---
BG      = (12, 8, 30)
PANEL   = (22, 16, 46)
CYAN    = (34, 211, 238)
PURPLE  = (168, 85, 247)
WHITE   = (238, 234, 248)
MUTE    = (150, 140, 180)

# stage, file, number, label, caption
STAGES = [
    ("origin.jpg",       "01", "PROTOTYPE",        "Pseudo-3D canvas road, hand-drawn HUD"),
    ("textured.jpg",     "02", "REAL 3D + TEXTURE","Three.js engine, procedural surfaces"),
    ("real-assets.jpg",  "03", "PBR MATERIALS",    "Photoreal CC0 textures (Poly Haven)"),
    ("grid.jpg",         "04", "9-RACER GRID",     "Deterministic AI rivals, standing start"),
    ("stage2-cars.jpg",  "05", "ARCADE CARS",      "Hand-modeled faceted karts & realms"),
    ("boost-pads.jpg",   "06", "TODAY",            "Power-ups, drift, boost pads, 4 realms"),
]

# --- layout ---
COLS, ROWS = 3, 2
TW, TH = 496, 279          # tile image size (16:9)
CAP_H  = 74                # caption strip under each image
GAP    = 22
MARGIN = 44
TITLE_H = 150
FOOT_H  = 58

cell_w = TW
cell_h = TH + CAP_H
W = MARGIN*2 + COLS*cell_w + (COLS-1)*GAP
H = MARGIN + TITLE_H + ROWS*cell_h + (ROWS-1)*GAP + FOOT_H + MARGIN

img = Image.new("RGB", (W, H), BG)
d = ImageDraw.Draw(img)

def crop_fill(im, tw, th):
    """center-crop im to fill tw x th (cover)."""
    sw, sh = im.size
    scale = max(tw/sw, th/sh)
    nw, nh = int(sw*scale+0.5), int(sh*scale+0.5)
    im = im.resize((nw, nh), Image.LANCZOS)
    x = (nw-tw)//2; y = (nh-th)//2
    return im.crop((x, y, x+tw, y+th))

# subtle top gradient glow
for y in range(TITLE_H+MARGIN):
    t = 1 - y/(TITLE_H+MARGIN)
    r = int(BG[0] + (30-BG[0])*t*0.5)
    g = int(BG[1] + (20-BG[1])*t*0.5)
    b = int(BG[2] + (60-BG[2])*t*0.5)
    d.line([(0,y),(W,y)], fill=(r,g,b))

# --- title ---
tx = MARGIN
ty = MARGIN + 6
# accent bar
d.rectangle([tx, ty+6, tx+10, ty+96], fill=CYAN)
d.text((tx+30, ty), "FANTASY RACER", font=f_title, fill=WHITE)
d.text((tx+32, ty+80), "How a browser kart racer evolved  —  prototype  →  3D arcade racer",
       font=f_sub, fill=(200,190,225))

# --- tiles ---
y0 = MARGIN + TITLE_H
for i, (fn, num, label, cap) in enumerate(STAGES):
    c = i % COLS; r = i // COLS
    x = MARGIN + c*(cell_w+GAP)
    y = y0 + r*(cell_h+GAP)
    accent = CYAN if i % 2 == 0 else PURPLE
    # panel bg
    d.rectangle([x, y, x+cell_w, y+cell_h], fill=PANEL)
    # image
    im = Image.open(os.path.join(SHOTS, fn)).convert("RGB")
    tile = crop_fill(im, TW, TH)
    img.paste(tile, (x, y))
    # thin accent underline between image and caption
    d.rectangle([x, y+TH, x+cell_w, y+TH+3], fill=accent)
    # caption strip
    cy = y + TH + 3
    d.text((x+16, cy+12), f"{num}", font=f_stage, fill=accent)
    d.text((x+16+42, cy+12), label, font=f_stage, fill=WHITE)
    d.text((x+16, cy+42), cap, font=f_cap, fill=MUTE)

# --- footer ---
fy = y0 + ROWS*cell_h + (ROWS-1)*GAP + 16
d.line([(MARGIN, fy), (W-MARGIN, fy)], fill=(40,32,70))
d.text((MARGIN, fy+16), "play  fantasy-racer.vercel.app", font=f_foot, fill=CYAN)
foot_r = "Next.js 15  ·  React 19  ·  Three.js  ·  TypeScript"
bb = d.textbbox((0,0), foot_r, font=f_foot)
d.text((W-MARGIN-(bb[2]-bb[0]), fy+16), foot_r, font=f_foot, fill=MUTE)

out = os.path.join(SHOTS, "evolution.jpg")
img.save(out, quality=92)
print("saved", out, img.size)
