'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { fixture, flush } = require('./harness.cjs');
const KEY = 'dankscape-assistant:verification-checkpoint:v1';
const record = f => JSON.parse(f.session()[KEY]);
const catalog = [{ key: 'first', name: 'Fixture Boss' }, { key: 'second', name: 'Other Boss' }, { key: 'locked', name: 'Locked Boss', locked: true }];

async function leave(f) { const session = f.session(); f.window.close(); await flush(); return session; }
async function first(t, settings = {}, options = {}) {
  const f = fixture(t, { mode: 'raid', bossHP: 10, hpLoss: 0, ...options });
  await f.start({ raidAll: true, maxRaids: 2, interval: 0.1, ...settings });
  await f.advance(1000);
  return f;
}
function lobby(t, session, options = {}) {
  return fixture(t, { mode: 'raid', raidList: true, url: 'https://dankscape.com/raid.php', now: 2000,
    raidCatalog: catalog, session, hpLoss: 0, ...options });
}
async function nextBoss(t, previous, name, id) {
  const summon = lobby(t, await leave(previous), { summonedBoss: { id, name } });
  await summon.advance(500);
  assert.equal(summon.state.requests.length, 1);
  assert.equal(summon.state.requests[0].boss, catalog.find(boss => boss.name === name).key);
  const fight = fixture(t, { mode: 'raid', bossName: name, raidId: id, bossHP: 10, hpLoss: 0,
    url: `https://dankscape.com/raid.php?id=${id}`, now: 3000, session: await leave(summon) });
  await fight.advance(1000);
  assert.equal(fight.state.requests[0]?.raid_id, id);
  return fight;
}

test('cycle mode completes X of each unlocked boss with one cumulative budget', async t => {
  let fight = await first(t);
  assert.deepEqual(record(fight).raidCounts, [{ name: 'Fixture Boss', completed: 1 }]);
  fight = await nextBoss(t, fight, 'Fixture Boss', '124');
  fight = await nextBoss(t, fight, 'Other Boss', '125');
  fight = await nextBoss(t, fight, 'Other Boss', '126');
  const finished = lobby(t, await leave(fight));
  await finished.advance(500);
  assert.equal(finished.state.requests.length, 0);
  assert.deepEqual(record(finished).raidCounts, [{ name: 'Fixture Boss', completed: 2 }, { name: 'Other Boss', completed: 2 }]);
  assert.equal(record(finished).raidsCompleted, 4);
  assert.equal(record(finished).completed, 4);
  assert.equal(record(finished).deadline, 1800000);
  assert.match(finished.status(), /All available bosses/);
});

test('X=1 still travels to the next available boss', async t => {
  const fight = await first(t, { maxRaids: 1 });
  const next = await nextBoss(t, fight, 'Other Boss', '124');
  assert.equal(record(next).raidsCompleted, 2);
});

test('the observed named daily-limit message skips that boss and confirms the next summon', async t => {
  const f = await first(t, { maxRaids: 4 });
  const limited = lobby(t, await leave(f), { summonMessage: key => key === 'first' ? "✓ You've already defeated Fixture Boss 3 times today — it will return tomorrow. (3 fights per boss per day thanks to your Fervor perk.)" : null });
  await limited.advance(1000);
  assert.deepEqual(limited.state.requests.map(request => request.boss), ['first', 'second']);
  assert.deepEqual(record(limited).raidSkipped, ['Fixture Boss']);
  assert.equal(record(limited).canResume, true);
  const next = fixture(t, { mode: 'raid', bossName: 'Other Boss', raidId: '124', bossHP: 10, hpLoss: 0,
    url: 'https://dankscape.com/raid.php?id=124', now: 3000, session: await leave(limited) });
  await next.advance(1000);
  assert.equal(record(next).raidsCompleted, 2);
});

test('a full-page daily rejection also advances without repeating its POST', async t => {
  const f = await first(t, { maxRaids: 4 });
  const pending = lobby(t, await leave(f), { noResponse: true });
  await pending.advance(200);
  assert.equal(record(pending).canResume, false);
  const returned = lobby(t, await leave(pending), { beforeScript(window) {
    window.document.getElementById('flash-stack').innerHTML = '<div class="flash flash-ok">✓ You\'ve already defeated Fixture Boss 3 times today — it will return tomorrow. (3 fights per boss per day thanks to your Fervor perk.)</div>';
  } });
  await returned.advance(500);
  assert.deepEqual(record(returned).raidSkipped, ['Fixture Boss']);
  assert.equal(returned.state.requests[0].boss, 'second');
});

test('a named quota shown on the catalogue card skips its still-visible summon control', async t => {
  const f = await first(t, { maxRaids: 4 });
  const returned = lobby(t, await leave(f), { beforeScript(window) {
    window.document.querySelector('section.content .card').insertAdjacentHTML('beforeend', '<p>✓ You\'ve already defeated Fixture Boss 3 times today — it will return tomorrow.</p>');
  } });
  await returned.advance(500);
  assert.deepEqual(record(returned).raidSkipped, ['Fixture Boss']);
  assert.equal(returned.state.requests[0].boss, 'second');
});

test('unknown errors and a quota for a different boss cannot skip or retry a summon', async t => {
  for (const message of ['Server unavailable.', "✓ You've already defeated Other Boss 3 times today — it will return tomorrow."]) {
    const f = await first(t);
    const failed = lobby(t, await leave(f), { summonMessage: message });
    await failed.advance(31000);
    assert.equal(failed.state.requests.length, 1);
    assert.deepEqual(record(failed).raidSkipped, []);
    assert.equal(record(failed).canResume, false);
  }
});

test('cycle mode preserves action/time caps and never summons while healing is pending', async t => {
  const capped = await first(t, { actions: 1 });
  assert.equal(capped.state.navigations.length, 0);
  assert.match(capped.status(), /Action limit/);
  const f = await first(t, { minutes: 1 });
  const expired = lobby(t, await leave(f), { now: 61000 });
  await expired.advance(500);
  assert.equal(expired.state.requests.length, 0);
  assert.match(expired.status(), /Time limit/);
  const healing = fixture(t, { mode: 'raid', bossHP: 10, hpLoss: 1, eatLatency: 2000,
    foods: [{ id: 'food', name: 'Shark', gain: 20, quantity: 5 }] });
  await healing.start({ raidAll: true, maxRaids: 2 });
  await healing.advance(1500);
  assert.deepEqual(healing.state.requests.map(request => request.action || 'eat'), ['attack', 'eat']);
  assert.equal(healing.state.navigations.length, 0);
  await healing.advance(2000);
  assert.equal(healing.state.navigations.length, 1);
});

test('an opted-in native summon arms one saved run and starts the confirmed boss on arrival', async t => {
  const f = lobby(t, {}, { noResponse: true });
  f.ui.getElementById('raidAll').checked = true;
  f.ui.getElementById('maxRaids').value = '2';
  f.document.querySelector('section.content form button').click();
  assert.equal(f.state.requests.length, 1);
  assert.equal(record(f).raidPhase, 'summon');
  assert.equal(record(f).raidId, '');
  assert.equal(record(f).canResume, false);
  const arrival = fixture(t, { mode: 'raid', raidId: '125', bossHP: 10, hpLoss: 0, url: 'https://dankscape.com/raid.php?id=125',
    now: 3000, session: await leave(f) });
  await arrival.advance(1000);
  assert.equal(arrival.state.requests.length, 1);
  assert.equal(record(arrival).raidCounts[0].completed, 1);
});

test('an opted-in manual attack starts automation once, while ordinary reloads remain idle', async t => {
  const f = fixture(t, { mode: 'raid', bossHP: 10, hpLoss: 0 });
  f.ui.getElementById('raidAll').checked = true;
  f.document.querySelector('section.content button[data-label]').click();
  await f.advance(1000);
  assert.equal(f.state.requests.length, 1);
  assert.equal(record(f).raidsCompleted, 1);
  const idle = fixture(t, { mode: 'raid', saved: { raidAll: true } });
  await idle.advance(1000);
  assert.equal(idle.state.requests.length, 0);
});

test('Stop during a daily rejection keeps the next boss paused', async t => {
  const f = await first(t);
  const limited = lobby(t, await leave(f), { latency: 1000, summonMessage: "✓ You've already defeated Fixture Boss 3 times today — it will return tomorrow." });
  await limited.advance(200);
  limited.stop();
  await limited.advance(1500);
  assert.equal(limited.state.requests.length, 1);
  assert.equal(limited.session()[KEY], undefined);
  assert.match(limited.status(), /Stopped/);
});
