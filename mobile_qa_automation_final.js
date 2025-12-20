const { chromium } = require('playwright');
const fs = require('fs');

const HOME_URL = 'https://yomovies.delivery';
const WAIT_AFTER_WEBDB = 5000;
const POLL_INTERVAL = 2000;

const ALLOWED_DOMAINS = [
  'yomovies.delivery',
  'arolinks.com',
  'webdb.store'
];

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

function domainAllowed(url) {
  return ALLOWED_DOMAINS.some(d => url.includes(d));
}

// Graceful stop
process.on('SIGINT', () => {
  console.log('\n🛑 Stopping after current session...');
  RUNNING = false;
});

// ================= SAFE CLICK =================

async function safeClick(page, selector, label) {
  const el = await page.$(selector);
  if (!el) return false;

  // Disable all iframe ads
  await page.evaluate(() => {
    document.querySelectorAll('iframe').forEach(i => {
      i.style.pointerEvents = 'none';
      i.style.display = 'none';
    });
  });

  try {
    await el.scrollIntoViewIfNeeded();
    try {
      await el.click({ timeout: 2000 });
    } catch {
      await page.evaluate(e => e.click(), el);
    }
    log(`${label} clicked`);
    return true;
  } catch {
    return false;
  }
}

// ================= POST PICKER =================

async function pickRandomPost(page) {
  await page.waitForLoadState('domcontentloaded');

  const posts = await page.$$('article.post h3.entry-title a');
  if (!posts.length) throw new Error('No posts found');

  log(`Found ${posts.length} posts`);
  return posts[Math.floor(Math.random() * posts.length)];
}

// ================= SESSION =================

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
    log(`▶ SESSION ${SESSION_COUNT} START`);

    // Home
    await page.goto(HOME_URL, { waitUntil: 'domcontentloaded' });
    log('Home opened');
    await sleep(2000);

    // Random post
    const post = await pickRandomPost(page);
    await post.click();
    await page.waitForLoadState('domcontentloaded');
    log('Random post opened');
    await sleep(2000);

    // DWD button
    const dwdButtons = await page.$$('.dwd-button');
    if (!dwdButtons.length) throw new Error('No dwd-button');

    const dwd = dwdButtons[Math.floor(Math.random() * dwdButtons.length)];
    const [newTab] = await Promise.all([
      context.waitForEvent('page'),
      dwd.click()
    ]);

    await newTab.waitForLoadState('domcontentloaded');
    log('DWD clicked → new tab');

    // ================= MAIN 2-SEC LOOP =================
    while (RUNNING) {
      const url = newTab.url();

      // unexpected domain
      if (!domainAllowed(url)) {
        log(`Unexpected domain: ${url}`);
        await newTab.screenshot({ path: `error-${Date.now()}.png` });
        break;
      }

      // FINAL EXIT
      if (url.includes('webdb.store')) {
        log('webdb.store reached');
        await sleep(WAIT_AFTER_WEBDB);
        break;
      }

      // Check buttons (EVERY 2 SECONDS)
      if (url.includes('arolinks.com')) {
        if (await safeClick(newTab, 'button:has-text("Get Link")', 'Get Link')) {
          await sleep(POLL_INTERVAL);
          continue;
        }
      }

      if (await safeClick(newTab, 'button.ce-btn.ce-blue:has-text("Verify")', 'Verify')) {
        await sleep(POLL_INTERVAL);
        continue;
      }

      if (await safeClick(
        newTab,
        'a#btn7 button.ce-btn.ce-blue:has-text("Continue")',
        'Continue'
      )) {
        await sleep(POLL_INTERVAL);
        continue;
      }

      // Nothing found → wait 2 sec
      await sleep(POLL_INTERVAL);
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
  }
}

// ================= RUNNER =================

(async () => {
  log('🚀 Automation started (2-sec polling mode)');
  while (RUNNING) {
    await runSession();
  }
  log('🛑 Automation stopped cleanly');
})();
