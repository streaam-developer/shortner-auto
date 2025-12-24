const { chromium } = require('playwright');
const axios = require('axios');
const fs = require('fs');

const HOME_URL = 'https://yomovies.delivery';
const WAIT_AFTER_WEBDB = 5000;
const POLL_INTERVAL = 1000;
const USE_PROXY = false; // Set to false to disable proxy usage
const HEADLESS = false; // Set to false to run in visible mode

// ================= PROXY CONFIG =================
const PROXIES = [
  'http://user:pass@45.90.12.22:8000',
  // add more if you want
];

function getRandomProxy() {
  return PROXIES[Math.floor(Math.random() * PROXIES.length)];
}

// ================= GLOBAL =================
let RUNNING = true;
let SESSION_COUNT = 0;

// ================= UTILS =================
const sleep = ms => new Promise(r => setTimeout(r, ms));

function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`;
  console.log(line);
  fs.appendFileSync('automation.log', line + '\n');
}

process.on('SIGINT', () => {
  console.log('\n🛑 Graceful shutdown...');
  RUNNING = false;
});

// ================= IP → FINGERPRINT =================
async function getIPProfile(proxy) {
  if (!proxy) {
    log('🌍 No proxy, using default profile');
    return {
      timezone: 'UTC',
      locale: 'en-US'
    };
  }

  try {
    const res = await axios.get('http://ip-api.com/json', {
      proxy: {
        protocol: 'http',
        host: proxy.split('@').pop().split(':')[0],
        port: proxy.split(':').pop(),
        auth: proxy.includes('@')
          ? {
              username: proxy.split('//')[1].split(':')[0],
              password: proxy.split('//')[1].split(':')[1].split('@')[0]
            }
          : undefined
      },
      timeout: 8000
    });

    const d = res.data;

    log(`🌍 IP detected: ${d.country} | ${d.city} | ${d.timezone}`);

    return {
      country: d.countryCode,
      timezone: d.timezone,
      lat: d.lat,
      lon: d.lon,
      locale: d.countryCode === 'IN' ? 'en-IN'
            : d.countryCode === 'US' ? 'en-US'
            : 'en-US'
    };
  } catch (e) {
    log('⚠ IP lookup failed, using safe defaults');
    return {
      timezone: 'UTC',
      locale: 'en-US'
    };
  }
}

// ================= STEALTH =================
const stealthScript = `
Object.defineProperty(navigator, 'webdriver', { get: () => false });
window.chrome = { runtime: {} };
Object.defineProperty(navigator, 'languages', {
  get: () => ['en-US','en']
});
Object.defineProperty(navigator, 'plugins', {
  get: () => [1,2,3,4,5]
});
const getParameter = WebGLRenderingContext.prototype.getParameter;
WebGLRenderingContext.prototype.getParameter = function(p){
  if (p === 37445) return 'Intel Inc.';
  if (p === 37446) return 'Intel Iris OpenGL Engine';
  return getParameter.call(this, p);
};
`;



// ================= ADVANCED BUTTON CLICKER =================

/**
 * Clicks a button and optionally waits for a new page to open.
 * @param {import('playwright').ElementHandle} button - The button element to click.
 * @param {Object} [options]
 * @param {boolean} [options.expectNewPage=false] - Whether to wait for a new page to open.
 * @param {import('playwright').BrowserContext} [options.context] - The browser context, required if expectNewPage is true.
 * @returns {Promise<import('playwright').Page|null>} - The new page if one opened, otherwise null.
 */
async function clickButton(button, options = {}) {
  const { expectNewPage = false, context } = options;
  if (expectNewPage && !context) {
    throw new Error('Browser context must be provided when expecting a new page.');
  }

  log(`🔥 Clicking button with selector...`);

  if (expectNewPage) {
    const page = button.page();
    const [newPage] = await Promise.all([
      page.context().waitForEvent('page'),
      button.click({ force: true }),
    ]);
    await newPage.waitForLoadState('domcontentloaded');
    log(`🔥 Clicked button and switched to new tab: ${newPage.url()}`);
    return newPage;
  } else {
    await button.click({ force: true });
    log('🔥 Clicked button.');
    await button.page().waitForTimeout(2000); // Wait for action
    return null;
  }
}

/**
 * Finds and clicks a button based on a list of selectors, with advanced options.
 * This is the "Most Advance and Advance Button Clicker".
 * It can search in the main page and also inside iframes.
 *
 * @param {import('playwright').Page} page - The page to search on.
 * @param {string[]} selectors - An array of selectors to try.
 * @param {Object} [options]
 * @param {number} [options.timeout=5000] - Timeout in ms to find the button.
 * @param {boolean} [options.expectNewPage=false] - Whether to wait for a new page to open.
 * @returns {Promise<{page: import('playwright').Page, clicked: boolean}>} - The new active page and whether a button was clicked.
 */
async function findAndClickButton(page, selectors, options = {}) {
  const { timeout = 5000, expectNewPage = false } = options;
  const context = page.context();

  let buttonClicked = false;
  let activePage = page;

  for (const selector of selectors) {
    let button = null;

    // Search on the main page
    try {
      await page.waitForSelector(selector, { timeout, state: 'visible' });
      button = await page.$(selector);
      if (button) {
        log(`🔍 Found button with selector "${selector}" on the main page.`);
        const newPage = await clickButton(button, { expectNewPage, context });
        if (newPage) {
          activePage = newPage;
        }
        buttonClicked = true;
        break; // Exit loop once a button is clicked
      }
    } catch (e) {
      // Not found on main page, continue
    }

    // Search in iframes
    if (!button) {
      for (const frame of page.frames()) {
        try {
          // Shorter timeout for frames to avoid long waits
          await frame.waitForSelector(selector, { timeout: 1000, state: 'visible' });
          button = await frame.$(selector);
          if (button) {
            log(`🔍 Found button with selector "${selector}" in an iframe.`);
            const newPage = await clickButton(button, { expectNewPage, context });
            if (newPage) {
              activePage = newPage;
            }
            buttonClicked = true;
            break; // Exit inner frame loop
          }
        } catch (e) {
          // Not found in this frame, continue
        }
      }
    }
    if(buttonClicked) break; // Exit outer selector loop
  }

  if (!buttonClicked) {
    log(`🤷 Button with selectors [${selectors.join(', ')}] not found.`);
  }

  return { page: activePage, clicked: buttonClicked };
}

// ================= SESSION =================
async function runSession() {
  const proxy = USE_PROXY ? getRandomProxy() : null;
  log(`🔗 Proxy: ${proxy ? proxy : 'Disabled'}`);
  const profile = await getIPProfile(proxy);

  const browser = await chromium.launch({
    headless: HEADLESS,
    args: ['--disable-blink-features=AutomationControlled'],
    proxy: proxy ? { server: proxy } : undefined
  });

  const context = await browser.newContext({
    viewport: { width: 360, height: 740 },
    isMobile: true,
    hasTouch: true,
    locale: profile.locale,
    timezoneId: profile.timezone,
    geolocation: profile.lat ? { latitude: profile.lat, longitude: profile.lon } : undefined,
    permissions: profile.lat ? ['geolocation'] : [],
    userAgent:
      'Mozilla/5.0 (Linux; Android 12) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36'
  });

  await context.addInitScript(stealthScript);

  const page = await context.newPage();

  try {
    SESSION_COUNT++;
    log(`▶ SESSION ${SESSION_COUNT} START`);

    let retries = 3;
    for (let i = 0; i < retries; i++) {
      try {
        await page.goto(HOME_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
        log(`✅ Navigated to ${HOME_URL}`);
        break;
      } catch (e) {
        if (i === retries - 1) throw e;
        log(`Retry ${i+1} failed: ${e.message}`);
        await sleep(5000);
      }
    }

    await page.waitForSelector('article.post h3.entry-title a');
    const post = (await page.$$('article.post h3.entry-title a'))[0];
    if (!post) throw new Error('Post link not found');
    const postTitle = await post.innerText();
    const postHref = await post.getAttribute('href');
    log(`📄 Clicking on post: "${postTitle}" (${postHref})`);
    await post.scrollIntoViewIfNeeded();
    await post.click({ force: true });
    await page.waitForLoadState('networkidle');
    log(`📍 Current page: ${page.url()}`);

    await page.waitForSelector('.dwd-button');
    const dwd = (await page.$$('.dwd-button'))[0];
    if (!dwd) throw new Error('Download button not found');
    const dwdText = await dwd.innerText();
    log(`⬇️ Clicking download button: "${dwdText}"`);
    await dwd.scrollIntoViewIfNeeded();
    const [tab] = await Promise.all([
      context.waitForEvent('page'),
      dwd.click({ force: true })
    ]);
    log(`📍 New tab opened: ${tab.url()}`);

    let activePage = tab;
    await activePage.waitForLoadState('domcontentloaded');

    while (RUNNING) {
      const url = activePage.url();

      if (url.includes('webdb.store')) {
        log('✅ webdb.store reached');
        await sleep(WAIT_AFTER_WEBDB);
        break;
      }

      // A more aggressive loop for arolinks
      while (activePage.url().includes('arolinks.com') && RUNNING) {
        log('🕵️‍♂️ arolinks.com detected, searching for buttons...');
        const result = await findAndClickButton(
          activePage,
          ['#btn6', '#btn7', 'a#get-link'],
          { expectNewPage: true }
        );

        // Update the active page, which might have changed
        activePage = result.page;

        // If no button was clicked in this iteration, wait a bit before retrying
        if (!result.clicked) {
          await sleep(POLL_INTERVAL);
        }
        // If a button was clicked, loop immediately to check the new page state
      }

      await sleep(POLL_INTERVAL);
    }

  } catch (e) {
    log(`❌ ERROR: ${e.message}`);
  } finally {
    await context.close();
    await browser.close();
    log(`⏹ SESSION ${SESSION_COUNT} CLOSED`);
  }
}

// ================= RUNNER =================
(async () => {
  log('🚀 AUTO-FINGERPRINT STEALTH MODE STARTED');
  while (RUNNING) await runSession();
})();
