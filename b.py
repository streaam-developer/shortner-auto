import asyncio
import logging
import os
from datetime import datetime
from playwright.async_api import async_playwright

# ================= CONFIG =================
TARGET_URL = "https://arolinks.com/dZJjx"
CHECK_INTERVAL = 2000
HEADLESS = True

# ================= LOGGING =================
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s | %(levelname)s | %(message)s",
    handlers=[
        logging.FileHandler("automation.log", encoding="utf-8"),
        logging.StreamHandler()
    ]
)
log = logging.getLogger("AUTO")

# ================= SCREENSHOTS =================
SCREENSHOT_DIR = "screenshots"
os.makedirs(SCREENSHOT_DIR, exist_ok=True)

async def take_screenshot(page, prefix="continue"):
    ts = datetime.now().strftime("%Y%m%d_%H%M%S")
    path = f"{SCREENSHOT_DIR}/{prefix}_{ts}.png"
    await page.screenshot(path=path, full_page=True)
    print(f"📸 SCREENSHOT SAVED: {path}")
    log.info(f"📸 Screenshot saved: {path}")

# ================= STATE =================
current_url = None
verify_done = False
continue_done = False
getlink_done = False

# ================= HELPERS =================
async def remove_overlay(page):
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

async def element_visible(page, el):
    return await page.evaluate("""
        el => {
            if (!el) return false;
            const r = el.getBoundingClientRect();
            return r.width > 0 && r.height > 0 &&
                   window.getComputedStyle(el).display !== 'none' &&
                   window.getComputedStyle(el).visibility !== 'hidden';
        }
    """, el)

# ================= CLICK VERIFY =================
async def click_verify(page):
    global verify_done
    if verify_done:
        return

    btn = await page.query_selector(
        "xpath=//button[contains(translate(.,'ABCDEFGHIJKLMNOPQRSTUVWXYZ','abcdefghijklmnopqrstuvwxyz'),'verify')]"
    )
    if not btn:
        return

    if not await element_visible(page, btn):
        return

    verify_done = True
    await page.evaluate("el => el.click()", btn)

    print(">>> VERIFY CLICKED")
    log.info("✅ VERIFY CLICKED")

# ================= CLICK CONTINUE =================
async def click_continue(page, context):
    global continue_done
    if continue_done:
        return page

    btn = await page.query_selector(
        "xpath=//button[contains(translate(.,'ABCDEFGHIJKLMNOPQRSTUVWXYZ','abcdefghijklmnopqrstuvwxyz'),'continue')]"
    )
    if not btn:
        return page

    if not await element_visible(page, btn):
        return page

    continue_done = True
    await page.evaluate("el => el.click()", btn)

    print(">>> CONTINUE CLICKED")
    log.info("➡️ CONTINUE CLICKED")

    try:
        async with context.expect_page(timeout=6000) as p:
            pass
        new_page = await p.value
        await new_page.wait_for_load_state("domcontentloaded")

        print(f"🌍 NEW TAB (CONTINUE): {new_page.url}")
        log.info(f"🌍 New tab (Continue): {new_page.url}")

        await new_page.wait_for_timeout(5000)
        await take_screenshot(new_page)

        return new_page

    except:
        await page.wait_for_load_state("domcontentloaded")

        print(f"🌍 SAME TAB (CONTINUE): {page.url}")
        log.info(f"🌍 Same tab (Continue): {page.url}")

        await page.wait_for_timeout(5000)
        await take_screenshot(page)

        return page

# ================= CLICK GET LINK =================
async def click_get_link(page, context):
    global getlink_done
    if getlink_done:
        return page

    btn = await page.query_selector("a#get-link")
    if not btn:
        return page

    visible = await page.evaluate("""
        el => {
            if (!el) return false;
            const r = el.getBoundingClientRect();
            return r.width > 0 && r.height > 0 &&
                   !el.classList.contains('disabled') &&
                   el.style.display !== 'none';
        }
    """, btn)

    if not visible:
        return page

    getlink_done = True
    await page.evaluate("el => el.click()", btn)

    print(">>> GET LINK CLICKED")
    log.info("➡️ GET LINK CLICKED")

    try:
        async with context.expect_page(timeout=6000) as p:
            pass
        new_page = await p.value
        await new_page.wait_for_load_state("domcontentloaded")

        print(f"🌍 NEW TAB (GET LINK): {new_page.url}")
        log.info(f"🌍 New tab (Get Link): {new_page.url}")

        return new_page

    except:
        await page.wait_for_load_state("domcontentloaded")

        print(f"🌍 SAME TAB (GET LINK): {page.url}")
        log.info(f"🌍 Same tab (Get Link): {page.url}")

        return page

# ================= URL CHANGE =================
async def handle_url_change(page):
    global current_url, verify_done, continue_done, getlink_done

    if page.url != current_url:
        current_url = page.url
        verify_done = False
        continue_done = False
        getlink_done = False

        await page.wait_for_load_state("domcontentloaded")

        print(f"\n🌍 PAGE LOADED:")
        print(f"➡️ {page.url}\n")
        log.info(f"🌍 Page loaded: {page.url}")

        if "webdb.store" in page.url:
            print("🛑 webdb.store reached — STOP")
            log.info("🛑 webdb.store reached")
            return False

    return True

# ================= MAIN LOOP =================
async def watcher(page, context):
    global current_url
    current_url = page.url

    log.info("🔁 Smart watcher started")

    while True:
        if not await handle_url_change(page):
            break

        await remove_overlay(page)

        await click_verify(page)
        page = await click_continue(page, context)
        page = await click_get_link(page, context)

        await page.wait_for_timeout(CHECK_INTERVAL)

# ================= MAIN =================
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

        await watcher(page, context)

        await browser.close()

if __name__ == "__main__":
    asyncio.run(run())
