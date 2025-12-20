import asyncio
import logging
from playwright.async_api import async_playwright

TARGET_URL = "https://arolinks.com/dZJjx"
CHECK_INTERVAL = 2000
HEADLESS = True

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
# REMOVE CONSENT OVERLAY
# =========================
async def remove_consent(page):
    try:
        await page.evaluate("""
            () => {
                document.querySelectorAll(
                    '.fc-consent-root, .fc-dialog-overlay, .fc-faq-icon'
                ).forEach(e => e.remove());
            }
        """)
        log.info("🧹 Consent overlay removed")
    except:
        pass

# =========================
# SAFE CLICK (ANTI-OVERLAY)
# =========================
async def safe_click(element, name):
    try:
        await element.click(force=True)
        print(f">>> BUTTON CLICKED: {name}")
        log.info(f"✅ CLICKED {name} (force)")
        return True
    except:
        # JS fallback
        await element.evaluate("el => el.click()")
        print(f">>> BUTTON CLICKED: {name}")
        log.info(f"✅ CLICKED {name} (js)")
        return True

# =========================
# BUTTON WATCHER
# =========================
async def watch_and_click(page):
    log.info("👀 Watching buttons (2s polling)")

    while True:
        await remove_consent(page)

        try:
            verify = await page.query_selector("button#btn6.ce-btn.ce-blue")
            if verify and await verify.is_visible():
                await safe_click(verify, "VERIFY")
                return

            cont = await page.query_selector("a#btn7 button.ce-btn.ce-blue")
            if cont and await cont.is_visible():
                await safe_click(cont, "CONTINUE")
                return

        except Exception as e:
            log.error(f"⚠️ Button loop error: {e}")

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

        # webdb.store detector
        async def on_nav(frame):
            if "webdb.store" in frame.url:
                print(">>> webdb.store detected, closing session")
                log.info("🌐 webdb.store opened, closing browser")
                await context.close()
                await browser.close()

        page.on("framenavigated", on_nav)

        log.info(f"🌍 Opening {TARGET_URL}")
        await page.goto(TARGET_URL, wait_until="domcontentloaded")

        await watch_and_click(page)

        while True:
            await asyncio.sleep(1)

if __name__ == "__main__":
    asyncio.run(run())
