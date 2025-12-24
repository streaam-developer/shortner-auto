const { chromium } = require('playwright');
const axios = require('axios');
const fs = require('fs');

const HOME_URL = 'https://yomovies.delivery';
const WAIT_AFTER_WEBDB = 5000;
const POLL_INTERVAL = 1000;

const USE_PROXY = false;   // true = enable proxy
const HEADLESS = false;   // true = headless

// ================= PROXY CONFIG =================
const PROXIES = [
  'http://user:pass@45.90.12.22:8000'
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
    return { timezone: 'UTC', locale: 'en-US' };
  }

  try {
    const p = proxy.split('@').pop();
    const [host, port] = p.split(':');

    const res = await axios.get('http://ip-api.com/json', {
      proxy: { protocol: 'http', host, port },
      timeout: 8000
    });

    const d = res.data;
    return {
      timezone: d.timezone,
      locale: d.countryCode === 'IN' ? 'en-IN' : 'en-US',
      lat: d.lat,
      lon: d.lon
    };
  } catch {
    return { timezone: 'UTC', locale: 'en-US' };
  }
}

// ================= STEALTH SCRIPT =================
const stealthScript = `
Object.defineProperty(navigator, 'webdriver', { get: () => false });
window.chrome = { runtime: {} };
Object.defineProperty(navigator, 'languages', { get: () => ['en-US','en'] });
Object.defineProperty(navigator, 'plugins', { get: () => [1,2,3,4,5] });

const gl = WebGLRenderingContext.prototype.getParameter;
WebGLRenderingContext.prototype.getParameter = function(p){
  if (p === 37445) return 'Intel Inc.';
  if (p === 37446) return 'Intel Iris OpenGL';
  return gl.call(this, p);
};
`;

// ================= ULTIMATE CLICKER =================
async function clickButton(button, options = {}) {
  const { expectNewPage = false, context } = options;
  const page = button.page();

  const attack = async () => {
    await button.evaluate(el => {
      el.disabled = false;
      el.style.display = 'block';
      el.style.visibility = 'visible';
      el.style.opacity = '1';
      el.style.pointerEvents = 'auto';
      el.scrollIntoView({ block: 'center' });
    });

    await page.evaluate(() => {
      document.querySelectorAll('*').forEach(el => {
        const z = getComputedStyle(el).zIndex;
        if (z !== 'auto' && +z > 9999) el.remove();
      });
    });

    await button.evaluate(el => {
      const r = el.getBoundingClientRect();
      const ev = t => new MouseEvent(t, {
        bubbles: true,
        clientX: r.left + r.width/2,
        clientY: r.top + r.height/2
      });
      el.dispatchEvent(ev('mousedown'));
      el.dispatchEvent(ev('mouseup'));
      el.dispatchEvent(ev('click'));
    });

    const onclick = await button.getAttribute('onclick');
    if (onclick) await page.evaluate(code => eval(code), onclick);

    const href = await button.getAttribute('href');
    if (href) await page.evaluate(url => location.href = url, href);
  };

  if (expectNewPage) {
    const [p] = await Promise.all([
      context.waitForEvent('page').catch(() => null),
      attack()
    ]);
    if (p) {
      await p.waitForLoadState('domcontentloaded');
      return p;
    }
    return null;
  } else {
    await attack();
    return null;
  }
}

// ================= FIND & CLICK =================
async function findAndClickButton(page, selectors, opts = {}) {
  for (const sel of selectors) {
    try {
      await page.waitForSelector(sel, { timeout: 2000 });
      const btn = await page.$(sel);
      if (btn) {
        const newPage = await clickButton(btn, {
          expectNewPage: opts.expectNewPage,
          context: page.context()
        });
        return { page: newPage || page, clicked: true };
      }
    } catch {}
  }
  return { page, clicked: false };
}

// ================= SESSION =================
async function runSession() {
  const proxy = USE_PROXY ? getRandomProxy() : null;
  const profile = await getIPProfile(proxy);

  const browser = await chromium.launch({
    headless: HEADLESS,
    proxy: proxy ? { server: proxy } : undefined,
    args: ['--disable-blink-features=AutomationControlled']
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

    await page.goto(HOME_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });

    await page.waitForSelector('article.post h3.entry-title a');
    const post = (await page.$$('article.post h3.entry-title a'))[0];
    await post.click({ force: true });

    await page.waitForSelector('.dwd-button');
    const dwd = (await page.$$('.dwd-button'))[0];

    const [tab] = await Promise.all([
      context.waitForEvent('page'),
      dwd.click({ force: true })
    ]);

    let activePage = tab;
    await activePage.waitForLoadState('domcontentloaded');

    while (RUNNING) {
      if (activePage.url().includes('webdb.store')) {
        await sleep(WAIT_AFTER_WEBDB);
        break;
      }

      if (activePage.url().includes('arolinks.com')) {
        const r = await findAndClickButton(
          activePage,
          ['#btn6', '#btn7', '#get-link', 'button:has-text("Verify")'],
          { expectNewPage: true }
        );
        activePage = r.page;
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
  log('🚀 AUTO STEALTH STARTED');
  while (RUNNING) await runSession();
})();
