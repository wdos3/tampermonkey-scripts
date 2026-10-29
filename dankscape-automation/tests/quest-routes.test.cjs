'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { fixture, flush } = require('./harness.cjs');
const { questContent } = require('./quest-fixture.cjs');

const KEY = 'dankscape-assistant:quest-queue:v1';
const contract = (extra = {}) => ({ id: 'mouse', name: 'Mouse Hunt', target: 'Field Mouse', group: 'Active', goal: 3, progress: 0, directFight: true, ...extra });
function board(t, quests, options = {}) {
  return fixture(t, { mode: 'quest', questContent: () => questContent(quests), ...options });
}
function queue(f) { return JSON.parse(f.session()[KEY]); }

test('direct Fight links open the exact native URL without a travel POST', async t => {
  const f = board(t, [contract()]);
  await f.start();
  assert.equal(f.state.requests.length, 0);
  assert.deepEqual(f.state.navigations, ['https://dankscape.com/arena.php?target=1']);
  assert.equal(queue(f).current.target, 'Field Mouse');
  assert.equal(queue(f).continuation, 'activity');
});

test('a direct Fight route verifies the exact enemy before learning its arena area', async t => {
  const f = board(t, [contract()]);
  await f.start();
  const session = f.session();
  f.window.close();
  const arena = fixture(t, { mode: 'arena', session, hpLoss: 0 });
  await arena.advance(500);
  assert.deepEqual(arena.state.requests.map(r => r.action), ['engage']);
  assert.equal(queue(arena).current.zone, 'Meadowbrook Fields');
});

test('an unrelated active fight cannot be attacked through a direct quest link', async t => {
  const f = board(t, [contract({ target: 'Other Foe' })]);
  await f.start();
  const session = f.session();
  f.window.close();
  const arena = fixture(t, { mode: 'arena', activeBattle: true, session });
  await arena.advance(500);
  assert.equal(arena.state.requests.length, 0);
  assert.match(arena.status(), /active enemy does not match/);
});

test('three supported active contracts never report full slots just because they use Fight links', async t => {
  const f = board(t, [contract(), contract({ name: 'Second' }), contract({ name: 'Third' })]);
  await f.start();
  await f.advance(500);
  assert.equal(f.state.navigations.length, 1);
  assert.equal(queue(f).skipped.length, 0);
  assert.doesNotMatch(f.status(), /slots are full/);
});

test('resuming a v1.4.0 queue reclassifies missing routes without resetting counters or abandoning', async t => {
  const quests = [contract({ noRoute: true }), contract({ name: 'Second', noRoute: true }), contract({ name: 'Third', noRoute: true })];
  const f = board(t, quests);
  await f.start({ quests: 1, actions: 1000, minutes: 60 });
  await f.advance(1000);
  assert.match(f.status(), /slots are full/);
  const session = f.session();
  const saved = JSON.parse(session[KEY]);
  saved.completed = 7;
  saved.wins = 1;
  saved.eaten = 2;
  session[KEY] = JSON.stringify(saved);
  f.window.close();
  const resumed = board(t, quests.map(q => ({ ...q, noRoute: false })), { session, now: 5000 });
  resumed.ui.getElementById('quest-resume').click();
  await flush();
  assert.deepEqual(resumed.state.navigations, ['https://dankscape.com/arena.php?target=1']);
  assert.equal(resumed.state.requests.length, 0);
  assert.equal(queue(resumed).completed, 7);
  assert.equal(queue(resumed).eaten, 2);
  assert.equal(queue(resumed).deadline, 3600000);
  assert.equal(queue(resumed).skipped.length, 0);
});

test('resuming after a manual board visit follows its current Fight route without skipping', async t => {
  const f = board(t, [contract({ directFight: false })]);
  await f.start({ interval: 1 });
  const firstSession = f.session();
  f.window.close();
  const arena = fixture(t, { mode: 'arena', session: firstSession, enemyHP: 3, hpLoss: 0 });
  await arena.advance(1500);
  assert.equal(arena.state.navigations.length, 0);
  arena.document.dispatchEvent(new arena.window.KeyboardEvent('keydown', { key: 'Escape' }));
  const nextSession = arena.session();
  arena.window.close();
  const next = board(t, [contract({ progress: 1 })], { session: nextSession, now: 3000 });
  next.ui.getElementById('quest-resume').click();
  await next.advance(1000);
  assert.equal(queue(next).completed, 1);
  assert.equal(queue(next).wins, 1);
  assert.equal(queue(next).skipped.length, 0);
  assert.deepEqual(next.state.navigations, ['https://dankscape.com/arena.php?target=1']);
});

test('external, malformed, non-Arena, missing-target and mismatched-label links are never followed', async t => {
  const cases = ['https://example.com/arena.php?target=1', 'http://[', '/wild.php?target=1', '/arena.php', '/arena.php?target=bad'];
  for (const fightHref of cases) {
    const f = board(t, [contract({ fightHref })]);
    await f.start();
    await f.advance(500);
    assert.equal(f.state.navigations.length, 0, fightHref);
    assert.equal(f.state.requests.length, 0, fightHref);
  }
  const mismatch = board(t, [contract()], { beforeScript(window) {
    window.document.querySelector('.quest-actions a').textContent = '⚔️ Fight Other Foe';
  } });
  await mismatch.start();
  assert.equal(mismatch.state.navigations.length, 0);
});

test('captured live full-slot cards recognize Forest Troll and Cursed Druid Fight links', async t => {
  const html = readFileSync(join(__dirname, 'fixtures', 'quest-route-variants.html'), 'utf8');
  const template = questContent([]).replace('<h2>Active</h2><div class="row"></div>', `<h2>Active</h2>${html}`);
  const f = fixture(t, { mode: 'quest', questContent: () => template });
  await f.start();
  assert.deepEqual(f.state.navigations, ['https://dankscape.com/arena.php?target=35']);
  assert.equal(queue(f).current.name, 'The Troll Road');
  assert.equal(queue(f).skipped.length, 0);
});
