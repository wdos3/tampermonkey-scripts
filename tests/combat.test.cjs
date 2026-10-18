'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { fixture, lockManager } = require('./harness.cjs');

const shark = { id: 'shark-row', name: 'Shark', gain: 20, quantity: 100 };
const actions = f => f.state.requests.map(request => request.inv_id ? 'eat' : request.action);

test('arena repeats the selected foe and stops at the victory limit', async t => {
  const f = fixture(t, { mode: 'arena', hpLoss: 0 });
  await f.start({ battles: 2, interval: 1 });
  await f.advance(20000);
  assert.deepEqual(actions(f), ['engage', 'swing', 'swing', 'swing', 'engage', 'swing', 'swing', 'swing']);
  assert.ok(f.state.requests.filter(request => request.monster_id).every(request => request.monster_id === '1'));
  assert.match(f.status(), /Arena win limit reached/);
  assert.match(f.ui.getElementById('stats').textContent, /6 confirmed actions.*2 wins/);
});

test('losing one HP immediately starts healing before the configured attack delay', async t => {
  const f = fixture(t, { mode: 'arena', activeBattle: true, hpLoss: 1, foods: [shark] });
  await f.start({ actions: 1, interval: 30 });
  await f.advance(100);
  assert.deepEqual(actions(f), ['swing', 'eat']);
  assert.match(f.status(), /Eating Shark/);
  assert.equal(f.state.requests[1].fill, '');
  await f.advance(100);
  assert.match(f.status(), /Action limit reached/);
  assert.equal(f.document.querySelector('.hp-text').textContent, '100 / 100 HP');
  assert.equal(f.document.getElementById('hud-energy').textContent, '100 / 100');
});

test('continues eating small food until HP is full, then stops at the action limit', async t => {
  const f = fixture(t, { mode: 'arena', activeBattle: true, hpLoss: 7,
    foods: [{ id: 'small-food', name: 'Small Food', gain: 3, quantity: 10 }] });
  await f.start({ actions: 1 });
  await f.advance(1000);
  assert.deepEqual(actions(f), ['swing', 'eat', 'eat', 'eat']);
  assert.equal(f.document.querySelector('.hp-text').textContent, '100 / 100 HP');
  assert.match(f.status(), /Action limit reached/);
});

test('heals existing injuries before engaging a foe', async t => {
  const f = fixture(t, { mode: 'arena', hp: 99, foods: [shark], hpLoss: 0 });
  await f.start({ actions: 1 });
  assert.deepEqual(actions(f), ['eat']);
  await f.advance(5000);
  assert.deepEqual(actions(f), ['eat', 'engage', 'swing']);
});

test('missing food stops an injured hero before any attack', async t => {
  const f = fixture(t, { mode: 'arena', hp: 99 });
  await f.start();
  await f.advance(10000);
  assert.deepEqual(actions(f), []);
  assert.match(f.status(), /HP recovery required.*No food/);
});

test('the meal limit prevents more attacks while HP is still missing', async t => {
  const f = fixture(t, { mode: 'arena', activeBattle: true, hpLoss: 7,
    foods: [{ id: 'small-food', name: 'Small Food', gain: 3, quantity: 10 }] });
  await f.start({ meals: 1 });
  await f.advance(10000);
  assert.deepEqual(actions(f), ['swing', 'eat']);
  assert.match(f.status(), /HP recovery required.*Food item limit reached/);
});

test('HP healing confirmation does not require an energy increase', async t => {
  const f = fixture(t, { mode: 'arena', activeBattle: true, hp: 80, foods: [shark], hpLoss: 0 });
  await f.start({ actions: 1 });
  await f.advance(5000);
  assert.deepEqual(actions(f), ['eat', 'swing']);
  assert.equal(f.document.getElementById('hud-energy').textContent, '100 / 100');
  assert.match(f.status(), /Action limit reached/);
});

test('unconfirmed HP recovery times out without consuming more food even if energy increased', async t => {
  const f = fixture(t, { mode: 'arena', hp: 99, energy: 10, foods: [shark], eatResult: { hpGain: 0 } });
  await f.start();
  await f.advance(10000);
  assert.deepEqual(actions(f), ['eat']);
  assert.match(f.status(), /Still waiting/);
  await f.advance(21000);
  assert.deepEqual(actions(f), ['eat']);
  assert.match(f.status(), /No confirmed response after 30 seconds/);
});

test('does not overlap healing with an unconfirmed combat request', async t => {
  const f = fixture(t, { mode: 'arena', activeBattle: true, noResponse: true, foods: [shark] });
  await f.start();
  f.document.querySelector('.hp-text').textContent = '99 / 100 HP';
  await f.advance(5000);
  assert.deepEqual(actions(f), ['swing']);
  assert.equal(f.ui.getElementById('start').disabled, true);
});

test('Stop during combat healing prevents subsequent attacks', async t => {
  const f = fixture(t, { mode: 'arena', activeBattle: true, hpLoss: 1, foods: [shark], eatLatency: 500 });
  await f.start();
  await f.advance(100);
  f.stop();
  await f.advance(10000);
  assert.deepEqual(actions(f), ['swing', 'eat']);
  assert.match(f.status(), /Stopped/);
});

test('arena attacks do not spend food merely because energy is zero', async t => {
  const f = fixture(t, { mode: 'arena', activeBattle: true, energy: 0, hpLoss: 0, foods: [shark] });
  await f.start({ actions: 1 });
  await f.advance(10000);
  assert.deepEqual(actions(f), ['swing']);
  assert.match(f.status(), /Action limit reached/);
});

test('a zero-damage strike is a confirmed turn rather than a request to retry immediately', async t => {
  const f = fixture(t, { mode: 'arena', activeBattle: true, damage: 0, hpLoss: 0 });
  await f.start({ actions: 2 });
  await f.advance(10000);
  assert.deepEqual(actions(f), ['swing', 'swing']);
  assert.match(f.status(), /Action limit reached/);
});

test('an unconfirmed combat response does not cause another attack or re-engagement', async t => {
  const f = fixture(t, { mode: 'arena', activeBattle: true, hpLoss: 0, result: { confirmed: false } });
  await f.start();
  await f.advance(10000);
  assert.deepEqual(actions(f), ['swing']);
  assert.match(f.status(), /Still waiting/);
  await f.advance(21000);
  assert.deepEqual(actions(f), ['swing']);
  assert.match(f.status(), /No confirmed response after 30 seconds/);
});

test('defeat stops without consuming food or engaging again', async t => {
  const f = fixture(t, { mode: 'arena', activeBattle: true, hp: 1, hpLoss: 10, foods: [shark] });
  await f.start({ autoHeal: false });
  await f.advance(10000);
  assert.deepEqual(actions(f), ['swing']);
  assert.match(f.status(), /hero was defeated/);
});

test('unreadable HP stops combat before sending any action', async t => {
  const f = fixture(t, { mode: 'arena' });
  f.document.querySelector('.hp-text').textContent = '?';
  await f.start();
  assert.deepEqual(actions(f), []);
  assert.match(f.status(), /Cannot read HP/);
});

test('raid repeats attacks and heals after every injury, including the final blow', async t => {
  const f = fixture(t, { mode: 'raid', foods: [shark], hpLoss: 1 });
  await f.start();
  await f.advance(10000);
  assert.deepEqual(actions(f), ['attack', 'eat', 'attack', 'eat', 'attack', 'eat']);
  assert.equal(f.state.raid.hp, 0);
  assert.equal(f.document.querySelector('.hp-text').textContent, '100 / 100 HP');
  assert.match(f.status(), /Boss defeated/);
});

test('zero damage raid strikes count once and still trigger healing', async t => {
  const f = fixture(t, { mode: 'raid', damage: 0, hpLoss: 1, foods: [shark] });
  await f.start({ actions: 1 });
  await f.advance(10000);
  assert.deepEqual(actions(f), ['attack', 'eat']);
  assert.match(f.status(), /Action limit reached/);
});

test('a different raid ID is never attacked automatically', async t => {
  const f = fixture(t, { mode: 'raid', hpLoss: 0 });
  await f.start();
  await f.advance(500);
  f.document.querySelector('input[name="raid_id"]').value = '999';
  await f.advance(5000);
  assert.deepEqual(actions(f), ['attack']);
  assert.match(f.status(), /no longer available/);
});

test('raid catalogue pages do not automatically summon or attack a boss', async t => {
  const f = fixture(t, { mode: 'raid', raidList: true });
  await f.advance(10000);
  assert.equal(f.ui.getElementById('start').disabled, true);
  assert.deepEqual(actions(f), []);
});

test('raid cooldowns are respected without enabling disabled buttons', async t => {
  const f = fixture(t, { mode: 'raid', hpLoss: 0 });
  f.document.querySelector('section.content button').disabled = true;
  await f.start({ actions: 1 });
  await f.advance(1000);
  assert.deepEqual(actions(f), []);
  f.document.querySelector('section.content button').disabled = false;
  await f.advance(500);
  assert.deepEqual(actions(f), ['attack']);
});

test('combat and raid forms cannot redirect automation to another endpoint', async t => {
  for (const mode of ['arena', 'raid']) {
    const f = fixture(t, { mode, hpLoss: 0 });
    f.document.querySelector('section.content form').setAttribute('action', '/pvp.php');
    await f.start();
    assert.deepEqual(actions(f), []);
    assert.match(f.status(), /combat form changed/);
  }
});

test('gathering, combat, and raids share one cross-tab lock', async t => {
  const locks = lockManager();
  const gather = fixture(t, { locks, noResponse: true });
  const arena = fixture(t, { locks, mode: 'arena' });
  const raid = fixture(t, { locks, mode: 'raid' });
  await gather.start();
  await arena.start();
  await raid.start();
  assert.equal(gather.state.requests.length, 1);
  for (const f of [arena, raid]) {
    assert.deepEqual(actions(f), []);
    assert.match(f.status(), /Another tab/);
  }
});

test('gathering also heals on any HP loss instead of waiting for low energy', async t => {
  const f = fixture(t, { hp: 99, foods: [shark] });
  await f.start({ actions: 1 });
  await f.advance(5000);
  assert.deepEqual(actions(f), ['eat', 'gather']);
  assert.equal(f.document.querySelector('.hp-text').textContent, '100 / 100 HP');
});

test('invalid boss HP is not interpreted as a victory or an affordable attack', async t => {
  for (const text of ['0 / 0', '-1 / 30', '40 / 30', '?']) {
    const f = fixture(t, { mode: 'raid' });
    f.document.querySelector('.stat-row strong').textContent = text;
    await f.start();
    assert.deepEqual(actions(f), []);
    assert.match(f.status(), /Cannot read boss HP/);
  }
});

test('unreadable HP after the final allowed strike reports uncertainty before stopping', async t => {
  const f = fixture(t, { mode: 'arena', activeBattle: true, result: { hpText: '?' } });
  await f.start({ actions: 1 });
  await f.advance(5000);
  assert.deepEqual(actions(f), ['swing']);
  assert.match(f.status(), /Cannot read HP/);
});
