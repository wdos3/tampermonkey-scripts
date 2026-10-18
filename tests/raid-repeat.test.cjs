'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { fixture, flush, lockManager } = require('./harness.cjs');
const { page, raidContent } = require('./fixture.cjs');

const KEY = 'dankscape-assistant:verification-checkpoint:v1';
const food = { id: 'food', name: 'Shark', gain: 20, quantity: 10 };
const record = f => JSON.parse(f.session()[KEY]);
const actions = f => f.state.requests.map(request => request.action || 'eat');

async function defeated(t, settings = {}, options = {}) {
  const f = fixture(t, { mode: 'raid', bossHP: 10, hpLoss: 0, ...options });
  await f.start({ maxRaids: 2, interval: 1, ...settings });
  await f.advance(3000);
  return f;
}
async function leave(f) {
  const session = f.session();
  f.window.close();
  await flush();
  return session;
}
function catalog(t, session, options = {}) {
  return fixture(t, { mode: 'raid', raidList: true, url: 'https://dankscape.com/raid.php', now: 3000, hpLoss: 0, session, ...options });
}

test('Maximum raids defaults to one, preserving the single-boss behavior', async t => {
  const f = await defeated(t, { maxRaids: 1 });
  assert.equal(f.state.navigations.length, 0);
  assert.deepEqual(actions(f), ['attack']);
  assert.match(f.status(), /Boss defeated/);
  assert.match(f.ui.getElementById('stats').textContent, /1 raids completed/);
});

test('after healing the first boss’s final hit, All raids and its exact native Summon lead to the second boss', async t => {
  const first = await defeated(t, { actions: 10 }, { hpLoss: 1, foods: [food] });
  assert.deepEqual(actions(first), ['attack', 'eat']);
  assert.deepEqual(first.state.navigations, ['https://dankscape.com/raid.php']);
  assert.equal(record(first).raidPhase, 'catalog');
  assert.equal(record(first).raidsCompleted, 1);
  assert.equal(record(first).deadline, 1800000);
  const lobby = catalog(t, await leave(first));
  await lobby.advance(500);
  assert.deepEqual(actions(lobby), ['summon']);
  assert.equal(lobby.state.requests[0].boss, 'fixture-boss');
  assert.equal(lobby.state.requests[0].csrf, 'fixture-token');
  assert.deepEqual(lobby.state.navigations, ['https://dankscape.com/raid.php?id=124']);
  const f = fixture(t, { mode: 'raid', raidId: '124', bossHP: 10, hpLoss: 1, foods: [food],
    url: 'https://dankscape.com/raid.php?id=124', now: 4000, session: await leave(lobby) });
  await f.advance(5000);
  assert.deepEqual(actions(f), ['attack', 'eat']);
  assert.equal(f.state.requests[0].raid_id, '124');
  assert.match(f.ui.getElementById('stats').textContent, /^2 confirmed actions · 2 food eaten.*2 raids completed/);
  assert.match(f.status(), /Raid limit reached/);
  assert.equal(f.state.navigations.length, 0);
});

test('a full document return confirms the new raid ID without repeating the summon POST', async t => {
  const first = await defeated(t);
  const lobby = catalog(t, await leave(first), { noResponse: true });
  await lobby.advance(100);
  assert.deepEqual(actions(lobby), ['summon']);
  assert.equal(record(lobby).raidPhase, 'summon');
  assert.equal(record(lobby).canResume, false);
  const battle = fixture(t, { mode: 'raid', raidId: '124', bossHP: 10, hpLoss: 0,
    url: 'https://dankscape.com/raid.php?id=124', now: 4000, session: await leave(lobby) });
  await battle.advance(3000);
  assert.deepEqual(actions(battle), ['attack']);
  assert.match(battle.status(), /Raid limit reached/);
  assert.match(battle.ui.getElementById('stats').textContent, /^2 confirmed actions.*2 raids completed/);
});

test('no catalogue navigation occurs before final healing is confirmed', async t => {
  const f = fixture(t, { mode: 'raid', bossHP: 10, hpLoss: 1, foods: [food], eatLatency: 2000 });
  await f.start({ interval: 1, maxRaids: 2 });
  await f.advance(1500);
  assert.deepEqual(actions(f), ['attack', 'eat']);
  assert.equal(f.state.navigations.length, 0);
  await f.advance(2000);
  assert.equal(f.state.navigations.length, 1);
});

test('the original action and time limits prevent another summon and never reset across pages', async t => {
  const capped = await defeated(t, { actions: 1 });
  assert.match(capped.status(), /Action limit reached/);
  assert.equal(capped.state.navigations.length, 0);
  const first = await defeated(t, { minutes: 1 });
  const expired = catalog(t, await leave(first), { now: 61000 });
  await expired.advance(500);
  assert.equal(expired.state.requests.length, 0);
  assert.match(expired.status(), /Time limit reached/);
});

test('an unavailable or locked selected boss never falls back to a different summon', async t => {
  for (const issue of ['missing', 'locked']) {
    const first = await defeated(t);
    const choices = [{ key: 'other-boss', name: 'Other Boss' }];
    if (issue === 'locked') choices.push({ key: 'fixture-boss', name: 'Fixture Boss', locked: true });
    const f = catalog(t, await leave(first), { raidCatalog: choices });
    await f.advance(500);
    assert.equal(f.state.requests.length, 0, issue);
    assert.match(f.status(), /summon.*unavailable/i, issue);
  }
});

test('summon validation rejects wrong destinations, missing fields and confirmation controls', async t => {
  for (const issue of ['origin', 'path', 'csrf', 'boss', 'confirm', 'onsubmit']) {
    const first = await defeated(t);
    const f = catalog(t, await leave(first), { beforeScript(window) {
      const form = window.document.querySelector('section.content form');
      if (issue === 'origin') form.action = 'https://example.com/raid.php';
      if (issue === 'path') form.action = '/pvp.php';
      if (issue === 'csrf' || issue === 'boss') form.querySelector(`[name="${issue}"]`).remove();
      if (issue === 'confirm') form.setAttribute('data-confirm', 'Different action');
      if (issue === 'onsubmit') form.setAttribute('onsubmit', 'return confirm("Different action")');
    } });
    await f.advance(500);
    assert.equal(f.state.requests.length, 0, issue);
    assert.match(f.status(), /summon form changed/, issue);
  }
});

test('returning the old raid ID or a different boss cannot start combat or summon again', async t => {
  for (const result of [{ id: '123' }, { name: 'Other Boss' }, { hp: 0 }, { state: 'Waiting' }]) {
    const first = await defeated(t);
    const f = catalog(t, await leave(first), { summonedBoss: result });
    await f.advance(31000);
    assert.deepEqual(actions(f), ['summon'], JSON.stringify(result));
    assert.match(f.status(), /restoration did not finish|not confirmed/, JSON.stringify(result));
  }
});

test('an uncertain summon survives reload without another POST and retains the shared lock', async t => {
  const first = await defeated(t);
  const locks = lockManager();
  const f = catalog(t, await leave(first), { noResponse: true, locks });
  await f.advance(31000);
  assert.deepEqual(actions(f), ['summon']);
  assert.equal(record(f).canResume, false);
  const other = fixture(t, { locks });
  await other.start();
  assert.equal(other.state.requests.length, 0);
  assert.match(other.status(), /Another tab/);
  const reloaded = catalog(t, f.session(), { now: 35000 });
  await reloaded.resume();
  await reloaded.advance(1000);
  assert.equal(reloaded.state.requests.length, 0);
  assert.match(reloaded.status(), /new raid was not confirmed/);
});

test('Stop during a summon permits its result but cannot attack the replacement raid', async t => {
  const first = await defeated(t);
  const f = catalog(t, await leave(first), { latency: 2000 });
  await f.advance(100);
  f.stop();
  await f.advance(5000);
  assert.deepEqual(actions(f), ['summon']);
  assert.equal(f.session()[KEY], undefined);
  assert.match(f.status(), /Stopped/);
});

test('a human check on the catalogue pauses and manual resume summons only the saved boss', async t => {
  const first = await defeated(t);
  const f = catalog(t, await leave(first), { guard: true });
  await f.advance(500);
  assert.equal(f.state.requests.length, 0);
  assert.equal(f.state.verificationClicks, 0);
  f.clearGuard();
  await flush();
  await f.resume();
  await f.advance(500);
  assert.deepEqual(actions(f), ['summon']);
  assert.equal(f.state.requests[0].boss, 'fixture-boss');
  assert.deepEqual(f.state.navigations, ['https://dankscape.com/raid.php?id=124']);
});

test('a changed hero cannot summon the next raid', async t => {
  const first = await defeated(t);
  const f = catalog(t, await leave(first), { beforeScript(window) {
    window.document.querySelector('aside h2').textContent = 'Other hero';
  } });
  await f.advance(500);
  assert.equal(f.state.requests.length, 0);
  assert.match(f.status(), /hero changed/);
});

test('a final strike recovered from server state counts that raid once before continuing the loop', async t => {
  const html = page('mining', false, 'raid').replace(/<section class="content">[\s\S]*?<\/section>/,
    `<section class="content">${raidContent({ id: '123', name: 'Fixture Boss', hp: 0, maximum: 10, state: 'Slain' })}</section>`)
    .replace('<div id="flash-stack"></div>', '<div id="flash-stack"><div class="flash flash-ok">You hit Fixture Boss for 10.</div></div>');
  const f = fixture(t, { mode: 'raid', bossHP: 10, hpLoss: 0, noResponse: true, beforeScript(window) {
    window.fetch = async url => ({ ok: true, url, text: async () => html });
  } });
  await f.start({ maxRaids: 2, interval: 1 });
  await f.advance(30000);
  assert.equal(record(f).raidsCompleted, 1);
  const restored = fixture(t, { mode: 'raid', bossHP: 0, hpLoss: 0, session: await leave(f), now: 31000 });
  await restored.advance(2000);
  assert.equal(record(restored).raidPhase, 'catalog');
  assert.equal(record(restored).raidsCompleted, 1);
  assert.equal(record(restored).recoveries, 1);
  assert.equal(record(restored).completed, 1);
});

test('selected potions and their original budget survive the next raid without topping up active buffs', async t => {
  const potion = { id: 'attack', name: 'Super Attack Elixir', stat: 'attack', boost: 7, quantity: 10 };
  const first = await defeated(t, { drinks: 1, potions: [{ name: potion.name, stat: potion.stat }] }, { potions: [potion] });
  assert.equal(record(first).drunk, 1);
  const lobby = catalog(t, await leave(first), { noResponse: true });
  await lobby.advance(100);
  const battle = fixture(t, { mode: 'raid', raidId: '124', bossHP: 10, hpLoss: 0, now: 4000,
    url: 'https://dankscape.com/raid.php?id=124', session: await leave(lobby), potions: [potion],
    boosts: [{ stat: 'attack', boost: 7, seconds: 290 }] });
  await battle.advance(3000);
  assert.deepEqual(actions(battle), ['attack']);
  assert.match(battle.ui.getElementById('stats').textContent, /1 potions drunk.*2 raids completed/);
  assert.equal(battle.ui.getElementById('drinks').value, '1');
});

test('the third-page summon landing may verify its new ID without allowing a fourth summon or catalogue hop', async t => {
  const first = await defeated(t);
  const lobby = catalog(t, await leave(first), { noResponse: true });
  await lobby.advance(100);
  const session = await leave(lobby);
  const saved = JSON.parse(session[KEY]);
  saved.steps = 3;
  session[KEY] = JSON.stringify(saved);
  const battle = fixture(t, { mode: 'raid', raidId: '124', bossHP: 10, hpLoss: 0, now: 4000,
    url: 'https://dankscape.com/raid.php?id=124', session });
  await battle.advance(3000);
  assert.deepEqual(actions(battle), ['attack']);
  assert.match(battle.status(), /Raid limit reached/);
  const blocked = { ...saved, raidPhase: 'catalog', canResume: true };
  const list = catalog(t, { [KEY]: JSON.stringify(blocked) });
  await list.advance(500);
  assert.equal(list.state.requests.length, 0);
  assert.match(list.status(), /three page changes/);
});

test('an external All raids link cannot carry a completed run out of the game', async t => {
  const f = fixture(t, { mode: 'raid', bossHP: 10, hpLoss: 0 });
  await f.start({ maxRaids: 2, interval: 2 });
  await f.advance(500);
  f.document.querySelector('section.content a').href = 'https://example.com/raid.php';
  await f.advance(3000);
  assert.equal(f.state.navigations.length, 0);
  assert.match(f.status(), /All raids link is unavailable/);
});
