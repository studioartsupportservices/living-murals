"""Generate placeholder murals in the studio's layered-SVG piece format.

These stand in for Dina Saadi's real vector files until they are supplied.
Each mural is one master SVG whose top-level <g id="..."> groups are the
animation layers (exactly how an Illustrator file with named layers exports),
plus a piece.json that holds the animation presets and rigs.

Run:  python3 tools/gen_placeholders.py
"""
import json, math, os, random

W, H = 1600, 1000
ROOT = os.path.join(os.path.dirname(__file__), "..", "pieces")


def esc(n):
    return f"{n:.1f}".rstrip("0").rstrip(".")


def poly(pts, fill, extra=""):
    return f'<polygon points="{" ".join(f"{esc(x)},{esc(y)}" for x, y in pts)}" fill="{fill}" {extra}/>'


def circle(cx, cy, r, fill, extra=""):
    return f'<circle cx="{esc(cx)}" cy="{esc(cy)}" r="{esc(r)}" fill="{fill}" {extra}/>'


def ellipse(cx, cy, rx, ry, fill, extra=""):
    return f'<ellipse cx="{esc(cx)}" cy="{esc(cy)}" rx="{esc(rx)}" ry="{esc(ry)}" fill="{fill}" {extra}/>'


def path(d, fill="none", extra=""):
    return f'<path d="{d}" fill="{fill}" {extra}/>'


def group(gid, role, items, extra=""):
    return f'<g id="{gid}" data-role="{role}" {extra}>\n' + "\n".join(items) + "\n</g>"


def tessellation(rng, cols, rows, palette, x0=0, y0=0, w=W, h=H):
    """Triangle grid: lots of corners and contrast, which is what image tracking needs."""
    out = []
    cw, ch = w / cols, h / rows
    for r in range(rows):
        for c in range(cols):
            x, y = x0 + c * cw, y0 + r * ch
            a = (x, y); b = (x + cw, y); d = (x, y + ch); e = (x + cw, y + ch)
            if (r + c) % 2:
                out.append(poly([a, b, e], rng.choice(palette)))
                out.append(poly([a, e, d], rng.choice(palette)))
            else:
                out.append(poly([a, b, d], rng.choice(palette)))
                out.append(poly([b, e, d], rng.choice(palette)))
    return out


def leaf(cx, cy, length, angle, width, fill, vein):
    ca, sa = math.cos(angle), math.sin(angle)
    tip = (cx + ca * length, cy + sa * length)
    nx, ny = -sa * width, ca * width
    m1 = (cx + ca * length * .5 + nx, cy + sa * length * .5 + ny)
    m2 = (cx + ca * length * .5 - nx, cy + sa * length * .5 - ny)
    d = (f"M{esc(cx)},{esc(cy)} Q{esc(m1[0])},{esc(m1[1])} {esc(tip[0])},{esc(tip[1])} "
         f"Q{esc(m2[0])},{esc(m2[1])} {esc(cx)},{esc(cy)}Z")
    return [path(d, fill), path(f"M{esc(cx)},{esc(cy)} L{esc(tip[0])},{esc(tip[1])}", "none",
                                f'stroke="{vein}" stroke-width="3"')]


def eye_layers(prefix, cx, cy, rx, ry, iris_r, iris, lid_fill, lash, pupil_slit=False):
    white = group(f"{prefix}-white", "eye-white", [ellipse(cx, cy, rx, ry, "#fbf6ee")])
    ir = [circle(cx, cy, iris_r, iris), circle(cx, cy, iris_r * .62, "#4a2a12" if not pupil_slit else iris)]
    if pupil_slit:
        ir.append(ellipse(cx, cy, iris_r * .22, iris_r * .9, "#120c08"))
    else:
        ir.append(circle(cx, cy, iris_r * .38, "#120c08"))
    ir.append(circle(cx - iris_r * .35, cy - iris_r * .35, iris_r * .22, "#ffffff"))
    iris_g = group(f"{prefix}-iris", "eye-iris", ir)
    # Lids are hidden in the painted mural (style display:none); the app reveals them to blink.
    lid = group(f"{prefix}-lid", "eye-lid", [
        ellipse(cx, cy, rx + 4, ry + 4, lid_fill),
        path(f"M{esc(cx-rx-2)},{esc(cy+ry*.55)} Q{esc(cx)},{esc(cy+ry*1.35)} {esc(cx+rx+2)},{esc(cy+ry*.55)}",
             "none", f'stroke="{lash}" stroke-width="5" stroke-linecap="round"'),
    ], 'style="display:none"')
    return white, iris_g, lid


def eye_rig(prefix, cx, cy, rx, ry, iris_r):
    return {"white": f"{prefix}-white", "iris": f"{prefix}-iris", "lid": f"{prefix}-lid",
            "center": [cx, cy], "range": [rx - iris_r * .9, ry - iris_r * .55],
            "lidPivot": [cx, cy - ry - 4]}


def write_piece(pid, layers_svg, meta):
    d = os.path.join(ROOT, pid)
    os.makedirs(d, exist_ok=True)
    svg = (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H}" width="{W}" height="{H}">\n'
           + "\n".join(layers_svg) + "\n</svg>\n")
    with open(os.path.join(d, "art.svg"), "w") as f:
        f.write(svg)
    meta = {"id": pid, "size": [W, H], "master": "art.svg", **meta}
    with open(os.path.join(d, "piece.json"), "w") as f:
        json.dump(meta, f, indent=2)


# ---------------------------------------------------------------- Mirador
def mirador():
    rng = random.Random(11)
    teal = ["#0f4c5c", "#12596b", "#0b3d4a", "#176d80", "#0d4655", "#1f7a8c"]
    bg = tessellation(rng, 32, 20, teal)
    # sun disc with rings behind the head
    for i, (r, c) in enumerate([(430, "#fb8b24"), (380, "#f5a142"), (330, "#fb8b24"), (290, "#e36414")]):
        bg.append(circle(800, 470, r, c))
    for k in range(36):
        a = k / 36 * math.tau
        x1, y1 = 800 + math.cos(a) * 300, 470 + math.sin(a) * 300
        x2, y2 = 800 + math.cos(a) * 425, 470 + math.sin(a) * 425
        bg.append(f'<line x1="{esc(x1)}" y1="{esc(y1)}" x2="{esc(x2)}" y2="{esc(y2)}" stroke="#9a031e" stroke-width="7"/>')
    for k in range(60):
        x, y = rng.uniform(40, 1560), rng.uniform(40, 960)
        if math.hypot(x - 800, y - 470) > 450:
            bg.append(circle(x, y, rng.uniform(4, 11), rng.choice(["#f6e7cb", "#fb8b24", "#e36414"])))

    hair_back = [path("M560,430 C540,250 650,160 800,160 C960,160 1070,260 1050,440 "
                      "C1110,560 1180,640 1260,700 C1150,720 1060,660 1010,600 "
                      "C960,760 640,760 590,600 C540,660 470,700 380,690 C470,630 540,560 560,430Z", "#5f0f40")]
    for k in range(46):
        t = k / 45
        sx = 600 + t * 400
        sy = 200 - math.sin(t * math.pi) * 30 + 30
        side = -1 if sx < 800 else 1
        ex = sx + side * rng.uniform(140, 360)
        ey = sy + rng.uniform(380, 520)
        cx1 = sx + side * rng.uniform(60, 180)
        hair_back.append(path(f"M{esc(sx)},{esc(sy)} C{esc(cx1)},{esc(sy+120)} {esc(ex-side*60)},{esc(ey-160)} {esc(ex)},{esc(ey)}",
                              "none", f'stroke="{rng.choice(["#8a1c5c", "#7b1452", "#a4286a", "#4a0a31"])}" stroke-width="{rng.choice([4,6,8])}" stroke-linecap="round"'))

    body = [path("M560,1000 C580,860 680,790 800,790 C920,790 1020,860 1040,1000Z", "#9a031e"),
            path("M740,640 L740,800 C760,830 840,830 860,800 L860,640Z", "#b5653f")]
    for k in range(9):
        body.append(circle(620 + k * 45, 940 - abs(k - 4) * 18, 10, "#fb8b24"))

    face = [ellipse(800, 470, 152, 196, "#c8794f"),
            ellipse(712, 540, 34, 20, "#d9895e"), ellipse(888, 540, 34, 20, "#d9895e"),
            path("M800,450 C790,500 776,530 790,545 C800,552 812,548 816,540", "none",
                 'stroke="#8c4a2b" stroke-width="5" stroke-linecap="round"'),
            path("M752,590 C780,575 820,575 848,590 C820,615 780,615 752,590Z", "#9a031e"),
            path("M752,590 C785,598 815,598 848,590", "none", 'stroke="#5f0f40" stroke-width="3"')]

    eL = eye_layers("eyeL", 738, 452, 40, 21, 16, "#6b3e1f", "#c8794f", "#2b1208")
    eR = eye_layers("eyeR", 862, 452, 40, 21, 16, "#6b3e1f", "#c8794f", "#2b1208")
    lines = [path(f"M{x-44},{452-4} Q{x},{452-34} {x+44},{452-4}", "none",
                  'stroke="#2b1208" stroke-width="6" stroke-linecap="round"') for x in (738, 862)]
    lines += [path(f"M{x-46},{452-52} Q{x},{452-70} {x+46},{452-50}", "none",
                   'stroke="#3d1a0c" stroke-width="9" stroke-linecap="round"') for x in (738, 862)]

    hair_front = [path("M640,330 C680,220 920,210 960,330 C900,280 860,300 820,330 "
                       "C790,290 740,280 700,320 C690,300 660,310 640,330Z", "#5f0f40")]
    for k in range(16):
        sx = 650 + k * 20
        hair_front.append(path(f"M{sx},{250 + abs(k-8)*4} Q{sx+20},{300} {sx+rng.uniform(-10,30)},{330 + rng.uniform(-10,10)}",
                               "none", 'stroke="#a4286a" stroke-width="4" stroke-linecap="round"'))

    fore = []
    for (cx, cy, ang0) in [(80, 1000, -1.2), (1520, 1000, -1.95)]:
        for k in range(7):
            fore += leaf(cx, cy, rng.uniform(260, 380), ang0 + (k - 3) * .22, rng.uniform(40, 62),
                         rng.choice(["#2d6a4f", "#40916c", "#1b4332", "#52b788"]), "#95d5b2")
    petals = [circle(rng.uniform(80, 1520), rng.uniform(60, 900), rng.uniform(7, 14),
                     rng.choice(["#f6e7cb", "#fb8b24", "#ffd6a5"])) for _ in range(26)]

    layers = [group("bg", "background", bg),
              group("hair-back", "subject", hair_back),
              group("body", "subject", body),
              group("face", "subject", face),
              *eL, *eR,
              group("eye-lines", "subject", lines),
              group("hair-front", "subject", hair_front),
              group("leaves", "foreground", fore),
              group("petals", "foreground", petals)]

    meta = {
        "title": "Mirador",
        "artist": "Dina Saadi Studio",
        "placeholder": True,
        "year": 2026,
        "location": {"label": "Test wall", "lat": None, "lng": None},
        "palette": ["#0f4c5c", "#fb8b24", "#e36414", "#5f0f40", "#9a031e"],
        "layers": [
            {"id": "bg", "depth": 0},
            {"id": "hair-back", "depth": 0.025, "anim": [
                {"type": "sway", "root": [800, 200], "dir": [0, 1], "length": 560, "amp": 16, "speed": 0.9},
                {"type": "flow", "amp": 5, "speed": 1.3, "scale": 26, "root": [800, 200], "length": 560}]},
            {"id": "body", "depth": 0.03, "anim": [{"type": "breathe", "amp": 0.008, "speed": 0.5, "pivot": [800, 1000]}]},
            {"id": "face", "depth": 0.04},
            {"id": "eyeL-white", "depth": 0.041}, {"id": "eyeL-iris", "depth": 0.042}, {"id": "eyeL-lid", "depth": 0.043},
            {"id": "eyeR-white", "depth": 0.041}, {"id": "eyeR-iris", "depth": 0.042}, {"id": "eyeR-lid", "depth": 0.043},
            {"id": "eye-lines", "depth": 0.044},
            {"id": "hair-front", "depth": 0.05, "anim": [
                {"type": "flow", "amp": 3, "speed": 1.6, "scale": 30, "root": [800, 240], "length": 120}]},
            {"id": "leaves", "depth": 0.09, "anim": [
                {"type": "sway", "root": [800, 1000], "dir": [0, -1], "length": 420, "amp": 14, "speed": 0.7, "radial": True}]},
            {"id": "petals", "depth": 0.12, "anim": [{"type": "drift", "amp": 14, "speed": 0.35}]},
        ],
        "rigs": {
            "eyes": [eye_rig("eyeL", 738, 452, 40, 21, 16), eye_rig("eyeR", 862, 452, 40, 21, 16)],
            "blink": {"every": [2.4, 6.0], "duration": 0.17, "double": 0.2},
            "head": {"pivot": [800, 720], "maxTurn": 0.06, "shift": 16,
                     "layers": {"hair-back": 0.35, "face": 0.6, "eyeL-white": 1, "eyeL-iris": 1, "eyeL-lid": 1,
                                "eyeR-white": 1, "eyeR-iris": 1, "eyeR-lid": 1, "eye-lines": 1, "hair-front": 0.85}}
        },
        "subject": {"box": [370, 150, 900, 850],
                    "layers": ["hair-back", "body", "face", "eyeL-white", "eyeL-iris", "eyeL-lid",
                               "eyeR-white", "eyeR-iris", "eyeR-lid", "eye-lines", "hair-front"]},
        "notes": "Portrait. The figure turns her eyes and head toward whoever stands in front of her."
    }
    write_piece("mirador", layers, meta)


# ---------------------------------------------------------------- Zorro
def zorro():
    rng = random.Random(23)
    bg = [f'<rect width="{W}" height="{H}" fill="#1b1f3b"/>']
    for k, c in enumerate(["#232a52", "#2c3567", "#36407a", "#414c8e"]):
        y = 620 + k * 90
        pts = [(0, H)]
        for i in range(0, 17):
            pts.append((i * 100, y - (60 if i % 2 else 0) - rng.uniform(0, 70)))
        pts.append((W, H))
        bg.append(poly(pts, c))
    for _ in range(260):
        x, y = rng.uniform(0, W), rng.uniform(0, 600)
        bg.append(circle(x, y, rng.choice([1.6, 2.4, 3.2, 4.5]), rng.choice(["#fdf0d5", "#ffd166", "#c9d6ff"])))
    for k in range(5):
        cx = 220 + k * 300
        bg.append(poly([(cx - 160, 720), (cx, 430 + rng.uniform(-40, 40)), (cx + 160, 720)],
                       rng.choice(["#2b2f5c", "#323870", "#272b55"])))
        bg.append(poly([(cx - 40, 560), (cx, 450), (cx + 40, 560)], "#e8e1ff", 'opacity=".8"'))
    bg.append(circle(1290, 210, 120, "#fdf0d5"))
    for (dx, dy, r) in [(-40, -30, 22), (30, 20, 30), (-10, 60, 14), (50, -50, 12), (-60, 40, 10)]:
        bg.append(circle(1290 + dx, 210 + dy, r, "#e9dcc0"))

    fx, fy = 790, 600
    tail = [path(f"M{fx+120},{fy+260} C{fx+330},{fy+300} {fx+430},{fy+150} {fx+380},{fy+30} "
                 f"C{fx+360},{fy+130} {fx+280},{fy+200} {fx+140},{fy+200}Z", "#e76f51"),
            path(f"M{fx+380},{fy+30} C{fx+410},{fy+70} {fx+405},{fy+110} {fx+378},{fy+130} C{fx+360},{fy+100} {fx+358},{fy+60} {fx+380},{fy+30}Z", "#fdf0d5")]
    body = [path(f"M{fx-150},{fy+300} C{fx-170},{fy+120} {fx-100},{fy-20} {fx},{fy-40} "
                 f"C{fx+100},{fy-20} {fx+170},{fy+120} {fx+150},{fy+300}Z", "#f4845f"),
            path(f"M{fx-70},{fy+300} C{fx-80},{fy+150} {fx-40},{fy+40} {fx},{fy+30} C{fx+40},{fy+40} {fx+80},{fy+150} {fx+70},{fy+300}Z", "#fdf0d5"),
            ellipse(fx - 70, fy + 300, 50, 22, "#3d2c2e"), ellipse(fx + 70, fy + 300, 50, 22, "#3d2c2e")]
    hx, hy = fx, fy - 150
    head = [poly([(hx - 140, hy - 20), (hx - 120, hy - 170), (hx - 40, hy - 60)], "#e76f51"),
            poly([(hx + 140, hy - 20), (hx + 120, hy - 170), (hx + 40, hy - 60)], "#e76f51"),
            poly([(hx - 118, hy - 40), (hx - 112, hy - 135), (hx - 60, hy - 60)], "#3d2c2e"),
            poly([(hx + 118, hy - 40), (hx + 112, hy - 135), (hx + 60, hy - 60)], "#3d2c2e"),
            path(f"M{hx-160},{hy+10} C{hx-150},{hy-90} {hx+150},{hy-90} {hx+160},{hy+10} "
                 f"C{hx+120},{hy+80} {hx+40},{hy+150} {hx},{hy+170} C{hx-40},{hy+150} {hx-120},{hy+80} {hx-160},{hy+10}Z", "#f4845f"),
            path(f"M{hx-150},{hy+20} C{hx-90},{hy+40} {hx-40},{hy+90} {hx},{hy+170} C{hx-50},{hy+150} {hx-120},{hy+90} {hx-150},{hy+20}Z", "#fdf0d5"),
            path(f"M{hx+150},{hy+20} C{hx+90},{hy+40} {hx+40},{hy+90} {hx},{hy+170} C{hx+50},{hy+150} {hx+120},{hy+90} {hx+150},{hy+20}Z", "#fdf0d5"),
            ellipse(hx, hy + 160, 20, 14, "#1a1214")]
    fur = []
    for k in range(30):
        side = -1 if k % 2 else 1
        bx = hx + side * rng.uniform(110, 160)
        by = hy + rng.uniform(-10, 70)
        fur.append(path(f"M{esc(bx)},{esc(by)} q{esc(side*30)},{esc(rng.uniform(5,25))} {esc(side*rng.uniform(40,60))},{esc(rng.uniform(20,40))}",
                        "none", 'stroke="#fdf0d5" stroke-width="5" stroke-linecap="round"'))
    for k in range(24):
        bx = fx + rng.uniform(-60, 60)
        by = fy + rng.uniform(40, 200)
        fur.append(path(f"M{esc(bx)},{esc(by)} q{esc(rng.uniform(-12,12))},18 {esc(rng.uniform(-6,6))},34",
                        "none", 'stroke="#efe3c8" stroke-width="4" stroke-linecap="round"'))
    eL = eye_layers("eyeL", hx - 62, hy + 30, 30, 18, 16, "#f4a261", "#f4845f", "#1a1214", pupil_slit=True)
    eR = eye_layers("eyeR", hx + 62, hy + 30, 30, 18, 16, "#f4a261", "#f4845f", "#1a1214", pupil_slit=True)
    lines = [path(f"M{x-36},{hy+30+6} Q{x},{hy+30-30} {x+38},{hy+30-2}", "none",
                  'stroke="#1a1214" stroke-width="6" stroke-linecap="round"') for x in (hx - 62, hx + 62)]
    grass = []
    for k in range(70):
        x = rng.uniform(0, W)
        hgt = rng.uniform(80, 220)
        lean = rng.uniform(-40, 40)
        grass.append(path(f"M{esc(x-7)},{H} Q{esc(x+lean*.4)},{esc(H-hgt*.6)} {esc(x+lean)},{esc(H-hgt)} Q{esc(x+lean*.3)},{esc(H-hgt*.5)} {esc(x+7)},{H}Z",
                          rng.choice(["#2a9d8f", "#264653", "#1f7a6e", "#3bb3a3"])))
    flies = []
    for _ in range(30):
        x, y = rng.uniform(60, 1540), rng.uniform(300, 900)
        flies += [circle(x, y, 13, "#ffd166", 'opacity=".25"'), circle(x, y, 5, "#fff3b0")]

    layers = [group("bg", "background", bg), group("tail", "subject", tail), group("body", "subject", body),
              group("head", "subject", head), group("fur", "subject", fur), *eL, *eR,
              group("eye-lines", "subject", lines), group("grass", "foreground", grass),
              group("fireflies", "foreground", flies)]
    meta = {
        "title": "Zorro de medianoche",
        "artist": "Dina Saadi Studio",
        "placeholder": True,
        "year": 2026,
        "location": {"label": "Test wall", "lat": None, "lng": None},
        "palette": ["#1b1f3b", "#f4845f", "#e76f51", "#2a9d8f", "#ffd166"],
        "layers": [
            {"id": "bg", "depth": 0},
            {"id": "tail", "depth": 0.03, "anim": [
                {"type": "sway", "root": [fx + 140, fy + 230], "dir": [1, -0.6], "length": 330, "amp": 26, "speed": 0.8},
                {"type": "flow", "amp": 3, "speed": 1.2, "scale": 22, "root": [fx + 140, fy + 230], "length": 330}]},
            {"id": "body", "depth": 0.035, "anim": [{"type": "breathe", "amp": 0.012, "speed": 0.6, "pivot": [fx, fy + 300]}]},
            {"id": "head", "depth": 0.045},
            {"id": "fur", "depth": 0.047, "anim": [{"type": "flow", "amp": 4, "speed": 1.7, "scale": 34, "root": [hx, hy], "length": 220}]},
            {"id": "eyeL-white", "depth": 0.048}, {"id": "eyeL-iris", "depth": 0.049}, {"id": "eyeL-lid", "depth": 0.05},
            {"id": "eyeR-white", "depth": 0.048}, {"id": "eyeR-iris", "depth": 0.049}, {"id": "eyeR-lid", "depth": 0.05},
            {"id": "eye-lines", "depth": 0.051},
            {"id": "grass", "depth": 0.09, "anim": [{"type": "sway", "root": [800, 1000], "dir": [0, -1], "length": 220, "amp": 18, "speed": 1.1, "wave": 0.02}]},
            {"id": "fireflies", "depth": 0.13, "anim": [{"type": "drift", "amp": 22, "speed": 0.45}, {"type": "pulse", "amp": 0.5, "speed": 1.4}]},
        ],
        "rigs": {
            "eyes": [eye_rig("eyeL", hx - 62, hy + 30, 30, 18, 16), eye_rig("eyeR", hx + 62, hy + 30, 30, 18, 16)],
            "blink": {"every": [3.0, 7.0], "duration": 0.15, "double": 0.3},
            "head": {"pivot": [fx, fy + 40], "maxTurn": 0.09, "shift": 18,
                     "layers": {"head": 0.7, "fur": 0.7, "eyeL-white": 1, "eyeL-iris": 1, "eyeL-lid": 1,
                                "eyeR-white": 1, "eyeR-iris": 1, "eyeR-lid": 1, "eye-lines": 1}}
        },
        "subject": {"box": [600, 260, 640, 680],
                    "layers": ["tail", "body", "head", "fur", "eyeL-white", "eyeL-iris", "eyeL-lid",
                               "eyeR-white", "eyeR-iris", "eyeR-lid", "eye-lines"]},
        "notes": "Night fox. Fur ruffles, tail sways, eyes follow passers-by."
    }
    write_piece("zorro", layers, meta)


# ---------------------------------------------------------------- Garza
def garza():
    rng = random.Random(41)
    bg = [f'<rect width="{W}" height="{H}" fill="#ffb4a2"/>']
    for k, c in enumerate(["#ffcdb2", "#ffb4a2", "#e5989b", "#ffcdb2", "#f6bd60", "#ffb4a2"]):
        bg.append(circle(1150, 330, 520 - k * 80, c))
    for r in range(14):
        y = 640 + r * 26
        bg.append(f'<rect x="0" y="{y}" width="{W}" height="14" fill="{rng.choice(["#6d6875", "#7f7a8a", "#5a5566"])}"/>')
        bg.append(f'<rect x="0" y="{y+14}" width="{W}" height="12" fill="{rng.choice(["#b5838d", "#a5737d", "#c4939d"])}"/>')
    for _ in range(18):
        x, y = rng.uniform(40, 1560), rng.uniform(660, 960)
        r = rng.uniform(30, 70)
        bg.append(ellipse(x, y, r, r * .38, rng.choice(["#2d6a4f", "#40916c", "#1b4332"])))
        bg.append(poly([(x, y), (x + r, y - r * .2), (x + r, y + r * .2)], "#6d6875"))
    tri = []
    for _ in range(40):
        x, y, s = rng.uniform(30, 1570), rng.uniform(30, 600), rng.uniform(14, 40)
        a = rng.uniform(0, math.tau)
        tri.append(poly([(x + math.cos(a + i * 2.094) * s, y + math.sin(a + i * 2.094) * s) for i in range(3)],
                        rng.choice(["#6d6875", "#e5989b", "#f6bd60", "#ffffff"])))
    bx, by = 640, 560
    legs = [path(f"M{bx-20},{by+80} L{bx-40},{by+330} M{bx+20},{by+80} L{bx+30},{by+250} L{bx+70},{by+330}",
                 "none", 'stroke="#3d3a45" stroke-width="10" stroke-linecap="round" stroke-linejoin="round"')]
    body = [path(f"M{bx-180},{by-10} C{bx-120},{by-120} {bx+120},{by-110} {bx+170},{by-20} "
                 f"C{bx+120},{by+90} {bx-60},{by+120} {bx-260},{by+60} C{bx-220},{by+40} {bx-200},{by+20} {bx-180},{by-10}Z", "#eef0f2"),
            path(f"M{bx-160},{by} C{bx-80},{by-60} {bx+60},{by-60} {bx+120},{by-10} C{bx+40},{by+30} {bx-60},{by+40} {bx-160},{by}Z", "#8d99ae"),
            path(f"M{bx+130},{by-40} C{bx+170},{by-160} {bx+110},{by-260} {bx+170},{by-360} L{bx+205},{by-345} "
                 f"C{bx+160},{by-250} {bx+215},{by-150} {bx+170},{by-20}Z", "#eef0f2")]
    hx, hy = bx + 200, by - 370
    head = [ellipse(hx, hy, 52, 40, "#eef0f2"),
            poly([(hx + 40, hy - 8), (hx + 210, hy + 12), (hx + 40, hy + 16)], "#f6bd60"),
            path(f"M{hx-20},{hy-34} C{hx-80},{hy-60} {hx-140},{hy-40} {hx-190},{hy-10}", "none",
                 'stroke="#3d3a45" stroke-width="8" stroke-linecap="round"')]
    plumes = []
    for k in range(26):
        sx = bx + rng.uniform(100, 170)
        sy = by - rng.uniform(40, 220)
        plumes.append(path(f"M{esc(sx)},{esc(sy)} q-20,{esc(rng.uniform(30,60))} {esc(-rng.uniform(10,40))},{esc(rng.uniform(70,120))}",
                           "none", 'stroke="#ffffff" stroke-width="4" stroke-linecap="round"'))
    for k in range(18):
        sx = bx - 180 - k * 6
        plumes.append(path(f"M{esc(sx)},{esc(by+20+k*2)} q-40,10 {esc(-rng.uniform(60,110))},{esc(rng.uniform(20,50))}",
                           "none", 'stroke="#dfe3e8" stroke-width="5" stroke-linecap="round"'))
    ex, ey = hx + 6, hy - 6
    eW, eI, eLd = eye_layers("eye", ex, ey, 15, 12, 9, "#f6bd60", "#eef0f2", "#3d3a45")
    lines = [path(f"M{ex-18},{ey+2} Q{ex},{ey-20} {ex+18},{ey+2}", "none",
                  'stroke="#3d3a45" stroke-width="4" stroke-linecap="round"')]
    reeds = []
    for k in range(40):
        x = rng.choice([rng.uniform(0, 380), rng.uniform(1100, 1600)])
        hgt = rng.uniform(200, 470)
        lean = rng.uniform(-30, 30)
        reeds.append(path(f"M{esc(x)},{H} Q{esc(x+lean*.3)},{esc(H-hgt*.5)} {esc(x+lean)},{esc(H-hgt)}",
                          "none", f'stroke="{rng.choice(["#264653", "#2a9d8f", "#386641"])}" stroke-width="{rng.choice([5,7,9])}" stroke-linecap="round"'))
        if k % 3 == 0:
            reeds.append(ellipse(x + lean, H - hgt + 30, 9, 34, "#6f4518"))
    layers = [group("bg", "background", bg), group("floaters", "foreground", tri), group("legs", "subject", legs),
              group("body", "subject", body), group("head", "subject", head), group("plumes", "subject", plumes),
              eW, eI, eLd, group("eye-lines", "subject", lines), group("reeds", "foreground", reeds)]
    meta = {
        "title": "Garza",
        "artist": "Dina Saadi Studio",
        "placeholder": True,
        "year": 2026,
        "location": {"label": "Test wall", "lat": None, "lng": None},
        "palette": ["#ffb4a2", "#e5989b", "#6d6875", "#f6bd60", "#eef0f2"],
        "layers": [
            {"id": "bg", "depth": 0},
            {"id": "floaters", "depth": 0.1, "anim": [{"type": "drift", "amp": 18, "speed": 0.3}, {"type": "spin", "amp": 0.0, "speed": 0.0}]},
            {"id": "legs", "depth": 0.03},
            {"id": "body", "depth": 0.035, "anim": [{"type": "breathe", "amp": 0.01, "speed": 0.45, "pivot": [bx, by + 80]}]},
            {"id": "head", "depth": 0.04},
            {"id": "plumes", "depth": 0.042, "anim": [{"type": "flow", "amp": 5, "speed": 1.4, "scale": 24, "root": [bx + 140, by - 220], "length": 300}]},
            {"id": "eye-white", "depth": 0.043}, {"id": "eye-iris", "depth": 0.044}, {"id": "eye-lid", "depth": 0.045},
            {"id": "eye-lines", "depth": 0.046},
            {"id": "reeds", "depth": 0.09, "anim": [{"type": "sway", "root": [800, 1000], "dir": [0, -1], "length": 470, "amp": 20, "speed": 0.8, "wave": 0.015}]},
        ],
        "rigs": {
            "eyes": [eye_rig("eye", ex, ey, 15, 12, 9)],
            "blink": {"every": [2.0, 5.0], "duration": 0.13, "double": 0.15},
            "head": {"pivot": [bx + 150, by - 40], "maxTurn": 0.08, "shift": 22,
                     "layers": {"head": 1, "eye-white": 1, "eye-iris": 1, "eye-lid": 1, "eye-lines": 1}}
        },
        "subject": {"box": [380, 140, 680, 760],
                    "layers": ["legs", "body", "head", "plumes", "eye-white", "eye-iris", "eye-lid", "eye-lines"]},
        "notes": "Heron in a geometric pond. Head tracks movement, reeds and plumes stir."
    }
    write_piece("garza", layers, meta)


if __name__ == "__main__":
    mirador(); zorro(); garza()
    ids = ["mirador", "zorro", "garza"]
    with open(os.path.join(ROOT, "manifest.json"), "w") as f:
        json.dump({"studio": "Dina Saadi Studio", "version": 1, "pieces": ids}, f, indent=2)
    print("wrote", ids)
