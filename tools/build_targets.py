"""Precompile image-tracking targets + QR codes for every piece in pieces/manifest.json.

  python3 tools/build_targets.py https://YOUR-SITE/            # QR codes point here
  python3 tools/build_targets.py https://YOUR-SITE/ --modules ../node_modules

Writes pieces/targets.mind, pieces/targets.json and qr/<piece>.svg.
Needs: pip install playwright && playwright install chromium
--modules: serve the CDN libraries from a local node_modules folder (offline builds).
"""
import base64, datetime, http.server, json, os, sys, threading
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
CDN_MAP = {
    "three@0.160.0": "three", "mind-ar@1.2.5": "mind-ar",
    "qrcode-generator@1.4.4": "qrcode-generator", "@mediapipe/tasks-vision@0.10.14": "@mediapipe/tasks-vision",
}


class Quiet(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **k): super().__init__(*a, directory=str(ROOT), **k)
    def log_message(self, *a): pass


def serve():
    srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Quiet)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv


def route_cdn(page, modules):
    def handler(route):
        url = route.request.url
        for k, v in CDN_MAP.items():
            marker = f"/npm/{k}/"
            if marker in url:
                f = Path(modules) / v / url.split(marker, 1)[1].split("?")[0]
                if f.exists():
                    ct = "text/javascript" if f.suffix in (".js", ".mjs") else ("application/wasm" if f.suffix == ".wasm" else "application/octet-stream")
                    return route.fulfill(path=str(f), headers={"content-type": ct, "access-control-allow-origin": "*"})
        return route.abort()
    page.route("https://cdn.jsdelivr.net/**", handler)


def qr_svgs(base, ids, page):
    page.add_script_tag(url="https://cdn.jsdelivr.net/npm/qrcode-generator@1.4.4/qrcode.js")
    out = ROOT / "qr"; out.mkdir(exist_ok=True)
    for name, url in [("studio", base + "?src=card")] + [(i, f"{base}?p={i}&src=qr") for i in ids]:
        svg = page.evaluate("u => { const q = qrcode(0, 'M'); q.addData(u); q.make(); return q.createSvgTag({cellSize: 10, margin: 2, scalable: true}); }", url)
        (out / f"{name}.svg").write_text(svg)
        print("qr", name, "->", url)


def main():
    args = sys.argv[1:]
    base = next((a for a in args if a.startswith("http")), None)
    modules = args[args.index("--modules") + 1] if "--modules" in args else None
    srv = serve()
    with sync_playwright() as p:
        b = p.chromium.launch(executable_path=os.environ.get("CHROME") or None, args=["--use-gl=swiftshader", "--enable-unsafe-swiftshader"])
        page = b.new_page()
        page.on("console", lambda m: print("  [page]", m.text) if "progress" not in m.text or m.text.endswith("0") else None)
        if modules:
            route_cdn(page, modules)
        page.goto(f"http://127.0.0.1:{srv.server_address[1]}/tools/compile.html")
        page.wait_for_function("window.ready === true")
        res = page.evaluate("run()")
        (ROOT / "pieces" / "targets.mind").write_bytes(base64.b64decode(res["b64"]))
        info = {"key": res["key"], "ids": res["ids"], "built": datetime.date.today().isoformat()}
        (ROOT / "pieces" / "targets.json").write_text(json.dumps(info, indent=2))
        print("targets.mind", len(base64.b64decode(res["b64"])), "bytes for", res["ids"])
        if base:
            qr_svgs(base.rstrip("/") + "/", res["ids"], page)
        b.close()
    srv.shutdown()


if __name__ == "__main__":
    main()
