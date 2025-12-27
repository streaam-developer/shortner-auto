const { chromium } = require('playwright');
const fs = require('fs');
const { isMainThread, Worker, workerData } = require('worker_threads');
const buttonSelectors = require('./selectors');

const HOME_URL = 'https://yomovies.delivery';
const WAIT_AFTER_WEBDB = 5000;
const POLL_INTERVAL = 500;

// Domains where blocking should not apply (allow all requests)
const ALLOWED_DOMAINS = [
  'yomovies.delivery',
  'webdb.store',
  'arolinks.com',
  'linkpays.in'
];

// Headless mode: default false, enable with --headless flag
const headless = process.argv.includes('--headless');
log(`Headless mode: ${headless}`);

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
// SESSION_COUNT is no longer a global variable.

// ================= UTIL =================
function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}
function log(msg) {
  const prefix = isMainThread ? '[Main]' : `[Worker ${workerData.sessionId}]`;
  const line = `[${new Date().toISOString()}] ${prefix} ${msg}`;
  console.log(line);
  fs.appendFileSync('automation.log', line + '\n');
}
// SIGINT handling is moved to the main thread runner section.

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

// ================= CHECK ALL BUTTONS =================
async function checkAndClickButtons(page, url) {
  for (const btn of buttonSelectors) {
    let useForce = btn.force;
    if (btn.force === 'conditional_not_arolinks') {
      useForce = !url.includes('arolinks.com');
    }
    if (await safeClick(page, btn.selector, btn.label, useForce)) {
      return true;
    }
  }
  return false;
}

// ================= SESSION =================
async function runSession(sessionId, headless) {
  const proxy = getRandomProxy();

  log(`Launching browser with headless: ${headless}`);

  const browser = await chromium.launch({
    headless: headless,
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
  if (proxy) log(`Using proxy: ${proxy.split('@')[1]}`);

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

  // Stealth mode: remove automation fingerprints
  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    delete navigator.__proto__.webdriver;
  });

  // Disable animations for low data
  await page.addStyleTag({ content: '* { animation: none !important; transition: none !important; }' });

  // Block ads, images, tracking, videos, fonts to prevent data usage
  await context.route('**/*', (route) => {
    const resourceType = route.request().resourceType();
    const url = route.request().url().toLowerCase();
    const hostname = new URL(url).hostname;

    // Allow scripts on all domains
    if (resourceType === 'script') {
      route.continue();
      return;
    }

    // Allow all requests on specified domains and their subdomains
    if (ALLOWED_DOMAINS.some(domain => hostname === domain || hostname.endsWith('.' + domain))) {
      route.continue();
      return;
    }

    // Block resource types
    const blockedTypes = ['image', 'media', 'font', 'websocket', 'ping', 'prefetch'];
    if (blockedTypes.includes(resourceType)) {
      route.abort();
    }

    // Block specific domains
    const blockedDomains = [
      'doubleclick.net',
      'googlesyndication.com',
      'google-analytics.com',
      'googletagmanager.com',
      'googleadservices.com',
      'adsystem.com',
      'facebook.net',
      'connect.facebook.net',
      'pixel.facebook.com',
      '2mdn.net',
      'taboola.com',
      'outbrain.com',
      'criteo.com',
      'hotjar.com',
      'clarity.ms',
      'youtube.com',
      'googlevideo.com',
      'gstatic.com'
    ];
    if (blockedDomains.some(domain => hostname.includes(domain))) {
      route.abort();
      return;
    }

    // Allow only necessary resource types
    const allowedTypes = ['document', 'xhr', 'fetch'];
    if (!allowedTypes.includes(resourceType)) {
      route.abort();
      return;
    }

    route.continue();
  });

  try {
    log(`▶ SESSION ${sessionId} START`);

    // Set referrer
    const referrers = ['https://www.google.com', 'https://www.bing.com'];
    const referrer = referrers[Math.floor(Math.random() * referrers.length)];
    await page.setExtraHTTPHeaders({ 'Referer': referrer });

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
          log('webdb.store reached. Short link obtained: ' + url);
          fs.appendFileSync('short_links.txt', url + '\n');
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
              'a[id="get-link"]',
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

        // Check all button selectors
        if (await checkAndClickButtons(activePage, url)) {
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
    log(`⏹ SESSION ${sessionId} CLOSED`);
  }
}

// ================= RUNNER =================
if (isMainThread) {
  const NUM_SESSIONS = 1;
  log(`🚀 Automation started. Launching ${NUM_SESSIONS} parallel sessions.`);

  const workers = new Map();

  function launchWorker(sessionId) {
    log(`Spawning worker for session ${sessionId}...`);
    const worker = new Worker(__filename, { workerData: { sessionId, headless } });

    worker.on('error', (err) => {
      log(`❌ Worker for session ${sessionId} had an error: ${err.message}`);
    });

    worker.on('exit', (code) => {
      workers.delete(sessionId);
      if (RUNNING) {
        log(`⏹ Worker for session ${sessionId} exited with code ${code}. Relaunching in 5s...`);
        setTimeout(() => launchWorker(sessionId), 5000);
      } else {
        log(`⏹ Worker for session ${sessionId} exited with code ${code}. Shutdown in progress.`);
      }
    });
    workers.set(sessionId, worker);
  }

  for (let i = 1; i <= NUM_SESSIONS; i++) {
    launchWorker(i);
  }

  process.on('SIGINT', async () => {
    if (!RUNNING) return;
    console.log('\n🛑 Graceful shutdown requested...');
    RUNNING = false;
    log('Stopping all workers...');

    const terminatePromises = [];
    for (const worker of workers.values()) {
      terminatePromises.push(worker.terminate());
    }
    
    await Promise.all(terminatePromises).catch(err => console.error('Error during termination:', err));

    log('All workers have been signaled to terminate.');
    // Allow time for exit handlers to log messages
    setTimeout(() => process.exit(0), 1000);
  });
} else {
  // Worker thread
  const { sessionId, headless } = workerData;
  runSession(sessionId, headless)
    .catch(err => {
      log(`❌ Unhandled error in session: ${err.message}\n${err.stack}`);
      process.exit(1);
    })
    .finally(() => {
      process.exit(0);
    });
}