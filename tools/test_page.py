#!/usr/bin/env python3
"""Headless smoke test of the static explorer: load, hover, toggle, export."""
import asyncio, json, subprocess, sys, time, socket
from pathlib import Path
from playwright.async_api import async_playwright

ROOT = Path(__file__).resolve().parent.parent   # repository root
PORT = 8765
SHOT = ROOT / "shots"
SHOT.mkdir(exist_ok=True)


async def main():
    server = subprocess.Popen([sys.executable, "-m", "http.server", str(PORT), "-d", str(ROOT)],
                              stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    for _ in range(50):
        try:
            socket.create_connection(("127.0.0.1", PORT), 0.2).close()
            break
        except OSError:
            time.sleep(0.1)
    errors, logs = [], []
    try:
        async with async_playwright() as p:
            browser = await p.chromium.launch()
            page = await browser.new_page(viewport={"width": 1440, "height": 950},
                                          device_scale_factor=2)
            page.on("console", lambda m: (logs.append(f"{m.type}: {m.text}"),
                                          errors.append(m.text) if m.type == "error" else None))
            page.on("pageerror", lambda e: errors.append(f"pageerror: {e}"))

            t0 = time.time()
            await page.goto(f"http://127.0.0.1:{PORT}/index.html", wait_until="networkidle")
            await page.wait_for_function("document.querySelector('#readout').children.length > 0",
                                         timeout=10000)
            load_s = time.time() - t0
            print(f"load to first render: {load_s:.2f} s")

            # resource sizes
            sizes = await page.evaluate("""() => performance.getEntriesByType('resource')
                 .map(r => [r.name.split('/').pop(), Math.round(r.transferSize/1024), Math.round(r.duration)])""")
            print("resources:", sizes)
            print("DOMContentLoaded:", await page.evaluate(
                "() => Math.round(performance.timing.domContentLoadedEventEnd - performance.timing.navigationStart)"), "ms")

            await page.screenshot(path=str(SHOT / "01_initial.png"), full_page=False)

            # --- hover over the map
            box = await page.locator("#map-canvas").bounding_box()
            await page.mouse.move(box["x"] + box["width"] * 0.34, box["y"] + box["height"] * 0.42)
            await page.wait_for_timeout(250)
            bin_after_hover = await page.locator("#bin").input_value()
            tip = await page.locator("#map-tooltip").is_visible()
            print("hover -> bin", bin_after_hover, "tooltip visible:", tip)
            await page.screenshot(path=str(SHOT / "02_hover.png"))

            # --- click to lock, then hover elsewhere (must not change)
            await page.mouse.click(box["x"] + box["width"] * 0.34, box["y"] + box["height"] * 0.42)
            await page.mouse.move(box["x"] + box["width"] * 0.6, box["y"] + box["height"] * 0.6)
            await page.wait_for_timeout(200)
            locked_bin = await page.locator("#bin").input_value()
            status = await page.locator("#status").inner_text()
            print("locked:", locked_bin == bin_after_hover, "|", status)
            await page.keyboard.press("Escape")
            await page.wait_for_timeout(100)
            print("after Esc:", await page.locator("#status").inner_text())

            # --- overlay + quantity + dataset switches (timed)
            for action, code in [
                ("overlay on", "document.querySelector('#overlay').click()"),
                ("sigma map", "(()=>{const s=document.querySelector('#quantity');s.value='sigma';s.dispatchEvent(new Event('change'))})()"),
                ("h3 map", "(()=>{const s=document.querySelector('#quantity');s.value='h3';s.dispatchEvent(new Event('change'))})()"),
                ("common scale", "document.querySelector('#common').click()"),
                ("switch to MUSE", "document.querySelector('[data-dataset=FCC47_MUSE]').click()"),
            ]:
                t = time.time()
                await page.evaluate(code)
                await page.wait_for_timeout(60)
                print(f"  {action}: {(time.time()-t)*1000:.0f} ms")
            await page.screenshot(path=str(SHOT / "03_muse_overlay_h3.png"))

            # back to SINFONI velocity with overlay for a representative shot
            await page.evaluate("document.querySelector('[data-dataset=FCC47_SINFONI]').click()")
            await page.evaluate("(()=>{const s=document.querySelector('#quantity');s.value='vel';s.dispatchEvent(new Event('change'))})()")
            await page.evaluate("(()=>{const s=document.querySelector('#bin');s.value='203';s.dispatchEvent(new Event('change'))})()")
            await page.wait_for_timeout(200)
            await page.screenshot(path=str(SHOT / "04_sinfoni_overlay.png"))

            # --- downloads
            for btn, label in [("#dl-losvd", "losvd csv"), ("#dl-kin", "kin csv"), ("#dl-png", "png")]:
                async with page.expect_download(timeout=8000) as dl:
                    await page.click(btn)
                d = await dl.value
                path = SHOT / d.suggested_filename
                await d.save_as(str(path))
                print(f"  download {label}: {d.suggested_filename} ({path.stat().st_size} bytes)")

            # --- responsive check
            await page.set_viewport_size({"width": 760, "height": 1000})
            await page.wait_for_timeout(400)
            overflow = await page.evaluate(
                "() => document.documentElement.scrollWidth - document.documentElement.clientWidth")
            print("horizontal overflow at 760px:", overflow)
            await page.screenshot(path=str(SHOT / "05_narrow.png"), full_page=False)

            await page.set_viewport_size({"width": 390, "height": 840})
            await page.wait_for_timeout(400)
            overflow_m = await page.evaluate(
                "() => document.documentElement.scrollWidth - document.documentElement.clientWidth")
            print("horizontal overflow at 390px:", overflow_m)
            await page.screenshot(path=str(SHOT / "06_mobile.png"))

            await browser.close()
    finally:
        server.terminate()

    print("\nconsole errors:", errors if errors else "none")


asyncio.run(main())
