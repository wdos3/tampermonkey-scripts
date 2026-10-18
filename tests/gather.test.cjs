'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { fixture, lockManager, flush, source } = require('./harness.cjs');

test('loads stopped even when saved settings exist', async t => {
  const f = fixture(t, { saved: { actions: 8, target: 'copper' } });
  await f.advance(120000);
  assert.equal(f.state.requests.length, 0);
  assert.equal(f.ui.getElementById('actions').value, '8');
  assert.equal(f.ui.getElementById('start').disabled, false);
  assert.equal(f.ui.querySelector('option[value="locked"]').disabled, true);
});

test('repeats using fresh forms and tokens, and stops at the exact action limit', async t => {
  const f = fixture(t);
  await f.start({ actions: 3 });
  await f.advance(10000);
  assert.equal(f.state.requests.length, 3);
  assert.deepEqual(f.state.requests.map(request => request.csrf), ['fixture-token', 'fixture-token-1', 'fixture-token-2']);
  assert.match(f.status(), /Action limit reached/);
  assert.match(f.ui.getElementById('stats').textContent, /^3 confirmed actions/);
});

test('honors disabled cooldown buttons without forcing them enabled', async t => {
  const f = fixture(t);
  f.document.querySelector('form button').disabled = true;
  await f.start({ actions: 1 });
  await f.advance(2000);
  assert.equal(f.state.requests.length, 0);
  assert.equal(f.document.querySelector('form button').disabled, true);
  f.document.querySelector('form button').disabled = false;
  await f.advance(250);
  assert.equal(f.state.requests.length, 1);
});

test('checks the energy reserve before every action', async t => {
  const f = fixture(t, { energy: 10 });
  await f.start({ reserve: 3 });
  await f.advance(5000);
  assert.equal(f.state.requests.length, 1);
  assert.equal(f.document.getElementById('hud-energy').textContent, '6 / 100');
  assert.match(f.status(), /Energy limit reached/);
});

test('wait mode uses updated natural-regeneration energy without spending food', async t => {
  const f = fixture(t, { energy: 3 });
  await f.start({ wait: true, actions: 1 });
  await f.advance(10000);
  assert.equal(f.state.requests.length, 0);
  assert.match(f.status(), /Waiting for natural energy/);
  f.document.getElementById('hud-energy').textContent = '4 / 100';
  await f.advance(500);
  assert.equal(f.state.requests.length, 1);
  assert.match(f.status(), /Action limit reached/);
});

test('stops impossible regeneration waits', async t => {
  const f = fixture(t);
  await f.start({ wait: true, reserve: 99 });
  assert.equal(f.state.requests.length, 0);
  assert.match(f.status(), /reserve is too high/);
});

test('Stop prevents more actions while allowing a sent request to finish', async t => {
  const f = fixture(t, { latency: 500 });
  await f.start();
  f.stop();
  assert.equal(f.ui.getElementById('start').disabled, true);
  await f.advance(10000);
  assert.equal(f.state.requests.length, 1);
  assert.match(f.status(), /last sent action completed/);
  assert.equal(f.ui.getElementById('start').disabled, false);
});

test('a response timeout is not retried and retains the cross-tab lock', async t => {
  const locks = lockManager();
  const f = fixture(t, { noResponse: true, locks });
  await f.start();
  await f.advance(60000);
  assert.equal(f.state.requests.length, 1);
  assert.match(f.status(), /No confirmed response after 30 seconds/);
  assert.equal(f.ui.getElementById('start').disabled, true);
  const other = fixture(t, { locks });
  await other.start();
  assert.equal(other.state.requests.length, 0);
  assert.match(other.status(), /Another tab/);
  f.swap();
  await flush();
  await other.start({ actions: 1 });
  assert.equal(other.state.requests.length, 1);
});

test('manual submits during a pending request are blocked and stop automation', async t => {
  const f = fixture(t, { latency: 500 });
  await f.start();
  const form = f.document.querySelector('form');
  const accepted = form.dispatchEvent(new f.window.Event('submit', { bubbles: true, cancelable: true }));
  assert.equal(accepted, false);
  await f.advance(10000);
  assert.equal(f.state.requests.length, 1);
  assert.match(f.status(), /Stopped/);
});

test('a manual action between requests stops automation and is allowed through', async t => {
  const f = fixture(t);
  await f.start({ interval: 2 });
  await f.advance(1500);
  f.document.querySelector('form button').click();
  await f.advance(10000);
  assert.equal(f.state.requests.length, 2);
  assert.match(f.status(), /manual game action/);
});

test('game errors stop further actions', async t => {
  const f = fixture(t, { result: { fail: true } });
  await f.start();
  await f.advance(10000);
  assert.equal(f.state.requests.length, 1);
  assert.match(f.status(), /Not enough energy/);
  assert.match(f.ui.getElementById('stats').textContent, /^0 confirmed actions/);
});

test('page replacement without a success confirmation is not counted or retried', async t => {
  const f = fixture(t, { result: { confirmed: false } });
  await f.start();
  await f.advance(10000);
  assert.equal(f.state.requests.length, 1);
  assert.match(f.status(), /Still waiting/);
  await f.advance(21000);
  assert.equal(f.state.requests.length, 1);
  assert.match(f.status(), /No confirmed response after 30 seconds/);
});

test('an unrelated swap event does not complete a still-connected form', async t => {
  const f = fixture(t, { noResponse: true });
  await f.start();
  f.document.dispatchEvent(new f.window.CustomEvent('dank:swapped'));
  await f.advance(10000);
  assert.equal(f.state.requests.length, 1);
  assert.match(f.ui.getElementById('stats').textContent, /^0 confirmed actions/);
  assert.equal(f.ui.getElementById('start').disabled, true);
});

test('the time limit also applies while waiting for regeneration', async t => {
  const f = fixture(t, { energy: 0 });
  await f.start({ wait: true, minutes: 1 });
  await f.advance(61000);
  assert.equal(f.state.requests.length, 0);
  assert.match(f.status(), /Time limit reached/);
});

test('unreadable energy and action costs fail before sending', async t => {
  for (const kind of ['energy', 'cost']) {
    const f = fixture(t);
    const element = kind === 'energy' ? f.document.getElementById('hud-energy') : f.document.querySelector('.stat-row:last-of-type strong');
    element.textContent = '?';
    await f.start();
    assert.equal(f.state.requests.length, 0);
    assert.match(f.status(), /Cannot read energy/);
  }
});

test('only the expected same-origin gathering form can be submitted', async t => {
  for (const action of ['https://example.com/gather.php', '/shop.php', 'https://[']) {
    const f = fixture(t);
    f.document.querySelector('form').setAttribute('action', action);
    await f.start();
    assert.equal(f.state.requests.length, 0);
    assert.match(f.status(), /form changed/);
  }
});

test('only one tab runs and an idle Stop releases its lock', async t => {
  const locks = lockManager();
  const a = fixture(t, { locks });
  const b = fixture(t, { locks });
  await a.start();
  await b.start();
  assert.equal(a.state.requests.length, 1);
  assert.equal(b.state.requests.length, 0);
  await a.advance(500);
  a.stop();
  await flush();
  await b.start();
  assert.equal(b.state.requests.length, 1);
});

test('Escape stops and reopening the page never resumes a prior run', async t => {
  const f = fixture(t);
  await f.start();
  await f.advance(500);
  f.document.dispatchEvent(new f.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  await f.advance(10000);
  assert.equal(f.state.requests.length, 1);
  const fresh = fixture(t, { saved: { target: 'copper', actions: 100 } });
  await fresh.advance(10000);
  assert.equal(fresh.state.requests.length, 0);
});

test('missing locks, locked skills, and Hall cannot start', async t => {
  const noLocks = fixture(t, { noLocks: true });
  const locked = fixture(t, { skill: 'herblore', locked: true });
  const hall = fixture(t, { hall: true });
  for (const f of [noLocks, locked, hall]) {
    assert.equal(f.ui.getElementById('start').disabled, true);
    await f.advance(5000);
    assert.equal(f.state.requests.length, 0);
  }
});

test('storage failure and offline events stop without automatic retry', async t => {
  const badStore = fixture(t, { storageError: true });
  await badStore.start();
  assert.equal(badStore.state.requests.length, 0);
  assert.match(badStore.status(), /Could not save settings/);
  const f = fixture(t);
  await f.start();
  await f.advance(500);
  f.window.dispatchEvent(new f.window.Event('offline'));
  await f.advance(10000);
  assert.equal(f.state.requests.length, 1);
  assert.match(f.status(), /offline/);
});

test('reinjection does not create a duplicate panel or submit handler', async t => {
  const f = fixture(t);
  f.window.eval(source);
  await f.start({ actions: 1 });
  await f.advance(5000);
  assert.equal(f.document.querySelectorAll('#dankscape-gather-assistant').length, 1);
  assert.equal(f.state.requests.length, 1);
});

for (const skill of ['woodcutting', 'fishing', 'herblore']) {
  test(`${skill} uses the selected page's action rather than a hardcoded mining request`, async t => {
    const f = fixture(t, { skill });
    await f.start({ actions: 1 });
    await f.advance(1000);
    assert.equal(f.state.requests[0].skill, skill);
    assert.match(f.status(), /Action limit reached/);
  });
}

const shark = { id: 'shark-row', name: 'Shark', gain: 20, quantity: 5 };
const chicken = { id: 'chicken-row', name: 'Cooked Chicken', gain: 3, quantity: 5 };

test('low energy automatically eats one item, then resumes gathering', async t => {
  const f = fixture(t, { energy: 2, foods: [shark] });
  await f.start({ actions: 2 });
  await f.advance(10000);
  assert.deepEqual(f.state.requests.map(request => request.inv_id ? 'eat' : 'gather'), ['eat', 'gather', 'gather']);
  assert.equal(f.state.requests[0].fill, '');
  assert.equal(f.state.foods[0].quantity, 4);
  assert.match(f.ui.getElementById('stats').textContent, /^2 confirmed actions · 1 food eaten/);
  assert.match(f.status(), /Action limit reached/);
});

test('does not eat while there is enough energy for the next action', async t => {
  const f = fixture(t, { energy: 20, foods: [shark] });
  await f.start({ actions: 2 });
  await f.advance(10000);
  assert.equal(f.state.requests.length, 2);
  assert.ok(f.state.requests.every(request => request.action === 'gather'));
  assert.equal(f.state.foods[0].quantity, 5);
});

test('eats multiple small foods sequentially only until the energy reserve is met', async t => {
  const f = fixture(t, { energy: 0, foods: [chicken] });
  await f.start({ actions: 1, reserve: 3, interval: 1 });
  await f.advance(10000);
  assert.deepEqual(f.state.requests.map(request => request.inv_id ? 'eat' : 'gather'), ['eat', 'eat', 'eat', 'gather']);
  assert.equal(f.state.foods[0].quantity, 2);
  assert.equal(f.document.getElementById('hud-energy').textContent, '5 / 100');
});

test('specific food choices survive swaps without substituting a different food', async t => {
  const f = fixture(t, { energy: 0, foods: [{ ...chicken, quantity: 1 }, shark] });
  await f.start({ food: 'Cooked Chicken' });
  await f.advance(10000);
  assert.equal(f.state.requests.length, 1);
  assert.equal(f.state.requests[0].inv_id, 'chicken-row');
  assert.equal(f.state.foods[1].quantity, 5);
  assert.match(f.status(), /Selected food \(Cooked Chicken\) is unavailable/);
});

test('auto-eat can be disabled without spending food', async t => {
  const f = fixture(t, { energy: 2, foods: [shark] });
  await f.start({ autoEat: false });
  await f.advance(10000);
  assert.equal(f.state.requests.length, 0);
  assert.match(f.status(), /Auto-eat is disabled/);
});

test('the food limit is independent of the gathering action limit', async t => {
  const f = fixture(t, { energy: 0, foods: [chicken] });
  await f.start({ meals: 1 });
  await f.advance(10000);
  assert.equal(f.state.requests.length, 1);
  assert.match(f.status(), /Food item limit reached/);
  assert.match(f.ui.getElementById('stats').textContent, /^0 confirmed actions · 1 food eaten/);
});

test('food depletion can fall back to natural regeneration when enabled', async t => {
  const f = fixture(t, { energy: 0, foods: [{ ...chicken, quantity: 1 }] });
  await f.start({ wait: true, actions: 1 });
  await f.advance(5000);
  assert.equal(f.state.requests.length, 1);
  assert.match(f.status(), /No food is available.*Waiting for natural/);
  f.document.getElementById('hud-energy').textContent = '4 / 100';
  await f.advance(2000);
  assert.equal(f.state.requests.length, 2);
  assert.match(f.status(), /Action limit reached/);
});

test('successful eating without increased energy stops rather than consuming more food', async t => {
  const f = fixture(t, { energy: 0, foods: [shark], eatResult: { energyGain: 0 } });
  await f.start();
  await f.advance(10000);
  assert.equal(f.state.requests.length, 1);
  assert.match(f.status(), /Still waiting/);
  await f.advance(21000);
  assert.equal(f.state.requests.length, 1);
  assert.match(f.status(), /No confirmed response after 30 seconds/);
});

test('a failed eating request is never retried', async t => {
  const f = fixture(t, { energy: 0, foods: [shark], eatResult: { fail: true } });
  await f.start();
  await f.advance(10000);
  assert.equal(f.state.requests.length, 1);
  assert.equal(f.state.foods[0].quantity, 5);
  assert.match(f.status(), /Game message/);
});

test('Stop during eating allows the sent food action to finish and sends no gather', async t => {
  const f = fixture(t, { energy: 0, foods: [shark], eatLatency: 500 });
  await f.start();
  f.stop();
  await f.advance(10000);
  assert.equal(f.state.requests.length, 1);
  assert.match(f.ui.getElementById('stats').textContent, /^0 confirmed actions · 1 food eaten/);
  assert.match(f.status(), /Stopped/);
});

test('food response timeout retains the cross-tab lock and is not retried', async t => {
  const locks = lockManager();
  const f = fixture(t, { locks, energy: 0, foods: [shark], noEatResponse: true });
  await f.start();
  await f.advance(60000);
  assert.equal(f.state.requests.length, 1);
  assert.match(f.status(), /No confirmed response/);
  const other = fixture(t, { locks });
  await other.start();
  assert.equal(other.state.requests.length, 0);
  assert.match(other.status(), /Another tab/);
});

test('food forms are restricted to the observed same-origin eat endpoint', async t => {
  for (const action of ['/shop.php', 'https://example.com/eat.php']) {
    const f = fixture(t, { energy: 0, foods: [shark] });
    f.document.querySelector('.quick-eat').setAttribute('action', action);
    await f.start();
    assert.equal(f.state.requests.length, 0);
    assert.match(f.status(), /food form changed/);
  }
});

test('food selected while energy is full is used after the game inserts its quick-eat form', async t => {
  const f = fixture(t, { energy: 100, foods: [shark, chicken], saved: { food: 'Cooked Chicken' } });
  assert.equal(f.ui.getElementById('food').value, 'Cooked Chicken');
  await f.start({ actions: 1, reserve: 95 });
  await f.advance(1000);
  assert.equal(f.state.requests.length, 1);
  assert.ok(f.ui.querySelector('option[value="Cooked Chicken"]'));
  assert.equal(f.state.foods[1].quantity, 5);
});

test('an unlocked resource can recover from low energy even if its action form is temporarily absent', async t => {
  const f = fixture(t, { energy: 0, foods: [shark], missingGatherForm: true });
  await f.start({ actions: 1 });
  await f.advance(10000);
  assert.deepEqual(f.state.requests.map(request => request.inv_id ? 'eat' : 'gather'), ['eat', 'gather']);
  assert.match(f.status(), /Action limit reached/);
});
