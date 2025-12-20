import asyncio
import logging
from playwright.async_api import async_playwright

# ================= CONFIG =================
START_SITE = "https://skymovieshd.tattoo"
CHECK_INTERVAL = 2000
HEADLESS = True
USE_PROXY = False   # 👉 True to enable proxy

PROXY = {
    "server": "http://IP:PORT",
    "username": "USER",
    "password": "PASS"
}

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

# ================= STATE =================
current_url = None
verify_done = False
continue_done = False
getlink_done = False
dwd_done = False

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

async def visible(page, el):
    return await page.evaluate("""
        el => {
            const r = el.getBoundingClientRect();
            return r.width > 0 && r.height > 0 &&
                   getComputedStyle(el).display !== 'none';
        }
    """, el)

# ================= STEP 1: PICK POST =================
async def pick_one_post(page):
    links = await page.query_selector_all("a[href]")
    for a in links:
        href = await a.get_attribute("href")
        if href and "download" in href.lower():
            await page.goto(href, wait_until="domcontentloaded")
            log.info(f"🎯 Post selected: {href}")
            print(f">>> POST OPENED: {href}")
            return

# ================= STEP 2: CLICK ONE DWD BUTTON =================
async def click_one_dwd(page):
    global dwd_done
    if dwd_done:
        return

    btns = await page.query_selector_all(".dwd-button")
    for btn in btns:
        if await visible(page, btn):
            dwd_done = True
            await page.evaluate("el => el.click()", btn)
            print(">>> DWD BUTTON CLICKED")
            log.info("➡️ DWD button clicked")
            return

# ================= VERIFY =================
async def click_verify(page):
    global verify_done
    if verify_done:
        return

    btn = await page.query_selector(
        "xpath=//button[contains(., 'Verify')]"
    )
    if btn and await visible(page, btn):
        verify_done = True
        await page.evaluate("el => el.click()", btn)
        print(">>> VERIFY CLICKED")
        log.info("✅ VERIFY CLICKED")

# ================= CONTINUE =================
async def click_continue(page, context):
    global continue_done
    if continue_done:
        return page

    btn = await page.query_selector(
        "xpath=//button[contains(translate(.,'ABCDEFGHIJKLMNOPQRSTUVWXYZ','abcdefghijklmnopqrstuvwxyz'),'continue')]"
    )
    if not btn or not await visible(page, btn):
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
        print(f"🌍 NEW TAB: {new_page.url}")
        return new_page
    except:
        await page.wait_for_load_state("domcontentloaded")
        print(f"🌍 SAME TAB: {page.url}")
        return page

# ================= GET LINK =================
async def click_get_link(page, context):
    global getlink_done
    if getlink_done:
        return page

    btn = await page.query_selector("a#get-link")
    if not btn or not await visible(page, btn):
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
        print(f"🌍 FINAL TAB: {new_page.url}")
        return new_page
    except:
        await page.wait_for_load_state("domcontentloaded")
        print(f"🌍 FINAL SAME TAB: {page.url}")
        return page

# ================= URL CHANGE =================
async def handle_url(page):
    global current_url, verify_done, continue_done, getlink_done

    if page.url != current_url:
        current_url = page.url
        verify_done = False
        continue_done = False
        getlink_done = False

        print(f"\n🌍 PAGE: {page.url}")
        log.info(f"🌍 Page: {page.url}")

        if "webdb.store" in page.url:
            print("🛑 webdb.store reached — STOP")
            return False

    return True

# ================= MAIN LOOP =================
async def watcher(page, context):
    while True:
        if not await handle_url(page):
            break

        await remove_overlay(page)
        await click_one_dwd(page)
        await click_verify(page)
        page = await click_continue(page, context)
        page = await click_get_link(page, context)

        await page.wait_for_timeout(CHECK_INTERVAL)

# ================= MAIN =================
async def run():
    async with async_playwright() as p:
        launch_args = {
            "headless": HEADLESS,
            "args": ["--disable-blink-features=AutomationControlled"]
        }

        if USE_PROXY:
            launch_args["proxy"] = PROXY

        browser = await p.chromium.launch(**launch_args)
        context = await browser.new_context()
        page = await context.new_page()

        await page.goto(START_SITE, wait_until="domcontentloaded")
        await pick_one_post(page)
        await watcher(page, context)

        await browser.close()

if __name__ == "__main__":
    asyncio.run(run())
