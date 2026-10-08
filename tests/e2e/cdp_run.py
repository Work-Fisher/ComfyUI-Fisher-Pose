"""Drive the real ComfyUI frontend headless and run one scenario script in it.

    python tests/e2e/cdp_run.py <scenario.js> [--base http://127.0.0.1:8188] [--workflow <file.json>]

The scenario is an async JS expression evaluated in the ComfyUI page after the workflow is loaded
(default: the plugin's free-pose workflow); whatever it returns is printed. Needs a running ComfyUI
and Chrome (set CHROME if it is not in the default location). Nothing is queued unless the scenario does.
"""
import argparse, asyncio, json, os, subprocess, tempfile
from pathlib import Path

import aiohttp

ROOT = Path(__file__).resolve().parents[2]
CHROME = os.environ.get("CHROME", r"C:/Program Files/Google/Chrome/Application/chrome.exe")


async def run(scenario, base, workflow, port=9341):
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
                counter = 0

                async def call(method, **params):
                    nonlocal counter
                    counter += 1
                    await ws.send_json({"id": counter, "method": method, "params": params})
                    while True:
                        message = await ws.receive_json()
                        if message.get("id") == counter:
                            return message.get("result", {})

                async def js(expression):
                    result = await call("Runtime.evaluate", expression=expression, awaitPromise=True, returnByValue=True)
                    if result.get("exceptionDetails"):
                        raise RuntimeError(json.dumps(result["exceptionDetails"], ensure_ascii=False)[:2000])
                    return result["result"].get("value")

                await call("Page.navigate", url=base + "/")
                for _ in range(120):
                    await asyncio.sleep(1)
                    try:
                        if await js("!!(window.app && window.app.graph && window.app.canvas)"):
                            break
                    except Exception:
                        pass
                await asyncio.sleep(3)
                data = json.loads(Path(workflow).read_text(encoding="utf-8"))
                await js(f"window.app.loadGraphData({json.dumps(data)}).then(() => 1)")
                await asyncio.sleep(2)
                return await js(Path(scenario).read_text(encoding="utf-8"))
    finally:
        chrome.terminate()


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("scenario")
    parser.add_argument("--base", default="http://127.0.0.1:8188")
    parser.add_argument("--workflow", default=str(ROOT / "workflows" / "【Work-Fisher】无限姿势+无限视角（支持双人）.json"))
    args = parser.parse_args()
    print(asyncio.run(run(args.scenario, args.base, args.workflow)))
