import asyncio
import logging
import random
import os
from datetime import datetime
from playwright.async_api import async_playwright, Page, BrowserContext

# ================= CONFIGURATION =================
START_SITE = "https://yomovies.delivery"
MAX_CONCURRENT_INSTANCES = 1  # Number of parallel browsers to run
HEADLESS = False  # Set to True to run without a visible browser window

# --- Proxy Configuration ---
# Proxies are loaded from proxy.txt (format: host:port:user:pass)
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

# ================= LOGGING SETUP =================
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
    """
    An advanced automation bot to navigate a website, handling various steps
    with human-like interaction to avoid detection.
    """
    def __init__(self, bot_id: int, proxy: dict = None):
        self.bot_id = bot_id
        self.proxy = proxy
        self.logger = logging.LoggerAdapter(logging.getLogger(), {'bot_id': f'Bot-{self.bot_id}'})
        
        self.browser = None
        self.context = None
        self.page = None
        
        # State tracking per page/URL
        self.current_url = None
        self.page_state = {}

    def _reset_page_state(self):
        """Resets the state for a new page or URL."""
        self.page_state = {
            "dwd_clicked": False,
            "verify_clicked": False,
            "continue_clicked": False,
            "getlink_clicked": False,
        }

    async def _take_screenshot(self, page: Page, prefix="page"):
        """Takes a screenshot of the current page."""
        try:
            ts = datetime.now().strftime("%Y%m%d_%H%M%S")
            path = os.path.join(SCREENSHOT_DIR, f"{prefix}_{self.bot_id}_{ts}.png")
            await page.screenshot(path=path, full_page=True)
            self.logger.info(f"📸 Screenshot saved: {path}")
        except Exception as e:
            self.logger.error(f"📸 Screenshot failed: {e}")

    async def _human_like_delay(self, min_ms=500, max_ms=1500):
        """Waits for a random duration to mimic human thinking time."""
        await asyncio.sleep(random.uniform(min_ms, max_ms) / 1000)

    async def _human_like_scroll(self, page: Page):
        """Performs a series of small, random scrolls to appear more human."""
        for _ in range(random.randint(1, 3)):
            scroll_amount = random.randint(-150, 300)
            await page.evaluate(f"window.scrollBy(0, {scroll_amount})")
            await self._human_like_delay(100, 300)

    async def _click_element_human_like(self, page: Page, selector: str, new_page_timeout=10000):
        """
        Finds an element, scrolls to it, hovers, and clicks in a human-like manner.
        Handles navigation and checks for special shortener pages.
        """
        try:
            element = page.locator(selector).first
            if not await element.is_visible():
                return page

            self.logger.info(f"Interacting with element: {selector}")
            
            await element.scroll_into_view_if_needed()
            await self._human_like_delay(200, 500)
            
            bounding_box = await element.bounding_box()
            if bounding_box:
                target_x = bounding_box['x'] + bounding_box['width'] * random.uniform(0.3, 0.7)
                target_y = bounding_box['y'] + bounding_box['height'] * random.uniform(0.3, 0.7)
                await page.mouse.move(target_x, target_y, steps=random.randint(5, 15))
                await self._human_like_delay(100, 400)

            async with self.context.expect_page(timeout=new_page_timeout) as new_page_info:
                await element.click()
            
            new_page = await new_page_info.value
            await new_page.wait_for_load_state("domcontentloaded", timeout=30000)
            self.logger.info(f"➡️ New tab opened: {new_page.url}")

            # Check if this new tab is a shortener that needs special handling
            if "readnews18.com" in new_page.url:
                self.logger.info("Shortener page detected, starting special handling...")
                new_page = await self._handle_shortener_tab(new_page)

            await self._take_screenshot(new_page, "new_tab")
            return new_page

        except Exception:
            await page.wait_for_load_state("networkidle", timeout=30000)
            self.logger.info(f"➡️ Navigated on the same tab to: {page.url}")
            await self._take_screenshot(page, "same_tab_nav")
            return page

    async def _handle_shortener_tab(self, page: Page) -> Page:
        """
        Aggressively handles specific shortener pages by waiting for and
        forcefully clicking a sequence of buttons.
        """
        try:
            self.logger.info("Waiting for 'Verify' button (#btn6)...")
            verify_button = page.locator("#btn6")
            await verify_button.wait_for(state="visible", timeout=20000)
            
            self.logger.info("Forcefully clicking 'Verify' button.")
            await verify_button.click(force=True)
            await self._human_like_delay(500, 1000)

            self.logger.info("Waiting for 'Continue' button (#btn7)...")
            continue_button = page.locator("#btn7")
            await continue_button.wait_for(state="visible", timeout=20000)
            
            self.logger.info("Forcefully clicking 'Continue' button.")
            
            # Click and wait for the navigation that should follow
            async with page.expect_navigation(wait_until="domcontentloaded", timeout=15000):
                await continue_button.click(force=True)
            
            self.logger.info(f"Navigation after Continue click successful. New URL: {page.url}")

        except Exception as e:
            self.logger.error(f"❌ Error during shortener handling: {e}")
            await self._take_screenshot(page, "shortener_error")
        
        return page

    async def _open_random_download_post(self, page: Page):
        """Finds and navigates to a random download link on the page."""
        self.logger.info("Searching for a random download post...")
        download_links = await page.locator("a[href*='download']").all()
        
        if not download_links:
            self.logger.error("❌ No download posts found on the main page.")
            raise RuntimeError("No download posts found.")

        random_post = random.choice(download_links)
        href = await random_post.get_attribute('href')
        
        self.logger.info(f"🎯 Navigating to random post: {href}")
        await page.goto(href, wait_until="domcontentloaded")
        await page.wait_for_load_state("networkidle")
        self.logger.info(f"✅ Arrived at post page: {page.url}")
        
    async def run_automation_flow(self, playwright: async_playwright):
        """Main automation logic loop."""
        device = playwright.devices['Pixel 5']

        launch_args = {
            "headless": HEADLESS,
            "args": [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-infobars',
                '--disable-blink-features=AutomationControlled',
                '--ignore-certificate-errors',
                '--disable-extensions',
            ],
            "proxy": self.proxy
        }

        self.browser = await playwright.chromium.launch(**launch_args)
        self.context = await self.browser.new_context(
            **device,
            java_script_enabled=True,
            bypass_csp=True
        )
        self.page = await self.context.new_page()

        try:
            self.logger.info(f"🚀 Starting automation at: {START_SITE}")
            await self.page.goto(START_SITE, wait_until="domcontentloaded", timeout=60000)
            await self.page.wait_for_load_state("networkidle")

            await self._open_random_download_post(self.page)
            
            max_iterations = 15
            stuck_iterations = 0

            for i in range(max_iterations):
                if self.page.is_closed():
                    self.logger.warning("Page was closed unexpectedly.")
                    break

                if self.page.url != self.current_url:
                    self.current_url = self.page.url
                    self._reset_page_state()
                    stuck_iterations = 0
                    self.logger.info(f"🌍 Page loaded: {self.current_url}")
                    
                    if "webdb.store" in self.current_url:
                        self.logger.info("🛑 Reached 'webdb.store', stopping this flow.")
                        break

                await self._human_like_scroll(self.page)
                await self._human_like_delay(1000, 2000)
                
                action_taken = False
                
                # We search both the main page and all of its iframes
                search_contexts = [self.page] + self.page.frames
                self.logger.info(f"Searching for actions on page and {len(search_contexts) - 1} iframe(s).")

                for search_context in search_contexts:
                    try:
                        # More robust selectors to find the target buttons
                        dwd_selector = "button:text-matches('download', 'i'), a:text-matches('download', 'i')"
                        verify_selector = "button:text-matches('verify', 'i')"
                        continue_selector = "button:text-matches('continue', 'i')"
                        getlink_selector = "a.get-link"

                        if not self.page_state["dwd_clicked"] and await search_context.locator(dwd_selector).first.is_visible(timeout=500):
                            self.page = await self._click_element_human_like(search_context, dwd_selector)
                            self.page_state["dwd_clicked"] = True
                            action_taken = True
                        
                        elif not self.page_state["verify_clicked"] and await search_context.locator(verify_selector).first.is_visible(timeout=500):
                            self.page = await self._click_element_human_like(search_context, verify_selector)
                            self.page_state["verify_clicked"] = True
                            action_taken = True

                        elif not self.page_state["continue_clicked"] and await search_context.locator(continue_selector).first.is_visible(timeout=500):
                            self.page = await self._click_element_human_like(search_context, continue_selector)
                            self.page_state["continue_clicked"] = True
                            action_taken = True
                        
                        elif not self.page_state["getlink_clicked"] and await search_context.locator(getlink_selector).first.is_visible(timeout=500):
                            self.page = await self._click_element_human_like(search_context, getlink_selector)
                            self.page_state["getlink_clicked"] = True
                            action_taken = True
                            self.logger.info(f"✅ Final link page reached: {self.page.url}")
                            break

                    except Exception:
                        # This is expected if the element is not in the current frame
                        continue
                    
                    if action_taken:
                        break # Exit the frame search loop once an action is taken

                if action_taken:
                    stuck_iterations = 0 # Reset stuck counter if we made progress
                else:
                    stuck_iterations += 1
                    self.logger.info(f"No actionable elements found. Stuck count: {stuck_iterations}")
                    if stuck_iterations >= 3:
                        self.logger.warning("Bot is stuck on this page. Ending flow.")
                        await self._take_screenshot(self.page, "stuck")
                        break
                
                if self.page_state["getlink_clicked"]:
                    break

                if i == max_iterations - 1:
                    self.logger.warning("Max iterations reached without finding the final link.")

            if self.page_state["getlink_clicked"]:
                self.logger.info("✅ Automation flow completed successfully.")
            else:
                self.logger.warning("⚠️ Automation flow finished without reaching the final link.")

        except Exception as e:
            self.logger.error(f"❌ An error occurred during the automation flow: {e}", exc_info=True)
            if self.page and not self.page.is_closed():
                await self._take_screenshot(self.page, "error")
        finally:
            self.logger.info("Browser cleanup.")
            if self.browser:
                await self.browser.close()

async def main():
    """Initializes and runs all automation bots concurrently."""
    async with async_playwright() as playwright:
        tasks = []
        active_proxies = proxies if USE_PROXY else [None] * MAX_CONCURRENT_INSTANCES

        for i in range(min(MAX_CONCURRENT_INSTANCES, len(active_proxies))):
            proxy = active_proxies[i] if USE_PROXY else None
            bot = AutomationBot(bot_id=i+1, proxy=proxy)
            tasks.append(bot.run_automation_flow(playwright))
        
        await asyncio.gather(*tasks)

if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print("\n🛑 Program interrupted by user.")