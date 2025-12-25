const { chromium } = require('playwright');
const fs = require('fs');

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
function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`;
  console.log(line);
  fs.appendFileSync('automation.log', line + '\n');
}

process.on('SIGINT', () => {
  console.log('\n🛑 Graceful shutdown requested...');
  RUNNING = false;
});

// ================= HUMAN BEHAVIOR =================
async function randomMouseMove(page) {
    const viewport = page.viewportSize();
    if (!viewport) return;
    const { width, height } = viewport;
    const moves = 3 + Math.floor(Math.random() * 5);
    for (let i = 0; i < moves; i++) {
        await page.mouse.move(
            Math.random() * width,
            Math.random() * height, 
            { steps: 5 + Math.floor(Math.random() * 10) }
        );
        await sleep(300 + Math.random() * 500);
    }
}

async function randomScroll(page) {
  const times = 1 + Math.floor(Math.random() * 3);
  for (let i = 0; i < times; i++) {
    await page.evaluate(y => window.scrollBy(0, y), 200 + Math.random() * 400);
    await sleep(500 + Math.random() * 800);
  }
}

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
  { label: 'Verify Link onclick', selector: 'button[onclick="scrol()":has-text("Verify Link")', force: true },
  { label: 'Go Next', selector: 'button:has-text("Go Next")' },
  { label: 'Get Link btn6 color-11', selector: 'button#btn6.btn-hover.color-11:has-text("Get Link")', force: false },
  { label: 'Get Final Link', selector: 'a[id="get-link"]', webdbOnly: true },
];

async function safeClick(page, selector, label, force = false) {
  try {
    const el = page.locator(selector).first();
    await el.waitFor({ timeout: 250 }).catch(() => {});
    if (!(await el.isVisible())) {
      return false; // Element not there, just return. Main loop will retry.
    }

    log(`🚀 Found element: "${label}". Attempting to click...`);
    
    // Clear overlays and enable button
    await page.evaluate(() => {
      document.querySelectorAll('iframe, .modal, .popup, .overlay, .dialog, [class*="modal"], [class*="popup"], [class*="overlay"], [class*="dialog"]').forEach(e => {
        e.style.display = 'none';
        e.style.pointerEvents = 'none';
      });
    });

    const buttonEl = selector.startsWith('a:') ? el.locator('button').first() : el;
    await buttonEl.evaluate(b => {
      b.disabled = false;
      b.removeAttribute('disabled');
      b.removeAttribute('aria-disabled');
      b.style.pointerEvents = 'auto';
      b.style.display = 'block';
      b.classList.remove('disabled');
    });

    log(`... Button for "${label}" forcibly enabled, waiting 0.5s for JS.`);
    await sleep(500);
    await el.scrollIntoViewIfNeeded();

    // Try multiple click methods
    const clickMethods = [
      { name: 'DOM evaluate', method: () => el.evaluate(n => n.click()) },
      { name: 'Playwright force', method: () => el.click({ force: true, timeout: 2000 }) },
      { name: 'Playwright race', method: () => Promise.race([ el.click({ timeout: 2000 }), page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 3000 }) ]) },
      { name: 'Dispatch event', method: () => el.dispatchEvent('click') },
    ];

    for (const { name, method } of clickMethods) {
      try {
        await method();
        log(`✓ Clicked "${label}" using: ${name}`);
        await sleep(1500); // Wait for navigation
        return true;
      } catch (e) {
        // Log quietly as this is an expected failure during the try-catch loop
      }
    }

    log(`❌ All click methods failed for "${label}".`);
    return false;

  } catch (err) {
    if (err.message.includes('Execution context was destroyed')) {
      log(`"${label}" click caused navigation (safe).`);
      return true; // Navigation is a success
    }
    log(`🚨 Error in safeClick for "${label}": ${err.message.split('\n')[0]}`);
    return false;
  }
}

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
            
            await randomMouseMove(activePage);

            let clickedSomething = false;
            for (const config of CLICK_SELECTORS) {
                const isArolinks = url.includes('arolinks.com');
                const isWebdb = url.includes('webdb.store');

                if ((config.arolinksOnly && !isArolinks) || (config.webdbOnly && !isWebdb)) {
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
                    if (config.webdbOnly) {
                        log('Final link page reached. Waiting before exit.');
                        await sleep(WAIT_AFTER_WEBDB);
                        return; // Exit loop
                    }
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
  
  const page = await context.newPage();

  try {
    SESSION_COUNT++;
    log(`▶ SESSION ${SESSION_COUNT} START`);

    await page.goto(HOME_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
    log('Home opened');
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
    
    const [newTab] = await Promise.all([
      context.waitForEvent('page'),
      dwd.click()
    ]);
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
