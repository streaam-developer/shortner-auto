# Required: pip install playwright-stealth
import asyncio
import logging
import random
import os
import re
import sys
from datetime import datetime
from playwright.async_api import async_playwright, Page, Frame
from playwright_stealth import Stealth

# ================= CONFIGURATION =================
START_SITE = "https://yomovies.delivery"
TARGET_URL_PART = "webdb.store"
MAX_CONCURRENT_INSTANCES = 1
HEADLESS = False
SCREENSHOTS_ENABLED = False

proxies = []
if os.path.exists("proxy.txt"):
    with open("proxy.txt", "r") as f:
        for line in f.read().splitlines():
            if line.strip():
                try:
                    host, port, username, password = line.strip().split(":")
                    proxies.append({
                        "server": f"http://{host}:{port}",
                        "username": username,
                        "password": password
                    })
                except ValueError:
                    print(f"⚠️ Skipping malformed proxy line: {line}")
USE_PROXY = bool(proxies)

# ================= LOGGING =================
LOG_DIR = "logs"
os.makedirs(LOG_DIR, exist_ok=True)
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] [%(bot_id)s] %(message)s",
    handlers=[
        logging.FileHandler(os.path.join(LOG_DIR, "automation.log"), encoding="utf-8"),
        logging.StreamHandler()
    ]
)

# ================= SCREENSHOTS =================
SCREENSHOT_DIR = "screenshots"
os.makedirs(SCREENSHOT_DIR, exist_ok=True)

class AutomationBot:
    def __init__(self, bot_id: int, proxy: dict = None):
        self.bot_id = bot_id
        self.proxy = proxy
        self.logger = logging.LoggerAdapter(logging.getLogger(), {'bot_id': f'Bot-{self.bot_id}'})
        self.browser = None
        self.context = None

    async def _take_screenshot(self, page: Page, prefix="page"):
        if not SCREENSHOTS_ENABLED or page.is_closed():
            return
        try:
            ts = datetime.now().strftime("%Y%m%d_%H%M%S")
            path = os.path.join(SCREENSHOT_DIR, f"{prefix}_{self.bot_id}_{ts}.png")
            await page.screenshot(path=path, full_page=True)
            self.logger.info(f"📸 Screenshot saved: {path}")
        except Exception as e:
            self.logger.error(f"📸 Screenshot failed: {e}")

    async def _configure_network_blocker(self, page: Page):
        block_list_patterns = [
            r"doubleclick\.net", r"googleadservices\.com", r"googlesyndication\.com", r"adservice\.google\.",
            r"pagead2\.googlesyndication\.com", r"tpc\.googlesyndication\.com", r"adnxs\.com", r"adform\.net",
            r"criteo\.com", r"pubmatic\.com", r"rubiconproject\.com", r"thetradedesk\.com", r"yieldlab\.net",
            r"popads\.net", r"propellerads\.com", r"adsterra\.com", r"yandex\.", r"analytics\.google\.com",
            r"adsco\.re", r"ad\.gt", r"syndication\.exdynsrv\.com", r"go\.mobisla\.com"
        ]
        compiled_block_list = [re.compile(p) for p in block_list_patterns]
        await page.route("**/*", lambda route: asyncio.create_task(self._handle_route(route, compiled_block_list)))

    async def _handle_route(self, route, compiled_block_list):
        if any(p.search(route.request.url) for p in compiled_block_list):
            try: await route.abort()
            except Exception: pass
        else:
            try: await route.continue_()
            except Exception: pass

    async def _open_and_process_link(self, start_page: Page, selector: str) -> bool:
        """Clicks a selector that should open a new tab and starts the processing loop on it."""
        try:
            element = start_page.locator(selector).first
            if not await element.is_visible(timeout=5000):
                return False

            self.logger.info(f"Clicking initial download link: {selector}")
            async with self.context.expect_page(timeout=15000) as new_page_info:
                await element.click(force=True)
            
            new_page = await new_page_info.value
            self.logger.info(f"➡️ New tab opened: {new_page.url}")
            
            await self._process_tab_until_target(new_page)
            return True
        except Exception as e:
            self.logger.warning(f"Could not open new tab from selector '{selector}'. It might be a same-page navigation. Error: {e}")
            # Attempt same-page navigation as a fallback
            try:
                await start_page.locator(selector).first.click(force=True)
                await start_page.wait_for_load_state("domcontentloaded", timeout=10000)
                self.logger.info(f"➡️ Navigated on same page to: {start_page.url}")
                await self._process_tab_until_target(start_page)
                return True
            except Exception as inner_e:
                self.logger.error(f"Fallback same-page navigation also failed: {inner_e}")
                return False

    async def _process_tab_until_target(self, page: Page):
        """The main engine. On a given tab, repeatedly clicks selectors until the target URL is found."""
        self.logger.info(f"🚀 Starting aggressive click loop on: {page.url}")
        
        selectors_to_try = ["#btn6", "#btn7", "button:text-matches('continue', 'i')"]
        
        for i in range(20):
            if page.is_closed():
                self.logger.warning("Page was closed during processing loop.")
                return
            
            if TARGET_URL_PART in page.url:
                self.logger.info(f"✅ Target URL reached: {page.url}")
                await self._take_screenshot(page, "success")
                await asyncio.sleep(5)
                return

            self.logger.info(f"Loop {i+1}/20: Searching for selectors on {page.url}")

            action_taken = False
            for selector in selectors_to_try:
                for frame in [page] + page.frames:
                    if frame.is_closed(): continue
                    
                    element = frame.locator(selector).first
                    try:
                        if await element.is_visible(timeout=200):
                            self.logger.info(f"Found '{selector}', attempting click...")
                            await element.click(force=True)
                            await asyncio.sleep(random.uniform(2.5, 4.0))
                            action_taken = True
                            break
                    except Exception:
                        continue
                if action_taken:
                    break
            
            if not action_taken:
                self.logger.warning("No listed selectors found in this loop iteration. Ending process for this tab.")
                await self._take_screenshot(page, "no_selectors_found")
                return
    
    async def run_automation_flow(self, playwright: async_playwright):
        """The main entry point for a single bot instance."""
        print(f"Bot-{self.bot_id} starting...")
        sys.stdout.flush()
        try:
            device = playwright.devices['Pixel 5']
            self.browser = await playwright.chromium.launch(headless=HEADLESS, proxy=self.proxy)
            self.context = await self.browser.new_context(
                **device,
                locale="en-US",
                timezone_id="America/New_York",
                permissions=["geolocation"]
            )
            await self.context.grant_permissions(["geolocation"], origin=START_SITE)
            
            page = await self.context.new_page()
            await self._configure_network_blocker(page)

            self.logger.info(f"Navigating to start site: {START_SITE}")
            await page.goto(START_SITE, wait_until="domcontentloaded", timeout=60000)
            
            self.logger.info("Searching for a random download post to click...")
            download_links = await page.locator("a[href*='download']").all()
            if not download_links:
                raise RuntimeError("No download posts found on the main page.")
            
            random.shuffle(download_links)
            
            success = False
            for link in download_links:
                href = await link.get_attribute('href')
                self.logger.info(f"Attempting to start process with post: {href}")
                # Use a more stable selector for the link
                stable_selector = f"a[href='{href.replace("'", "\'\'")}']"
                if await self._open_and_process_link(page, stable_selector):
                    success = True
                    break
                else:
                    self.logger.warning(f"Post {href} did not start the process. Trying another.")
            
            if success:
                self.logger.info("✅ Main processing loop initiated successfully.")
            else:
                self.logger.error("❌ Could not find any download link that successfully started the process.")
                await self._take_screenshot(page, "initial_link_failure")

        except Exception as e:
            self.logger.error(f"❌ A critical error occurred in the bot run: {e}", exc_info=True)
            if self.context and self.context.pages:
                await self._take_screenshot(self.context.pages[-1], "critical_error")
        finally:
            self.logger.info("Browser cleanup.")
            if self.browser:
                await self.browser.close()

async def main():
    print("Main function started...")
    sys.stdout.flush()
    async with Stealth().use_async(async_playwright()) as playwright:
        tasks = []
        active_proxies = proxies if USE_PROXY else [None] * MAX_CONCURRENT_INSTANCES
        for i in range(min(MAX_CONCURRENT_INSTANCES, len(active_proxies))):
            bot = AutomationBot(bot_id=i+1, proxy=active_proxies[i])
            tasks.append(bot.run_automation_flow(playwright))
        await asyncio.gather(*tasks)

if __name__ == "__main__":
    print("Script starting...")
    sys.stdout.flush()
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print("\n🛑 Program interrupted by user.")
    except Exception as e:
        print(f"A critical error occurred in main: {e}")
