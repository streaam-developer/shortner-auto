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

// ================= AROLINKS HARD FIX =================
async function forceArolinks(context, page) {
  // Click Verify button if present
  try {
    await page.waitForSelector('#btn6', { timeout: 5000 });
    await page.click('#btn6');
    log('🔥 Clicked Verify button');
    await sleep(2000); // Wait for action
  } catch (e) {
    // Button not present or not clickable
  }

  // Click Continue button if present
  try {
    await page.waitForSelector('#btn7', { timeout: 5000 });
    await page.click('#btn7');
    log('🔥 Clicked Continue button');
    await sleep(2000); // Wait for navigation
  } catch (e) {
    // Button not present or not clickable
  }

  // Click Get Link button if present
  try {
    await page.waitForSelector('a#get-link', { timeout: 5000 });
    const [newTab] = await Promise.all([
      context.waitForEvent('page'),
      page.click('a#get-link')
    ]);
    log(`🔥 Clicked Get Link button`);
    await newTab.waitForLoadState('domcontentloaded');
    return newTab;
  } catch (e) {
    log('⚠ Get Link button not clickable');
    return null;
  }
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
    await post.click();
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
      dwd.click()
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

      if (url.includes('arolinks.com')) {
        // Advanced click using dispatchEvent
        const verifyClicked = await activePage.evaluate(() => {
          const btn = document.getElementById('btn6');
          if (btn && btn.offsetParent !== null) {
            btn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
            return true;
          }
          return false;
        });
        if (verifyClicked) {
          log('🔥 Dispatched click on Verify button');
          await sleep(2000);
        }

        const continueClicked = await activePage.evaluate(() => {
          const btn = document.getElementById('btn7');
          if (btn && btn.offsetParent !== null) {
            btn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
            return true;
          }
          return false;
        });
        if (continueClicked) {
          log('🔥 Dispatched click on Continue button');
          await sleep(2000);
        }

        const linkClicked = await activePage.evaluate(() => {
          const a = document.querySelector('a#get-link');
          if (a && a.offsetParent !== null) {
            a.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
            return true;
          }
          return false;
        });
        if (linkClicked) {
          log('🔥 Dispatched click on Get Link');
          const newTab = await context.waitForEvent('page');
          activePage = newTab;
          await activePage.waitForLoadState('domcontentloaded');
        }
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
