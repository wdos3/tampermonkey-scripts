'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { fixture, lockManager } = require('./harness.cjs');

const shark = { id: 'shark-row', name: 'Shark', gain: 20, quantity: 10 };
const actions = f => f.state.requests.map(request => request.inv_id ? 'eat' : request.action);

test('unrelated form replacements wait for the original response in each activity mode', async t => {
  for (const mode of ['gather', 'arena', 'raid']) {
    const f = fixture(t, { mode, activeBattle: true, hpLoss: 0, latency: 3000 });
    await f.start({ actions: 2, interval: 1 });
    f.refresh();
    await f.advance(1500);
    assert.equal(f.state.requests.length, 1, mode);
    assert.match(f.status(), /Still waiting for the game/, mode);
    assert.match(f.ui.getElementById('stats').textContent, /^0 confirmed actions/, mode);
    await f.advance(10000);
    assert.equal(f.state.requests.length, 2, mode);
    assert.match(f.status(), /Action limit reached/, mode);
  }
});

test('a page update during healing cannot send a second meal or an early attack', async t => {
  const f = fixture(t, { mode: 'arena', activeBattle: true, hp: 99, hpLoss: 0, foods: [shark], eatLatency: 3000 });
  await f.start({ actions: 1, interval: 1 });
  f.refresh();
  await f.advance(1500);
  assert.deepEqual(actions(f), ['eat']);
  assert.match(f.status(), /Still waiting/);
  await f.advance(5000);
  assert.deepEqual(actions(f), ['eat', 'swing']);
  assert.match(f.status(), /Action limit reached/);
});

test('missed raid attacks count normally and heal before the next attack', async t => {
  const f = fixture(t, { mode: 'raid', miss: true, hpLoss: 1, foods: [shark] });
  await f.start({ actions: 3, interval: 2 });
  await f.advance(100);
  assert.deepEqual(actions(f), ['attack', 'eat']);
  await f.advance(2000);
  assert.deepEqual(actions(f), ['attack', 'eat']);
  await f.advance(15000);
  assert.deepEqual(actions(f), ['attack', 'eat', 'attack', 'eat', 'attack', 'eat']);
  assert.equal(f.state.raid.hp, 30);
  assert.match(f.ui.getElementById('stats').textContent, /^3 confirmed actions.*3 food eaten/);
  assert.match(f.status(), /Action limit reached/);
});

test('repeated arena misses continue with the normal delay and action limit', async t => {
  const f = fixture(t, { mode: 'arena', activeBattle: true, miss: true, hpLoss: 0 });
  await f.start({ actions: 3, interval: 2 });
  await f.advance(2099);
  assert.deepEqual(actions(f), ['swing']);
  await f.advance(10000);
  assert.deepEqual(actions(f), ['swing', 'swing', 'swing']);
  assert.equal(f.state.arena.hp, 8);
  assert.match(f.status(), /Action limit reached/);
});

test('a fresh explicit miss confirms an arena turn even when the displayed log repeats', async t => {
  const log = 'You miss the Field Mouse.';
  const f = fixture(t, { mode: 'arena', activeBattle: true, miss: true, hpLoss: 0,
    result: { combatLog: log, flash: log } });
  f.state.arena.log = log;
  f.refresh();
  await f.start({ actions: 2 });
  await f.advance(10000);
  assert.deepEqual(actions(f), ['swing', 'swing']);
  assert.match(f.status(), /Action limit reached/);
});

test('a previous raid hit toast cannot confirm the next attack during an unrelated refresh', async t => {
  const f = fixture(t, { mode: 'raid', hpLoss: 0, latency: 3000 });
  await f.start({ actions: 2, interval: 1 });
  await f.advance(4500);
  assert.equal(f.state.requests.length, 2);
  f.refresh();
  await f.advance(500);
  assert.match(f.ui.getElementById('stats').textContent, /^1 confirmed actions/);
  assert.equal(f.state.requests.length, 2);
  await f.advance(3000);
  assert.match(f.status(), /Action limit reached/);
  assert.equal(f.state.requests.length, 2);
});

test('repeated ambiguous updates never extend the response deadline or release the cross-tab lock', async t => {
  const locks = lockManager();
  const f = fixture(t, { mode: 'arena', activeBattle: true, noResponse: true, locks });
  await f.start();
  for (let index = 0; index < 3; index += 1) {
    await f.advance(9000);
    f.refresh();
  }
  assert.equal(f.state.requests.length, 1);
  assert.match(f.status(), /Still waiting/);
  await f.advance(4000);
  assert.equal(f.state.requests.length, 1);
  assert.match(f.status(), /No confirmed response after 30 seconds/);
  const other = fixture(t, { locks });
  await other.start();
  assert.equal(other.state.requests.length, 0);
  assert.match(other.status(), /Another tab/);
});

test('Stop during an ambiguous update cannot restart combat when its delayed response arrives', async t => {
  const f = fixture(t, { mode: 'arena', activeBattle: true, latency: 3000, hpLoss: 0 });
  await f.start();
  f.refresh();
  f.stop();
  await f.advance(10000);
  assert.deepEqual(actions(f), ['swing']);
  assert.match(f.status(), /Stopped.*last sent action completed/);
});

test('a miss on a different boss never confirms the selected raid attack', async t => {
  const f = fixture(t, { mode: 'raid', noResponse: true });
  await f.start();
  f.state.raid.id = '999';
  f.swap({ kind: 'raid', flash: 'You miss Fixture Boss.' });
  await f.advance(31000);
  assert.deepEqual(actions(f), ['attack']);
  assert.match(f.ui.getElementById('stats').textContent, /^0 confirmed actions/);
});
