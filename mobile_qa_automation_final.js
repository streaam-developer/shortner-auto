const { chromium } = require('playwright');
const fs = require('fs');
const buttonSelectors = require('./selectors');

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

    // Remove overlays/iframes/popups/modals
    await page.evaluate(() => {
      // Hide iframes
      document.querySelectorAll('iframe').forEach(i => {
        i.style.pointerEvents = 'none';
        i.style.display = 'none';
      });
      // Hide common blockers
      document.querySelectorAll('.modal, .popup, .overlay, .dialog, [class*="modal"], [class*="popup"], [class*="overlay"], [class*="dialog"]').forEach(el => {
        el.style.display = 'none';
      });
      // Hide fixed/absolute high z-index elements
      document.querySelectorAll('*').forEach(el => {
        const style = window.getComputedStyle(el);
        if ((style.position === 'fixed' || style.position === 'absolute') && parseInt(style.zIndex) > 1000) {
          el.style.display = 'none';
        }
      });
      // Reset pointer events
      document.querySelectorAll('[style*="pointer-events"]').forEach(n => {
        n.style.pointerEvents = 'auto';
      });
    });

    // 🔥 AROLINKS: enable button forcibly (handles disabled/countdown)
    const buttonEl = selector.startsWith('a:') ? el.locator('button').first() : el;
    await buttonEl.evaluate((b) => {
      b.disabled = false;
      b.removeAttribute('disabled');
      b.removeAttribute('aria-disabled');
      b.style.pointerEvents = 'auto';
      b.style.display = 'block';
      b.classList.remove('disabled');
    });

    // Wait for potential JS countdown to update the href
    log('Button forcibly enabled, waiting 2s for JS to update link...');
    await sleep(2000);

    await el.scrollIntoViewIfNeeded();
    await randomMouseMove(page);

    let clicked = false;

    // Method 1: evaluate node.click() (DOM click - highest priority)
    try {
        await el.evaluate(node => node.click());
        log('✓ Click Method 1: evaluate(node => node.click()) succeeded.');
        clicked = true;
        await sleep(1500); // Allow time for navigation
    } catch (e) {
        log(`... Method 1 failed: ${e.message.split('\n')[0]}`);
    }

    // Method 2: Playwright click
    if (!clicked) {
        try {
            if (force) {
                await el.click({ force: true, timeout: 3000 });
            } else {
                await Promise.race([
                    el.click({ timeout: 3000 }),
                    page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 4000 }).catch(() => {})
                ]);
            }
            log('✓ Click Method 2: Playwright click succeeded.');
            clicked = true;
        } catch (e) {
            log(`... Method 2 failed: ${e.message.split('\n')[0]}`);
        }
    }

    // Method 3: dispatchEvent
    if (!clicked) {
        try {
            await el.dispatchEvent('click');
            log('✓ Click Method 3: dispatchEvent("click") succeeded.');
            clicked = true;
            await sleep(1500); // Allow time for navigation
        } catch (e) {
            log(`... Method 3 failed: ${e.message.split('\n')[0]}`);
        }
    }

    // Method 4: href fallback
    if (!clicked) {
        try {
            const href = await buttonEl.evaluate((e) => e.closest('a')?.href);
            if (href) {
                log(`... Trying Method 4: Navigating directly to href: ${href}`);
                await page.goto(href, { waitUntil: 'domcontentloaded' });
                log('✓ Click Method 4: href navigation succeeded.');
                clicked = true;
            }
        } catch (e) {
            log(`... Method 4 failed: ${e.message.split('\n')[0]}`);
        }
    }
    
    // Method 5: onclick fallback
    if (!clicked) {
        try {
            const onclick = await buttonEl.getAttribute('onclick');
            if (onclick) {
                log(`... Trying Method 5: evaluate with onclick attribute: ${onclick}`);
                await page.evaluate(onclick);
                log('✓ Click Method 5: evaluate(onclick) succeeded.');
                clicked = true;
                await sleep(1500); // Allow time for navigation
            }
        } catch (e) {
            log(`... Method 5 failed: ${e.message.split('\n')[0]}`);
        }
    }

    if (clicked) {
        log(`${label} clicked successfully.`);
    } else {
        log(`❌ All click methods failed for ${label}.`);
    }
    
    return clicked;

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

  let contextOptions = {
    viewport: { width: 360, height: 740 },
    isMobile: true,
    hasTouch: true,
    userAgent: 'Mozilla/5.0 (Linux; Android 12; Mobile) AppleWebKit/537.36 Chrome/120.0.0.0 Mobile Safari/537.36'
  };

  if (proxy) {
    contextOptions.geolocation = { latitude: 19.0760, longitude: 72.8777 };
    contextOptions.locale = 'en-IN';
    contextOptions.timezoneId = 'Asia/Kolkata';
    contextOptions.permissions = ['geolocation'];
  }

  const context = await browser.newContext(contextOptions);

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
    await page.waitForLoadState('networkidle');
    log('Random post opened');
    await randomScroll(page);

    // DWD
    await page.waitForSelector('.dwd-button', { timeout: 10000 });
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
          await safeClick(activePage, 'a[id="get-link"]', 'Get Final Link');
          await sleep(WAIT_AFTER_WEBDB);
          break;
        }

        await randomMouseMove(activePage);

        // Click here link
        if (await safeClick(
          activePage,
          'a:has-text("click here")',
          'Click Here',
          true
        )) {
          await sleep(POLL_INTERVAL);
          continue;
        }

        // 🔥 AROLINKS GET LINK (dZJjx FIX + NEW TAB)
        if (url.includes('arolinks.com')) {
          const [maybeNewTab] = await Promise.all([
            context.waitForEvent('page').catch(() => null),
            safeClick(
              activePage,
              'button[id="get-link"]',
              'Get Link',
              false // No force on arolinks
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
          'Verify',
          !url.includes('arolinks.com')
        )) {
          await sleep(POLL_INTERVAL);
          continue;
        }

        // Continue (normal)
        if (await safeClick(
          activePage,
          'button:has-text("Continue")',
          'Continue',
          !url.includes('arolinks.com')
        )) {
          await sleep(POLL_INTERVAL);
          continue;
        }

        // Continue (force)
        if (await safeClick(
          activePage,
          'button#cross-snp2.ce-btn.ce-blue',
          'Force Continue',
          !url.includes('arolinks.com')
        )) {
          await sleep(POLL_INTERVAL);
          continue;
        }

        // New buttons parallel
        const newSelectors = [
          { selector: 'button#btn6.btn-hover.color-9:has-text("Continue")', label: 'Continue btn6 color-9', force: !url.includes('arolinks.com') },
          { selector: 'button#btn6.btn-hover.color-11:has-text("Continue Next")', label: 'Continue Next', force: !url.includes('arolinks.com') },
          { selector: 'button[onclick="scrol()"]:has-text("Verify Link")', label: 'Verify Link onclick', force: true },
          { selector: 'button:has-text("Go Next")', label: 'Go Next', force: !url.includes('arolinks.com') },
          { selector: 'button#btn6.btn-hover.color-11:has-text("Get Link")', label: 'Get Link btn6 color-11', force: false }
        ];
        const results = await Promise.allSettled(newSelectors.map(({selector, label, force}) => safeClick(activePage, selector, label, force)));
        if (results.some(r => r.status === 'fulfilled' && r.value)) {
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