const { chromium } = require('playwright');
const fs = require('fs');

const HOME_URL = 'https://yomovies.delivery';
const WAIT_AFTER_WEBDB = 5000;
const POLL_INTERVAL = 2000;

// ================= PROXY CONFIG =================
const PROXY_ENABLED = false; // false to disable
const PROXIES = [
  // 'http://user:pass@ip:port'
];

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
  const width = 360, height = 740;
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

// ================= SAFE CLICK (AROLINKS FIXED) =================
async function safeClick(page, selector, label, force = false) {
  try {
    const el = page.locator(selector).first();
    await el.waitFor({ timeout: 2000 }).catch(() => {});
    if (!(await el.isVisible())) {
      log(`${label} element not visible after 5s wait`);
      return false;
    }

    // Remove overlays/iframes
    await page.evaluate(() => {
      document.querySelectorAll('iframe').forEach(i => {
        i.style.pointerEvents = 'none';
        i.style.display = 'none';
      });
      document.querySelectorAll('[style*="pointer-events"]').forEach(n => {
        n.style.pointerEvents = 'auto';
      });
    });

    // 🔥 AROLINKS: enable button forcibly (handles disabled/countdown)
    await el.evaluate((b) => {
      b.disabled = false;
      b.removeAttribute('disabled');
      b.removeAttribute('aria-disabled');
      b.style.pointerEvents = 'auto';
      b.style.display = 'block';
      b.classList.remove('disabled');
    });

    await el.scrollIntoViewIfNeeded();
    await randomMouseMove(page);

    try {
      if (force) {
        await el.click({ force: true, timeout: 2000 });
      } else {
        await Promise.race([
          el.click({ timeout: 2000 }),
          page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 3000 }).catch(() => {})
        ]);
      }
    } catch {
      // Hard JS click (works on arolinks)
      await el.evaluate((e) => {
        e.dispatchEvent(new MouseEvent('click', {
          bubbles: true,
          cancelable: true,
          view: window
        }));
      });
    }

    log(`${label} clicked${force ? ' (force)' : ''}`);
    return true;

  } catch (err) {
    if (err.message && err.message.includes('Execution context was destroyed')) {
      log(`${label} caused navigation (safe)`);
      return true;
    }
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
  const proxy = getRandomProxy();

  const browser = await chromium.launch({
    headless: false,
    proxy: proxy
      ? {
          server: proxy.split('@').pop(),
          username: proxy.includes('@') ? proxy.split('//')[1].split(':')[0] : undefined,
          password: proxy.includes('@')
            ? proxy.split('//')[1].split(':')[1].split('@')[0]
            : undefined
        }
      : undefined
  });
  if (proxy) log(`Using proxy: ${proxy}`);

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
    await randomScroll(page);

    // Random post
    const post = await pickRandomPost(page);
    await post.click();
    await page.waitForLoadState('domcontentloaded');
    log('Random post opened');
    await randomScroll(page);

    // DWD
    const dwdButtons = await page.$$('.dwd-button');
    if (!dwdButtons.length) throw new Error('No dwd-button found');
    const dwd = dwdButtons[Math.floor(Math.random() * dwdButtons.length)];
    const [newTab] = await Promise.all([
      context.waitForEvent('page'),
      dwd.click()
    ]);
    await newTab.waitForLoadState('domcontentloaded');
    log('DWD clicked → new tab');

    let activePage = newTab;

    // ================= MAIN 2-SEC LOOP =================
    while (RUNNING) {
      try {
        const url = activePage.url();

        // FINAL EXIT
        if (url.includes('webdb.store')) {
          log('webdb.store reached');
          await sleep(WAIT_AFTER_WEBDB);
          break;
        }

        await randomMouseMove(activePage);

        // 🔥 AROLINKS GET LINK (dZJjx FIX + NEW TAB)
        if (url.includes('arolinks.com')) {
          const [maybeNewTab] = await Promise.all([
            context.waitForEvent('page').catch(() => null),
            safeClick(
              activePage,
              'a:has(button:has-text("Get Link"))',
              'Get Link',
              true // FORCE
            )
          ]);

          if (maybeNewTab) {
            await maybeNewTab.waitForLoadState('domcontentloaded');
            activePage = maybeNewTab;
            log('Get Link opened in NEW TAB');
            await sleep(POLL_INTERVAL);
            continue;
          }
        }

        // Verify
        if (await safeClick(
          activePage,
          'button.ce-btn.ce-blue:has-text("Verify")',
          'Verify'
        )) {
          await sleep(POLL_INTERVAL);
          continue;
        }

        // Continue (normal)
        if (await safeClick(
          activePage,
          'button:has-text("Continue")',
          'Continue'
        )) {
          await sleep(POLL_INTERVAL);
          continue;
        }

        // Continue (force)
        if (await safeClick(
          activePage,
          'button#cross-snp2.ce-btn.ce-blue',
          'Force Continue',
          true
        )) {
          await sleep(POLL_INTERVAL);
          continue;
        }

        await sleep(POLL_INTERVAL);

      } catch (err) {
        if (err.message && err.message.includes('Execution context was destroyed')) {
          log('Navigation detected, continuing loop');
          await sleep(1000);
          continue;
        }
        throw err;
      }
    }

  } catch (err) {
    log(`❌ REAL ERROR: ${err.message}`);
    try { await page.screenshot({ path: `fatal-${Date.now()}.png` }); } catch {}
  } finally {
    await context.close();
    await browser.close();
    log(`⏹ SESSION ${SESSION_COUNT} CLOSED`);
  }
}

// ================= RUNNER =================
(async () => {
  log('🚀 Automation started (arolinks dZJjx fixed)');
  while (RUNNING) {
    await runSession();
  }
  log('🛑 Automation stopped cleanly');
})();