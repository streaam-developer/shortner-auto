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
# STATE (ANTI DOUBLE CLICK)
# =========================
clicked_buttons = set()

# =========================
# REMOVE OVERLAY
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
# SAFE CLICK (ONCE)
# =========================
async def safe_click(page, element, name, selector):
    global clicked_buttons

    if selector in clicked_buttons:
        return  # already clicked, skip

    try:
        await element.click(force=True)
    except:
        await element.evaluate("el => el.click()")

    clicked_buttons.add(selector)

    print(f">>> BUTTON CLICKED: {name}")
    log.info(f"✅ CLICKED {name}")

    # ⏳ WAIT until button is gone / disabled
    try:
        await page.wait_for_function(
            """(sel) => {
                const el = document.querySelector(sel);
                return !el || el.disabled || el.offsetParent === null;
            }""",
            selector,
            timeout=10000
        )
        log.info(f"🔒 {name} button locked (hidden/disabled)")
    except:
        pass

# =========================
# BUTTON LOOP
# =========================
async def watch_and_click(page):
    log.info("🔁 Infinite button watcher started (safe mode)")

    while True:
        await remove_consent(page)

        try:
            # VERIFY
            verify_sel = "button#btn6.ce-btn.ce-blue"
            verify = await page.query_selector(verify_sel)
            if verify and await verify.is_visible():
                await safe_click(page, verify, "VERIFY", verify_sel)

            # CONTINUE
            cont_sel = "a#btn7 button.ce-btn.ce-blue"
            cont = await page.query_selector(cont_sel)
            if cont and await cont.is_visible():
                await safe_click(page, cont, "CONTINUE", cont_sel)

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
