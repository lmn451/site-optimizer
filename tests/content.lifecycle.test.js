const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const tick = () => new Promise(resolve => setImmediate(resolve));
const config = Object.fromEntries(['lazyLoad', 'imageOptimization', 'noAnimation', 'blockAds', 'saveData', 'preload'].map(key => [key, false]));

// Delayed storage reads exercise callback races that are difficult to schedule
// deterministically in a browser. Real DOM/network behavior is tested separately.
function harness(firefox = false) {
  const reads = [];
  const listeners = {};
  const observers = [];
  const frames = new Map();
  let nextFrame = 0;
  let onChanged;
  const document = { nodeType: 9, querySelectorAll: () => [] };
  const window = {
    addEventListener: (name, callback) => { listeners[name] = callback; },
    requestAnimationFrame: callback => { frames.set(++nextFrame, callback); return nextFrame; },
    cancelAnimationFrame: id => frames.delete(id),
  };
  const errors = [];
  const context = vm.createContext({ document, window, console: { error: (...args) => errors.push(args) },
    [firefox ? 'browser' : 'chrome']: { storage: {
      local: { get: () => new Promise(resolve => reads.push(resolve)) },
      onChanged: { addListener: callback => { onChanged = callback; } },
    } },
    MutationObserver: class {
      constructor() { this.active = false; observers.push(this); }
      observe(target) { assert.equal(target, document); this.active = true; }
      disconnect() { this.active = false; }
    },
  });
  for (const file of ['settings.js', 'contentScript.js']) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), context);
  }
  return {
    reads, frames, observers, errors,
    event: name => listeners[name](),
    change: () => onChanged({ enabled: { newValue: false } }, 'local'),
    resolve: async (index, enabled = true) => { reads[index]({ enabled, config }); await tick(); },
  };
}

test('pagehide invalidates pending initialization and pageshow resumes exactly once', async () => {
  const h = harness();
  h.event('pagehide');
  await h.resolve(0);
  assert.equal(h.observers.length, 0);
  assert.equal(h.frames.size, 0);
  h.event('pageshow');
  await h.resolve(1);
  assert.equal(h.observers.filter(observer => observer.active).length, 1);
  assert.equal(h.frames.size, 1);
  h.event('pageshow');
  await h.resolve(2);
  assert.equal(h.observers.length, 1);
  h.event('pagehide');
  assert.equal(h.observers.filter(observer => observer.active).length, 0);
  assert.equal(h.frames.size, 0);
  assert.deepEqual(h.errors, []);
});

test('storage notifications while suspended cannot restart observers or scheduled writes', async () => {
  const h = harness();
  await h.resolve(0);
  h.event('pagehide');
  h.change();
  await h.resolve(1, true);
  assert.equal(h.observers.filter(observer => observer.active).length, 0);
  assert.equal(h.frames.size, 0);
  h.event('pageshow');
  await h.resolve(2, false);
  assert.equal(h.observers.filter(observer => observer.active).length, 0);
  assert.deepEqual(h.errors, []);
});

test('a newer disabled-state read wins over an older enabled-state read', async () => {
  const h = harness();
  h.change();
  await h.resolve(1, false);
  await h.resolve(0, true);
  assert.equal(h.observers.length, 0);
  assert.equal(h.frames.size, 0);
  assert.deepEqual(h.errors, []);
});

test('Firefox content scripts use the Promise-based browser API without requiring chrome', async () => {
  const h = harness(true);
  await h.resolve(0);
  assert.equal(h.observers.filter(observer => observer.active).length, 1);
  h.change();
  await h.resolve(1, false);
  assert.equal(h.observers.filter(observer => observer.active).length, 0);
  assert.deepEqual(h.errors, []);
});
