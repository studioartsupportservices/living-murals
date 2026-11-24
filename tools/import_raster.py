"""Import flat artwork images (photos, digital paintings) as animatable pieces.

Dina's work pairs greyscale figures with saturated pattern masses, so a flat
image splits well into:
  base.jpg   the whole image, static, painted on the wall (also the tracking target)
  color.png  the saturated pattern areas (+ the thin dark stripes inside them),
             feathered, which flow / sway over the base
Eyes are animated in-shader on the base layer (gaze shift + procedural blink),
so no hand-cut eye layers are needed.

When the studio has the layered source files, a separately exported hair/pattern
layer can be given as `color_src` (see "afro") for an exact split.

  python3 tools/import_raster.py "<folder with the source images>"
"""
import json, os, sys
import numpy as np
from PIL import Image, ImageFilter
from scipy import ndimage

ROOT = os.path.join(os.path.dirname(__file__), "..", "pieces")
MAX = 2048

# Coordinates are in ORIGINAL image pixels; the tool rescales them.
PIECES = {
    "afro": {
        "src": "Screen Shot 2021-09-26 at 4.14.44 PM.png", "color_src": "Round.png",
        "title": "Afro portrait", "flow": {"amp": 5, "speed": 0.9, "scale": 18},
        "eyes": [{"c": [481, 808], "r": [27, 14], "iris": 0.55}, {"c": [615, 823], "r": [30, 15], "iris": 0.55}],
        "notes": "Pattern hair flows; she follows you with her eyes.",
    },
    "embrace": {
        "src": "Screen Shot 2021-09-26 at 4.16.48 PM.png",
        "title": "Crossed arms", "flow": {"amp": 6, "speed": 0.8, "scale": 16},
        "figure_box": [700, 150, 1650, 1412],
        "eyes": [{"c": [986, 545], "r": [42, 20], "iris": 0.5}, {"c": [1218, 555], "r": [42, 20], "iris": 0.5}],
        "notes": "Botanical pattern breathes around the figure; her gaze follows passers-by.",
    },
    "profile": {
        "src": "Screen Shot 2021-08-26 at 5.51.19 PM.png",
        "title": "Profile", "flow": {"amp": 6, "speed": 1.0, "scale": 16},
        "sway": {"root": [1300, 300], "dir": [-1, 0.1], "length": 1300, "amp": 14, "speed": 0.5},
        "figure_box": [1180, 60, 1568, 778], "purple_bg": True,
        "notes": "Hair streams out behind her like a banner in the wind.",
    },
    "turtle": {
        "white_bg": True,
        "src": "Turtle final.jpg",
        "title": "Turtle", "flow": {"amp": 8, "speed": 0.8, "scale": 14},
        "sway": {"root": [1300, 1100], "dir": [1, 0.2], "length": 3000, "amp": 40, "speed": 0.6},
        "figure_box": [0, 400, 1800, 2200],
        "notes": "Ribbons trail and ripple behind the swimming turtle.",
    },
    "jellyfish": {
        "white_bg": True,
        "src": "Jellyfish full.jpg",
        "title": "Jellyfish", "flow": {"amp": 6, "speed": 1.1, "scale": 18},
        "sway": {"root": [180, 250], "dir": [1, 0.05], "length": 2800, "amp": 30, "speed": 0.7},
        "notes": "Tentacles undulate from the bell.",
    },
    "fish": {
        "white_bg": True,
        "src": "Fish.png",
        "title": "Fish", "flow": {"amp": 7, "speed": 0.9, "scale": 16},
        "sway": {"root": [5300, 800], "dir": [-1, 0], "length": 5000, "amp": 45, "speed": 0.55},
        "figure_box": [4900, 450, 5494, 1100],
        "notes": "The patterned body swims in a slow S-curve behind the head.",
    },
    "rotterdam": {
        "src": "POW! WOW! Rotterdam festival - mural by Dina Saadi- ---.jpg",
        "crop": [0, 420, 960, 600],
        "title": "POW! WOW! Rotterdam", "flow": {"amp": 4, "speed": 0.8, "scale": 20},
        "notes": "Photo of the painted wall, VDV Freight Station. Point at the actual mural (or this photo).",
    },
    "patterns": {
        "src": "Screen Shot 2021-09-26 at 4.25.41 PM.png",
        "title": "Pattern panel", "flow": {"amp": 7, "speed": 0.8, "scale": 14},
        "notes": "Shapes ripple and drift.",
    },
}


def load(path, crop=None):
    im = Image.open(path)
    if im.mode in ("RGBA", "LA", "P"):
        im = im.convert("RGBA")
        bg = Image.new("RGBA", im.size, (255, 255, 255, 255))
        bg.alpha_composite(im)
        im = bg
    im = im.convert("RGB")
    if crop:
        im = im.crop(crop)
    return im


def color_mask(rgb, cfg, k):
    a = np.asarray(rgb).astype(np.float32) / 255
    mx, mn = a.max(2), a.min(2)
    sat = np.where(mx > 0, (mx - mn) / np.maximum(mx, 1e-6), 0)
    m = (sat > 0.28) & (mx > 0.12)
    if cfg.get("white_bg"):
        m = mn < 0.9  # everything that isn't the white ground
    # pull in the thin dark/white stripes that sit inside pattern areas
    m = ndimage.binary_closing(m, iterations=max(2, int(6 * k)))
    if cfg.get("figure_box"):
        x0, y0, x1, y1 = [int(v * k) for v in cfg["figure_box"]]
        grey = (sat < 0.2)
        box = np.zeros_like(m); box[y0:y1, x0:x1] = True
        m &= ~(grey & box)
    if cfg.get("purple_bg"):
        # keep the flat background colour still: exclude the most common colour
        q = (np.asarray(rgb) // 8).reshape(-1, 3)
        vals, counts = np.unique(q, axis=0, return_counts=True)
        bgc = vals[counts.argmax()].astype(np.int16)
        m &= np.abs((np.asarray(rgb) // 8).astype(np.int16) - bgc).sum(2) > 3
    m = ndimage.binary_opening(m, iterations=2)
    return m


def push_pull_fill(rgb, hole):
    """Fill `hole` pixels with a smooth blend of their surroundings (cheap inpaint)."""
    img = np.asarray(rgb).astype(np.float32)
    w = (~hole).astype(np.float32)
    levels = []
    ci, cw = img * w[..., None], w
    while min(cw.shape) > 4:
        levels.append((ci, cw))
        h2, w2 = cw.shape[0] // 2 * 2, cw.shape[1] // 2 * 2
        ci = ci[:h2, :w2].reshape(h2 // 2, 2, w2 // 2, 2, 3).sum((1, 3))
        cw = cw[:h2, :w2].reshape(h2 // 2, 2, w2 // 2, 2).sum((1, 3))
    filled = ci / np.maximum(cw, 1e-6)[..., None]
    for ci, cw in reversed(levels):
        up = np.asarray(Image.fromarray(np.clip(filled, 0, 255).astype(np.uint8)).resize((cw.shape[1], cw.shape[0]), Image.BILINEAR)).astype(np.float32)
        own = ci / np.maximum(cw, 1e-6)[..., None]
        a = np.clip(cw, 0, 1)[..., None]
        filled = own * a + up * (1 - a)
    filled = np.asarray(Image.fromarray(np.clip(filled, 0, 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(8))).astype(np.float32)
    out = img.copy()
    out[hole] = filled[hole]
    return Image.fromarray(np.clip(out, 0, 255).astype(np.uint8))


def run(src_dir):
    ids = []
    for pid, cfg in PIECES.items():
        path = os.path.join(src_dir, cfg["src"])
        if not os.path.exists(path):
            print("skip", pid, "(missing", cfg["src"], ")"); continue
        crop = cfg.get("crop")
        im = load(path, crop)
        ox, oy = (crop[0], crop[1]) if crop else (0, 0)
        k = min(1.0, MAX / max(im.size))
        W, H = round(im.width * k), round(im.height * k)
        im = im.resize((W, H), Image.LANCZOS)
        d = os.path.join(ROOT, pid); os.makedirs(d, exist_ok=True)
        im.save(os.path.join(d, "base.jpg"), quality=90)

        if cfg.get("color_src"):
            c = Image.open(os.path.join(src_dir, cfg["color_src"])).convert("RGBA").resize((W, H), Image.LANCZOS)
            alpha = np.asarray(c)[..., 3] > 20
        else:
            alpha = color_mask(im, cfg, k)
        # avoid the base's own edge: never flow the outer 2px; feather
        a_img = Image.fromarray((alpha * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(1.6))
        rgba = im.convert("RGBA"); rgba.putalpha(a_img)
        bb = a_img.getbbox() or (0, 0, W, H)
        pad = 24
        bb = (max(0, bb[0] - pad), max(0, bb[1] - pad), min(W, bb[2] + pad), min(H, bb[3] + pad))
        rgba.crop(bb).save(os.path.join(d, "color.png"), optimize=True)
        # white-ground pieces become cut-outs: white connected to the border is transparent
        a = np.asarray(im).astype(np.int16)
        white = a.min(2) > 232
        lab, _ = ndimage.label(white)
        edge_ids = np.unique(np.concatenate([lab[0], lab[-1], lab[:, 0], lab[:, -1]]))
        ground = np.isin(lab, edge_ids[edge_ids > 0])
        cutout = ground.mean() > 0.12
        # what shows under the moving layer
        hole = ndimage.binary_dilation(alpha, iterations=3)
        if cutout:
            keep = ~(ground | hole)
            u = im.convert("RGBA")
            u.putalpha(Image.fromarray((keep * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(1.2)))
            u.save(os.path.join(d, "under.png"), optimize=True)
            if os.path.exists(os.path.join(d, "under.jpg")): os.remove(os.path.join(d, "under.jpg"))
            ys, xs = np.nonzero(~ground)
            content = [int(xs.min()), int(ys.min()), int(xs.max() - xs.min()), int(ys.max() - ys.min())]
        else:
            push_pull_fill(im, hole).save(os.path.join(d, "under.jpg"), quality=85)
            content = None

        S = lambda p: [round((p[0] - ox) * k, 1), round((p[1] - oy) * k, 1)]
        anims = [{"type": "flow", "amp": cfg["flow"]["amp"], "speed": cfg["flow"]["speed"], "scale": cfg["flow"]["scale"],
                  "root": [W / 2, H / 2], "length": 1}]
        if cfg.get("sway"):
            s = cfg["sway"]
            anims.append({"type": "sway", "root": S(s["root"]), "dir": s["dir"], "length": s["length"] * k,
                          "amp": s["amp"] * k * 2, "speed": s["speed"]})
        eyes = []
        arr = np.asarray(im)
        for e in cfg.get("eyes", []):
            cx, cy = S(e["c"]); rx, ry = e["r"][0] * k, e["r"][1] * k
            # lid colour: median of the skin just above the eye
            y0 = int(max(0, cy - ry * 2.4)); y1 = int(max(1, cy - ry * 1.4))
            patch = arr[y0:y1, int(cx - rx * 0.6):int(cx + rx * 0.6)].reshape(-1, 3)
            lid = np.median(patch, 0) if len(patch) else np.array([150, 150, 150])
            eyes.append({"center": [cx, cy], "radius": [round(rx, 1), round(ry, 1)], "iris": e["iris"],
                         "lid": "#%02x%02x%02x" % tuple(int(v) for v in lid)})
        meta = {
            "id": pid, "title": cfg["title"], "artist": "Dina Saadi", "year": None,
            "workingTitle": True, "size": [W, H], "raster": "base.jpg",
            "location": {"label": "Rotterdam, NL" if pid == "rotterdam" else "Studio archive", "lat": None, "lng": None},
            "palette": ["#e63946", "#ffb703", "#6a4c93", "#1982c4", "#2ec4b6"],
            "layers": [
                {"id": "base", "src": "under.png" if cutout else "under.jpg", "depth": 0, "role": "subject" if cutout else "background"},
                {"id": "color", "src": "color.png", "rect": [bb[0], bb[1], bb[2] - bb[0], bb[3] - bb[1]],
                 "depth": 0.02, "role": "subject" if cutout else "foreground", "anim": anims},
            ],
            "rigs": {"rasterEyes": {"layer": "base", "eyes": eyes, "blink": {"every": [2.6, 6.5], "duration": 0.16, "double": 0.2}}} if eyes else {},
            "notes": cfg["notes"],
        }
        if cutout:
            meta["subject"] = {"box": content, "layers": ["base", "color"]}
        with open(os.path.join(d, "piece.json"), "w") as f:
            json.dump(meta, f, indent=2)
        ids.append(pid)
        print("imported", pid, (W, H), "color px %.0f%%" % (alpha.mean() * 100))
    return ids


if __name__ == "__main__":
    ids = run(sys.argv[1])
    mpath = os.path.join(ROOT, "manifest.json")
    m = json.load(open(mpath))
    m["pieces"] = ids
    m["version"] = m.get("version", 1) + 1
    json.dump(m, open(mpath, "w"), indent=2)
    print("manifest:", ids)
