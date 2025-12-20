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
        self.page = None
        self.current_url = None
        self.page_state = {}

    def _reset_page_state(self):
        self.page_state = { "dwd_clicked": False, "verify_clicked": False, "continue_clicked": False, "getlink_clicked": False }

    async def _take_screenshot(self, page: Page, prefix="page"):
        if not SCREENSHOTS_ENABLED:
            return
        try:
            ts = datetime.now().strftime("%Y%m%d_%H%M%S")
            path = os.path.join(SCREENSHOT_DIR, f"{prefix}_{self.bot_id}_{ts}.png")
            await page.screenshot(path=path, full_page=True)
            self.logger.info(f"📸 Screenshot saved: {path}")
        except Exception as e:
            self.logger.error(f"📸 Screenshot failed: {e}")

    async def _human_like_delay(self, min_ms=500, max_ms=1500):
        await asyncio.sleep(random.uniform(min_ms, max_ms) / 1000)

    async def _human_like_scroll(self, page: Page):
        for _ in range(random.randint(1, 3)):
            scroll_amount = random.randint(-150, 300)
            await page.evaluate(f"window.scrollBy(0, {scroll_amount})")
            await self._human_like_delay(100, 300)
    
    async def _configure_network_blocker(self, page: Page):
        self.logger.info("Configuring network request blocker.")
        block_list_patterns = [
            r"doubleclick\.net", r"googleadservices\.com", r"googlesyndication\.com", r"adservice\.google\.",
            r"pagead2\.googlesyndication\.com", r"tpc\.googlesyndication\.com", r"adnxs\.com", r"adform\.net",
            r"criteo\.com", r"pubmatic\.com", r"rubiconproject\.com", r"thetradedesk\.com", r"yieldlab\.net",
            r"popads\.net", r"propellerads\.com", r"adsterra\.com", r"yandex\.", r"analytics\.google\.com",
            r"adsco\.re", r"ad\.gt", r"syndication\.exdynsrv\.com", r"go\.mobisla\.com"
        ]
        compiled_block_list = [re.compile(p) for p in block_list_patterns]

        async def handle_route(route):
            url = route.request.url
            if any(p.search(url) for p in compiled_block_list):
                try: await route.abort()
                except Exception: pass
            else:
                try: await route.continue_()
                except Exception: pass
        
        await page.route("**/*", handle_route)

    async def _click_element_human_like(self, page_or_frame: [Page, Frame], selector: str, new_page_timeout=10000):
        try:
            element = page_or_frame.locator(selector).first
            if not await element.is_visible():
                return self.page

            self.logger.info(f"Interacting with element: {selector}")
            await element.scroll_into_view_if_needed()
            await self._human_like_delay(200, 500)
            
            # Correctly get the page object for mouse actions, even from a frame
            action_page = page_or_frame.page if isinstance(page_or_frame, Frame) else page_or_frame
            bounding_box = await element.bounding_box()
            if bounding_box:
                target_x = bounding_box['x'] + bounding_box['width'] * random.uniform(0.3, 0.7)
                target_y = bounding_box['y'] + bounding_box['height'] * random.uniform(0.3, 0.7)
                await action_page.mouse.move(target_x, target_y, steps=random.randint(5, 15))
                await self._human_like_delay(100, 400)

            async with self.context.expect_page(timeout=new_page_timeout) as new_page_info:
                await element.click()
            
            new_page = await new_page_info.value
            # No longer need to apply stealth here, context manager handles it
            await self._configure_network_blocker(new_page)
            await new_page.wait_for_load_state("domcontentloaded", timeout=30000)
            self.logger.info(f"➡️ New tab opened: {new_page.url}")

            if "readnews18.com" in new_page.url:
                self.logger.info("Shortener page detected, starting special handling...")
                new_page = await self._handle_shortener_tab(new_page)

            await self._take_screenshot(new_page, "new_tab")
            return new_page

        except Exception:
            await self.page.wait_for_load_state("networkidle", timeout=30000)
            self.logger.info(f"➡️ Navigated on the same tab to: {self.page.url}")
            await self._take_screenshot(self.page, "same_tab_nav")
            return self.page

    async def _handle_shortener_tab(self, page: Page) -> Page:
        try:
            self.logger.info("Waiting for 'Verify' button (#btn6) to be attached...")
            verify_button = page.locator("#btn6")
            await verify_button.wait_for(state="attached", timeout=20000)
            
            self.logger.info("Forcefully clicking attached 'Verify' button, ignoring visibility.")
            await verify_button.click(force=True)
            await self._human_like_delay(500, 1000)

            self.logger.info("Waiting for 'Continue' button (#btn7) to become visible...")
            continue_button = page.locator("#btn7")
            await continue_button.wait_for(state="visible", timeout=20000)
            
            self.logger.info("Forcefully clicking 'Continue' button.")
            async with page.expect_navigation(wait_until="domcontentloaded", timeout=15000):
                await continue_button.click(force=True)
            self.logger.info(f"Navigation after Continue click successful. New URL: {page.url}")
        except Exception as e:
            self.logger.error(f"❌ Error during shortener handling: {e}", exc_info=True)
            await self._take_screenshot(page, "shortener_error")
        return page

    async def _open_random_download_post(self, page: Page):
        self.logger.info("Searching for a random download post...")
        download_links = await page.locator("a[href*='download']").all()
        if not download_links:
            raise RuntimeError("No download posts found on the main page.")

        random_post = random.choice(download_links)
        href = await random_post.get_attribute('href')
        self.logger.info(f"🎯 Navigating to random post: {href}")
        await page.goto(href, wait_until="domcontentloaded")
        self.logger.info(f"✅ Arrived at post page: {page.url}")
        
    async def run_automation_flow(self, playwright: async_playwright):
        print("Bot starting run_automation_flow...")
        sys.stdout.flush()
        
        device = playwright.devices['Pixel 5']
        launch_args = { "headless": HEADLESS, "proxy": self.proxy }

        self.browser = await playwright.chromium.launch(**launch_args)
        self.context = await self.browser.new_context(
            **device,
            locale="en-US",
            timezone_id="America/New_York",
            permissions=["geolocation"],
            java_script_enabled=True,
            bypass_csp=True
        )
        await self.context.grant_permissions(["geolocation"], origin=START_SITE)
        
        self.page = await self.context.new_page()
        # No longer need to apply stealth here, context manager handles it
        await self._configure_network_blocker(self.page)

        try:
            self.logger.info(f"🚀 Starting automation at: {START_SITE}")
            await self.page.goto(START_SITE, wait_until="domcontentloaded", timeout=60000)

            await self._open_random_download_post(self.page)
            
            max_iterations, stuck_iterations = 15, 0
            for i in range(max_iterations):
                if self.page.is_closed():
                    self.logger.warning("Page was closed unexpectedly."); break

                if self.page.url != self.current_url:
                    self.current_url, stuck_iterations = self.page.url, 0
                    self._reset_page_state()
                    self.logger.info(f"🌍 Page loaded: {self.current_url}")
                    if "webdb.store" in self.current_url:
                        self.logger.info("🛑 Reached 'webdb.store', stopping this flow."); break

                await self._human_like_scroll(self.page)
                await self._human_like_delay(1000, 2000)
                
                action_taken = False
                search_contexts = [self.page] + self.page.frames
                self.logger.info(f"Searching for actions on page and {len(search_contexts) - 1} iframe(s).")

                for search_context in search_contexts:
                    try:
                        dwd_selector = "button:text-matches('download', 'i'), a:text-matches('download', 'i')"
                        verify_selector = "button:text-matches('verify', 'i')"
                        continue_selector = "button:text-matches('continue', 'i')"
                        getlink_selector = "a.get-link"

                        if not self.page_state["dwd_clicked"] and await search_context.locator(dwd_selector).first.is_visible(timeout=500):
                            self.page, self.page_state["dwd_clicked"], action_taken = await self._click_element_human_like(search_context, dwd_selector), True, True
                        elif not self.page_state["verify_clicked"] and await search_context.locator(verify_selector).first.is_visible(timeout=500):
                            self.page, self.page_state["verify_clicked"], action_taken = await self._click_element_human_like(search_context, verify_selector), True, True
                        elif not self.page_state["continue_clicked"] and await search_context.locator(continue_selector).first.is_visible(timeout=500):
                            self.page, self.page_state["continue_clicked"], action_taken = await self._click_element_human_like(search_context, continue_selector), True, True
                        elif not self.page_state["getlink_clicked"] and await search_context.locator(getlink_selector).first.is_visible(timeout=500):
                            self.page, self.page_state["getlink_clicked"], action_taken = await self._click_element_human_like(search_context, getlink_selector), True, True
                            self.logger.info(f"✅ Final link page reached: {self.page.url}"); break
                    except Exception: continue
                    if action_taken: break

                if action_taken: stuck_iterations = 0
                else:
                    stuck_iterations += 1
                    self.logger.info(f"No actionable elements found. Stuck count: {stuck_iterations}")
                    if stuck_iterations >= 3:
                        self.logger.warning("Bot is stuck. Ending flow."); await self._take_screenshot(self.page, "stuck"); break
                
                if self.page_state["getlink_clicked"]: break
                if i == max_iterations - 1: self.logger.warning("Max iterations reached.")

            if self.page_state["getlink_clicked"]: self.logger.info("✅ Automation flow completed successfully.")
            else: self.logger.warning("⚠️ Automation flow finished without reaching the final link.")
        except Exception as e:
            self.logger.error(f"❌ An error occurred: {e}", exc_info=True)
            if self.page and not self.page.is_closed(): await self._take_screenshot(self.page, "error")
        finally:
            self.logger.info("Browser cleanup.")
            if self.browser: await self.browser.close()

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
