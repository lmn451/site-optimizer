import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = fileURLToPath(new URL('../', import.meta.url));
const animationSelector = 'style[data-early-performance-optimizer="animations"]';
async function eventually(read, accepts, label) {
  const deadline = Date.now() + 10000;
  let value;
  do {
    value = await read();
    if (accepts(value)) return value;
    await new Promise(resolve => setTimeout(resolve, 25));
  } while (Date.now() < deadline);
  assert.fail(`${label}: last observed ${JSON.stringify(value)}`);
}

test('installed Chrome extension: popup, all frames, DOM rollback and actual network rules', { timeout: 90000 }, async t => {
  const requests = [];
  let origin;
  const server = createServer((req, res) => {
    requests.push({ url: req.url, host: req.headers.host, saveData: req.headers['save-data'] });
    res.setHeader('Access-Control-Allow-Origin', '*');
    const url = new URL(req.url, origin);
    if (url.pathname === '/pending.svg') {
      // Keep images incomplete so both visible and offscreen loading decisions are observable.
      // closeAllConnections in teardown closes these sockets, even on assertion failures.
      return;
    }
    if (url.pathname === '/script.js') {
      res.setHeader('Content-Type', 'application/javascript');
      res.end('window.testScriptLoaded = true;');
      return;
    }
    res.setHeader('Content-Type', 'text/html');
    if (url.pathname === '/headers') {
      res.end(`<pre id="headers">${JSON.stringify(req.headers)}</pre>`);
    } else if (url.pathname === '/ad') {
      res.end('ad test request reached the local server');
    } else if (url.pathname === '/frame') {
      res.end('<!doctype html><html><body><p id="frame-ready">Frame loaded</p><div hidden class="fade">Keep hidden</div></body></html>');
    } else {
      const port = new URL(origin).port;
      const images = Array.from({ length: 12 }, (_, i) =>
        `<img id="image-${i}" width="40" height="40" src="http://localhost:${port}/pending.svg?id=${i}"${i === 1 ? ' loading="eager" decoding="sync" fetchpriority="high"' : ''}${i === 2 ? ' data-src="/site-managed.jpg"' : ''}${i === 3 ? ` srcset="http://localhost:${port}/pending.svg?id=responsive 1x"` : ''}>`).join('');
      res.end(`<!doctype html><html><head>
        <style>body{height:7000px}.media{position:absolute;top:4000px}#viewport{position:absolute;top:5000px;width:100px;height:100px}</style>
        <link id="critical" rel="preload" as="image" href="/pending.svg?critical">
        <script id="ordered-script" src="/script.js"></script>
        </head><body>
        <div id="hidden" hidden class="fade">Do not expose</div><div id="transparent" style="opacity:0">Do not expose</div>
        <div class="media">${images}<iframe id="child" src="/frame" width="200" height="100"></iframe></div>
        <div id="viewport" class="optimize-viewport"></div>
        </body></html>`);
    }
  });
  server.on('clientError', (_error, socket) => socket.destroy());
  await new Promise(resolve => server.listen(0, '0.0.0.0', resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
  const profile = await mkdtemp(path.join(process.env.JCODE_SCRATCH_DIR || tmpdir(), 'site-optimizer-browser-'));
  let context;
  t.after(async () => {
    await context?.close();
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    await rm(profile, { recursive: true, force: true });
  });
  const extension = path.join(root, 'build/chrome');
  const launchOptions = {
    headless: true,
    channel: 'chromium',
    executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined,
    args: [
      `--disable-extensions-except=${extension}`,
      `--load-extension=${extension}`,
      '--no-proxy-server',
      '--host-resolver-rules=MAP doubleclick.net 127.0.0.1, MAP localhost 127.0.0.1',
    ],
  };
  context = await chromium.launchPersistentContext(profile, launchOptions);
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  const extensionId = new URL(worker.url()).host;
  const readRules = () => worker.evaluate(() => chrome.declarativeNetRequest.getSessionRules());
  const readStorage = () => worker.evaluate(() => chrome.storage.local.get(['enabled', 'config']));
  await eventually(readRules, rules => rules.length === 2, 'default rules registered');
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${extensionId}/popup.html`);
  await popup.locator('#settings input').last().waitFor({ state: 'attached' });
  await popup.waitForFunction(() => !document.querySelector('#masterToggle').disabled);
  async function setToggle(key, checked) {
    if (await popup.locator(`#${key}`).isChecked() !== checked) {
      await popup.locator(`#${key} + .slider`).click();
    }
  }
  await page.goto(origin, { waitUntil: 'domcontentloaded' });

  await t.test('initial image, viewport and iframe behavior preserves site resources and hidden UI', async () => {
    await page.waitForFunction(() => document.querySelector('#image-11').getAttribute('decoding') === 'async');
    assert.equal(await popup.locator('#settings input').count(), 6);
    assert.equal(await popup.locator('#masterToggle').isChecked(), true);
    const media = await page.locator('img').evaluateAll(images => images.map(img => ({
      id: img.id, src: img.getAttribute('src'), srcset: img.getAttribute('srcset'),
      loading: img.getAttribute('loading'), decoding: img.getAttribute('decoding'), priority: img.getAttribute('fetchpriority'),
    })));
    assert.equal(media.length, 12);
    for (let i = 0; i < media.length; i++) {
      assert.ok(media[i].src.endsWith(`/pending.svg?id=${i}`), `image ${i} source unchanged`);
      assert.equal(media[i].srcset === null, i !== 3);
      if (i !== 1) assert.equal(media[i].decoding, 'async');
      if (i !== 1 && i !== 2) assert.equal(media[i].loading, 'lazy');
    }
    assert.equal(media[1].loading, 'eager');
    assert.equal(media[1].decoding, 'sync');
    assert.equal(media[1].priority, 'high');
    assert.equal(media[2].loading, null, 'site-managed lazy loader respected');
    assert.equal(media[3].srcset, `http://localhost:${server.address().port}/pending.svg?id=responsive 1x`);
    await page.waitForFunction(() => document.querySelector('#child').loading === 'lazy');
    await page.waitForFunction(() => document.querySelector('#viewport').style.contentVisibility === 'auto');
    await page.locator('#viewport').scrollIntoViewIfNeeded();
    await page.waitForFunction(() => document.querySelector('#viewport').style.contentVisibility === 'visible');
    await page.locator('#child').scrollIntoViewIfNeeded();
    await page.frameLocator('#child').locator('#frame-ready').waitFor();
    await page.frameLocator('#child').locator(animationSelector).waitFor({ state: 'attached' });
    assert.equal(await page.frameLocator('#child').locator(animationSelector).count(), 1);
    assert.equal(await page.locator(animationSelector).count(), 1, 'no top-frame style duplication');
    assert.equal(await page.locator('#hidden').getAttribute('hidden'), '');
    assert.equal(await page.locator('#transparent').evaluate(el => getComputedStyle(el).opacity), '0');
    assert.equal(await page.locator('#critical').getAttribute('rel'), 'preload');
    assert.equal(await page.locator('#ordered-script').getAttribute('defer'), null);
    assert.equal(await page.locator('link[rel="preconnect"]').count(), 1);
  });

  await t.test('reduced motion retains animation and transition completion events', async () => {
    const events = await page.evaluate(() => new Promise((resolve, reject) => {
      const style = document.createElement('style');
      style.textContent = '@keyframes acceptance-motion {from {opacity:0} to {opacity:1}}';
      document.head.appendChild(style);
      const transition = document.createElement('div');
      transition.style.cssText = 'opacity:0;transition:opacity 1s linear';
      const animation = document.createElement('div');
      document.body.append(transition, animation);
      const observed = [];
      const timer = setTimeout(() => { cleanup(); reject(Error(`Missing motion events: ${observed}`)); }, 2000);
      function cleanup() { clearTimeout(timer); transition.remove(); animation.remove(); style.remove(); }
      function record(event) {
        observed.push(event.type);
        if (observed.length === 2) { cleanup(); resolve(observed.sort()); }
      }
      transition.addEventListener('transitionend', record, { once: true });
      animation.addEventListener('animationend', record, { once: true });
      void getComputedStyle(transition).opacity;
      requestAnimationFrame(() => {
        transition.style.opacity = '1';
        animation.style.animation = 'acceptance-motion 1s forwards';
      });
    }));
    assert.deepEqual(events, ['animationend', 'transitionend']);
  });

  await t.test('dynamic insertions, class changes, iframe reloads and detached nodes', async () => {
    await page.evaluate(port => {
      const img = document.createElement('img');
      img.id = 'dynamic';
      img.src = '/pending.svg?dynamic';
      img.style.cssText = 'position:absolute;top:6500px;width:30px;height:30px';
      document.body.appendChild(img);
      const target = document.createElement('div');
      target.id = 'dynamic-viewport';
      target.style.cssText = 'position:absolute;top:6500px;width:50px;height:50px';
      document.body.appendChild(target);
      const deferred = document.createElement('iframe');
      deferred.loading = 'lazy';
      deferred.src = `http://127.0.0.2:${port}/frame?dormant`;
      deferred.style.cssText = 'position:absolute;top:20000px';
      document.body.appendChild(deferred);
    }, server.address().port);
    await page.waitForFunction(() => document.querySelector('#dynamic').loading === 'lazy');
    assert.equal(await page.locator('link[rel="preconnect"][href^="http://127.0.0.2:"]').count(), 0);
    assert.equal(await page.locator('link[rel="dns-prefetch"][href^="http://127.0.0.2:"]').count(), 0);
    await page.evaluate(() => document.querySelector('#dynamic-viewport').className = 'optimize-viewport');
    await page.waitForFunction(() => document.querySelector('#dynamic-viewport').style.contentVisibility === 'auto');
    await page.evaluate(() => document.querySelector('#dynamic-viewport').className = '');
    await page.waitForFunction(() => document.querySelector('#dynamic-viewport').style.contentVisibility === '');
    await page.evaluate(() => {
      window.detachedImage = document.querySelector('#dynamic');
      window.detachedImage.remove();
    });
    await page.waitForFunction(() => !window.detachedImage.hasAttribute('loading') && !window.detachedImage.hasAttribute('decoding'));
    const childFrame = page.frames().find(frame => frame.url() === `${origin}/frame`);
    assert.ok(childFrame, 'initial child frame exists');
    const committed = childFrame.waitForURL(`${origin}/frame?reload`);
    await page.locator('#child').evaluate(frame => frame.src = '/frame?reload');
    await committed;
    await page.frameLocator('#child').locator('#frame-ready').waitFor();
    await page.frameLocator('#child').locator(animationSelector).waitFor({ state: 'attached' });
    assert.equal(requests.some(request => request.url === '/frame?dormant'), false,
      'dormant cross-origin iframe was not contacted');
    assert.equal(await page.locator(animationSelector).count(), 1);
    assert.equal(await page.frameLocator('#child').locator(animationSelector).count(), 1);
  });

  await t.test('Save-Data header follows the real popup setting and rules remain bounded', async () => {
    const headers = await context.newPage();
    await headers.goto(`${origin}/headers`);
    assert.equal(JSON.parse(await headers.locator('#headers').innerText())['save-data'], 'on');
    await setToggle('saveData', false);
    await eventually(readRules, rules => rules.length === 1 && rules[0].id === 2, 'Save-Data removed');
    await headers.goto(`${origin}/headers?disabled`);
    assert.equal(JSON.parse(await headers.locator('#headers').innerText())['save-data'], undefined);
    await setToggle('saveData', true);
    await eventually(readRules, rules => rules.length === 2, 'Save-Data restored');
    for (let i = 0; i < 5; i++) await headers.goto(`${origin}/headers?navigation=${i}`);
    assert.equal((await readRules()).length, 2);
    await headers.close();
  });

  await t.test('third-party ad request is really blocked, then allowed when switched off', async () => {
    const ad = `http://doubleclick.net:${server.address().port}/ad`;
    const countAds = () => requests.filter(request => request.url === '/ad').length;
    const before = countAds();
    const blocked = await page.evaluate(async url => {
      try { await fetch(url, { mode: 'no-cors' }); return false; } catch { return true; }
    }, ad);
    assert.equal(blocked, true);
    assert.equal(countAds(), before);
    // This setting must not block a top-level navigation to the same domain.
    const top = await context.newPage();
    await top.goto(`http://doubleclick.net:${server.address().port}/headers`);
    assert.equal(JSON.parse(await top.locator('#headers').innerText())['save-data'], 'on');
    await top.close();
    await setToggle('blockAds', false);
    await eventually(readRules, rules => rules.length === 1 && rules[0].id === 1, 'ad rule removed');
    await page.evaluate(url => fetch(url, { mode: 'no-cors' }).then(() => true), ad);
    await eventually(async () => countAds(), count => count === before + 1, 'ad request reached local HTTP server');
    await setToggle('blockAds', true);
    await eventually(readRules, rules => rules.length === 2, 'ad rule restored');
  });

  await t.test('individual DOM settings switch off live, then restore', async () => {
    for (const key of ['lazyLoad', 'imageOptimization', 'noAnimation', 'preload']) await setToggle(key, false);
    await page.waitForFunction(selector => !document.querySelector(selector) &&
      !document.querySelector('#image-11').hasAttribute('decoding') &&
      !document.querySelector('#child').hasAttribute('loading') &&
      !document.querySelector('link[rel="preconnect"]'), animationSelector);
    assert.equal(await page.locator('#viewport').evaluate(el => el.style.contentVisibility), '');
    for (const key of ['lazyLoad', 'imageOptimization', 'noAnimation', 'preload']) await setToggle(key, true);
    await page.waitForFunction(selector => document.querySelector(selector) &&
      document.querySelector('#image-11').getAttribute('decoding') === 'async', animationSelector);
  });

  await t.test('master disable rolls back all frames and new navigations, preserving later site edits', async () => {
    await page.locator('#image-0').evaluate(img => img.setAttribute('loading', 'eager'));
    await setToggle('masterToggle', false);
    await eventually(readRules, rules => rules.length === 0, 'all network rules removed');
    await page.waitForFunction(selector => !document.querySelector(selector) &&
      !document.querySelector('#image-11').hasAttribute('decoding'), animationSelector);
    assert.equal(await page.locator('#image-0').getAttribute('loading'), 'eager', 'site edit preserved');
    assert.equal(await page.locator('#image-1').getAttribute('decoding'), 'sync');
    await page.frameLocator('#child').locator(animationSelector).waitFor({ state: 'detached' });
    assert.equal(await page.frameLocator('#child').locator(animationSelector).count(), 0);
    assert.equal(await popup.locator('#settings input:disabled').count(), 6);
    await page.goto(`${origin}/headers?master-disabled`);
    assert.equal(JSON.parse(await page.locator('#headers').innerText())['save-data'], undefined);
    await page.goto(`${origin}/?disabled`, { waitUntil: 'domcontentloaded' });
    assert.equal(await page.locator(animationSelector).count(), 0);
    assert.equal(await page.locator('#image-11').getAttribute('decoding'), null);
    await setToggle('masterToggle', true);
    await eventually(readRules, rules => rules.length === 2, 'reenable bounded rules');
    await page.waitForFunction(selector => document.querySelector(selector), animationSelector);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForFunction(selector => document.querySelector(selector), animationSelector);
    assert.equal(await page.locator(animationSelector).count(), 1);
    assert.equal((await readStorage()).enabled, true);
  });

  await t.test('history navigation resumes one frame-local optimizer', async () => {
    await page.goto(`${origin}/headers?history`);
    await page.goBack({ waitUntil: 'domcontentloaded' });
    await page.waitForFunction(selector => document.querySelector(selector) &&
      document.querySelector('#image-11')?.getAttribute('decoding') === 'async', animationSelector);
    assert.equal(await page.locator(animationSelector).count(), 1);
  });

  await t.test('disabled state and individual preferences survive a real browser restart', async () => {
    await setToggle('saveData', false);
    await setToggle('masterToggle', false);
    await eventually(readStorage, state => !state.enabled && !state.config.saveData, 'saved disabled state');
    await eventually(readRules, rules => rules.length === 0, 'rules removed before restart');
    await context.close();
    context = await chromium.launchPersistentContext(profile, launchOptions);
    const restartedWorker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
    const restartedPopup = await context.newPage();
    await restartedPopup.goto(`chrome-extension://${extensionId}/popup.html`);
    await restartedPopup.waitForFunction(() => !document.querySelector('#masterToggle').disabled);
    assert.equal(await restartedPopup.locator('#masterToggle').isChecked(), false);
    assert.equal(await restartedPopup.locator('#saveData').isChecked(), false);
    assert.equal(await restartedPopup.locator('#settings input:disabled').count(), 6);
    assert.equal((await restartedWorker.evaluate(() => chrome.declarativeNetRequest.getSessionRules())).length, 0);
    const disabledPage = await context.newPage();
    await disabledPage.goto(`${origin}/headers?after-restart`);
    assert.equal(JSON.parse(await disabledPage.locator('#headers').innerText())['save-data'], undefined);
    assert.equal(await disabledPage.locator(animationSelector).count(), 0);
    await restartedPopup.locator('#masterToggle + .slider').click();
    await eventually(() => restartedWorker.evaluate(() => chrome.declarativeNetRequest.getSessionRules()),
      rules => rules.length === 1 && rules[0].id === 2, 'only saved ad-block rule restored');
  });

  assert.deepEqual(errors, [], 'no content-script or page runtime errors');
});
