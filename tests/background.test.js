const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const source = name => fs.readFileSync(path.join(__dirname, '..', name), 'utf8');
const clone = value => JSON.parse(JSON.stringify(value));
const tick = () => new Promise(resolve => setImmediate(resolve));
function event() {
  const listeners = [];
  return { addListener: fn => listeners.push(fn), fire: (...args) => Promise.all(listeners.map(fn => fn(...args))) };
}
function harness(initial = {}, legacy = [], firefox = false) {
  let data = clone(initial), rules = clone(legacy), active = 0, maxActive = 0;
  const errors = [];
  const changed = event();
  const api = {
    runtime: { onInstalled: event(), onStartup: event() },
    storage: { onChanged: changed, local: {
      get: async () => { await tick(); return clone(data); },
      set: async patch => {
        const changes = Object.fromEntries(Object.entries(patch).map(([key, value]) => [key, { oldValue: data[key], newValue: clone(value) }]));
        Object.assign(data, clone(patch));
        await changed.fire(changes, 'local');
      },
    } },
    declarativeNetRequest: {
      getSessionRules: async () => clone(rules),
      updateSessionRules: async ({ removeRuleIds, addRules }) => {
        maxActive = Math.max(maxActive, ++active);
        await tick();
        rules = rules.filter(rule => !removeRuleIds.includes(rule.id));
        for (const rule of addRules) {
          assert.ok(!rules.some(existing => existing.id === rule.id));
          rules.push(clone(rule));
        }
        active--;
      },
    },
  };
  const context = vm.createContext({ [firefox ? 'browser' : 'chrome']: api, console: { error: (...args) => errors.push(args) } });
  context.importScripts = file => vm.runInContext(source(file), context);
  if (firefox) vm.runInContext(source('settings.js'), context);
  vm.runInContext(source('background.js'), context);
  return { api, context, data: () => data, rules: () => rules, errors, maxActive: () => maxActive,
    settle: async () => { for (let i = 0; i < 80; i++) await tick(); } };
}
test('normalization has six defaults and accepts only boolean known settings', () => {
  const context = vm.createContext({});
  vm.runInContext(source('settings.js'), context);
  const normalize = value => clone(context.OptimizerSettings.normalizeSettings(value));
  assert.equal(Object.keys(normalize().config).length, 6);
  assert.ok(Object.values(normalize(null).config).every(Boolean));
  const state = normalize({ enabled: false, config: { saveData: false, lazyLoad: 'false', bogus: true } });
  assert.equal(state.enabled, false);
  assert.equal(state.config.saveData, false);
  assert.equal(state.config.lazyLoad, true);
  assert.equal(state.config.bogus, undefined);
});
test('initializes defaults and migrates every legacy session duplicate', async () => {
  const h = harness({}, [{ id: 15 }, { id: 24 }, { id: 30 }]);
  await h.settle();
  assert.equal(h.data().enabled, true);
  assert.equal(Object.keys(h.data().config).length, 6);
  assert.deepEqual(h.rules().map(r => r.id), [1, 2]);
  assert.deepEqual(h.errors, []);
});
test('installation and startup preserve disabled settings and merge missing defaults (Firefox scripts)', async () => {
  const h = harness({ enabled: false, config: { saveData: false, lazyLoad: false }, unrelated: 42 }, [], true);
  await h.settle();
  await h.api.runtime.onInstalled.fire({ reason: 'update' });
  await h.api.runtime.onStartup.fire();
  await h.settle();
  assert.equal(h.data().enabled, false);
  assert.equal(h.data().config.saveData, false);
  assert.equal(h.data().config.lazyLoad, false);
  assert.equal(h.data().config.blockAds, true);
  assert.equal(h.data().unrelated, 42);
  assert.deepEqual(h.rules(), []);
});
test('each combination of enabled, saveData and blockAds has exact bounded rules', async () => {
  const h = harness(); await h.settle();
  for (const enabled of [true, false]) for (const saveData of [true, false]) for (const blockAds of [true, false]) {
    await h.api.storage.local.set({ enabled, config: { saveData, blockAds } });
    await h.settle();
    assert.deepEqual(h.rules().map(r => r.id), enabled ? [...(saveData ? [1] : []), ...(blockAds ? [2] : [])] : []);
  }
});
test('ad blocking is restricted to third-party known-domain subresources', async () => {
  const h = harness(); await h.settle();
  const ad = h.rules().find(r => r.id === 2);
  assert.equal(ad.condition.domainType, 'thirdParty');
  assert.equal(ad.condition.requestDomains.length, 3);
  assert.ok(!ad.condition.resourceTypes.includes('main_frame'));
  assert.equal(h.rules()[0].action.requestHeaders[0].header, 'Save-Data');
});
test('queued concurrent changes read latest state, never overlap or grow rule counts', async () => {
  const h = harness(); await h.settle();
  const writes = [];
  for (let i = 0; i < 30; i++) writes.push(h.api.storage.local.set({ enabled: i % 2 === 0 }));
  await Promise.all(writes);
  await h.api.storage.local.set({ enabled: true, config: { saveData: false, blockAds: true } });
  await h.settle();
  assert.deepEqual(h.rules().map(r => r.id), [2]);
  assert.equal(h.maxActive(), 1);
  assert.deepEqual(h.errors, []);
});
test('manifest has no injection permissions and loads shared settings first', () => {
  const manifest = JSON.parse(source('manifest.json'));
  assert.deepEqual(manifest.permissions.sort(), ['declarativeNetRequest', 'storage']);
  assert.deepEqual(manifest.content_scripts[0].js, ['settings.js', 'contentScript.js']);
  assert.equal(manifest.content_scripts[0].all_frames, true);
  assert.equal(manifest.content_scripts[0].run_at, 'document_start');
  assert.ok(source('popup.html').indexOf('src="settings.js"') < source('popup.html').indexOf('src="popup.js"'));
});
test('DNR update failure is reported and later changes recover the queue', async () => {
  const h = harness(); await h.settle();
  const update = h.api.declarativeNetRequest.updateSessionRules;
  h.api.declarativeNetRequest.updateSessionRules = async () => { throw Error('temporary failure'); };
  await h.api.storage.local.set({ enabled: false });
  await h.settle();
  assert.equal(h.errors.length, 1);
  h.api.declarativeNetRequest.updateSessionRules = update;
  await h.api.storage.local.set({ enabled: false });
  await h.settle();
  assert.deepEqual(h.rules(), []);
});
