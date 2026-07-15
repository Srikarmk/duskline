#!/usr/bin/env python3
"""Build the Fantasy Racer '8 worlds' showcase montage — 4x2 grid of realms."""
from PIL import Image, ImageDraw, ImageFont
import os

ROOT = "/Users/srikarmk/Programming/fantasy-racer"
SHOTS = os.path.join(ROOT, "docs/screenshots")
PREV = os.path.join(ROOT, "public/previews")

ARIAL_BLACK = "/System/Library/Fonts/Supplemental/Arial Black.ttf"
ARIAL = "/System/Library/Fonts/Supplemental/Arial.ttf"
MENLO = "/System/Library/Fonts/Menlo.ttc"
def font(p, s, i=0):
    try: return ImageFont.truetype(p, s, index=i)
    except Exception: return ImageFont.load_default()

f_title = font(ARIAL_BLACK, 54)
f_sub   = font(ARIAL, 24)
f_name  = font(MENLO, 21, 1)
f_tag   = font(MENLO, 14, 1)
f_foot  = font(MENLO, 20)

BG=(12,8,30); PANEL=(22,16,46); CYAN=(34,211,238); PURPLE=(168,85,247)
WHITE=(238,234,248); MUTE=(150,140,180); GOLD=(234,197,88)

# file, name, is_new
REALMS = [
    ("realm-forest.jpg",  "ENCHANTED FOREST", False),
    ("realm-ember.jpg",   "EMBER WASTES",     False),
    ("realm-peaks.jpg",   "CRYSTAL PEAKS",    False),
    ("realm-void.jpg",    "VOID CIRCUIT",     False),
    ("realm-sands.jpg",   "SUNSPIRE SANDS",   True),
    ("realm-castle.jpg",  "RAVENSPIRE KEEP",  True),
    ("realm-circuit.jpg", "APEX SPEEDWAY",    True),
    ("realm-metro.jpg",   "NEON METRO",       True),
]

COLS, ROWS = 4, 2
TW, TH = 384, 216
CAP_H = 50
GAP = 18
MARGIN = 40
TITLE_H = 132
FOOT_H = 50

cell_w, cell_h = TW, TH + CAP_H
W = MARGIN*2 + COLS*cell_w + (COLS-1)*GAP
H = MARGIN + TITLE_H + ROWS*cell_h + (ROWS-1)*GAP + FOOT_H + MARGIN

img = Image.new("RGB", (W, H), BG)
d = ImageDraw.Draw(img)

def crop_fill(im, tw, th):
    sw, sh = im.size
    sc = max(tw/sw, th/sh)
    nw, nh = int(sw*sc+0.5), int(sh*sc+0.5)
    im = im.resize((nw, nh), Image.LANCZOS)
    x=(nw-tw)//2; y=(nh-th)//2
    return im.crop((x,y,x+tw,y+th))

for y in range(TITLE_H+MARGIN):
    t = 1 - y/(TITLE_H+MARGIN)
    d.line([(0,y),(W,y)], fill=(int(BG[0]+(30-BG[0])*t*0.5), int(BG[1]+(20-BG[1])*t*0.5), int(BG[2]+(60-BG[2])*t*0.5)))

# title
tx, ty = MARGIN, MARGIN+4
d.rectangle([tx, ty+4, tx+10, ty+88], fill=PURPLE)
d.text((tx+28, ty), "EIGHT WORLDS", font=f_title, fill=WHITE)
d.text((tx+30, ty+72), "Fantasy Racer  —  four fresh realms join the grid: desert, castle, F1 stadium, neon city",
       font=f_sub, fill=(200,190,225))

y0 = MARGIN + TITLE_H
for i,(fn,name,new) in enumerate(REALMS):
    c=i%COLS; r=i//COLS
    x=MARGIN + c*(cell_w+GAP)
    y=y0 + r*(cell_h+GAP)
    accent = GOLD if new else CYAN
    d.rectangle([x,y,x+cell_w,y+cell_h], fill=PANEL)
    p = os.path.join(PREV, fn)
    im = Image.open(p).convert("RGB")
    img.paste(crop_fill(im, TW, TH), (x,y))
    d.rectangle([x, y+TH, x+cell_w, y+TH+3], fill=accent)
    d.text((x+14, y+TH+15), name, font=f_name, fill=WHITE)
    if new:
        # NEW badge top-right of the tile
        bw, bh = 52, 24
        d.rectangle([x+cell_w-bw-8, y+8, x+cell_w-8, y+8+bh], fill=GOLD)
        d.text((x+cell_w-bw-8+9, y+8+4), "NEW", font=f_tag, fill=(20,16,6))

fy = y0 + ROWS*cell_h + (ROWS-1)*GAP + 12
d.line([(MARGIN,fy),(W-MARGIN,fy)], fill=(40,32,70))
d.text((MARGIN, fy+14), "play  fantasy-racer.vercel.app", font=f_foot, fill=CYAN)
r = "8 worlds  ·  8 karts  ·  9-racer grid"
bb = d.textbbox((0,0), r, font=f_foot)
d.text((W-MARGIN-(bb[2]-bb[0]), fy+14), r, font=f_foot, fill=MUTE)

out = os.path.join(SHOTS, "realms.jpg")
img.save(out, quality=92)
print("saved", out, img.size)
