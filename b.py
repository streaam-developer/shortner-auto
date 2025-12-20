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
    # CONTINUE handled separately (force + new tab safe)
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
# FORCE CONTINUE CLICK (NEW TAB SAFE)
# =========================
async def click_continue_force(page, context):
    selector = "button.ce-btn.ce-blue:has-text('Continue')"
    btn = await page.query_selector(selector)

    if not btn:
        return page

    print(">>> CLICKING CONTINUE (force)")
    log.info(">>> Clicking CONTINUE (force)")

    try:
        # 🆕 NEW TAB HANDLER
        async with context.expect_page(timeout=5000) as new_page_info:
            await btn.click(force=True)

        new_page = await new_page_info.value
        await new_page.wait_for_load_state("domcontentloaded")

        print(f"🌍 NEW TAB OPENED: {new_page.url}")
        log.info(f"🌍 New tab opened: {new_page.url}")

        await new_page.wait_for_timeout(5000)
        await take_screenshot(new_page, "continue")

        return new_page

    except:
        # SAME TAB NAVIGATION
        await btn.click(force=True)
        await page.wait_for_load_state("domcontentloaded")

        print(f"🌍 SAME TAB URL: {page.url}")
        log.info(f"🌍 Same tab URL: {page.url}")

        await page.wait_for_timeout(5000)
        await take_screenshot(page, "continue")

        return page

# =========================
# SAFE CLICK (VERIFY)
# =========================
async def safe_click(page, element, name, selector):
    global clicked_buttons

    if selector in clicked_buttons:
        return

    try:
        await element.click(force=True)
    except:
        await element.evaluate("el => el.click()")

    clicked_buttons.add(selector)

    print(f">>> BUTTON CLICKED: {name}")
    log.info(f"✅ CLICKED {name}")

# =========================
# URL CHANGE HANDLER
# =========================
async def handle_url_change(page):
    global current_url, clicked_buttons

    if page.url != current_url:
        current_url = page.url
        await page.wait_for_load_state("domcontentloaded")
        clicked_buttons.clear()

        print(f"\n🌍 NEW PAGE OPENED:")
        print(f"➡️  {page.url}\n")
        log.info(f"🌍 New URL loaded: {page.url}")

        if "webdb.store" in page.url:
            print("🛑 webdb.store detected, closing session")
            log.info("🛑 webdb.store detected → exit")
            return False

    return True

# =========================
# MAIN LOOP
# =========================
async def watch_and_click(page, context):
    global current_url
    current_url = page.url

    log.info("🔁 Advanced watcher started")

    while True:
        if not await handle_url_change(page):
            break

        await remove_consent(page)

        try:
            # VERIFY
            verify_sel = "button#btn6.ce-btn.ce-blue"
            verify = await page.query_selector(verify_sel)
            if verify and await verify.is_visible():
                await safe_click(page, verify, "VERIFY", verify_sel)

            # CONTINUE (FORCE + TAB SAFE)
            page = await click_continue_force(page, context)

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

        await watch_and_click(page, context)

        await browser.close()

if __name__ == "__main__":
    asyncio.run(run())
