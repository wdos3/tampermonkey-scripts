'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { fixture, flush, lockManager } = require('./harness.cjs');
const { page } = require('./fixture.cjs');
const { questContent } = require('./quest-fixture.cjs');

const KEY = 'dankscape-assistant:quest-queue:v1';
const contract = (extra = {}) => ({ id: 'mouse', name: 'Mouse Hunt', target: 'Field Mouse', group: 'Active', goal: 2, progress: 0, ...extra });

function board(t, contracts = [contract()], options = {}) {
  return fixture(t, { mode: 'quest', questContent: (state, token) => questContent(contracts, options.level ?? 45, 'Local test hero', token),
    questSubmit(payload) {
      const quest = contracts.find(quest => quest.id === payload.quest_id);
      if (payload.action === 'accept') quest.group = 'Active';
      if (payload.action === 'claim') quest.group = 'Chronicled';
    }, ...options });
}

function queue(f) { return JSON.parse(f.session()[KEY]); }

async function route(t, quest = contract(), settings = {}, options = {}) {
  const f = board(t, [quest], options);
  await f.start({ interval: 1, actions: 100, ...settings });
  await f.advance(500);
  const session = f.session();
  f.window.close();
  await flush();
  return session;
}

function activity(t, session, options = {}) {
  return fixture(t, { mode: 'arena', hpLoss: 0, session, ...options });
}

test('quest mode is visible and stopped until Start', t => {
  const f = board(t);
  assert.equal(f.ui.getElementById('start').disabled, false);
  assert.equal(f.ui.getElementById('quests').value, '20');
  assert.equal(f.state.requests.length, 0);
});

test('active contracts run before available quests and use native Hunt controls', async t => {
  const f = board(t, [contract(), contract({ id: 'other', name: 'Next', group: 'Available' })]);
  await f.start();
  assert.equal(f.state.requests.length, 1);
  assert.equal(f.state.requests[0].action, 'travel');
  assert.equal(f.state.requests[0].csrf, 'fixture-token');
  assert.equal(queue(f).current.name, 'Mouse Hunt');
  assert.equal(queue(f).continuation, 'activity');
});

test('eligibility uses the actual combat level, then accepts in board order', async t => {
  const contracts = [contract({ id: 'high', name: 'Too high', level: 46, group: 'Available' }),
    contract({ id: 'eligible', name: 'Eligible', level: 45, group: 'Available' })];
  const f = board(t, contracts);
  await f.start({ interval: 1 });
  await f.advance(1400);
  assert.deepEqual(f.state.requests.map(r => r.action), ['accept', 'travel']);
  assert.equal(f.state.requests[0].quest_id, 'eligible');
  assert.equal(f.state.requests[1].csrf, 'fixture-token-1');
});

test('turn-in confirmation permits the next eligible quest and counts no combat actions', async t => {
  const contracts = [contract({ progress: 2 }), contract({ id: 'next', name: 'Next quest', group: 'Available' })];
  const f = board(t, contracts);
  await f.start({ interval: 1 });
  await f.advance(2500);
  assert.deepEqual(f.state.requests.map(r => r.action), ['claim', 'accept', 'travel']);
  assert.equal(queue(f).finished.length, 1);
  assert.equal(queue(f).completed, 0);
});

test('quest cap stops after the final turn-in without accepting another', async t => {
  const f = board(t, [contract({ progress: 2 }), contract({ id: 'next', name: 'Next', group: 'Available' })]);
  await f.start({ quests: 1, interval: 1 });
  await f.advance(2000);
  assert.deepEqual(f.state.requests.map(r => r.action), ['claim']);
  assert.match(f.status(), /Quest limit reached/);
});

test('unsupported active deliveries are skipped without abandoning them', async t => {
  const f = board(t, [contract({ id: 'bones', name: 'Bone Tithe', kind: 'collect', target: 'Dragon Bones', noRoute: true }), contract()]);
  await f.start();
  await f.advance(500);
  assert.deepEqual(f.state.requests.map(r => r.action), ['travel']);
  assert.match(f.ui.getElementById('quest-info').textContent, /Bone Tithe/);
  assert.equal(queue(f).skipped.length, 1);
});

test('unsupported and locked contracts do not trigger accepts, abandonment, or purchases', async t => {
  const f = board(t, [contract({ group: 'Locked' }), contract({ id: 'high', name: 'Too high', level: 90, group: 'Available' })]);
  await f.start();
  assert.equal(f.state.requests.length, 0);
  assert.match(f.status(), /No more supported eligible quests/);
});

test('an eligible delivery is accepted only after its gathering level and item are verified', async t => {
  const f = board(t, [contract({ kind: 'collect', target: 'Fixture resource', group: 'Available' })], {
    beforeScript(window) {
      window.fetch = async url => ({ ok: true, url, text: async () => page(new URL(url).searchParams.get('skill')) });
    },
  });
  await f.start({ interval: 1 });
  await f.advance(500);
  await f.advance(2000);
  assert.deepEqual(f.state.requests.map(r => r.action), ['accept']);
  assert.match(f.state.navigations[0], /gather.php\?skill=fishing&target=shark/);
});

test('unknown delivery items are left unaccepted after catalog inspection', async t => {
  const f = board(t, [contract({ kind: 'collect', target: 'Dragon Bones', group: 'Available' })], {
    beforeScript(window) { window.fetch = async url => ({ ok: true, url, text: async () => page(new URL(url).searchParams.get('skill')) }); },
  });
  await f.start();
  await f.advance(500);
  await f.advance(500);
  assert.equal(f.state.requests.length, 0);
  assert.match(f.status(), /No more supported eligible quests/);
});

test('an Arena objective stays for both foes, heals each time, then returns to the board', async t => {
  const session = await route(t);
  const f = activity(t, session, { enemyHP: 3, damageOnKill: true, hpLoss: 1, foods: [{ id: 'food', name: 'Shark', gain: 20, quantity: 3 }] });
  await f.advance(8000);
  assert.deepEqual(f.state.requests.map(r => r.action || 'eat'), ['engage', 'swing', 'eat', 'engage', 'swing', 'eat']);
  assert.match(f.state.navigations[0], /quests.php$/);
  assert.equal(queue(f).wins, 2);
  assert.equal(queue(f).eaten, 2);
  assert.equal(queue(f).completed, 2);
});

test('gathering stays at the exact resource until the requested item count is reached', async t => {
  const session = await route(t, contract({ kind: 'collect', target: 'Fixture resource', goal: 12 }));
  const f = activity(t, session, { mode: 'gather', skill: 'fishing' });
  await f.advance(20000);
  assert.equal(f.state.requests.length, 12);
  assert.ok(f.state.requests.every(r => r.node === 'shark'));
  assert.match(f.state.navigations[0], /quests.php$/);
  assert.equal(queue(f).completed, 12);
});

test('a delivery two items from goal checks the board after two actions', async t => {
  const session = await route(t, contract({ kind: 'collect', target: 'Fixture resource', goal: 12, progress: 10 }));
  const f = activity(t, session, { mode: 'gather', skill: 'fishing' });
  await f.advance(5000);
  assert.equal(f.state.requests.length, 2);
  assert.equal(f.state.navigations.length, 1);
});

test('the completed item count is verified on the board before hand-in and continuation', async t => {
  const session = await route(t, contract({ kind: 'collect', target: 'Fixture resource', goal: 2 }));
  const f = activity(t, session, { mode: 'gather', skill: 'fishing' });
  await f.advance(4000);
  const nextSession = f.session();
  f.window.close();
  const next = board(t, [contract({ kind: 'collect', target: 'Fixture resource', goal: 2, progress: 2 })], { session: nextSession, now: 4000 });
  await next.advance(2000);
  assert.deepEqual(next.state.requests.map(r => r.action), ['claim']);
  assert.equal(queue(next).finished.length, 1);
  assert.match(next.status(), /No more supported eligible quests/);
});

test('budgets remain cumulative across quest travel and a final completed objective can be turned in', async t => {
  const session = await route(t, contract({ kind: 'collect', target: 'Fixture resource', goal: 1 }), { actions: 1 });
  const f = activity(t, session, { mode: 'gather', skill: 'fishing' });
  await f.advance(2000);
  const nextSession = f.session();
  f.window.close();
  const next = board(t, [contract({ kind: 'collect', target: 'Fixture resource', goal: 1, progress: 1 }),
    contract({ id: 'next', name: 'Next', group: 'Available' })], { session: nextSession, now: 2000 });
  await next.advance(2000);
  assert.deepEqual(next.state.requests.map(r => r.action), ['claim']);
  assert.equal(queue(next).completed, 1);
  assert.match(next.status(), /Action limit reached/);
});

test('wrong hero, skill, area, or active enemy cannot continue a queued objective', async t => {
  for (const change of ['hero', 'skill', 'zone', 'enemy']) {
    const session = await route(t);
    const f = activity(t, session, change === 'zone' ? { zone: 'Mossgill Sewers' } : change === 'skill' ? { mode: 'gather', skill: 'fishing' }
      : { activeBattle: change === 'enemy', beforeScript(window) {
        if (change === 'hero') window.document.querySelector('aside h2').textContent = 'Other hero';
        if (change === 'enemy') window.document.querySelector('.fight-stage h2').textContent = 'Combat: Other Foe';
      } });
    await f.advance(500);
    assert.equal(f.state.requests.length, 0, change);
    assert.equal(queue(f).active, false, change);
  }
});

test('a locked gathering objective is skipped and never replaced with another resource', async t => {
  const session = await route(t, contract({ kind: 'collect', target: 'Unobtainable item' }));
  const f = activity(t, session, { mode: 'gather', skill: 'fishing' });
  await f.advance(500);
  assert.equal(f.state.requests.length, 0);
  assert.match(f.state.navigations[0], /quests.php$/);
  assert.equal(queue(f).skipped.length, 1);
});

test('a timed-out acceptance remains uncertain, and reload cannot resend it', async t => {
  const f = board(t, [contract({ group: 'Available' })], { noResponse: true });
  await f.start();
  await f.advance(31000);
  assert.match(f.status(), /quest request was not confirmed/);
  assert.equal(f.state.requests.length, 1);
  assert.equal(queue(f).uncertain, true);
  const next = board(t, [contract()], { session: f.session(), now: 31000 });
  await next.advance(5000);
  assert.equal(next.state.requests.length, 0);
  assert.equal(next.ui.getElementById('quest-resume').disabled, true);
});

test('human checks pause quests without clicking verification or losing the objective', async t => {
  const session = await route(t);
  const f = activity(t, session, { guard: true });
  await f.advance(2000);
  assert.equal(f.state.requests.length, 0);
  assert.equal(f.state.verificationClicks, 0);
  assert.equal(queue(f).current.name, 'Mouse Hunt');
  assert.match(f.status(), /Human verification required/);
});

test('Stop during an acceptance sends no later travel or next quest', async t => {
  const f = board(t, [contract({ group: 'Available' })], { latency: 1000 });
  await f.start();
  f.stop();
  await f.advance(5000);
  assert.equal(f.state.requests.length, 1);
  assert.equal(f.session()[KEY], undefined);
});

test('expired queue and corrupt saved data cannot run automatically', async t => {
  const session = await route(t, contract(), { minutes: 1 });
  const f = activity(t, session, { now: 61000 });
  await f.advance(500);
  assert.equal(f.state.requests.length, 0);
  assert.match(f.status(), /Time limit reached/);
  const bad = board(t, [contract()], { session: { [KEY]: '{"version":1,"active":true}' } });
  assert.equal(bad.ui.getElementById('start').disabled, true);
  assert.match(bad.status(), /invalid/);
});

test('quest queues respect the same cross-tab game lock', async t => {
  const locks = lockManager();
  const other = fixture(t, { locks, noResponse: true });
  await other.start();
  const f = board(t, [contract()], { locks });
  await f.start();
  assert.equal(f.state.requests.length, 0);
  assert.match(f.status(), /Another tab/);
});

test('full slots occupied by unsupported quests stop without accepting or abandoning', async t => {
  const contracts = ['One', 'Two', 'Three'].map(name => contract({ id: name, name, kind: 'collect', target: 'Unknown item', noRoute: true }));
  contracts.push(contract({ id: 'next', name: 'Next', group: 'Available' }));
  const f = board(t, contracts);
  await f.start();
  await f.advance(2000);
  assert.equal(f.state.requests.length, 0);
  assert.match(f.status(), /Quest slots are full/);
});

test('quest turn-in cannot post to another endpoint or a confirmation form', async t => {
  for (const mutation of ['endpoint', 'confirmation']) {
    const f = board(t, [contract({ progress: 2 })], { beforeScript(window) {
      const form = window.document.querySelector('section.content form[data-ajax]');
      if (mutation === 'endpoint') form.action = 'https://example.com/quests.php';
      else form.setAttribute('onsubmit', 'return confirm("Different action");');
    } });
    await f.start();
    assert.equal(f.state.requests.length, 0);
    assert.match(f.status(), /form changed/);
  }
});

test('manual verification resumes via fresh board progress and keeps the original budget', async t => {
  const session = await route(t, contract(), { actions: 3, minutes: 10 });
  const f = activity(t, session, { guard: true });
  await f.advance(500);
  f.clearGuard();
  await flush();
  f.ui.getElementById('quest-resume').click();
  await flush();
  assert.equal(f.state.requests.length, 0);
  assert.deepEqual(f.state.navigations, ['https://dankscape.com/guard.php?from=arena', 'https://dankscape.com/quests.php']);
  assert.equal(queue(f).deadline, 600000);
  assert.equal(queue(f).config.actions, 3);
});

function guardPage(t, session, options = {}) {
  return fixture(t, { url: 'https://dankscape.com/guard.php?from=arena', session, beforeScript(window) {
    window.document.querySelector('section.content').innerHTML = '<h1>Quick human check</h1><form action="/guard.php?from=arena" method="post"><button>I’m human — continue</button></form>';
  }, ...options });
}

async function verificationHandoff(t, settings = {}) {
  const session = await route(t, contract(), { actions: 3, minutes: 10, ...settings });
  const f = activity(t, session, { guardOnRequest: 1 });
  await f.advance(1000);
  assert.deepEqual(f.state.navigations, ['https://dankscape.com/guard.php?from=arena']);
  assert.deepEqual(queue(f).verification, { returnPath: '/arena.php', visited: false });
  const guard = guardPage(t, f.session(), { now: 1000 });
  await guard.advance(1000);
  assert.deepEqual(queue(guard).verification, { returnPath: '/arena.php', visited: true, continueClicked: true });
  assert.equal(guard.state.verificationClicks, 1);
  assert.equal(guard.state.requests.length, 0);
  assert.equal(guard.state.navigations.length, 0);
  guard.window.dispatchEvent(new guard.window.Event('pagehide'));
  assert.equal(queue(guard).verification.visited, true);
  return guard;
}

test('manual challenge completion automatically checks the quest board and continues the exact objective', async t => {
  const guard = await verificationHandoff(t);
  const returned = activity(t, guard.session(), { now: 5000, zone: 'Default area after verification' });
  await returned.advance(1000);
  assert.deepEqual(returned.state.navigations, ['https://dankscape.com/quests.php']);
  assert.equal(returned.state.requests.length, 0);
  assert.equal(queue(returned).verification, false);
  assert.equal(queue(returned).deadline, 600000);
  assert.equal(queue(returned).config.actions, 3);
  const fresh = board(t, [contract()], { session: returned.session(), now: 6000 });
  await fresh.advance(500);
  assert.equal(fresh.state.requests[0].action, 'travel');
  const fight = activity(t, fresh.session(), { now: 7000, enemyHP: 3 });
  await fight.advance(6000);
  assert.equal(queue(fight).completed, 2);
  assert.equal(queue(fight).wins, 2);
  assert.equal(queue(fight).current.target, 'Field Mouse');
  assert.deepEqual(fight.state.navigations, ['https://dankscape.com/quests.php']);
});

test('a quest already paused on the guard page can adopt the handoff after an update', async t => {
  const session = await route(t);
  const saved = JSON.parse(session[KEY]);
  Object.assign(saved, { active: false, continuation: null, completed: 1, eaten: 2, drunk: 2, wins: 1, recoveries: 1 });
  const guard = guardPage(t, { [KEY]: JSON.stringify(saved) });
  await guard.advance(120000);
  assert.equal(guard.state.requests.length, 0);
  const returned = activity(t, guard.session(), { now: 120000 });
  await returned.advance(500);
  const resumed = queue(returned);
  assert.deepEqual([resumed.completed, resumed.eaten, resumed.drunk, resumed.wins, resumed.recoveries], [1, 2, 2, 1, 1]);
  assert.equal(resumed.deadline, saved.deadline);
  assert.deepEqual(returned.state.navigations, ['https://dankscape.com/quests.php']);
});

test('gathering verification resets to the board before restoring the quest resource', async t => {
  const delivery = contract({ kind: 'collect', target: 'Fixture resource', goal: 4 });
  const session = await route(t, delivery);
  const f = activity(t, session, { mode: 'gather', skill: 'fishing', guard: true });
  await f.advance(500);
  assert.deepEqual(f.state.navigations, ['https://dankscape.com/guard.php?from=gather']);
  const guard = guardPage(t, f.session(), { url: 'https://dankscape.com/guard.php?from=gather' });
  await guard.advance(500);
  const returned = fixture(t, { session: guard.session() });
  await returned.advance(500);
  assert.deepEqual(returned.state.navigations, ['https://dankscape.com/quests.php']);
  assert.equal(returned.state.requests.length, 0);
  const fresh = board(t, [delivery], { session: returned.session() });
  await fresh.advance(500);
  assert.deepEqual(fresh.state.navigations, ['https://dankscape.com/gather.php?skill=fishing&target=shark']);
});

test('a completed strike accompanying a human check is counted once before the handoff', async t => {
  const session = await route(t);
  const f = activity(t, session, { activeBattle: true, enemyHP: 3, result: { showCheck: true } });
  await f.advance(1000);
  assert.equal(queue(f).completed, 1);
  assert.equal(queue(f).wins, 1);
  assert.equal(queue(f).current.progress, 1);
  assert.equal(queue(f).uncertain, false);
  assert.deepEqual(f.state.navigations, ['https://dankscape.com/guard.php?from=arena']);
  const guard = guardPage(t, f.session());
  await guard.advance(500);
  const returned = activity(t, guard.session());
  await returned.advance(1000);
  assert.equal(queue(returned).completed, 1);
  assert.equal(queue(returned).wins, 1);
  assert.equal(returned.state.requests.length, 0);
});

test('returning without visiting the challenge cannot authorize automatic quest resume', async t => {
  const session = await route(t);
  const f = activity(t, session, { guard: true });
  await f.advance(500);
  const returned = activity(t, f.session());
  await returned.advance(2000);
  assert.equal(returned.state.navigations.length, 0);
  assert.equal(returned.state.requests.length, 0);
});

test('Stop and Escape on the challenge cancel automatic resume', async t => {
  for (const cancel of ['stop', 'escape']) {
    const guard = await verificationHandoff(t);
    if (cancel === 'stop') guard.stop();
    else guard.document.dispatchEvent(new guard.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await guard.advance(1000);
    const returned = activity(t, guard.session());
    await returned.advance(2000);
    assert.equal(returned.state.requests.length, 0);
    assert.equal(returned.state.navigations.length, 0);
    if (cancel === 'escape') assert.equal(queue(returned).verification, false);
  }
});

test('an explicitly cancelled queue is not adopted again on the guard page', async t => {
  const guard = await verificationHandoff(t);
  guard.document.dispatchEvent(new guard.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  const reloaded = guardPage(t, guard.session());
  await reloaded.advance(2000);
  assert.equal(queue(reloaded).verification, false);
  const returned = activity(t, reloaded.session());
  await returned.advance(2000);
  assert.equal(returned.state.navigations.length, 0);
});

test('a pending uncertain action neither opens the check nor retries on return', async t => {
  const session = await route(t);
  const f = activity(t, session, { noResponse: true });
  await f.advance(100);
  f.showGuard();
  await f.advance(500);
  assert.equal(queue(f).uncertain, true);
  assert.equal(f.state.navigations.length, 0);
  assert.equal(f.state.requests.length, 1);
  const guard = guardPage(t, f.session());
  await guard.advance(500);
  const returned = activity(t, guard.session());
  await returned.advance(1000);
  assert.equal(returned.state.requests.length, 0);
  assert.equal(returned.state.navigations.length, 0);
  assert.match(returned.status(), /unconfirmed task action/);
});

test('challenge waiting cannot extend an expired quest deadline', async t => {
  const guard = await verificationHandoff(t, { minutes: 1 });
  const returned = activity(t, guard.session(), { now: 61000 });
  await returned.advance(1000);
  assert.equal(returned.state.navigations.length, 0);
  assert.equal(returned.state.requests.length, 0);
  assert.equal(queue(returned).verification, false);
  assert.match(returned.status(), /original time limit expired/);
});

test('a different hero or return page cannot automatically continue the quest', async t => {
  for (const mismatch of ['hero', 'page']) {
    const guard = await verificationHandoff(t);
    const returned = activity(t, guard.session(), { ...(mismatch === 'page' ? { mode: 'gather' } : { beforeScript(window) {
      window.document.querySelector('aside h2').textContent = 'Another hero';
    } }) });
    await returned.advance(1000);
    assert.equal(returned.state.navigations.length, 0);
    assert.equal(returned.state.requests.length, 0);
    if (mismatch === 'hero') assert.match(returned.status(), /active hero changed/);
  }
});

test('another active tab prevents automatic resume without repeated lock attempts', async t => {
  const locks = lockManager();
  const other = fixture(t, { locks, noResponse: true });
  await other.start();
  const guard = await verificationHandoff(t);
  const returned = activity(t, guard.session(), { locks });
  await returned.advance(2000);
  assert.equal(returned.state.navigations.length, 0);
  assert.equal(returned.state.requests.length, 0);
  assert.equal(queue(returned).verification, false);
  assert.match(returned.status(), /another tab/i);
});

test('malformed verification destinations are rejected before any continuation', async t => {
  const session = await route(t);
  const saved = JSON.parse(session[KEY]);
  saved.verification = { returnPath: 'https://example.com/arena.php', visited: true };
  const f = activity(t, { [KEY]: JSON.stringify(saved) });
  await f.advance(2000);
  assert.equal(f.state.requests.length, 0);
  assert.equal(f.state.navigations.length, 0);
  assert.match(f.status(), /Saved quest data is invalid/);
});

test('ordinary reload pauses a queue instead of automatically repeating the current action', async t => {
  const session = await route(t);
  const f = activity(t, session, { noResponse: true });
  await f.advance(100);
  const next = activity(t, f.session(), { now: 500 });
  await next.advance(5000);
  assert.equal(next.state.requests.length, 0);
  assert.equal(queue(next).uncertain, true);
  assert.equal(queue(next).active, false);
});

test('energy recovery and food limits still apply inside a delivery', async t => {
  const session = await route(t, contract({ kind: 'collect', target: 'Fixture resource', goal: 5 }), { meals: 1 });
  const f = activity(t, session, { mode: 'gather', skill: 'fishing', energy: 0, foods: [{ id: 'fish', name: 'Shark', gain: 4, quantity: 10 }] });
  await f.advance(10000);
  assert.deepEqual(f.state.requests.map(r => r.action || 'eat'), ['eat', 'gather']);
  assert.match(f.status(), /Food item limit reached/);
  assert.equal(queue(f).eaten, 1);
});

test('delivery availability failures and hero changes stop before acceptance', async t => {
  for (const failure of ['network', 'hero']) {
    const f = board(t, [contract({ kind: 'collect', target: 'Fixture resource', group: 'Available' })], {
      beforeScript(window) { window.fetch = async url => {
        if (failure === 'network') throw new Error('Network unavailable');
        return { ok: true, url, text: async () => page('fishing').replaceAll('Local test hero', 'Other hero') };
      }; },
    });
    await f.start();
    await f.advance(500);
    assert.equal(f.state.requests.length, 0);
    assert.match(f.status(), /Could not check delivery quests/);
  }
});

test('server-confirmed recovery retains the quest counters and the original recovery cap', async t => {
  const session = await route(t, contract({ kind: 'collect', target: 'Fixture resource', goal: 3 }));
  const html = page('fishing').replace('fishing 1 · 0 / 83 XP', 'fishing 1 · 18 / 83 XP')
    .replace('<div id="flash-stack"></div>', '<div id="flash-stack"><div class="flash flash-ok">You gather 1 Fixture resource.</div></div>');
  const f = activity(t, session, { mode: 'gather', skill: 'fishing', noResponse: true,
    beforeScript(window) { window.fetch = async url => ({ ok: true, url, text: async () => html }); } });
  await f.advance(30000);
  assert.equal(queue(f).completed, 1);
  assert.equal(queue(f).recoveries, 1);
  assert.equal(queue(f).uncertain, false);
  const restoredSession = f.session();
  f.window.close();
  const restored = activity(t, restoredSession, { mode: 'gather', skill: 'fishing', now: 31000 });
  await restored.advance(4000);
  assert.equal(restored.state.requests.length, 2);
  assert.equal(queue(restored).completed, 3);
  assert.equal(queue(restored).recoveries, 1);
  assert.match(restored.state.navigations[0], /quests.php$/);
});

test('browser back/forward reads current queue counts instead of restoring an old budget', async t => {
  const f = board(t);
  await f.start();
  const latest = queue(f);
  latest.completed = 7;
  latest.wins = 2;
  latest.eaten = 3;
  f.window.sessionStorage.setItem(KEY, JSON.stringify(latest));
  f.window.dispatchEvent(new f.window.PageTransitionEvent('pageshow', { persisted: true }));
  await flush();
  assert.equal(queue(f).completed, 7);
  assert.equal(queue(f).wins, 2);
  assert.equal(f.ui.getElementById('quest-resume').disabled, false);
  assert.match(f.ui.getElementById('stats').textContent, /^7 confirmed actions · 3 food/);
  assert.equal(queue(f).active, false);
});
