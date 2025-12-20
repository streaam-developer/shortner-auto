import asyncio
import logging
from playwright.async_api import async_playwright

# =========================
# CONFIG
# =========================
TARGET_URL = "https://arolinks.com/dZJjx"
CHECK_INTERVAL = 2000  # 2 seconds
HEADLESS = True

# =========================
# LOGGING
# =========================
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s | %(levelname)s | %(message)s",
    handlers=[
        logging.FileHandler("automation.log", encoding="utf-8"),
        logging.StreamHandler()
    ]
)
log = logging.getLogger("AUTO")

# =========================
# BUTTON WATCHER
# =========================
async def watch_and_click(page):
    log.info("👀 Button watcher started (checking every 2s)")

    while True:
        try:
            # 🔎 CHECK VERIFY
            verify = await page.query_selector("button#btn6.ce-btn.ce-blue")
            if verify and await verify.is_visible():
                await verify.click()
                print(">>> BUTTON CLICKED: VERIFY")
                log.info("✅ CLICKED VERIFY")
                return

            # 🔎 CHECK CONTINUE
            cont = await page.query_selector("a#btn7 button.ce-btn.ce-blue")
            if cont and await cont.is_visible():
                await cont.click()
                print(">>> BUTTON CLICKED: CONTINUE")
                log.info("✅ CLICKED CONTINUE")
                return

        except Exception as e:
            log.error(f"⚠️ Button check error: {e}")

        await page.wait_for_timeout(CHECK_INTERVAL)

# =========================
# MAIN
# =========================
async def run():
    log.info("🚀 Automation started")

    async with async_playwright() as p:
        browser = await p.chromium.launch(
            headless=HEADLESS,
            args=["--disable-blink-features=AutomationControlled"]
        )

        context = await browser.new_context()
        page = await context.new_page()

        # 🔗 Listen for URL change
        async def on_frame_nav(frame):
            url = frame.url
            if "webdb.store" in url:
                log.info(f"🌐 webdb.store opened → {url}")
                print(">>> webdb.store detected, closing session")
                await context.close()
                await browser.close()

        page.on("framenavigated", on_frame_nav)

        log.info(f"🌍 Opening: {TARGET_URL}")
        await page.goto(TARGET_URL, wait_until="domcontentloaded")

        await watch_and_click(page)

        # Keep loop alive until webdb.store opens
        while True:
            await asyncio.sleep(1)

# =========================
# ENTRY
# =========================
if __name__ == "__main__":
    asyncio.run(run())
