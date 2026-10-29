'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { fixture, flush, lockManager } = require('./harness.cjs');
const { arenaContent, raidContent, page } = require('./fixture.cjs');
const KEY = 'dankscape-assistant:verification-checkpoint:v1';
const shark = { id: 'shark-row', name: 'Shark', gain: 20, quantity: 20 };

function serverPage(mode = 'arena', options = {}) {
  let html = page('mining', false, mode);
  if (mode === 'arena') html = html.replace(/<section class="content">[\s\S]*?<\/section>/,
    `<section class="content">${arenaContent({ active: !options.victory, name: options.enemy || 'Field Mouse', hp: 5,
      zone: options.zone || 'Meadowbrook Fields', log: options.log || (options.victory ? 'You slay the Field Mouse!' : 'You miss the Field Mouse.') })}</section>`);
  if (mode === 'raid') html = html.replace(/<section class="content">[\s\S]*?<\/section>/,
    `<section class="content">${raidContent({ id: options.id || '123', name: 'Fixture Boss', hp: options.bossHP ?? 30, maximum: 30, state: 'Active' })}</section>`);
  if (options.flash) html = html.replace('<div id="flash-stack"></div>', `<div id="flash-stack"><div class="flash flash-ok">${options.flash}</div></div>`);
  if (options.guard) html = html.replace('<section class="content">', '<section class="content"><a href="/guard.php?from=arena">Verify I’m human</a>');
  html = html.replace('100 / 100 HP', options.hpText || `${options.hp ?? 100} / 100 HP`);
  if (options.hero) html = html.replace('Local test hero', options.hero);
  if (options.xp !== undefined) html = html.replace('mining 1 · 0 / 83 XP', `mining 1 · ${options.xp} / 83 XP`);
  return html;
}

function recoveryFixture(t, options = {}) {
  const reads = [];
  const f = fixture(t, { mode: 'arena', activeBattle: true, noResponse: true, hpLoss: 0, ...options,
    beforeScript(window) {
      window.fetch = async (url, init) => {
        reads.push({ url, init });
        if (options.fetchImpl) return options.fetchImpl(url, init, window);
        if (options.fetchError) throw new Error('Network unavailable');
        return { ok: options.status === undefined || options.status === 200, status: options.status || 200,
          url: options.responseURL || url, text: async () => options.html || serverPage(options.mode || 'arena') };
      };
      options.beforeScript?.(window);
    },
  });
  return { ...f, reads, record: () => JSON.parse(f.session()[KEY]) };
}

test('automatic recovery defaults on and checks only with GET before refreshing a confirmed turn', async t => {
  const f = recoveryFixture(t);
  assert.equal(f.ui.getElementById('autoRecover').checked, true);
  await f.start({ actions: 3, interval: 2, minutes: 10 });
  await f.advance(29999);
  assert.equal(f.reads.length, 0);
  await f.advance(1);
  assert.equal(f.reads.length, 1);
  assert.equal(f.reads[0].init.method, 'GET');
  assert.equal(f.reads[0].init.body, undefined);
  assert.equal(f.reads[0].init.credentials, 'same-origin');
  assert.equal(f.reads[0].init.redirect, 'error');
  assert.equal(f.state.requests.length, 1);
  assert.deepEqual(f.state.navigations, ['https://dankscape.com/arena.php']);
  const record = f.record();
  assert.equal(record.completed, 1);
  assert.equal(record.canResume, true);
  assert.equal(record.restoreRequested, true);
  assert.equal(record.recoveries, 1);
  assert.equal(record.deadline, 600000);
  assert.equal(record.nextAt, 32000);
  assert.ok(!JSON.stringify(record).includes('fixture-token'));
  f.window.dispatchEvent(new f.window.Event('pagehide'));
  const resumed = fixture(t, { mode: 'arena', activeBattle: true, hpLoss: 1, foods: [shark], hp: 99,
    session: f.session(), now: 31000 });
  await resumed.advance(10000);
  assert.equal(resumed.state.requests.filter(request => request.action === 'swing').length, 2);
  assert.match(resumed.ui.getElementById('stats').textContent, /^3 confirmed actions/);
  assert.match(resumed.status(), /Action limit reached/);
});

test('a gather recovered from server XP preserves the exact Shark Waters target', async t => {
  const html = serverPage('gather', { xp: 18 }).replaceAll('mining', 'fishing');
  const f = recoveryFixture(t, { mode: 'gather', skill: 'fishing', html });
  await f.start({ actions: 2 });
  await f.advance(30000);
  assert.deepEqual(f.state.navigations, ['https://dankscape.com/gather.php?skill=fishing']);
  assert.equal(f.record().config.target, 'shark');
  assert.equal(f.record().completed, 1);
});

test('a recovered raid miss counts once without using other players’ boss damage as proof', async t => {
  const f = recoveryFixture(t, { mode: 'raid', html: serverPage('raid', { flash: 'You miss Fixture Boss.' }) });
  await f.start();
  await f.advance(30000);
  assert.equal(f.record().completed, 1);
  assert.equal(f.record().raidId, '123');
  assert.deepEqual(f.state.navigations, ['https://dankscape.com/raid.php?id=123']);
  const unproven = recoveryFixture(t, { mode: 'raid', html: serverPage('raid', { bossHP: 20 }) });
  await unproven.start();
  await unproven.advance(40000);
  assert.equal(unproven.reads.length, 2);
  assert.equal(unproven.state.navigations.length, 0);
  assert.match(unproven.status(), /Automatic recovery could not confirm/);
});

test('a recovered final boss strike heals before stopping and never attacks another boss', async t => {
  const f = recoveryFixture(t, { mode: 'raid', html: serverPage('raid', { bossHP: 0, hp: 99, flash: 'You hit Fixture Boss for 10.' }) });
  await f.start();
  await f.advance(30000);
  assert.equal(f.record().finishReason, 'Boss defeated.');
  const resumed = fixture(t, { mode: 'raid', bossHP: 0, bossMaximum: 30, hp: 99, foods: [shark], session: f.session(), now: 31000 });
  await resumed.advance(5000);
  assert.equal(resumed.state.requests.length, 1, resumed.status());
  assert.ok(resumed.state.requests[0].inv_id);
  assert.match(resumed.status(), /Boss defeated/);
});

test('a server-confirmed meal preserves the food budget and never resends that meal', async t => {
  const f = recoveryFixture(t, { hp: 99, foods: [shark], noEatResponse: true,
    html: serverPage('arena', { log: 'The battle begins.', flash: 'You eat the Shark and recover HP.' }) });
  await f.start({ meals: 1, actions: 1 });
  await f.advance(30000);
  assert.equal(f.record().eaten, 1);
  assert.equal(f.record().completed, 0);
  const resumed = fixture(t, { mode: 'arena', activeBattle: true, hpLoss: 0, foods: [shark], session: f.session(), now: 31000 });
  await resumed.advance(5000);
  assert.deepEqual(resumed.state.requests.map(request => request.action), ['swing']);
});

test('an unchanged server state gets only two checks and retains the pending cross-tab lock', async t => {
  const locks = lockManager();
  const f = recoveryFixture(t, { locks, html: serverPage('arena', { log: 'The battle begins.' }) });
  await f.start();
  await f.advance(120000);
  assert.equal(f.reads.length, 2);
  assert.equal(f.state.requests.length, 1);
  assert.equal(f.state.navigations.length, 0);
  assert.match(f.status(), /Automatic recovery could not confirm/);
  const other = fixture(t, { locks });
  await other.start();
  assert.equal(other.state.requests.length, 0);
});

test('disabling automatic recovery retains the original timeout behavior', async t => {
  const f = recoveryFixture(t);
  await f.start({ autoRecover: false });
  await f.advance(40000);
  assert.equal(f.reads.length, 0);
  assert.match(f.status(), /No confirmed response after 30 seconds/);
});

test('failed and stalled recovery reads are bounded and never create another POST', async t => {
  for (const failure of ['network', 'status', 'hang']) {
    const f = recoveryFixture(t, { fetchError: failure === 'network', status: failure === 'status' ? 503 : undefined,
      ...(failure === 'hang' ? { fetchImpl: (url, init) => new Promise((resolve, reject) => {
        init.signal.addEventListener('abort', () => reject(new Error('Aborted')));
      }) } : {}) });
    await f.start();
    await f.advance(60000);
    assert.equal(f.reads.length, 2, failure);
    assert.equal(f.state.requests.length, 1, failure);
    assert.equal(f.state.navigations.length, 0, failure);
    assert.match(f.status(), /Automatic recovery could not confirm/, failure);
  }
});

test('Stop aborts an in-flight check and ignores a response that arrives later', async t => {
  let resolveRead;
  const f = recoveryFixture(t, { fetchImpl: url => new Promise(resolve => { resolveRead = () => resolve({ ok: true, url, text: async () => serverPage() }); }) });
  await f.start();
  await f.advance(30000);
  f.stop();
  assert.equal(f.reads[0].init.signal.aborted, true);
  resolveRead();
  await flush();
  await f.advance(30000);
  assert.equal(f.state.navigations.length, 0);
  assert.equal(f.session()[KEY], undefined);
  assert.equal(f.state.requests.length, 1);
});

test('a normal late response cancels recovery and resumes without a stale reload', async t => {
  let resolveRead;
  const f = recoveryFixture(t, { noResponse: false, latency: 31000,
    fetchImpl: url => new Promise(resolve => { resolveRead = () => resolve({ ok: true, url, text: async () => serverPage() }); }) });
  await f.start({ actions: 1 });
  await f.advance(31000);
  assert.equal(f.reads[0].init.signal.aborted, true);
  resolveRead();
  await flush();
  assert.equal(f.state.navigations.length, 0);
  assert.match(f.status(), /Action limit reached/);
});

test('a missed swap event is repaired by rechecking the current DOM without any GET', async t => {
  const f = recoveryFixture(t, { beforeScript(window) {
    window.document.addEventListener('dank:swapped', event => event.stopImmediatePropagation());
  }, noResponse: false });
  await f.start({ actions: 1 });
  await f.advance(1000);
  assert.match(f.status(), /Action limit reached/);
  assert.equal(f.reads.length, 0);
  assert.equal(f.state.requests.length, 1);
});

test('a server-side human check pauses and alerts without submitting verification', async t => {
  const f = recoveryFixture(t, { html: serverPage('arena', { guard: true }) });
  await f.start();
  await f.advance(40000);
  assert.equal(f.reads.length, 1);
  assert.match(f.status(), /Human verification required/);
  assert.equal(f.state.verificationClicks, 0);
  assert.equal(f.state.navigations.length, 0);
  assert.equal(f.record().canResume, false);
  assert.equal(f.ui.getElementById('verify-link').hidden, false);
});

test('wrong hero, wrong area, wrong raid, and unreadable or defeated HP cannot restart combat', async t => {
  for (const scenario of [{ hero: 'Other hero' }, { zone: 'Other zone' }, { hpText: '?' }, { hp: 0 }]) {
    const f = recoveryFixture(t, { html: serverPage('arena', scenario) });
    await f.start();
    await f.advance(60000);
    assert.equal(f.state.navigations.length, 0);
    assert.equal(f.state.requests.length, 1);
  }
  const raid = recoveryFixture(t, { mode: 'raid', responseURL: 'https://dankscape.com/raid.php?id=999',
    html: serverPage('raid', { bossHP: 0, flash: 'You hit Fixture Boss for 10.' }) });
  await raid.start();
  await raid.advance(60000);
  assert.equal(raid.state.navigations.length, 0);
});

test('stale identical server toasts do not confirm the next raid miss', async t => {
  const f = recoveryFixture(t, { mode: 'raid', html: serverPage('raid', { flash: 'You miss Fixture Boss.' }) });
  f.document.getElementById('flash-stack').innerHTML = '<div class="flash flash-ok">You miss Fixture Boss.</div>';
  await f.start();
  await f.advance(60000);
  assert.equal(f.state.navigations.length, 0);
  assert.equal(f.state.requests.length, 1);
});

test('recovery does not navigate if checkpoint storage fails or the original time limit expires', async t => {
  const denied = recoveryFixture(t);
  await denied.start();
  denied.window.Storage.prototype.setItem = () => { throw new Error('Storage denied'); };
  await denied.advance(30000);
  assert.equal(denied.state.navigations.length, 0);
  assert.match(denied.status(), /Storage denied/);
  const expired = recoveryFixture(t, { fetchImpl: (url, init) => new Promise((resolve, reject) => {
    init.signal.addEventListener('abort', () => reject(new Error('Aborted')));
  }) });
  await expired.start({ minutes: 1 });
  await expired.advance(61000);
  assert.equal(expired.state.navigations.length, 0);
  assert.equal(expired.state.requests.length, 1);
});

test('the per-run refresh cap survives reloads', async t => {
  const original = recoveryFixture(t);
  await original.start();
  await original.advance(30000);
  const record = original.record();
  record.recoveries = 2;
  record.nextAt = 0;
  const f = recoveryFixture(t, { session: { [KEY]: JSON.stringify(record) }, now: 31000 });
  await f.advance(31000);
  assert.equal(f.state.requests.length, 1);
  assert.equal(f.reads.length, 0);
  assert.match(f.status(), /refresh limit reached/);
});

test('a recovered engagement is not counted as an attack and a recovered victory retains its win limit', async t => {
  const engaged = recoveryFixture(t, { activeBattle: false });
  await engaged.start();
  await engaged.advance(30000);
  assert.equal(engaged.record().completed, 0);
  assert.equal(engaged.record().canResume, true);
  const victory = recoveryFixture(t, { html: serverPage('arena', { victory: true, hp: 99 }) });
  await victory.start({ battles: 1 });
  await victory.advance(30000);
  assert.equal(victory.record().wins, 1);
  const resumed = fixture(t, { mode: 'arena', hp: 99, foods: [shark], session: victory.session(), now: 31000 });
  await resumed.advance(5000);
  assert.equal(resumed.state.requests.length, 1);
  assert.ok(resumed.state.requests[0].inv_id);
  assert.match(resumed.status(), /Arena win limit reached/);
});

test('the second check can recover after the first read fails', async t => {
  let count = 0;
  const f = recoveryFixture(t, { fetchImpl: async url => {
    if (++count === 1) throw new Error('Temporary network failure');
    return { ok: true, url, text: async () => serverPage() };
  } });
  await f.start();
  await f.advance(36000);
  assert.equal(f.reads.length, 2);
  assert.equal(f.state.requests.length, 1);
  assert.equal(f.state.navigations.length, 1);
  assert.equal(f.record().completed, 1);
});

test('redirects and returned scripts cannot execute or move recovery to another site', async t => {
  const f = recoveryFixture(t, { responseURL: 'https://example.com/arena.php', html: serverPage() });
  await f.start();
  await f.advance(60000);
  assert.equal(f.state.navigations.length, 0);
  const inert = recoveryFixture(t, { html: serverPage().replace('</body>', '<script>window.recoveryScriptExecuted = true;</script></body>') });
  await inert.start();
  await inert.advance(30000);
  assert.equal(inert.window.recoveryScriptExecuted, undefined);
  assert.equal(inert.state.navigations.length, 1);
});

test('older saved runs inherit automatic recovery without losing their existing settings', async t => {
  const original = recoveryFixture(t);
  await original.start({ interval: 5 });
  await original.advance(30000);
  const record = original.record();
  delete record.config.autoRecover;
  delete record.recoveries;
  record.nextAt = 0;
  const resumed = recoveryFixture(t, { session: { [KEY]: JSON.stringify(record) }, now: 31000 });
  await resumed.advance(30000);
  assert.equal(resumed.reads.length, 1);
  assert.equal(resumed.record().config.autoRecover, true);
  assert.equal(resumed.record().config.interval, 5);
});
