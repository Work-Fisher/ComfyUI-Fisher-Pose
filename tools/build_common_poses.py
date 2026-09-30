"""Render the 常用姿势 thumbnails (web/editor/common-poses/<id>.webp) in the real editor.

    python tools/build_common_poses.py [--base http://127.0.0.1:8188] [--review review.jpg]

Needs a running ComfyUI (for the editor page) and Chrome. --review also writes a contact sheet
with a front and a side view of every pose, for checking depth by eye.
"""
import argparse, asyncio, base64, io, json, os, subprocess, tempfile
from pathlib import Path

import aiohttp
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "web" / "editor" / "common-poses"
CHROME = os.environ.get("CHROME", r"C:/Program Files/Google/Chrome/Application/chrome.exe")

RENDER = r"""(async () => {
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  for (let i = 0; i < 120 && !(window.freePose && document.querySelector('#loading').hidden); i++) await sleep(500);
  const fp = window.freePose, v = fp.viewer;
  for (const [id, value] of [['#output-width', 768], ['#output-height', 1024]]) {
    const input = document.querySelector(id); input.value = value; input.dispatchEvent(new Event('change'));
  }
  const shrink = async (url, w, h, type) => {
    const image = new Image(); image.src = url; await image.decode();
    const canvas = document.createElement('canvas'); canvas.width = w; canvas.height = h;
    canvas.getContext('2d').drawImage(image, 0, 0, w, h);
    return canvas.toDataURL(type, 0.9);
  };
  const out = [];
  for (const entry of fp.galleries.common) {
    fp.applyCommonPose(entry);
    await sleep(150);
    const front = JSON.parse(await fp.serialize()).poseReference;
    v.setModelRotation(0, (entry.spec.turn || 0) + 90, 0);
    const side = JSON.parse(await fp.serialize()).poseReference;
    out.push({ id: entry.spec.id, name: entry.name,
               thumb: await shrink(front, 240, 320, 'image/webp'),
               front: await shrink(front, 240, 320, 'image/png'), side: await shrink(side, 240, 320, 'image/png') });
  }
  return JSON.stringify(out);
})()"""


async def render(base, port=9342):
    chrome = subprocess.Popen([CHROME, "--headless=new", f"--remote-debugging-port={port}", f"--user-data-dir={tempfile.mkdtemp()}",
                               "--window-size=1600,1000", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "about:blank"])
    try:
        async with aiohttp.ClientSession() as http:
            for _ in range(60):
                try:
                    page = next(t for t in await (await http.get(f"http://127.0.0.1:{port}/json")).json() if t["type"] == "page")
                    break
                except Exception:
                    await asyncio.sleep(0.3)
            async with http.ws_connect(page["webSocketDebuggerUrl"], max_msg_size=0) as ws:
                await ws.send_json({"id": 1, "method": "Page.navigate", "params": {"url": base + "/extensions/ComfyUI-Fisher-Pose/editor/freepose.html?build=1"}})
                await asyncio.sleep(3)
                await ws.send_json({"id": 2, "method": "Runtime.evaluate", "params": {"expression": RENDER, "awaitPromise": True, "returnByValue": True}})
                while True:
                    message = await ws.receive_json()
                    if message.get("id") == 2:
                        result = message["result"]
                        if result.get("exceptionDetails"):
                            raise RuntimeError(json.dumps(result["exceptionDetails"])[:1500])
                        return json.loads(result["result"]["value"])
    finally:
        chrome.terminate()


def decode(data_url):
    return Image.open(io.BytesIO(base64.b64decode(data_url.split(",", 1)[1])))


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--base", default="http://127.0.0.1:8188")
    parser.add_argument("--review")
    args = parser.parse_args()
    poses = asyncio.run(render(args.base))
    OUT.mkdir(parents=True, exist_ok=True)
    for pose in poses:
        (OUT / f"{pose['id']}.webp").write_bytes(base64.b64decode(pose["thumb"].split(",", 1)[1]))
    print(f"wrote {len(poses)} thumbnails to {OUT}")
    if args.review:
        cols, cell_w, cell_h = 7, 480, 350
        sheet = Image.new("RGB", (cols * cell_w, -(-len(poses) // cols) * cell_h), "white")
        draw = ImageDraw.Draw(sheet)
        font = ImageFont.truetype("msyh.ttc", 22) if os.name == "nt" else None
        for i, pose in enumerate(poses):
            x, y = (i % cols) * cell_w, (i // cols) * cell_h
            sheet.paste(decode(pose["front"]).convert("RGB"), (x, y + 28))
            sheet.paste(decode(pose["side"]).convert("RGB"), (x + 240, y + 28))
            draw.text((x + 6, y + 2), f"{i + 1}. {pose['name']}  (正面 | 侧面)", fill=(30, 40, 60), font=font)
        sheet.save(args.review, quality=88)
        print("review sheet:", args.review)
