import asyncio
import logging
import os
from datetime import datetime
from playwright.async_api import async_playwright

TARGET_URL = "https://arolinks.com/dZJjx"
CHECK_INTERVAL = 2000
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
# SCREENSHOT
# =========================
SCREENSHOT_DIR = "screenshots"
os.makedirs(SCREENSHOT_DIR, exist_ok=True)

async def take_screenshot(page, prefix="continue"):
    ts = datetime.now().strftime("%Y%m%d_%H%M%S")
    path = f"{SCREENSHOT_DIR}/{prefix}_{ts}.png"
    await page.screenshot(path=path, full_page=True)
    print(f"📸 SCREENSHOT SAVED: {path}")
    log.info(f"📸 Screenshot saved: {path}")

# =========================
# BUTTON REGISTRY
# =========================
BUTTONS = [
    ("VERIFY", "button#btn6.ce-btn.ce-blue"),
    ("CONTINUE", "a#btn7 button.ce-btn.ce-blue"),
]

clicked_buttons = set()
current_url = None

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
# SAFE CLICK (NAV AWARE)
# =========================
async def safe_click(page, element, name, selector):
    global clicked_buttons

    if selector in clicked_buttons:
        return

    try:
        async with page.expect_navigation(wait_until="domcontentloaded", timeout=15000):
            await element.click(force=True)
    except:
        await element.evaluate("el => el.click()")

    clicked_buttons.add(selector)

    print(f">>> BUTTON CLICKED: {name}")
    log.info(f"✅ CLICKED {name}")

    if name == "CONTINUE":
        await page.wait_for_timeout(5000)
        await take_screenshot(page, "continue")

# =========================
# URL CHANGE HANDLER (FIXED)
# =========================
async def handle_url_change(page):
    global current_url, clicked_buttons

    new_url = page.url
    if new_url != current_url:
        current_url = new_url

        # 🔥 WAIT FOR NEW PAGE DOM
        await page.wait_for_load_state("domcontentloaded")

        clicked_buttons.clear()  # reset ONLY after DOM ready

        print(f"\n🌍 NEW PAGE OPENED:")
        print(f"➡️  {new_url}\n")
        log.info(f"🌍 New URL loaded: {new_url}")

        if "webdb.store" in new_url:
            print("🛑 webdb.store detected, closing session")
            log.info("🛑 webdb.store detected → exit")
            return False

    return True

# =========================
# MAIN LOOP (FIXED)
# =========================
async def watch_and_click(page):
    global current_url
    current_url = page.url

    log.info("🔁 Advanced watcher started (navigation safe)")

    while True:
        if not await handle_url_change(page):
            break

        await remove_consent(page)

        try:
            for name, selector in BUTTONS:
                el = await page.query_selector(selector)
                if el and await el.is_visible():
                    await safe_click(page, el, name, selector)

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

        log.info(f"🌍 Opening {TARGET_URL}")
        await page.goto(TARGET_URL, wait_until="domcontentloaded")

        await watch_and_click(page)

        await browser.close()

if __name__ == "__main__":
    asyncio.run(run())
