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

    async def _click_element_human_like(self, page: Page, selector: str, new_page_timeout=7000):
        """
        Finds an element, scrolls to it, hovers, and clicks in a human-like manner.
        Handles navigation that opens in a new tab.
        """
        try:
            element = page.locator(selector).first
            if not await element.is_visible():
                return page

            self.logger.info(f"Interacting with element: {selector}")
            
            # Human-like interaction
            await element.scroll_into_view_if_needed()
            await self._human_like_delay(200, 500)
            
            # Move mouse over the element
            bounding_box = await element.bounding_box()
            if bounding_box:
                target_x = bounding_box['x'] + bounding_box['width'] * random.uniform(0.3, 0.7)
                target_y = bounding_box['y'] + bounding_box['height'] * random.uniform(0.3, 0.7)
                await page.mouse.move(target_x, target_y, steps=random.randint(5, 15))
                await self._human_like_delay(100, 400)

            # Perform the click and handle potential new tabs
            async with self.context.expect_page(timeout=new_page_timeout) as new_page_info:
                await element.click()
            
            new_page = await new_page_info.value
            await new_page.wait_for_load_state("domcontentloaded", timeout=30000)
            self.logger.info(f"➡️ New tab opened: {new_page.url}")
            await self._take_screenshot(new_page, "new_tab")
            
            # Close the old page to save resources
            # await page.close() 
            return new_page

        except Exception:
            # Fallback for same-tab navigation or if new tab logic fails
            await page.wait_for_load_state("networkidle", timeout=30000)
            self.logger.info(f"➡️ Navigated on the same tab to: {page.url}")
            await self._take_screenshot(page, "same_tab_nav")
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
        
    async def run_automation_flow(self):
        """Main automation logic loop."""
        p = await async_playwright().start()
        
        user_agents = [
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36",
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36",
        ]
        
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

        self.browser = await p.chromium.launch(**launch_args)
        self.context = await self.browser.new_context(
            user_agent=random.choice(user_agents),
            viewport={'width': 1280, 'height': 720},
            java_script_enabled=True,
            bypass_csp=True
        )
        self.page = await self.context.new_page()

        try:
            self.logger.info(f"🚀 Starting automation at: {START_SITE}")
            await self.page.goto(START_SITE, wait_until="domcontentloaded", timeout=60000)
            await self.page.wait_for_load_state("networkidle")

            await self._open_random_download_post(self.page)
            
            # Main loop
            for _ in range(10): # Limit loops to prevent infinite runs
                if self.page.url != self.current_url:
                    self.current_url = self.page.url
                    self._reset_page_state()
                    self.logger.info(f"🌍 Page loaded: {self.current_url}")
                    
                    if "webdb.store" in self.current_url:
                        self.logger.info("🛑 Reached 'webdb.store', stopping this flow.")
                        break

                await self._human_like_scroll(self.page)
                await self._human_like_delay(1000, 2000)
                
                # Sequentially try to click buttons based on state
                if not self.page_state["dwd_clicked"]:
                    self.page = await self._click_element_human_like(
                        self.page, 
                        "button:text-matches('download', 'i')"
                    )
                    self.page_state["dwd_clicked"] = True
                    continue

                if not self.page_state["verify_clicked"]:
                    self.page = await self._click_element_human_like(
                        self.page, 
                        "button:text-matches('verify', 'i')"
                    )
                    self.page_state["verify_clicked"] = True
                    continue

                if not self.page_state["continue_clicked"]:
                    self.page = await self._click_element_human_like(
                        self.page,
                        "button:text-matches('continue', 'i')"
                    )
                    self.page_state["continue_clicked"] = True
                    continue
                
                if not self.page_state["getlink_clicked"]:
                    self.page = await self._click_element_human_like(
                        self.page,
                        "a.get-link"
                    )
                    self.page_state["getlink_clicked"] = True
                    self.logger.info(f"✅ Final link page reached: {self.page.url}")
                    break # End of this flow
            
            self.logger.info("✅ Automation flow completed.")

        except Exception as e:
            self.logger.error(f"❌ An error occurred: {e}", exc_info=True)
            await self._take_screenshot(self.page, "error")
        finally:
            self.logger.info("Browser cleanup.")
            if self.browser:
                await self.browser.close()
            await p.stop()

async def main():
    """Initializes and runs all automation bots concurrently."""
    tasks = []
    active_proxies = proxies if USE_PROXY else [None] * MAX_CONCURRENT_INSTANCES

    for i in range(min(MAX_CONCURRENT_INSTANCES, len(active_proxies))):
        proxy = active_proxies[i] if USE_PROXY else None
        bot = AutomationBot(bot_id=i+1, proxy=proxy)
        tasks.append(bot.run_automation_flow())
    
    await asyncio.gather(*tasks)

if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print("\n🛑 Program interrupted by user.")