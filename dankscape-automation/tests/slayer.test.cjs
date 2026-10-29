'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { fixture, flush, lockManager } = require('./harness.cjs');
const { page, potionMarkup } = require('./fixture.cjs');
const { slayerContent } = require('./slayer-fixture.cjs');
const { questContent } = require('./quest-fixture.cjs');
const KEY = 'dankscape-assistant:quest-queue:v1';
const task = { target: 'Yeti', goal: 22, progress: 21, zone: 'Meadowbrook Fields' };
const record = f => JSON.parse(f.session()[KEY] || 'null');

function board(t, options = {}) {
  return fixture(t, { ...options, mode: 'slayer',
    url: 'https://dankscape.com/slayer.php', slayerContent: () => slayerContent({ task, ...options.board }),
    beforeScript(window) {
      window.document.querySelector('aside').remove();
      window.fetch = async (url, init) => {
        options.reads?.push({ url, init });
        return { ok: true, url, text: async () => page('mining', false, 'arena').replace('Local test hero', options.hero || 'Local test hero') };
      };
      options.beforeScript?.(window);
    } });
}

async function leave(f) {
  const session = f.session();
  f.window.close();
  await flush();
  return session;
}

async function lastKill(t, config = {}, options = {}) {
  const first = board(t);
  await first.start({ interval: 0.1, ...config });
  const fight = fixture(t, { mode: 'arena', enemyName: 'Yeti', enemyHP: 3, hpLoss: 0,
    session: await leave(first), ...options });
  await fight.advance(2500);
  return fight;
}

test('the 21/22 active task continues without assignment, using one read-only hero lookup', async t => {
  const reads = [];
  const f = board(t, { reads });
  await f.start({ interval: 0.1, reserve: 4, meals: 12 });
  assert.equal(reads.length, 1);
  assert.equal(reads[0].init.method, 'GET');
  assert.equal(reads[0].init.redirect, 'error');
  assert.equal(f.state.requests.length, 0);
  assert.deepEqual(f.state.navigations, ['https://dankscape.com/arena.php?target=1&from=slayer']);
  assert.equal(record(f).current.progress, 21);
  assert.equal(record(f).source, 'slayer');
  assert.equal(record(f).config.meals, 12);
});

test('an away task uses its exact native travel form and carries its route across navigation', async t => {
  const f = board(t, { board: { away: true } });
  await f.start();
  assert.deepEqual(f.state.requests.map(r => r.action), ['travel']);
  assert.equal(f.state.requests[0].from, 'slayer');
  assert.equal(record(f).continuation, 'activity');
});

test('the final confirmed kill heals first and returns to Slayer without another engagement', async t => {
  const f = await lastKill(t, {}, { damageOnKill: true, hpLoss: 1,
    foods: [{ id: 'food', name: 'Shark', gain: 20, quantity: 5 }] });
  assert.deepEqual(f.state.requests.map(r => r.action), ['engage', 'swing', undefined]);
  assert.equal(record(f).wins, 1);
  assert.equal(record(f).completed, 1);
  assert.equal(record(f).eaten, 1);
  assert.equal(record(f).current.progress, 22);
  assert.deepEqual(f.state.navigations, ['https://dankscape.com/slayer.php']);
});

test('claim confirmation then assignment preserves budgets and permits another identical task', async t => {
  const fight = await lastKill(t, { quests: 1, actions: 50, minutes: 12 });
  const claim = board(t, { now: 3000, board: { task: { ...task, progress: 22 } }, session: await leave(fight) });
  await claim.advance(0);
  assert.deepEqual(claim.state.requests.map(r => r.action), ['claim']);
  assert.equal(record(claim).command.kind, 'claim');
  assert.equal(record(claim).uncertain, true);
  const empty = board(t, { board: { task: null, completed: 3 }, session: await leave(claim) });
  await empty.advance(200);
  assert.equal(record(empty).tasksCompleted, 1);
  assert.deepEqual(empty.state.requests.map(r => r.action), ['assign']);
  const next = board(t, { board: { task: { ...task, progress: 0 }, completed: 3 }, session: await leave(empty) });
  await next.advance(200);
  assert.equal(record(next).tasksCompleted, 1);
  assert.equal(record(next).current.progress, 0);
  assert.equal(record(next).completed, 1);
  assert.equal(record(next).config.actions, 50);
  assert.equal(record(next).config.quests, 1);
  assert.equal(record(next).deadline, 12 * 60000);
  assert.equal(record(next).finished.length, 0);
  assert.equal(next.state.navigations.length, 1);
});

test('a fresh run with no task submits Take a task once and cannot repeat an unconfirmed assignment', async t => {
  const first = board(t, { board: { task: null } });
  await first.start();
  assert.deepEqual(first.state.requests.map(r => r.action), ['assign']);
  const next = board(t, { board: { task: null }, session: await leave(first) });
  await next.advance(5000);
  assert.equal(next.state.requests.length, 0);
  assert.match(next.status(), /not confirmed/);
  assert.equal(record(next).uncertain, true);
  next.ui.getElementById('quest-resume').click();
  await next.advance(0);
  assert.equal(next.state.requests.length, 0);
});

test('an unchanged ready task cannot cause an uncertain claim to be submitted twice', async t => {
  const first = board(t, { board: { task: { ...task, progress: 22 } } });
  await first.start();
  const next = board(t, { board: { task: { ...task, progress: 22 } }, session: await leave(first) });
  await next.advance(5000);
  assert.equal(next.state.requests.length, 0);
  assert.match(next.status(), /not confirmed/);
});

test('the original action cap permits the earned claim, then prevents another assignment', async t => {
  const fight = await lastKill(t, { actions: 1 });
  const claim = board(t, { now: 3000, board: { task: { ...task, progress: 22 } }, session: await leave(fight) });
  await claim.advance(0);
  assert.equal(claim.state.requests[0].action, 'claim');
  const next = board(t, { board: { task: null, completed: 3 }, session: await leave(claim) });
  await next.advance(1000);
  assert.equal(record(next).tasksCompleted, 1);
  assert.equal(next.state.requests.length, 0);
  assert.match(next.status(), /Action limit reached/);
});

test('different heroes, areas, and enemies cannot continue the original Slayer task', async t => {
  for (const issue of ['hero', 'zone', 'enemy']) {
    const first = board(t);
    await first.start();
    const session = await leave(first);
    const f = issue === 'hero' ? board(t, { session, hero: 'Another hero' })
      : fixture(t, { mode: 'arena', session, enemyName: issue === 'enemy' ? 'Wrong foe' : 'Yeti',
        zone: issue === 'zone' ? 'Mossgill Sewers' : 'Meadowbrook Fields' });
    await f.advance(1000);
    assert.equal(f.state.requests.length, 0, issue);
    assert.equal(f.state.navigations.length, 0, issue);
    assert.match(f.status(), /hero|area|target/i, issue);
  }
});

test('changed task metadata, malformed counts, and missing claims pause without using Skip', async t => {
  for (const issue of ['goal', 'count', 'claim']) {
    const f = board(t, { board: { task: { ...task, progress: 22 } }, beforeScript(window) {
      if (issue === 'goal') window.document.querySelector('section.content h3').firstChild.textContent = 'Current task: slay 99 Yeti ';
      if (issue === 'count') window.document.querySelector('section.content p.dim strong').textContent = 'unknown';
      if (issue === 'claim') window.document.querySelector('section.content form').remove();
    } });
    await f.start();
    assert.equal(f.state.requests.length, 0, issue);
  }
});

test('Slayer controls reject external routes and inline confirmation handlers', async t => {
  for (const issue of ['travel', 'claim', 'assign', 'confirmation']) {
    const f = board(t, { board: { away: true, task: issue === 'assign' ? null : { ...task, progress: issue === 'claim' ? 22 : 21 } },
      beforeScript(window) {
        const form = window.document.querySelector('section.content form');
        if (issue === 'confirmation') form.setAttribute('onsubmit', 'return confirm("Changed");');
        else form.action = 'https://example.com/slayer.php';
      } });
    await f.start();
    assert.equal(f.state.requests.length, 0, issue);
  }
});

test('Slayer potion choices load without a sidebar and survive travel into combat', async t => {
  const potion = { id: 'potion', name: 'Super Attack Elixir', stat: 'attack', boost: 7, quantity: 5 };
  const f = board(t, { beforeScript(window) {
    window.fetch = async url => ({ ok: true, url, text: async () => page().replace('</aside>', `${potionMarkup([potion])}</aside>`) });
  } });
  f.ui.getElementById('load-potions').click();
  await flush();
  await f.start({ potions: [{ stat: potion.stat, name: potion.name }] });
  assert.equal(f.ui.getElementById('potion-settings').hidden, false);
  const fight = fixture(t, { mode: 'arena', enemyName: 'Yeti', session: await leave(f), potions: [potion], noResponse: true });
  await fight.advance(500);
  assert.equal(fight.state.requests[0].action, 'drink');
  assert.equal(record(fight).drunk, 1);
  assert.equal(record(fight).current.progress, 21);
});

test('Stop cancels a stalled hero lookup and a late result cannot revive the queue', async t => {
  let resolve;
  let signal;
  const locks = lockManager();
  const f = board(t, { locks, beforeScript(window) {
    window.fetch = (url, init) => { signal = init.signal; return new Promise(done => { resolve = () => done({ ok: true, url, text: async () => page() }); }); };
  } });
  await f.start();
  assert.equal(f.ui.getElementById('start').disabled, true);
  f.stop();
  assert.equal(signal.aborted, true);
  resolve();
  await f.advance(500);
  assert.equal(record(f), null);
  assert.equal(f.state.requests.length, 0);
  const other = fixture(t, { locks });
  await other.start({ actions: 1 });
  assert.equal(other.state.requests.length, 1);
});

test('human checks save Slayer for resume and open only the verification page', async t => {
  const first = board(t);
  await first.start();
  const f = fixture(t, { mode: 'arena', enemyName: 'Yeti', session: await leave(first), guardOnRequest: 1 });
  await f.advance(500);
  assert.match(f.status(), /automatic resume/);
  assert.deepEqual(f.state.navigations, ['https://dankscape.com/guard.php?from=arena']);
  assert.equal(f.state.verificationClicks, 0);
  assert.equal(record(f).current.progress, 21);
  assert.equal(record(f).active, false);
});

test('manual verification returns Slayer through its own fresh board and restores the assigned monster', async t => {
  const first = board(t);
  await first.start({ actions: 3, minutes: 10 });
  const f = fixture(t, { mode: 'arena', enemyName: 'Yeti', session: await leave(first), guardOnRequest: 1 });
  await f.advance(500);
  const guard = fixture(t, { url: 'https://dankscape.com/guard.php?from=arena', session: await leave(f) });
  await guard.advance(1000);
  assert.equal(guard.state.requests.length, 0);
  const returned = fixture(t, { mode: 'arena', zone: 'Default area', session: await leave(guard) });
  await returned.advance(500);
  assert.deepEqual(returned.state.navigations, ['https://dankscape.com/slayer.php']);
  const fresh = board(t, { session: await leave(returned) });
  await fresh.advance(500);
  assert.deepEqual(fresh.state.navigations, ['https://dankscape.com/arena.php?target=1&from=slayer']);
  assert.equal(record(fresh).current.target, 'Yeti');
  assert.equal(record(fresh).current.progress, 21);
  assert.equal(record(fresh).config.actions, 3);
  assert.equal(record(fresh).deadline, 600000);
});

test('invalid persisted Slayer counters cannot auto-resume or submit a task', async t => {
  const first = board(t);
  await first.start();
  const session = await leave(first);
  const saved = JSON.parse(session[KEY]);
  saved.tasksCompleted = -1;
  const f = board(t, { session: { [KEY]: JSON.stringify(saved) } });
  await f.advance(1000);
  assert.equal(f.state.requests.length, 0);
  assert.match(f.status(), /invalid/);
});

test('a Slayer run cannot resume through the Quest Board', async t => {
  const first = board(t);
  await first.start();
  const f = fixture(t, { mode: 'quest', session: await leave(first), questContent: () => questContent([]) });
  await f.advance(0);
  f.ui.getElementById('quest-resume').click();
  await f.advance(0);
  assert.equal(f.state.requests.length, 0);
  assert.match(f.status(), /own board/);
});

test('a cached Slayer board reloads fresh controls before any assignment or claim', async t => {
  const f = board(t, { board: { task: { ...task, progress: 22 } } });
  await f.start();
  f.window.dispatchEvent(new f.window.PageTransitionEvent('pagehide', { persisted: true }));
  f.window.dispatchEvent(new f.window.PageTransitionEvent('pageshow', { persisted: true }));
  assert.match(f.status(), /cached Slayer board/);
  await flush();
  f.ui.getElementById('quest-resume').click();
  await f.advance(0);
  assert.deepEqual(f.state.requests.map(r => r.action), ['claim']);
  assert.deepEqual(f.state.navigations, ['https://dankscape.com/slayer.php']);
});
