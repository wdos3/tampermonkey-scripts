'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { fixture, flush, lockManager } = require('./harness.cjs');
const { page, raidContent } = require('./fixture.cjs');
const captured = require('./fixtures/raid-final-response.json');
const KEY = 'dankscape-assistant:verification-checkpoint:v1';
const hero = 'Local test hero';
const food = { id: 'food', name: 'Shark', gain: 20, quantity: 5 };
const record = f => JSON.parse(f.session()[KEY]);

function serverPage(options = {}) {
  const boss = { id: '123', name: 'Fixture Boss', hp: 20, maximum: 30, state: 'Active', ...options.boss };
  return page('mining', false, 'raid').replace(/<section class="content">[\s\S]*?<\/section>/,
    `<section class="content">${raidContent(boss)}</section>`)
    .replace('Local test hero</h2>', `${options.hero || hero}</h2>`);
}

function stalled(t, html, options = {}) {
  const reads = [];
  const f = fixture(t, { mode: 'raid', hpLoss: 0, noResponse: true, ...options, beforeScript(window) {
    window.fetch = async (url, init) => {
      reads.push({ url, init });
      return { ok: true, url, text: async () => html };
    };
    options.beforeScript?.(window);
  } });
  return { ...f, reads };
}

test('the captured live finishing-blow wording confirms defeat, heals, and opens the next summon', async t => {
  const f = fixture(t, { mode: 'raid', bossName: captured.boss, raidId: captured.raidId,
    url: `https://dankscape.com/raid.php?id=${captured.raidId}`, bossHP: captured.bossHPBefore,
    bossMaximum: captured.bossMaximum, damage: 306, hpLoss: 1, foods: [food],
    result: { flash: captured.flash } });
  await f.start({ maxRaids: 2, interval: 0.1 });
  await f.advance(1500);
  assert.deepEqual(f.state.requests.map(r => r.action || 'eat'), ['attack', 'eat']);
  assert.equal(record(f).raidsCompleted, 1);
  assert.equal(record(f).completed, 1);
  assert.equal(record(f).eaten, 1);
  assert.equal(record(f).recoveries, 0);
  assert.equal(record(f).raidPhase, 'catalog');
  assert.deepEqual(f.state.navigations, ['https://dankscape.com/raid.php']);
});

test('two finishing responses continue the same boss without resetting limits or using recovery reads', async t => {
  const f = fixture(t, { mode: 'raid', bossHP: 10, hpLoss: 0,
    result: { flash: 'You struck for 10 and felled Fixture Boss! Rewards are split by damage dealt.' } });
  await f.start({ maxRaids: 2, interval: 0.1, actions: 10, minutes: 12 });
  await f.advance(500);
  const firstSession = f.session();
  f.window.close();
  await flush();
  const catalog = fixture(t, { mode: 'raid', raidList: true, url: 'https://dankscape.com/raid.php',
    session: firstSession, now: 1000, noResponse: true });
  await catalog.advance(100);
  assert.deepEqual(catalog.state.requests.map(r => r.action), ['summon']);
  const nextSession = catalog.session();
  catalog.window.close();
  await flush();
  const next = fixture(t, { mode: 'raid', raidId: '124', url: 'https://dankscape.com/raid.php?id=124', bossHP: 10,
    session: nextSession, now: 2000, hpLoss: 0, result: { flash: 'You struck for 12 and felled Fixture Boss! Rewards are split by damage dealt.' } });
  await next.advance(1500);
  assert.equal(next.state.requests.length, 1);
  assert.equal(next.state.requests[0].raid_id, '124');
  assert.match(next.status(), /Raid limit reached/);
  assert.match(next.ui.getElementById('stats').textContent, /^2 confirmed actions.*2 raids completed/);
  assert.equal(next.state.navigations.length, 0);
});

test('an increase on this hero’s Damage Board confirms a missing client toast', async t => {
  const f = fixture(t, { mode: 'raid', raidFighters: [], hpLoss: 0, result: { flash: '' } });
  await f.start({ actions: 2 });
  await f.advance(5000);
  assert.equal(f.state.requests.length, 2);
  assert.match(f.status(), /Action limit reached/);
  assert.match(f.ui.getElementById('stats').textContent, /^2 confirmed actions/);
});

test('a lost hit recovers from the persistent own contribution without any flash or attack retry', async t => {
  const f = stalled(t, serverPage({ boss: { fighters: [{ hero, damage: 10 }] } }), { raidFighters: [] });
  await f.start({ actions: 2 });
  await f.advance(30000);
  assert.equal(f.reads.length, 1);
  assert.equal(f.reads[0].init.method, 'GET');
  assert.equal(f.state.requests.length, 1);
  assert.equal(record(f).completed, 1);
  assert.equal(record(f).recoveries, 1);
  assert.deepEqual(f.state.navigations, ['https://dankscape.com/raid.php?id=123']);
});

test('a lost final response recovers from the captured personal damage delta and continues the raid loop', async t => {
  const html = serverPage({ hero: captured.hero, boss: { name: captured.boss, id: captured.raidId, hp: 0,
    maximum: captured.bossMaximum, fighters: [{ hero: captured.hero, damage: captured.damageAfter }], state: captured.stateAfter } });
  const f = stalled(t, html, { bossName: captured.boss, raidId: captured.raidId,
    url: `https://dankscape.com/raid.php?id=${captured.raidId}`, bossHP: captured.bossHPBefore, bossMaximum: captured.bossMaximum,
    raidFighters: [{ hero: captured.hero, damage: captured.damageBefore }], beforeScript(window) {
      window.document.querySelector('aside h2').textContent = captured.hero;
    } });
  await f.start({ maxRaids: 2 });
  await f.advance(30000);
  assert.equal(record(f).completed, 1);
  assert.equal(record(f).raidsCompleted, 1);
  assert.equal(record(f).finishReason, 'Boss defeated.');
  const session = f.session();
  f.window.close();
  await flush();
  const resumed = fixture(t, { mode: 'raid', bossName: captured.boss, raidId: captured.raidId,
    url: `https://dankscape.com/raid.php?id=${captured.raidId}`, bossHP: 0, session, now: 31000,
    beforeScript(window) { window.document.querySelector('aside h2').textContent = captured.hero; } });
  await resumed.advance(1000);
  assert.equal(record(resumed).raidPhase, 'catalog');
  assert.equal(record(resumed).raidsCompleted, 1);
  assert.equal(resumed.state.requests.length, 0);
  assert.deepEqual(resumed.state.navigations, ['https://dankscape.com/raid.php']);
});

test('other players’ damage and boss defeat cannot confirm this hero’s unchanged contribution', async t => {
  const locks = lockManager();
  const f = stalled(t, serverPage({ boss: { hp: 0, fighters: [{ hero: 'Other hero', damage: 100 }, { hero, damage: 7 }] } }),
    { locks, raidFighters: [{ hero, damage: 7 }] });
  await f.start({ maxRaids: 2 });
  await f.advance(40000);
  assert.equal(f.reads.length, 2);
  assert.equal(f.state.navigations.length, 0);
  assert.equal(f.state.requests.length, 1);
  assert.match(f.status(), /Automatic recovery could not confirm/);
  const other = fixture(t, { locks });
  await other.start();
  assert.equal(other.state.requests.length, 0);
});

test('missing, decreasing, malformed, or duplicate personal damage rows remain unconfirmed', async t => {
  for (const fighters of [[{ hero: 'Other hero', damage: 100 }], [{ hero, damage: 6 }],
    [{ hero, damage: 'unknown' }], [{ hero, damage: 10 }, { hero, damage: 10 }]]) {
    const f = stalled(t, serverPage({ boss: { fighters } }), { raidFighters: [{ hero, damage: 7 }] });
    await f.start();
    await f.advance(40000);
    assert.equal(f.state.navigations.length, 0, JSON.stringify(fighters));
    assert.equal(f.state.requests.length, 1, JSON.stringify(fighters));
    assert.match(f.status(), /could not confirm/);
  }
});

test('damage increases for another hero, raid ID, or boss cannot authorize recovery', async t => {
  for (const change of [{ hero: 'Another hero' }, { boss: { id: '999' } }, { boss: { name: 'Other Boss' } }]) {
    const f = stalled(t, serverPage({ ...change, boss: { fighters: [{ hero: change.hero || hero, damage: 100 }], ...change.boss } }),
      { raidFighters: [] });
    await f.start();
    await f.advance(40000);
    assert.equal(f.state.navigations.length, 0);
    assert.equal(f.state.requests.length, 1);
  }
});

test('wrong-target, zero-damage, and still-active finishing messages cannot confirm defeat', async t => {
  for (const [flash, hp] of [
    ['You struck for 10 and felled Other Boss! Rewards are split by damage dealt.', 0],
    ['You struck for 0 and felled Fixture Boss! Rewards are split by damage dealt.', 0],
    ['You struck for 10 and felled Fixture Boss! Rewards are split by damage dealt.', 20],
    ['You hit Other Boss for 10.', 20],
  ]) {
    const f = fixture(t, { mode: 'raid', noResponse: true });
    await f.start({ autoRecover: false });
    f.state.raid.hp = hp;
    f.swap({ kind: 'raid', flash });
    await f.advance(31000);
    assert.equal(f.state.requests.length, 1, flash);
    assert.equal(f.state.navigations.length, 0, flash);
    assert.match(f.ui.getElementById('stats').textContent, /^0 confirmed actions/, flash);
  }
});

test('an old finishing toast cannot confirm a pending action when someone else defeats the boss', async t => {
  const f = fixture(t, { mode: 'raid', noResponse: true, beforeScript(window) {
    window.document.getElementById('flash-stack').innerHTML = '<div class="flash flash-ok">You struck for 10 and felled Fixture Boss! Rewards are split by damage dealt.</div>';
  } });
  await f.start({ autoRecover: false });
  f.state.raid.hp = 0;
  f.refresh();
  await f.advance(31000);
  assert.match(f.ui.getElementById('stats').textContent, /^0 confirmed actions/);
  assert.equal(f.state.navigations.length, 0);
});

test('fresh named zero-damage hits still count as confirmed turns', async t => {
  const f = fixture(t, { mode: 'raid', miss: true, hpLoss: 0, raidFighters: [],
    result: { flash: 'You hit Fixture Boss for 0.' } });
  await f.start({ actions: 3 });
  await f.advance(5000);
  assert.equal(f.state.requests.length, 3);
  assert.match(f.status(), /Action limit reached/);
});

test('Stop during a delayed hit permits contribution confirmation without sending another attack', async t => {
  const f = fixture(t, { mode: 'raid', latency: 3000, raidFighters: [], hpLoss: 0, result: { flash: '' } });
  await f.start();
  f.stop();
  await f.advance(6000);
  assert.equal(f.state.requests.length, 1);
  assert.match(f.ui.getElementById('stats').textContent, /^1 confirmed actions/);
  assert.match(f.status(), /Stopped/);
});
