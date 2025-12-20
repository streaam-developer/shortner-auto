const { chromium } = require('playwright');
const fs = require('fs');

const HOME_URL = 'https://yomovies.delivery';
const WAIT_AFTER_WEBDB = 5000;
const POLL_INTERVAL = 2000;

// ================= GLOBAL =================
let RUNNING = true;
let SESSION_COUNT = 0;

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}
function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`;
  console.log(line);
  fs.appendFileSync('automation.log', line + '\n');
}
process.on('SIGINT', () => RUNNING = false);

// ================= HUMAN =================
async function randomMouseMove(page) {
  for (let i = 0; i < 4; i++) {
    await page.mouse.move(
      Math.random() * 360,
      Math.random() * 740,
      { steps: 10 }
    );
    await sleep(300);
  }
}

// ================= ENABLE BUTTON =================
async function waitUntilEnabled(page, selector, timeout = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const ok = await page.evaluate(sel => {
      const b = document.querySelector(sel);
      if (!b) return false;
      return !b.disabled && getComputedStyle(b).pointerEvents !== 'none';
    }, selector);
    if (ok) return true;
    await sleep(500);
  }
  return false;
}

// ================= IFRAME SAFE CLICK =================
async function iframeSafeClick(page, selector, label, force = false) {
  try {
    // Try main page
    const clicked = await tryClick(page, selector, label, force);
    if (clicked) return true;

    // Try all iframes
    for (const frame of page.frames()) {
      if (frame === page.mainFrame()) continue;
      const ok = await tryClick(frame, selector, label + ' (iframe)', force);
      if (ok) return true;
    }
    return false;
  } catch {
    return false;
  }
}

async function tryClick(ctx, selector, label, force) {
  const el = await ctx.$(selector);
  if (!el) return false;

  await ctx.evaluate(sel => {
    const b = document.querySelector(sel);
    if (!b) return;
    b.disabled = false;
    b.removeAttribute('disabled');
    b.style.pointerEvents = 'auto';
    b.style.display = 'block';
  }, selector);

  await el.scrollIntoViewIfNeeded();
  await randomMouseMove(ctx.page ? ctx.page() : ctx);

  try {
    await el.click({ force, timeout: 2000 });
  } catch {
    await ctx.evaluate(sel => {
      const e = document.querySelector(sel);
      if (!e) return;
      e.dispatchEvent(new MouseEvent('click', {
        bubbles: true,
        cancelable: true
      }));
    }, selector);
  }

  log(`${label} clicked`);
  return true;
}

// ================= POST PICK =================
async function pickRandomPost(page) {
  await page.waitForLoadState('domcontentloaded');
  const posts = await page.$$('article.post a');
  if (!posts.length) throw 'No posts';
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
      'Mozilla/5.0 (Linux; Android 12) AppleWebKit/537.36 Chrome/120 Mobile'
  });

  const page = await context.newPage();

  try {
    SESSION_COUNT++;
    log(`▶ SESSION ${SESSION_COUNT}`);

    await page.goto(HOME_URL, { waitUntil: 'domcontentloaded' });

    const post = await pickRandomPost(page);
    await post.click();
    await page.waitForLoadState('domcontentloaded');

    const dwd = (await page.$$('.dwd-button'))[0];
    const [newTab] = await Promise.all([
      context.waitForEvent('page'),
      dwd.click()
    ]);
    await newTab.waitForLoadState('domcontentloaded');

    let activePage = newTab;

    while (RUNNING) {
      const url = activePage.url();

      if (url.includes('webdb.store')) {
        log('✅ webdb reached');
        await sleep(WAIT_AFTER_WEBDB);
        break;
      }

      // AROLINKS GET LINK
      if (url.includes('arolinks')) {
        await waitUntilEnabled(activePage, '#get-link');
        const [tab] = await Promise.all([
          context.waitForEvent('page').catch(() => null),
          iframeSafeClick(
            activePage,
            '#get-link, button:has-text("Get Link")',
            'Get Link',
            true
          )
        ]);
        if (tab) {
          await tab.waitForLoadState('domcontentloaded');
          activePage = tab;
        }
      }

      // VERIFY
      if (await iframeSafeClick(
        activePage,
        'button:has-text("Verify")',
        'Verify'
      )) {
        await sleep(POLL_INTERVAL);
        continue;
      }

      // CONTINUE
      if (await iframeSafeClick(
        activePage,
        'button:has-text("Continue")',
        'Continue',
        true
      )) {
        await sleep(POLL_INTERVAL);
        continue;
      }

      await sleep(POLL_INTERVAL);
    }

  } catch (e) {
    log(`❌ ERROR: ${e}`);
  } finally {
    await context.close();
    await browser.close();
    log(`⏹ SESSION CLOSED`);
  }
}

// ================= RUN =================
(async () => {
  log('🚀 STARTED');
  while (RUNNING) await runSession();
})();
