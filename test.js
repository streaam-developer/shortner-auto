const { chromium } = require('playwright');
const axios = require('axios');
const fs = require('fs');

const HOME_URL = 'https://yomovies.delivery';
const WAIT_AFTER_WEBDB = 5000;
const POLL_INTERVAL = 1000;

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
  const href = await page.evaluate(() => {
    const a = document.querySelector('a#get-link');
    if (!a) return null;
    a.style.pointerEvents = 'auto';
    a.style.display = 'block';
    return a.href;
  });

  if (!href) return null;

  log(`🔥 FORCE OPEN → ${href}`);

  const [newTab] = await Promise.all([
    context.waitForEvent('page').catch(() => null),
    page.evaluate(u => window.open(u, '_blank'), href)
  ]);

  if (newTab) {
    await newTab.waitForLoadState('domcontentloaded');
    return newTab;
  }

  await page.goto(href, { waitUntil: 'domcontentloaded' });
  return page;
}

// ================= SESSION =================
async function runSession() {
  const proxy = getRandomProxy();
  const profile = await getIPProfile(proxy);

  const browser = await chromium.launch({
    headless: true,
    args: ['--disable-blink-features=AutomationControlled'],
    proxy: { server: proxy }
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

    await page.goto(HOME_URL, { waitUntil: 'domcontentloaded' });

    const post = (await page.$$('article.post h3.entry-title a'))[0];
    await post.click();
    await page.waitForLoadState('networkidle');

    const dwd = (await page.$$('.dwd-button'))[0];
    const [tab] = await Promise.all([
      context.waitForEvent('page'),
      dwd.click()
    ]);

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
        const np = await forceArolinks(context, activePage);
        if (np) activePage = np;
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
