import asyncio
import logging
import os
from datetime import datetime
from playwright.async_api import async_playwright

# =========================
# CONFIG
# =========================
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
# SCREENSHOT SETUP
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
# GLOBAL STATE
# =========================
clicked_buttons = set()
continue_clicked = False
current_url = None

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
# SAFE VERIFY CLICK
# =========================
async def click_verify(page):
    selector = "button#btn6.ce-btn.ce-blue"
    if selector in clicked_buttons:
        return

    btn = await page.query_selector(selector)
    if not btn:
        return

    visible = await page.evaluate("""
        el => {
            const r = el.getBoundingClientRect();
            return r.width > 0 && r.height > 0;
        }
    """, btn)

    if not visible:
        return

    await page.evaluate("el => el.click()", btn)
    clicked_buttons.add(selector)

    print(">>> BUTTON CLICKED: VERIFY")
    log.info("✅ CLICKED VERIFY")

# =========================
# FORCE CONTINUE CLICK (NO VISIBILITY ERRORS)
# =========================
async def click_continue_force(page, context):
    global continue_clicked

    if continue_clicked:
        return page

    selector = "button.ce-btn.ce-blue"
    btn = await page.query_selector(selector)
    if not btn:
        return page

    visible = await page.evaluate("""
        el => {
            const r = el.getBoundingClientRect();
            return r.width > 0 && r.height > 0;
        }
    """, btn)

    if not visible:
        return page

    continue_clicked = True

    print(">>> CLICKING CONTINUE (JS force)")
    log.info(">>> Clicking CONTINUE (JS force)")

    # JS click (bypasses Playwright visibility rules)
    await page.evaluate("el => el.click()", btn)

    # Try new tab first
    try:
        async with context.expect_page(timeout=6000) as p:
            pass
        new_page = await p.value
        await new_page.wait_for_load_state("domcontentloaded")

        print(f"🌍 NEW TAB OPENED: {new_page.url}")
        log.info(f"🌍 New tab opened: {new_page.url}")

        await new_page.wait_for_timeout(5000)
        await take_screenshot(new_page, "continue")

        return new_page

    except:
        # Same tab navigation
        await page.wait_for_load_state("domcontentloaded")

        print(f"🌍 SAME TAB URL: {page.url}")
        log.info(f"🌍 Same tab URL: {page.url}")

        await page.wait_for_timeout(5000)
        await take_screenshot(page, "continue")

        return page

# =========================
# URL CHANGE HANDLER
# =========================
async def handle_url_change(page):
    global current_url, clicked_buttons, continue_clicked

    if page.url != current_url:
        current_url = page.url
        clicked_buttons.clear()
        continue_clicked = False

        await page.wait_for_load_state("domcontentloaded")

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
            await click_verify(page)
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
