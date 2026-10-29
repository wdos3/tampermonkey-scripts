'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { JSDOM } = require('jsdom');
const { page } = require('./fixture.cjs');
const { fixture, flush, lockManager, source } = require('./harness.cjs');

const PANEL_ID = 'dankscape-gather-assistant';

function startup(t, { path = '/gather.php', prepare = () => {} } = {}) {
  const dom = new JSDOM(page(), { url: `https://dankscape.com${path}`, runScripts: 'outside-only' });
  const { window } = dom;
  const menus = new Map();
  const errors = [];
  window.GM_getValue = () => ({ actions: 9, food: 'Shark' });
  window.GM_setValue = () => {};
  window.GM_registerMenuCommand = (name, callback) => menus.set(name, callback);
  window.console.error = (...details) => errors.push(details);
  Object.defineProperty(window.navigator, 'locks', { value: lockManager() });
  const cleanup = prepare(window);
  window.eval(source);
  t.after(() => {
    cleanup?.();
    window.close();
  });
  return { window, menus, errors, host: () => window.document.getElementById(PANEL_ID),
    show: () => menus.get('Show DankScape Assistant')() };
}

test('navigation pages show the panel without enabling automation', t => {
  for (const path of ['/characters.php', '/inn.php', '/bank.php', '/']) {
    const f = startup(t, { path });
    assert.ok(f.host());
    assert.equal(f.host().shadowRoot.getElementById('start').disabled, true);
    assert.match(f.host().shadowRoot.getElementById('status').textContent, /Choose an activity above/);
    assert.equal(f.host().shadowRoot.getElementById('actions').value, '9');
  }
  assert.match(source, /^\/\/ @match\s+https:\/\/dankscape\.com\/\*$/m);
});

test('startup succeeds when HTML-string setters reject plain strings', t => {
  const f = startup(t, { prepare(window) {
    const originals = new Map();
    for (const prototype of [window.Element.prototype, window.ShadowRoot.prototype]) {
      originals.set(prototype, Object.getOwnPropertyDescriptor(prototype, 'innerHTML'));
      Object.defineProperty(prototype, 'innerHTML', { configurable: true,
        set() { throw new TypeError('TrustedHTML is required'); } });
    }
    return () => {
      for (const [prototype, descriptor] of originals) Object.defineProperty(prototype, 'innerHTML', descriptor);
    };
  } });
  assert.equal(f.errors.length, 0);
  assert.equal(f.host().shadowRoot.getElementById('start').disabled, false);
  assert.match(f.host().shadowRoot.querySelector('h2').textContent, /v\d+\.\d+\.\d+/);
});

test('injection before body creation waits and initializes exactly one panel', t => {
  let body;
  const f = startup(t, { prepare(window) {
    body = window.document.body;
    body.remove();
  } });
  assert.equal(f.host(), null);
  f.window.document.documentElement.appendChild(body);
  f.window.document.dispatchEvent(new f.window.Event('DOMContentLoaded'));
  const host = f.host();
  assert.ok(host);
  f.window.document.dispatchEvent(new f.window.Event('DOMContentLoaded'));
  assert.equal(f.host(), host);
  assert.equal(f.window.document.querySelectorAll(`#${PANEL_ID}`).length, 1);
  assert.equal(f.errors.length, 0);
});

test('an empty abandoned panel does not suppress startup', t => {
  const f = startup(t, { prepare(window) {
    const abandoned = window.document.createElement('div');
    abandoned.id = PANEL_ID;
    abandoned.attachShadow({ mode: 'open' });
    window.document.body.appendChild(abandoned);
  } });
  assert.equal(f.window.document.querySelectorAll(`#${PANEL_ID}`).length, 1);
  assert.equal(f.host().shadowRoot.getElementById('start').disabled, false);
});

test('startup errors remain visible and can be retried through the menu', t => {
  let broken = true;
  const f = startup(t, { prepare(window) {
    const select = window.document.querySelectorAll.bind(window.document);
    window.document.querySelectorAll = selector => {
      if (broken && selector.includes('[data-fold-group]')) throw new Error('Fixture DOM unavailable');
      return select(selector);
    };
  } });
  assert.match(f.host().shadowRoot.textContent, /Startup failed: Fixture DOM unavailable/);
  assert.equal(f.host().shadowRoot.getElementById('start'), null);
  assert.equal(f.errors.length, 1);
  broken = false;
  f.show();
  assert.equal(f.host().shadowRoot.getElementById('start').disabled, false);
  assert.equal(f.host().shadowRoot.getElementById('actions').value, '9');
});

test('the menu and show-panel shortcut restore visibility without resetting settings', t => {
  const f = startup(t);
  const host = f.host();
  const ui = host.shadowRoot;
  ui.getElementById('actions').value = '17';
  ui.getElementById('collapse').click();
  host.hidden = true;
  host.style.setProperty('display', 'none', 'important');
  f.show();
  assert.equal(host.hidden, false);
  assert.equal(host.style.display, 'block');
  assert.equal(host.style.getPropertyPriority('display'), 'important');
  assert.equal(ui.getElementById('controls').hidden, false);
  assert.equal(ui.getElementById('actions').value, '17');
  ui.getElementById('collapse').click();
  f.window.document.dispatchEvent(new f.window.KeyboardEvent('keydown', { code: 'KeyP', altKey: true, shiftKey: true }));
  assert.equal(ui.getElementById('controls').hidden, false);
  assert.equal(ui.getElementById('stop').disabled, true);
});

test('replacing the body leaves the paused panel mounted', async t => {
  const f = startup(t);
  const host = f.host();
  f.window.document.body.replaceWith(f.window.document.createElement('body'));
  await flush();
  assert.equal(f.host(), host);
  assert.equal(host.isConnected, true);
  assert.equal(host.parentElement, f.window.document.documentElement);
  assert.equal(host.shadowRoot.getElementById('stop').disabled, true);
});

test('removing the panel during a request restores it, stops further actions, and retains the lock', async t => {
  const locks = lockManager();
  const f = fixture(t, { locks, latency: 500 });
  const host = f.document.getElementById(PANEL_ID);
  await f.start();
  host.remove();
  await flush();
  assert.equal(host.isConnected, true);
  assert.match(f.status(), /panel was removed/);
  assert.equal(f.ui.getElementById('start').disabled, true);
  const other = fixture(t, { locks });
  await other.start();
  assert.equal(other.state.requests.length, 0);
  assert.match(other.status(), /Another tab/);
  await f.advance(10000);
  assert.equal(f.state.requests.length, 1);
  assert.equal(f.ui.getElementById('start').disabled, false);
  await other.start({ actions: 1 });
  assert.equal(other.state.requests.length, 1);
});
