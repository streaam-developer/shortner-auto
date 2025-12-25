const { chromium } = require('playwright');
const fs = require('fs');
const {
    sleep,
    log,
    getRandomReferrer,
    randomMouseMove,
    randomScroll,
    safeClick,
} = require('./utils.js');

const HOME_URL = 'https://yomovies.delivery';
const WAIT_AFTER_WEBDB = 5000;
const POLL_INTERVAL = 1000;

// ================= PROXY CONFIG =================
const PROXY_ENABLED = true; // true to enable
const PROXIES = fs.readFileSync('proxy.txt', 'utf8')
  .split('\n')
  .map(line => line.trim())
  .filter(line => line)
  .map(line => {
    const [ip, port, user, pass] = line.split(':');
    return `http://${user}:${pass}@${ip}:${port}`;
  });

function getRandomProxy() {
  if (!PROXY_ENABLED || !PROXIES.length) return null;
  return PROXIES[Math.floor(Math.random() * PROXIES.length)];
}

// ================= GLOBAL =================
let RUNNING = true;
let SESSION_COUNT = 0;

// ================= UTIL =================
process.on('SIGINT', () => {
  console.log('\n🛑 Graceful shutdown requested...');
  RUNNING = false;
});

// ================= CLICK LOGIC =================

// This array centralizes all the selectors the bot will try to click.
const CLICK_SELECTORS = [
  { label: 'Click Here', selector: 'a:has-text("click here")', force: true },
  { label: 'Get Link', selector: 'button[id="get-link"]', arolinksOnly: true, handleNewTab: true, force: false },
  { label: 'Verify', selector: 'button.ce-btn.ce-blue:has-text("Verify")' },
  { label: 'Continue', selector: 'button:has-text("Continue")' },
  { label: 'Force Continue', selector: 'button#cross-snp2.ce-btn.ce-blue' },
  { label: 'Continue btn6 color-9', selector: 'button#btn6.btn-hover.color-9:has-text("Continue")' },
  { label: 'Continue Next', selector: 'button#btn6.btn-hover.color-11:has-text("Continue Next")' },
  { label: 'Verify Link onclick', selector: 'button[onclick="scrol()"]:has-text("Verify Link")', force: true },
  { label: 'Go Next', selector: 'button:has-text("Go Next")' },
  { label: 'Get Link btn6 color-11', selector: 'button#btn6.btn-hover.color-11:has-text("Get Link")', force: false },
];

// ================= POST PICKER =================
async function pickRandomPost(page) {
  await page.waitForLoadState('domcontentloaded');
  const posts = await page.locator('article.post h3.entry-title a').all();
  if (!posts.length) throw new Error('No posts found on homepage.');
  log(`Found ${posts.length} posts.`);
  return posts[Math.floor(Math.random() * posts.length)];
}

// ================= MAIN BOT LOGIC =================
async function handleClicks(page, context) {
    let activePage = page;
    while (RUNNING) {
        try {
            const url = activePage.url();
            log(`Current URL: ${url}`);
            
            if (url.includes('webdb.store')) {
                log('webdb.store page reached. Short link obtained: ' + url);
                fs.appendFileSync('short_links.txt', url + '\n');
                await sleep(WAIT_AFTER_WEBDB);
                return; // Exit handleClicks, which will lead to session close.
            }

            await randomMouseMove(activePage);

            let clickedSomething = false;
            for (const config of CLICK_SELECTORS) {
                const isArolinks = url.includes('arolinks.com');
                
                if (config.arolinksOnly && !isArolinks) {
                    continue;
                }
                
                const forceClick = config.force === undefined ? !isArolinks : config.force;

                let success = false;
                if (config.handleNewTab) {
                    const [newTab] = await Promise.all([
                        context.waitForEvent('page', { timeout: 5000 }).catch(() => null),
                        safeClick(activePage, config.selector, config.label, forceClick)
                    ]);
                    if (newTab) {
                        await newTab.waitForLoadState('domcontentloaded');
                        if (activePage !== page && !activePage.isClosed()) await activePage.close();
                        activePage = newTab;
                        log(`Switched to new tab for "${config.label}"`);
                        success = true;
                    }
                } else {
                    success = await safeClick(activePage, config.selector, config.label, forceClick);
                }

                if (success) {
                    clickedSomething = true;
                    break; 
                }
            }

            if (clickedSomething) {
                await sleep(POLL_INTERVAL);
            } else {
                log('No clickable elements found in this cycle. Waiting...');
                await sleep(POLL_INTERVAL);
            }
            
        } catch (err) {
            if (err.message.includes('Target page, context or browser has been closed')) {
                log('Page closed, ending session.');
                break;
            }
             if (err.message.includes('Execution context was destroyed')) {
                log('Navigation detected, continuing loop...');
                await sleep(1000);
                continue;
            }
            throw err;
        }
    }
}

async function runSession() {
  const proxy = getRandomProxy();
  const browser = await chromium.launch({
    headless: false,
    args: ['--disable-blink-features=AutomationControlled'],
    proxy: proxy ? { server: proxy.split('@')[0], bypass: `*.delivery, *.store` } : undefined,
  });

  if (proxy) log(`Using proxy: ${proxy.split('@')[1]}`);

  const context = await browser.newContext({
    viewport: { width: 360, height: 740 },
    isMobile: true,
    hasTouch: true,
    userAgent: 'Mozilla/5.0 (Linux; Android 12; Mobile) AppleWebKit/537.36 Chrome/120.0.0.0 Mobile Safari/537.36',
    geolocation: proxy ? { latitude: 19.0760, longitude: 72.8777 } : undefined,
    locale: proxy ? 'en-IN' : undefined,
    timezoneId: proxy ? 'Asia/Kolkata' : undefined,
    permissions: proxy ? ['geolocation'] : [],
  });
  
  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', {
      get: () => false,
    });
  });
  log('Stealth: navigator.webdriver set to false.');
  
  const page = await context.newPage();

  try {
    SESSION_COUNT++;
    log(`▶ SESSION ${SESSION_COUNT} START`);

    const referrer = getRandomReferrer();
    await page.setExtraHTTPHeaders({ 'Referer': referrer });

    await page.goto(HOME_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
    
    await page.setExtraHTTPHeaders({}); // Reset headers
    log(`Home opened (referrer: ${referrer})`);
    await randomScroll(page);

    const post = await pickRandomPost(page);
    await post.click();
    await page.waitForLoadState('networkidle', { timeout: 60000 });
    log('Random post opened');
    await randomScroll(page);
    
    await page.waitForSelector('.dwd-button', { timeout: 10000 });
    const dwdButtons = await page.locator('.dwd-button').all();
    if (!dwdButtons.length) throw new Error('No dwd-button found');
    const dwd = dwdButtons[Math.floor(Math.random() * dwdButtons.length)];
    
    log('Found DWD button. Attempting a more human-like click...');
    await dwd.scrollIntoViewIfNeeded();
    await randomMouseMove(page);

    // Forcibly enable the button, as some sites use disabled attribute
    await dwd.evaluate(b => {
        b.disabled = false;
        b.removeAttribute('disabled');
        b.style.pointerEvents = 'auto';
    });
    await sleep(200); // Brief pause

    let newTab = null;

    // Try to click and get the new tab
    try {
        const [tab] = await Promise.all([
            context.waitForEvent('page', { timeout: 7000 }),
            dwd.click({ delay: 100 + Math.random() * 100 }) // add a small random delay
        ]);
        newTab = tab;
    } catch(e) {
        log(`Standard DWD click failed: ${e.message}. Trying evaluate click...`);
        // If standard click fails or times out, try the evaluate method
        const [tab] = await Promise.all([
            context.waitForEvent('page', { timeout: 7000 }),
            dwd.evaluate(n => n.click())
        ]);
        newTab = tab;
    }

    if (!newTab) {
        throw new Error('DWD click did not result in a new tab.');
    }

    await newTab.waitForLoadState('domcontentloaded');
    log('DWD clicked → new tab');
    if (!page.isClosed()) await page.close();

    await handleClicks(newTab, context);

  } catch (err) {
    log(`❌ REAL ERROR in Session ${SESSION_COUNT}: ${err.stack}`);
    try { 
        const screenshotPath = `fatal-${Date.now()}.png`;
        await page.screenshot({ path: screenshotPath });
        log(`📸 Screenshot saved to ${screenshotPath}`);
    } catch (e) {
        log(`📸 Screenshot failed: ${e.message}`);
    }
  } finally {
    if (browser) await browser.close();
    log(`⏹ SESSION ${SESSION_COUNT} CLOSED`);
  }
}

// ================= RUNNER =================
(async () => {
  log('🚀 Automation starting...');
  while (RUNNING) {
    await runSession();
    if (RUNNING) {
      log(`Session finished. Waiting 30s before next run...`);
      await sleep(30000);
    }
  }
  log('🛑 Automation stopped cleanly.');
})();