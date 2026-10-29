'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { fixture } = require('./harness.cjs');
const KEY = 'dankscape-assistant:verification-checkpoint:v1';
const repeatedMiss = 'Your attack glances off the Field Mouse.\nThe Field Mouse swings and misses.';
const completed = overrides => ({ name: 'https://dankscape.com/arena.php', initiatorType: 'fetch', startTime: 0,
  responseStart: 100, responseEnd: 100, decodedBodySize: 100, responseStatus: 200, ...overrides });

function applyLiveFrame(document, frame) {
  document.body.innerHTML = frame.body;
  // Browser exports omit hidden values. These are synthetic fixture actions,
  // using the existing form contract; no live token or hidden value is recovered.
  for (const form of document.querySelectorAll('.fight-stage form')) {
    const action = form.querySelector('input[name="action"]');
    if (action) action.value = form.querySelector('button[data-label="Strike!"]') ? 'swing' : 'flee';
  }
}

async function pendingRepeat(t, options = {}) {
  const f = fixture(t, { mode: 'arena', activeBattle: true, damage: 0, hpLoss: 0, noResponse: true, ...options });
  f.state.arena.log = repeatedMiss;
  f.refresh();
  await f.start({ actions: 1, autoRecover: false });
  return f;
}

test('eight identical glance/miss turns complete without recovery or invented damage', async t => {
  const f = fixture(t, { mode: 'arena', activeBattle: true, miss: true, hpLoss: 0 });
  await f.start({ actions: 8, interval: 1 });
  await f.advance(15000);
  assert.equal(f.state.requests.length, 8);
  assert.equal(f.state.arena.hp, 8);
  assert.equal(f.state.arena.log, repeatedMiss);
  assert.match(f.ui.getElementById('stats').textContent, /^8 confirmed actions.*0 food eaten/);
  assert.match(f.status(), /Action limit reached/);
  assert.equal(f.state.navigations.length, 0);
});

test('equal-damage hits also continue when the two-line transcript repeats', async t => {
  const f = fixture(t, { mode: 'arena', activeBattle: true, damage: 2, hpLoss: 0, enemyHP: 66 });
  await f.start({ actions: 6, interval: 1 });
  await f.advance(15000);
  assert.equal(f.state.requests.length, 6);
  assert.equal(f.state.arena.hp, 54);
  assert.match(f.status(), /Action limit reached/);
});

test('an identical old outcome in an unrelated replacement waits for the original transport', async t => {
  const f = await pendingRepeat(t);
  for (let index = 0; index < 3; index += 1) {
    f.refresh();
    await f.advance(500);
  }
  assert.match(f.ui.getElementById('stats').textContent, /^0 confirmed actions/);
  assert.equal(f.state.requests.length, 1);
  f.resource(completed());
  await f.advance(250);
  assert.match(f.status(), /Action limit reached/);
  assert.equal(f.state.requests.length, 1);
});

test('resource delivery after the DOM swap still confirms the original turn once', async t => {
  const f = await pendingRepeat(t);
  f.swap({ kind: 'strike', combatLog: repeatedMiss });
  await f.advance(500);
  assert.match(f.ui.getElementById('stats').textContent, /^0 confirmed actions/);
  f.resource(completed());
  await f.advance(500);
  f.resource(completed());
  assert.match(f.ui.getElementById('stats').textContent, /^1 confirmed actions/);
  assert.equal(f.state.requests.length, 1);
});

test('unrelated, failed, aborted, and empty resource entries cannot confirm a repeated turn', async t => {
  const f = await pendingRepeat(t);
  f.refresh();
  for (const entry of [completed({ name: 'https://dankscape.com/notify_poll.php' }), completed({ initiatorType: 'img' }),
    completed({ startTime: -1 }), completed({ responseStatus: 503 }), completed({ responseStatus: 0 }),
    completed({ responseStart: 0 }), completed({ decodedBodySize: 0 })]) {
    f.resource(entry);
    await f.advance(250);
    assert.match(f.ui.getElementById('stats').textContent, /^0 confirmed actions/);
  }
  f.resource(completed());
  await f.advance(250);
  assert.match(f.status(), /Action limit reached/);
});

test('a recovery GET and reset entry messages do not masquerade as a completed attack', async t => {
  const f = fixture(t, { mode: 'arena', activeBattle: true, noResponse: true, beforeScript(window) {
    const html = window.document.documentElement.outerHTML;
    window.fetch = async url => {
      const at = window.performance.now();
      f.resource(completed({ name: url, startTime: at, responseStart: at + 1, responseEnd: at + 2 }));
      return { ok: true, url, text: async () => html };
    };
  } });
  f.state.arena.log = repeatedMiss;
  f.refresh();
  await f.start();
  await f.advance(40000);
  assert.match(f.status(), /Automatic recovery could not confirm/);
  assert.equal(f.state.navigations.length, 0);
  assert.match(f.ui.getElementById('stats').textContent, /^0 confirmed actions/);
});

test('a rejected human check does not count the previous miss despite a completed transport', async t => {
  const f = await pendingRepeat(t);
  f.resource(completed());
  f.swap({ guard: true, kind: 'strike' });
  await f.advance(1000);
  assert.equal(JSON.parse(f.session()[KEY]).completed, 0);
  assert.equal(JSON.parse(f.session()[KEY]).canResume, true);
  assert.equal(f.state.verificationClicks, 0);
});

test('opponent-only messages and neutral entry messages cannot confirm the hero’s strike', async t => {
  for (const log of ['The Field Mouse swings and misses.', 'Heroism has entered the arena.\nField Mouse has entered the arena.']) {
    const f = await pendingRepeat(t);
    f.resource(completed());
    f.swap({ kind: 'strike', combatLog: log });
    await f.advance(1000);
    assert.match(f.ui.getElementById('stats').textContent, /^0 confirmed actions/);
    assert.equal(f.state.requests.length, 1);
  }
});

test('missing resource observation retains the conservative behavior for identical results', async t => {
  const f = fixture(t, { mode: 'arena', activeBattle: true, miss: true, hpLoss: 0,
    beforeScript(window) { window.PerformanceObserver = undefined; } });
  await f.start({ actions: 2, autoRecover: false });
  await f.advance(40000);
  assert.equal(f.state.requests.length, 2);
  assert.match(f.ui.getElementById('stats').textContent, /^1 confirmed actions/);
  assert.match(f.status(), /No confirmed response after 30 seconds/);
});

test('resource observation resumes after returning from the browser page cache', async t => {
  const f = fixture(t, { mode: 'arena', activeBattle: true, miss: true, hpLoss: 0 });
  await f.start({ actions: 1 });
  await f.advance(500);
  f.window.dispatchEvent(new f.window.Event('pagehide'));
  f.window.dispatchEvent(new f.window.Event('pageshow'));
  await f.start({ actions: 1 });
  await f.advance(2000);
  assert.equal(f.state.requests.length, 2);
  assert.match(f.status(), /Action limit reached/);
});

test('enemy names containing regex punctuation are matched literally', async t => {
  const f = fixture(t, { mode: 'arena', activeBattle: true, miss: true, hpLoss: 0 });
  f.state.arena.name = 'Odd Foe (Elite)';
  f.refresh();
  await f.start({ actions: 2 });
  await f.advance(10000);
  assert.equal(f.state.requests.length, 2);
  assert.match(f.status(), /Action limit reached/);
});

test('the captured live Forest Troll responses confirm both identical misses', async t => {
  const trace = JSON.parse(readFileSync(join(__dirname, 'fixtures', 'forest-troll-repeated-turns.json'), 'utf8'));
  assert.equal(trace.frames[1].log, trace.frames[2].log);
  assert.equal(trace.frames[1].hp, trace.frames[2].hp);
  assert.equal(trace.frames[1].enemyHP, trace.frames[2].enemyHP);
  const f = fixture(t, { mode: 'arena', url: 'https://dankscape.com/arena.php', noResponse: true,
    beforeScript(window) { applyLiveFrame(window.document, trace.frames[0]); } });
  await f.start({ actions: 2, interval: 1 });
  await f.advance(100);
  applyLiveFrame(f.document, trace.frames[1]);
  f.resource(completed());
  f.document.dispatchEvent(new f.window.CustomEvent('dank:swapped'));
  await f.advance(1200);
  assert.equal(f.state.requests.length, 2);
  applyLiveFrame(f.document, trace.frames[2]);
  f.resource(completed({ startTime: 1100, responseStart: 1300, responseEnd: 1300 }));
  f.document.dispatchEvent(new f.window.CustomEvent('dank:swapped'));
  await f.advance(500);
  assert.match(f.ui.getElementById('stats').textContent, /^2 confirmed actions/);
  assert.match(f.status(), /Action limit reached/);
  assert.equal(f.state.navigations.length, 0);
});
