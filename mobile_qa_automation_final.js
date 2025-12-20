const { chromium } = require('playwright');
const fs = require('fs');

const HOME_URL = 'https://yomovies.delivery';
const WAIT_AFTER_WEBDB = 5000;

const ALLOWED_DOMAINS = [
  'yomovies.delivery',
  'arolinks.com',
  'webdb.store',
  'readnews18.com'
];

let RUNNING = true;
let SESSION_COUNT = 0;

// ================= UTILITIES =================

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

function randomDelay(min = 1500, max = 4000) {
  return sleep(min + Math.random() * (max - min));
}

function log(step) {
  const msg = `[${new Date().toISOString()}] ${step}`;
  console.log(msg);
  fs.appendFileSync('automation.log', msg + '\n');
}

function domainAllowed(url) {
  return ALLOWED_DOMAINS.some(d => url.includes(d));
}

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n🛑 Graceful shutdown requested...');
  RUNNING = false;
});

// ================= POST PICKER =================

async function pickRandomPost(page) {
  await page.waitForLoadState('domcontentloaded');

  // 🔥 EXACT selector based on your HTML
  const posts = await page.$$('article.post h3.entry-title a');

  if (!posts.length) {
    throw new Error('No posts found using article.post h3.entry-title a');
  }

  log(`Found ${posts.length} posts on page`);

  return posts[Math.floor(Math.random() * posts.length)];
}

// ================= CORE SESSION =================

async function runSession() {
  const browser = await chromium.launch({ headless: false });

  const context = await browser.newContext({
    viewport: { width: 360, height: 740 },
    isMobile: true,
    hasTouch: true,
    userAgent:
      'Mozilla/5.0 (Linux; Android 12; Mobile) AppleWebKit/537.36 Chrome/120.0.0.0 Mobile Safari/537.36'
  });

  const page = await context.newPage();

  try {
    SESSION_COUNT++;
    log(`▶ SESSION ${SESSION_COUNT} STARTED`);

    // 1️⃣ Open home
    await page.goto(HOME_URL, { waitUntil: 'domcontentloaded' });
    log('Home opened');
    await randomDelay();

    // 2️⃣ Open random post (CLASS-BASED)
    const post = await pickRandomPost(page);
    await post.click();
    await page.waitForLoadState('domcontentloaded');
    log('Random post opened');
    await randomDelay();

    // 3️⃣ Random dwd-button
    const dwdButtons = await page.$$('.dwd-button');
    if (!dwdButtons.length) throw new Error('No dwd-button found');

    const dwd = dwdButtons[Math.floor(Math.random() * dwdButtons.length)];

    const [newTab] = await Promise.all([
      context.waitForEvent('page'),
      dwd.click()
    ]);

    await newTab.waitForLoadState('domcontentloaded');
    log('DWD button clicked → new tab opened');

    // 4️⃣ MAIN LOOP (NO TIMEOUT, ONLY webdb.store EXIT)
    while (RUNNING) {
      const url = newTab.url();

      // ❌ unexpected domain
      if (!domainAllowed(url)) {
        log(`Unexpected domain detected: ${url}`);
        await newTab.screenshot({ path: `error-${Date.now()}.png` });
        break;
      }

      // ✅ FINAL EXIT
      if (url.includes('webdb.store')) {
        log('webdb.store reached');
        await sleep(WAIT_AFTER_WEBDB);
        break;
      }

      // 🔗 arolinks Get Link
      if (url.includes('arolinks.com')) {
        const getLinkBtn = await newTab.$('button:has-text("Get Link")');
        if (getLinkBtn && await getLinkBtn.isEnabled()) {
          log('Get Link clicked');
          await getLinkBtn.click();
          await randomDelay();
          continue;
        }
      }

      // ✅ Verify
      const verifyBtn = await newTab.$(
        'button.ce-btn.ce-blue:has-text("Verify")'
      );
      if (verifyBtn && await verifyBtn.isVisible()) {
        log('Verify clicked');
        await verifyBtn.click();
        await randomDelay();
        continue;
      }

      // ➡ Continue
      const continueBtn = await newTab.$(
        'a#btn7 button.ce-btn.ce-blue:has-text("Continue")'
      );
      if (continueBtn && await continueBtn.isVisible()) {
        log('Continue clicked');
        await continueBtn.click();
        await randomDelay();
        continue;
      }

      // ⏳ nothing yet
      await sleep(2000);
    }

  } catch (err) {
    log(`❌ ERROR: ${err.message}`);
    try {
      await page.screenshot({ path: `fatal-${Date.now()}.png` });
    } catch {}
  } finally {
    await context.close();
    await browser.close();
    log(`⏹ SESSION ${SESSION_COUNT} CLOSED`);

    // cooldown
    if (SESSION_COUNT % 50 === 0) {
      log('😴 Cooldown 60s');
      await sleep(60000);
    }
  }
}

// ================= RUNNER =================

(async () => {
  log('🚀 Mobile QA Automation Started');
  while (RUNNING) {
    await runSession();
  }
  log('🛑 Automation stopped cleanly');
})();
