const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const clone = value => JSON.parse(JSON.stringify(value));
const source = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
const tick = () => new Promise(resolve => setImmediate(resolve));
async function popup(initial = {}, options = {}) {
  const elements = new Map();
  function element(id) {
    if (!elements.has(id)) elements.set(id, {
      id, checked: false, disabled: false, textContent: '', listeners: {}, classes: new Set(),
      addEventListener(type, callback) { this.listeners[type] = callback; },
      change(checked) { this.checked = checked; this.listeners.change({ target: this }); },
      classList: { toggle(name, enabled) { elements.get(id).classes[enabled ? 'add' : 'delete'](name); } },
    });
    return elements.get(id);
  }
  const listeners = [];
  let data = clone(initial), ready, failGet = !!options.failGet, failSet = false, active = 0, maxActive = 0;
  let afterSet;
  const api = { storage: {
    onChanged: { addListener: callback => listeners.push(callback) },
    local: {
      get: async () => { await tick(); if (failGet) throw Error('read failed'); return clone(data); },
      set: async patch => {
        maxActive = Math.max(maxActive, ++active);
        await tick(); active--;
        if (failSet) throw Error('write failed');
        const changes = Object.fromEntries(Object.entries(patch).map(([key, value]) => [key, { newValue: clone(value) }]));
        Object.assign(data, clone(patch));
        listeners.forEach(listener => listener(changes, 'local'));
        const callback = afterSet;
        afterSet = undefined;
        if (callback) await callback();
      },
    },
  } };
  const context = vm.createContext({ chrome: api, document: {
    getElementById: element,
    addEventListener: (_, callback) => { ready = callback; },
  } });
  vm.runInContext(source('settings.js'), context);
  vm.runInContext(source('popup.js'), context);
  await ready();
  return { element, data: () => data, api, maxActive: () => maxActive,
    afterNextSet: callback => { afterSet = callback; },
    failSet: value => { failSet = value; },
    settle: async () => { for (let i = 0; i < 60; i++) await tick(); } };
}
test('missing and partial config renders six defaults safely', async () => {
  const h = await popup({ enabled: false, config: { lazyLoad: false, unknown: false } });
  assert.equal(h.element('masterToggle').checked, false);
  assert.equal(h.element('lazyLoad').checked, false);
  assert.equal(h.element('saveData').checked, true);
  assert.equal(h.element('saveData').disabled, true);
  const empty = await popup();
  assert.equal(empty.element('masterToggle').checked, true);
  assert.equal(empty.element('blockAds').checked, true);
  assert.equal(empty.element('blockAds').disabled, false);
});

test('external disable during a pending save is reflected in the final popup UI', async () => {
  const h = await popup({ enabled: true });
  h.afterNextSet(() => h.api.storage.local.set({ enabled: false }));
  h.element('lazyLoad').change(false);
  await h.settle();
  assert.equal(h.data().enabled, false);
  assert.equal(h.data().config.lazyLoad, false);
  assert.equal(h.element('masterToggle').checked, false);
  assert.equal(h.element('lazyLoad').disabled, true);
});
test('rapid independent and repeated toggles preserve every final setting', async () => {
  const h = await popup();
  h.element('lazyLoad').change(false);
  h.element('blockAds').change(false);
  h.element('saveData').change(false);
  h.element('lazyLoad').change(true);
  h.element('masterToggle').change(false);
  h.element('masterToggle').change(true);
  await h.settle();
  assert.equal(h.data().config.lazyLoad, true);
  assert.equal(h.data().config.blockAds, false);
  assert.equal(h.data().config.saveData, false);
  assert.equal(h.data().config.preload, true);
  assert.equal(h.data().enabled, true);
  assert.equal(h.maxActive(), 1);
  assert.equal(h.element('blockAds').checked, false);
  assert.equal(h.element('saveData').disabled, false);
});
test('load failure displays error and prevents writing fabricated defaults', async () => {
  const h = await popup({}, { failGet: true });
  assert.match(h.element('status').textContent, /Could not load/);
  assert.equal(h.element('masterToggle').disabled, true);
  assert.equal(h.element('saveData').disabled, true);
  assert.deepEqual(h.data(), {});
});
test('failed write restores confirmed state and queue recovers on retry', async () => {
  const h = await popup();
  h.failSet(true);
  h.element('masterToggle').change(false);
  await h.settle();
  assert.equal(h.element('masterToggle').checked, true);
  assert.equal(h.element('saveData').disabled, false);
  assert.match(h.element('status').textContent, /Could not save/);
  h.failSet(false);
  h.element('saveData').change(false);
  await h.settle();
  assert.equal(h.data().config.saveData, false);
  assert.equal(h.element('status').textContent, '');
});
test('storage updates refresh popup without tab APIs or runtime messages', async () => {
  const h = await popup();
  await h.api.storage.local.set({ enabled: false, config: { blockAds: false } });
  assert.equal(h.element('masterToggle').checked, false);
  assert.equal(h.element('saveData').disabled, true);
  assert.equal(h.element('blockAds').checked, false);
  assert.equal(h.element('preload').checked, true);
});
