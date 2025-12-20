import asyncio
import logging
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
# SAFE CLICK (SINGLE)
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

    # wait until element hides / disables
    try:
        await page.wait_for_function(
            """(sel) => {
                const el = document.querySelector(sel);
                return !el || el.disabled || el.offsetParent === null;
            }""",
            selector,
            timeout=10000
        )
    except:
        pass

# =========================
# URL CHANGE HANDLER
# =========================
async def handle_url_change(page):
    global current_url, clicked_buttons

    new_url = page.url
    if new_url != current_url:
        current_url = new_url
        clicked_buttons.clear()  # reset for new page

        print(f"\n🌍 NEW PAGE OPENED:")
        print(f"➡️  {new_url}\n")

        log.info(f"🌍 New URL loaded: {new_url}")

        # hard stop condition
        if "webdb.store" in new_url:
            print("🛑 webdb.store detected, closing session")
            log.info("🛑 webdb.store detected → exit")
            return False

    return True

# =========================
# MAIN LOOP
# =========================
async def watch_and_click(page):
    global current_url
    current_url = page.url

    log.info("🔁 Advanced infinite watcher started")

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

        # new tab handler
        context.on(
            "page",
            lambda p: asyncio.create_task(watch_and_click(p))
        )

        log.info(f"🌍 Opening {TARGET_URL}")
        await page.goto(TARGET_URL, wait_until="domcontentloaded")

        await watch_and_click(page)

        await browser.close()

if __name__ == "__main__":
    asyncio.run(run())
