"""Dev tool: top-down rasterisation of dump-mesh.mjs output (no GPU needed).

  python3 scripts/render-topdown.py /tmp/topdown.json /tmp/top.png [cx cz halfsize]

Colours follow src/engine/materials.js. Triangles are painted far-to-near by height so
higher decks cover lower ground. Useful to check junction hubs, curb bands and overlaps.
"""
import json, sys
from PIL import Image, ImageDraw

COL = {
    0: (128, 128, 128), 1: (40, 40, 44), 2: (70, 66, 60), 3: (110, 108, 102), 4: (140, 138, 130),
    5: (120, 118, 110), 6: (80, 78, 74), 7: (90, 88, 84), 8: (235, 235, 230), 9: (210, 160, 30),
    10: (30, 48, 26), 11: (50, 52, 56), 12: (150, 152, 158), 13: (255, 220, 150), 14: (105, 100, 95),
    15: (10, 12, 16), 16: (5, 5, 5), 17: (60, 62, 66), 18: (150, 148, 140), 19: (180, 30, 20),
    28: (160, 156, 148), 29: (30, 30, 32),
}

src, dst = sys.argv[1], sys.argv[2]
crop = None
if len(sys.argv) >= 6:
    crop = (float(sys.argv[3]), float(sys.argv[4]), float(sys.argv[5]))
data = json.load(open(src))
tris = data["tris"]

if crop:
    cx, cz, half = crop
    x0, x1, z0, z1 = cx - half, cx + half, cz - half, cz + half
else:
    xs = [v for t in tris for v in (t[0], t[4], t[8])]
    zs = [v for t in tris for v in (t[2], t[6], t[10])]
    x0, x1, z0, z1 = min(xs), max(xs), min(zs), max(zs)
W = 1600
H = int(W * (z1 - z0) / (x1 - x0))
img = Image.new("RGB", (W, H), (22, 26, 22))
dr = ImageDraw.Draw(img)

def to_px(x, z):
    return ((x - x0) / (x1 - x0) * W, (z - z0) / (z1 - z0) * H)

order = sorted(tris, key=lambda t: (t[1] + t[5] + t[9]) / 3)
for t in order:
    pts = [to_px(t[0], t[2]), to_px(t[4], t[6]), to_px(t[8], t[10])]
    c = COL.get(t[3], (255, 0, 255))
    if t[3] == 10:
        continue
    dr.polygon(pts, fill=c)
img.save(dst)
print("saved", dst, img.size, "tris", len(tris), "bounds", round(x0), round(x1), round(z0), round(z1))
