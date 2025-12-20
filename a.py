import asyncio
import logging
from playwright.async_api import async_playwright

TARGET_URL = "https://arolinks.com/dZJjx"
CHECK_INTERVAL = 2000
HEADLESS = False

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
# REMOVE COOKIE / OVERLAY
# =========================
async def remove_consent(page):
    try:
        await page.evaluate("""
            () => {
                document.querySelectorAll(
                    '.fc-consent-root,
                     .fc-dialog-overlay,
                     .fc-faq-icon'
                ).forEach(e => e.remove());
            }
        """)
    except:
        pass

# =========================
# SAFE CLICK
# =========================
async def safe_click(element, name):
    try:
        await element.click(force=True)
    except:
        await element.evaluate("el => el.click()")

    print(f">>> BUTTON CLICKED: {name}")
    log.info(f"✅ CLICKED {name}")

# =========================
# INFINITE BUTTON LOOP
# =========================
async def watch_and_click(page):
    log.info("🔁 Infinite button watcher started")

    while True:
        await remove_consent(page)

        try:
            # VERIFY
            verify = await page.query_selector("button#btn6.ce-btn.ce-blue")
            if verify and await verify.is_visible():
                await safe_click(verify, "VERIFY")

            # CONTINUE
            cont = await page.query_selector("a#btn7 button.ce-btn.ce-blue")
            if cont and await cont.is_visible():
                await safe_click(cont, "CONTINUE")

        except Exception as e:
            log.error(f"⚠️ Loop error: {e}")

        await page.wait_for_timeout(CHECK_INTERVAL)

# =========================
# MAIN
# =========================
async def run():
    async with async_playwright() as p:
        browser = await p.chromium.launch(
            headless=HEADLESS,
            args=["--disable-blink-features=AutomationControlled"]
        )

        context = await browser.new_context()
        page = await context.new_page()

        # DOMAIN DETECTOR
        async def on_nav(frame):
            if "webdb.store" in frame.url:
                print(">>> webdb.store detected, closing session")
                log.info("🌐 webdb.store opened → session closed")
                await context.close()
                await browser.close()

        page.on("framenavigated", on_nav)

        log.info(f"🌍 Opening {TARGET_URL}")
        await page.goto(TARGET_URL, wait_until="domcontentloaded")

        await watch_and_click(page)

if __name__ == "__main__":
    asyncio.run(run())
