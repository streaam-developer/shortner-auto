const fs = require('fs');

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`;
  console.log(line);
  fs.appendFileSync('automation.log', line + '\n');
}

function getRandomReferrer() {
    const referrers = ['https://www.google.com/', 'https://www.bing.com/'];
    return referrers[Math.floor(Math.random() * referrers.length)];
}

async function randomMouseMove(page) {
    const viewport = page.viewportSize();
    if (!viewport) return;
    const { width, height } = viewport;
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

async function safeClick(page, selector, label, force = false) {
  try {
    const el = page.locator(selector).first();
    await el.waitFor({ timeout: 250 }).catch(() => {});
    if (!(await el.isVisible())) {
      return false;
    }

    log(`🚀 Found element: "${label}". Attempting to click...`);
    
    const buttonEl = selector.startsWith('a:') ? el.locator('button').first() : el;
    await buttonEl.evaluate(b => {
      b.disabled = false;
      b.removeAttribute('disabled');
      b.removeAttribute('aria-disabled');
      b.style.pointerEvents = 'auto';
      b.style.display = 'block';
      b.classList.remove('disabled');
    });

    log(`... Button for "${label}" forcibly enabled, waiting 0.5s for JS.`);
    await sleep(500);
    await el.scrollIntoViewIfNeeded();

    const clickMethods = [
      { name: 'DOM evaluate', method: () => el.evaluate(n => n.click()) },
      { name: 'Playwright force', method: () => el.click({ force: true, timeout: 2000 }) },
      { name: 'Playwright race', method: () => Promise.race([ el.click({ timeout: 2000 }), page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 3000 }) ]) },
      { name: 'Dispatch event', method: () => el.dispatchEvent('click') },
    ];

    for (const { name, method } of clickMethods) {
      try {
        await method();
        log(`✓ Clicked "${label}" using: ${name}`);
        await sleep(1500);
        return true;
      } catch (e) {}
    }

    log(`❌ All click methods failed for "${label}".`);
    return false;

  } catch (err) {
    if (err.message.includes('Execution context was destroyed')) {
      log(`"${label}" click caused navigation (safe).`);
      return true;
    }
    log(`🚨 Error in safeClick for "${label}" (selector: ${selector}): ${err.message.split('\n')[0]}`);
    return false;
  }
}

module.exports = {
    sleep,
    log,
    getRandomReferrer,
    randomMouseMove,
    randomScroll,
    safeClick,
};