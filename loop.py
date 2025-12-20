import asyncio
import logging
import random
import os
import threading
from datetime import datetime
from playwright.async_api import async_playwright

user_agents = [
    "Mozilla/5.0 (Linux; Android 10; SM-G975F) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.120 Mobile Safari/537.36",
    "Mozilla/5.0 (Linux; Android 11; Pixel 5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/90.0.4430.91 Mobile Safari/537.36",
    "Mozilla/5.0 (Linux; Android 12; SM-S908B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/103.0.0.0 Mobile Safari/537.36",
    "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/116.0.0.0 Mobile Safari/537.36",
    "Mozilla/5.0 (Linux; Android 9; SM-G960F) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/78.0.3904.108 Mobile Safari/537.36",
]

# ================= CONFIG =================
START_SITE = "https://yomovies.delivery"
CHECK_INTERVAL = 2000
HEADLESS = False

USE_PROXY = False
PROXY = {
    "server": "http://IP:PORT",
    "username": "USER",
    "password": "PASS"
}

proxies = []
if os.path.exists("proxy.txt"):
    with open("proxy.txt", "r") as f:
        for line in f:
            line = line.strip()
            if line:
                parts = line.split(":")
                if len(parts) == 4:
                    host, port, username, password = parts
                    proxies.append({
                        "server": f"http://{host}:{port}",
                        "username": username,
                        "password": password
                    })
USE_PROXY = len(proxies) > 0

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

async def take_screenshot(page, prefix="dwd"):
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
    try:
        return await el.is_visible()
    except:
        return False

# ================= RANDOM POST =================
async def open_random_download_post(page):
    links = []
    for a in await page.query_selector_all("a[href]"):
        href = await a.get_attribute("href")
        if href and "download" in href.lower():
            links.append(href)

    if not links:
        raise RuntimeError("❌ No download posts found")

    target = random.choice(links)
    await page.goto(target, wait_until="domcontentloaded")
    await page.wait_for_load_state("networkidle")

    print(f">>> RANDOM POST OPENED: {target}")
    log.info(f"🎯 Random post selected: {target}")

# ================= RANDOM DWD CLICK (FIXED) =================
async def click_random_dwd(page, context):
    global dwd_done
    if dwd_done:
        return page

    # 🔥 STRICT selector: class + text
    buttons = await page.query_selector_all(
        "xpath=//button[contains(@class,'dwd-button') and "
        "contains(translate(.,'ABCDEFGHIJKLMNOPQRSTUVWXYZ','abcdefghijklmnopqrstuvwxyz'),'download')]"
    )

    if not buttons:
        return page

    btn = random.choice(buttons)

    if not await btn.is_visible():
        return page

    dwd_done = True

    print(">>> DWD DOWNLOAD NOW CLICKED")
    log.info("➡️ DWD Download Now clicked")

    # ======================
    # LEVEL 1: JS CLICK
    # ======================
    await page.evaluate("el => el.click()", btn)
    await page.wait_for_timeout(random.randint(500, 1500))

    # ======================
    # WAIT FOR NAVIGATION
    # ======================
    try:
        async with context.expect_page(timeout=7000) as p:
            pass
        new_page = await p.value
        await new_page.wait_for_load_state("domcontentloaded")
        await new_page.wait_for_load_state("networkidle")

        print(f"🌍 DWD NEW TAB: {new_page.url}")
        log.info(f"🌍 DWD new tab: {new_page.url}")

        # ⏱ wait 5 sec + screenshot
        await new_page.wait_for_timeout(5000)
        await take_screenshot(new_page, "dwd")

        return new_page

    except:
        # ======================
        # SAME TAB FALLBACK
        # ======================
        await page.wait_for_load_state("domcontentloaded")
        await page.wait_for_load_state("networkidle")

        print(f"🌍 DWD SAME TAB: {page.url}")
        log.info(f"🌍 DWD same tab: {page.url}")

        await page.wait_for_timeout(5000)
        await take_screenshot(page, "dwd")

        return page


# ================= VERIFY =================
async def click_verify(page):
    global verify_done
    if verify_done:
        return

    btn = await page.query_selector(
        "xpath=//button[contains(translate(.,'ABCDEFGHIJKLMNOPQRSTUVWXYZ','abcdefghijklmnopqrstuvwxyz'),'verify')]"
    )
    if btn and await visible(page, btn):
        verify_done = True
        await page.evaluate("el => el.click()", btn)
        await page.wait_for_timeout(random.randint(500, 1500))
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
    await page.wait_for_timeout(random.randint(500, 1500))

    print(">>> CONTINUE CLICKED")
    log.info("➡️ CONTINUE CLICKED")

    try:
        async with context.expect_page(timeout=6000) as p:
            pass
        new_page = await p.value
        await new_page.wait_for_load_state("domcontentloaded")
        await new_page.wait_for_load_state("networkidle")
        print(f"🌍 CONTINUE NEW TAB: {new_page.url}")
        log.info(f"🌍 Continue new tab: {new_page.url}")
        return new_page
    except:
        await page.wait_for_load_state("domcontentloaded")
        await page.wait_for_load_state("networkidle")
        print(f"🌍 CONTINUE SAME TAB: {page.url}")
        log.info(f"🌍 Continue same tab: {page.url}")
        return page

# ================= GET LINK =================
async def click_get_link(page, context):
    global getlink_done
    if getlink_done:
        return page

    btn = await page.query_selector("a.get-link")
    if not btn or not await visible(page, btn):
        return page

    getlink_done = True
    await page.evaluate("el => el.click()", btn)
    await page.wait_for_timeout(random.randint(500, 1500))

    print(">>> GET LINK CLICKED")
    log.info("➡️ GET LINK CLICKED")

    try:
        async with context.expect_page(timeout=6000) as p:
            pass
        new_page = await p.value
        await new_page.wait_for_load_state("domcontentloaded")
        await new_page.wait_for_load_state("networkidle")
        print(f"🌍 FINAL TAB: {new_page.url}")
        log.info(f"🌍 Final tab: {new_page.url}")
        return new_page
    except:
        await page.wait_for_load_state("domcontentloaded")
        await page.wait_for_load_state("networkidle")
        print(f"🌍 FINAL SAME TAB: {page.url}")
        log.info(f"🌍 Final same tab: {page.url}")
        return page

# ================= URL CHANGE =================
async def handle_url(page):
    global current_url, verify_done, continue_done, getlink_done

    if page.url != current_url:
        current_url = page.url
        verify_done = False
        continue_done = False
        getlink_done = False

        print(f"\n🌍 PAGE LOADED: {page.url}")
        log.info(f"🌍 Page loaded: {page.url}")

        if "webdb.store" in page.url:
            print("🛑 webdb.store reached — STOP")
            log.info("🛑 webdb.store reached")
            return False

    return True

# ================= MAIN LOOP =================
async def watcher(page, context):
    while True:
        if not await handle_url(page):
            break

        await remove_overlay(page)
        page = await click_random_dwd(page, context)
        await click_verify(page)
        page = await click_continue(page, context)
        page = await click_get_link(page, context)

        await page.wait_for_timeout(random.randint(1000, 3000))

# ================= MAIN =================
async def run():
    async with async_playwright() as p:
        launch_args = {
            "headless": HEADLESS,
            "args": [
                "--disable-blink-features=AutomationControlled",
                "--disable-web-security",
                "--disable-features=VizDisplayCompositor",
                "--no-sandbox",
                "--disable-setuid-sandbox",
            ]
        }
        if USE_PROXY:
            proxy = random.choice(proxies)
            launch_args["proxy"] = proxy

        browser = await p.chromium.launch(**launch_args)
        device = p.devices['iPhone 12']
        context = await browser.new_context(
            **device,
            proxy=proxy if USE_PROXY else None,
            extra_http_headers={"User-Agent": random.choice(user_agents)}
        )
        page = await context.new_page()

        await page.goto(START_SITE, wait_until="domcontentloaded")
        await page.wait_for_load_state("networkidle")
        await open_random_download_post(page)
        await watcher(page, context)

        await browser.close()

def run_async():
    asyncio.run(run())

if __name__ == "__main__":
    num_threads = 1  # Adjust number of concurrent instances
    threads = []
    for i in range(num_threads):
        t = threading.Thread(target=run_async)
        threads.append(t)
        t.start()
    for t in threads:
        t.join()
