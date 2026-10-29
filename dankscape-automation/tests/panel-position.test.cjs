'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { fixture } = require('./harness.cjs');
const KEY = 'panel:position';

function panel(t, options = {}) {
  return fixture(t, { ...options, beforeScript(window) {
    const original = window.HTMLElement.prototype.getBoundingClientRect;
    window.HTMLElement.prototype.getBoundingClientRect = function () {
      if (this.id !== 'dankscape-gather-assistant') return original.call(this);
      const width = Math.min(340, window.innerWidth - 32);
      const height = Math.min(500, window.innerHeight - 32);
      return { left: parseFloat(this.style.left) || window.innerWidth - width - 16,
        top: parseFloat(this.style.top) || window.innerHeight - height - 16, width, height };
    };
    let capture = null;
    window.Element.prototype.setPointerCapture = id => { capture = id; };
    window.Element.prototype.hasPointerCapture = id => capture === id;
    window.Element.prototype.releasePointerCapture = () => { capture = null; };
  } });
}

function pointer(f, node, type, x, y, id = 1) {
  const event = new f.window.MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0 });
  Object.defineProperty(event, 'pointerId', { value: id });
  node.dispatchEvent(event);
}

test('dragging the header persists a position and the next page restores it', t => {
  const values = {};
  const f = panel(t, { values });
  const header = f.ui.querySelector('header');
  const start = f.ui.host.getBoundingClientRect();
  pointer(f, header, 'pointerdown', start.left + 10, start.top + 10);
  pointer(f, header, 'pointermove', 110, 90);
  pointer(f, header, 'pointerup', 110, 90);
  assert.deepEqual(JSON.parse(JSON.stringify(values[KEY])), { x: 100, y: 80 });
  assert.equal(f.state.requests.length, 0);
  const next = panel(t, { values, mode: 'arena' });
  assert.equal(next.ui.host.style.left, '100px');
  assert.equal(next.ui.host.style.top, '80px');
  assert.equal(next.ui.host.style.right, 'auto');
});

test('the collapse control does not drag, while the Move handle does', t => {
  const f = panel(t);
  pointer(f, f.ui.getElementById('collapse'), 'pointerdown', 500, 100);
  pointer(f, f.ui.querySelector('header'), 'pointermove', 100, 80);
  assert.equal(f.ui.host.style.left, 'auto');
  pointer(f, f.ui.getElementById('move'), 'pointerdown', 500, 100);
  pointer(f, f.ui.querySelector('header'), 'pointermove', 200, 100);
  pointer(f, f.ui.querySelector('header'), 'pointerup', 200, 100);
  assert.notEqual(f.ui.host.style.left, 'auto');
  const header = f.ui.querySelector('header');
  pointer(f, header, 'pointerdown', 200, 100);
  pointer(f, header, 'lostpointercapture', 200, 100);
  pointer(f, header, 'pointerdown', 200, 100);
  pointer(f, header, 'pointermove', 180, 100);
  pointer(f, header, 'pointerup', 180, 100);
  assert.equal(f.ui.host.style.left, `${f.window.innerWidth - 340 - 16 - 320}px`);
});

test('arrow keys move the handle and Home restores the default corner', t => {
  const f = panel(t, { values: { [KEY]: { x: 100, y: 80 } } });
  const move = f.ui.getElementById('move');
  move.dispatchEvent(new f.window.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
  move.dispatchEvent(new f.window.KeyboardEvent('keydown', { key: 'ArrowDown', shiftKey: true, bubbles: true }));
  assert.equal(f.ui.host.style.left, '110px');
  assert.equal(f.ui.host.style.top, '130px');
  move.dispatchEvent(new f.window.KeyboardEvent('keydown', { key: 'Home', bubbles: true }));
  assert.equal(f.values[KEY], null);
  assert.equal(f.ui.host.style.left, 'auto');
  assert.equal(f.ui.host.style.right, '16px');
});

test('off-screen positions clamp into view after load and resize', t => {
  const f = panel(t, { values: { [KEY]: { x: 9000, y: -1000 } } });
  assert.equal(f.ui.host.style.top, '8px');
  assert.equal(parseFloat(f.ui.host.style.left), f.window.innerWidth - 340 - 8);
  f.window.innerWidth = 400;
  f.window.innerHeight = 300;
  f.window.dispatchEvent(new f.window.Event('resize'));
  assert.equal(f.ui.host.style.left, '52px');
  assert.equal(f.ui.host.style.top, '8px');
});

test('restoring a removed panel preserves its moved position', t => {
  const f = panel(t, { values: { [KEY]: { x: 70, y: 50 } } });
  f.ui.host.hidden = true;
  f.window.document.dispatchEvent(new f.window.KeyboardEvent('keydown', { code: 'KeyP', altKey: true, shiftKey: true, bubbles: true }));
  assert.equal(f.ui.host.hidden, false);
  assert.equal(f.ui.host.style.left, '70px');
  assert.equal(f.ui.host.style.top, '50px');
});

test('position persistence failures are visible without stopping a running action', async t => {
  const f = panel(t);
  await f.start({ actions: 2 });
  f.window.GM_setValue = () => { throw new Error('position storage unavailable'); };
  f.ui.getElementById('move').dispatchEvent(new f.window.KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
  assert.match(f.status(), /Could not save panel position/);
  await f.advance(5000);
  assert.equal(f.state.requests.length, 2);
});
