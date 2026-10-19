'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { fixture, flush, lockManager } = require('./harness.cjs');

const KEY = 'dankscape-assistant:verification-checkpoint:v1';
const shark = { id: 'shark-row', name: 'Shark', gain: 20, quantity: 20 };
const savedRun = f => JSON.parse(f.session()[KEY]);

async function pausedRun(t, options = {}, settings = {}) {
  const f = fixture(t, { guardOnRequest: 1, ...options });
  await f.start(settings);
  await f.advance(10000);
  assert.ok(savedRun(f));
  return f;
}

for (const mode of ['gather', 'arena', 'raid']) {
  test(`${mode} pauses on a rejected human-check response without submitting verification`, async t => {
    const f = await pausedRun(t, { mode });
    assert.equal(f.state.requests.length, 1);
    assert.equal(f.state.verificationClicks, 0);
    assert.deepEqual(f.state.navigations, [`https://dankscape.com/guard.php?from=${mode}`]);
    assert.equal(savedRun(f).completed, 0);
    assert.equal(savedRun(f).canResume, true);
    assert.equal(f.ui.getElementById('resume').disabled, true);
    await f.advance(120000);
    assert.equal(f.state.requests.length, 1);
    assert.match(f.status(), /Complete the game’s check yourself/);
  });
}

test('initial human-check links open once on every activity and on otherwise unsupported pages', async t => {
  for (const path of ['gather', 'arena', 'raid', 'quests', 'slayer', 'workshop']) {
    const f = fixture(t, { url: `https://dankscape.com/${path}.php`, beforeScript(window) {
      window.document.querySelector('section.content').insertAdjacentHTML('afterbegin',
        `<a href="/guard.php?from=${path}">Verify I’m human</a>`);
    } });
    await f.advance(120000);
    assert.deepEqual(f.state.navigations, [`https://dankscape.com/guard.php?from=${path}`]);
    assert.equal(f.state.requests.length, 0);
  }
});

test('external and hidden verification links never open automatically', async t => {
  for (const markup of ['<a href="https://example.com/guard.php?from=arena">Verify I’m human</a>',
    '<div hidden><a href="/guard.php?from=arena">Verify I’m human</a></div>']) {
    const f = fixture(t, { beforeScript(window) { window.document.querySelector('section.content').insertAdjacentHTML('afterbegin', markup); } });
    await f.advance(1000);
    assert.equal(f.state.navigations.length, 0);
    assert.equal(f.state.requests.length, 0);
  }
});

test('replacing the body with a human-check prompt also opens its guard link', async t => {
  const f = fixture(t);
  await f.advance(1);
  const replacement = f.document.body.cloneNode(true);
  replacement.querySelector('section.content').innerHTML = '<a href="/guard.php?from=gather">Verify I’m human</a>';
  f.document.body.replaceWith(replacement);
  await f.advance(1000);
  assert.deepEqual(f.state.navigations, ['https://dankscape.com/guard.php?from=gather']);
  assert.equal(f.state.requests.length, 0);
});

test('manual verification recovery returns Mining to Shark Waters and retains counts, food, and limits', async t => {
  const original = await pausedRun(t, { skill: 'fishing', energy: 2, foods: [shark], guardOnRequest: 3 },
    { actions: 3, meals: 4, interval: 1, minutes: 10, food: 'Shark' });
  const record = savedRun(original);
  assert.equal(record.config.target, 'shark');
  assert.equal(record.targetName, 'Shark Waters');
  assert.equal(record.completed, 1);
  assert.equal(record.eaten, 1);
  assert.ok(!JSON.stringify(record).includes('fixture-token'));
  const reset = fixture(t, { skill: 'mining', session: original.session() });
  await reset.advance(5000);
  assert.equal(reset.state.requests.length, 0);
  await reset.resume();
  assert.deepEqual(reset.state.navigations, ['https://dankscape.com/gather.php?skill=fishing']);
  assert.equal(reset.state.requests.length, 0);
  assert.equal(savedRun(reset).restoreRequested, true);
  reset.window.dispatchEvent(new reset.window.Event('pagehide'));
  assert.equal(savedRun(reset).restoreRequested, true);
  const restored = fixture(t, { skill: 'fishing', session: reset.session(), energy: 84, foods: [shark] });
  await restored.advance(5000);
  assert.equal(restored.state.requests.length, 2);
  assert.ok(restored.state.requests.every(request => request.skill === 'fishing' && request.node === 'shark'));
  assert.equal(restored.ui.getElementById('actions').value, '3');
  assert.equal(restored.ui.getElementById('food').value, 'Shark');
  assert.match(restored.ui.getElementById('stats').textContent, /^3 confirmed actions · 1 food eaten/);
  assert.match(restored.status(), /Action limit reached/);
  assert.equal(restored.session()[KEY], undefined);
});

test('the guard page never starts actions or submits the human-check form', async t => {
  const original = await pausedRun(t, { skill: 'fishing' });
  const f = fixture(t, { url: 'https://dankscape.com/guard.php?from=raid', session: original.session(), hp: 99, foods: [shark] });
  const form = f.document.createElement('form');
  form.method = 'post';
  form.action = '/guard.php?from=raid';
  const button = f.document.createElement('button');
  button.textContent = 'I’m human — Continue';
  form.appendChild(button);
  let clicks = 0;
  button.addEventListener('click', () => { clicks += 1; });
  f.document.querySelector('section.content').appendChild(form);
  await f.advance(120000);
  assert.equal(clicks, 0);
  assert.equal(f.state.requests.length, 0);
  assert.equal(f.ui.getElementById('resume').disabled, true);
  assert.equal(savedRun(f).skill, 'fishing');
});

test('a confirmed action accompanying a new check is counted before pausing', async t => {
  const f = fixture(t, { result: { showCheck: true } });
  await f.start({ actions: 5 });
  await f.advance(5000);
  assert.equal(f.state.requests.length, 1);
  assert.equal(savedRun(f).completed, 1);
  assert.equal(savedRun(f).canResume, true);
});

test('a human-check notice does not erase a positive confirmation in the same response', async t => {
  const f = fixture(t, { beforeScript(window) {
    window.document.addEventListener('dank:swapped', () => {
      window.document.getElementById('flash-stack').insertAdjacentHTML('beforeend',
        '<div class="flash flash-error">Quick check needed — confirm you are human.</div>');
    });
  } });
  await f.start({ actions: 5 });
  await f.advance(5000);
  assert.equal(f.state.requests.length, 1);
  assert.equal(savedRun(f).completed, 1);
});

test('Stop during an unknown request prevents a later check response from recreating its checkpoint', async t => {
  const f = fixture(t, { noResponse: true });
  await f.start();
  f.showGuard();
  await flush();
  f.stop();
  f.swap({ guard: true });
  await flush();
  assert.equal(f.session()[KEY], undefined);
  assert.equal(f.state.requests.length, 1);
});

test('a checkpoint removal error still cancels automatic continuation', async t => {
  const original = await pausedRun(t, { skill: 'fishing' });
  const reset = fixture(t, { session: original.session() });
  await reset.resume();
  assert.equal(savedRun(reset).restoreRequested, true);
  reset.window.Storage.prototype.removeItem = () => { throw new Error('Removal denied'); };
  reset.stop();
  assert.equal(savedRun(reset).restoreRequested, false);
  const returned = fixture(t, { skill: 'fishing', session: reset.session() });
  await returned.advance(5000);
  assert.equal(returned.state.requests.length, 0);
});

test('a hidden check does not pause ordinary gathering', async t => {
  const f = fixture(t);
  f.showGuard({ notice: false, hidden: true });
  await f.start({ actions: 2 });
  await f.advance(6000);
  assert.equal(f.state.requests.length, 2);
  assert.equal(f.session()[KEY], undefined);
});

test('an unknown pending outcome restores selection and requires inspection before a new run', async t => {
  const f = fixture(t, { skill: 'fishing', noResponse: true });
  await f.start();
  f.showGuard();
  await flush();
  assert.equal(savedRun(f).canResume, false);
  assert.equal(f.ui.getElementById('resume').disabled, true);
  const returned = fixture(t, { skill: 'fishing', session: f.session() });
  assert.equal(returned.ui.getElementById('resume').textContent, 'Restore activity');
  await returned.resume();
  await returned.advance(10000);
  assert.equal(returned.ui.getElementById('target').value, 'shark');
  assert.equal(returned.state.requests.length, 0);
  assert.match(returned.status(), /Inspect the unconfirmed request/);
  assert.equal(returned.session()[KEY], undefined);
});

test('a late confirmation updates the checkpoint without automatically restarting', async t => {
  const f = fixture(t, { noResponse: true });
  await f.start({ actions: 3 });
  f.showGuard();
  await flush();
  assert.equal(savedRun(f).canResume, false);
  f.swap();
  await flush();
  assert.equal(savedRun(f).completed, 1);
  assert.equal(savedRun(f).canResume, true);
  await f.advance(10000);
  assert.equal(f.state.requests.length, 1);
});

test('the original time limit includes time spent on manual verification', async t => {
  const f = await pausedRun(t, {}, { minutes: 1 });
  const returned = fixture(t, { session: f.session(), now: 70000 });
  await returned.resume();
  assert.equal(returned.state.requests.length, 0);
  assert.match(returned.status(), /original time limit expired/);
  assert.equal(returned.ui.getElementById('target').value, 'copper');
});

test('resuming preserves the remaining delay after a confirmed result', async t => {
  const original = fixture(t, { result: { showCheck: true } });
  await original.start({ actions: 2, interval: 30 });
  await original.advance(100);
  assert.equal(savedRun(original).nextAt, 30100);
  const f = fixture(t, { session: original.session(), now: 1000 });
  await f.resume();
  await f.advance(29000);
  assert.equal(f.state.requests.length, 0);
  await f.advance(250);
  assert.equal(f.state.requests.length, 1);
});

test('Stop discards a saved run and a subsequent load remains paused', async t => {
  const f = await pausedRun(t);
  f.stop();
  assert.equal(f.session()[KEY], undefined);
  const returned = fixture(t, { session: f.session() });
  await returned.advance(10000);
  assert.equal(returned.state.requests.length, 0);
  assert.equal(returned.ui.getElementById('recovery').hidden, true);
});

test('a resumed run retains its exhausted food budget before healing', async t => {
  const f = await pausedRun(t, { energy: 2, foods: [shark], guardOnRequest: 2 }, { meals: 1 });
  assert.equal(savedRun(f).eaten, 1);
  const returned = fixture(t, { session: f.session(), hp: 99, foods: [shark] });
  await returned.resume();
  assert.equal(returned.state.requests.length, 0);
  assert.match(returned.status(), /Food item limit reached/);
});

test('arena recovery uses fresh travel controls before engaging the original enemy', async t => {
  const original = await pausedRun(t, { mode: 'arena', zone: 'Volcanic Caverns' }, { actions: 1 });
  const f = fixture(t, { mode: 'arena', session: original.session(), hpLoss: 0 });
  await f.resume();
  await f.advance(10000);
  assert.deepEqual(f.state.requests.map(request => request.action), ['travel', 'engage', 'swing']);
  assert.equal(f.state.requests[0].zone_id, '3');
  assert.equal(f.state.arena.zone, 'Volcanic Caverns');
  assert.equal(f.state.requests[1].csrf, 'fixture-token-1');
  assert.match(f.status(), /Action limit reached/);
});

test('arena recovery cannot submit an external travel form', async t => {
  const original = await pausedRun(t, { mode: 'arena', zone: 'Volcanic Caverns' });
  const f = fixture(t, { mode: 'arena', session: original.session() });
  f.document.querySelector('input[name="zone_id"][value="3"]').form.action = 'https://example.com/arena.php';
  await f.resume();
  assert.equal(f.state.requests.length, 0);
  assert.match(f.status(), /Restore it using the game’s travel controls/);
});

test('restoring a timed-out travel request does not retry or release its pending lock', async t => {
  const original = await pausedRun(t, { mode: 'arena', zone: 'Volcanic Caverns' });
  const locks = lockManager();
  const f = fixture(t, { mode: 'arena', session: original.session(), noTravelResponse: true, locks });
  await f.resume();
  await f.advance(60000);
  assert.equal(f.state.requests.length, 1);
  assert.match(f.status(), /restoration did not finish/);
  assert.equal(savedRun(f).restoreRequested, false);
  assert.equal(f.ui.getElementById('resume').disabled, true);
  const other = fixture(t, { locks });
  await other.start();
  assert.equal(other.state.requests.length, 0);
  assert.match(other.status(), /Another tab/);
});

test('arena victories are retained across verification rather than resetting the win limit', async t => {
  const f = await pausedRun(t, { mode: 'arena', enemyHP: 1, hpLoss: 0, guardOnRequest: 3 }, { battles: 2, interval: 1 });
  assert.equal(savedRun(f).wins, 1);
  const returned = fixture(t, { mode: 'arena', session: f.session(), enemyHP: 1, hpLoss: 0 });
  await returned.resume();
  await returned.advance(10000);
  assert.deepEqual(returned.state.requests.map(request => request.action), ['engage', 'swing']);
  assert.match(returned.ui.getElementById('stats').textContent, /2 confirmed actions.*2 wins/);
  assert.match(returned.status(), /Arena win limit reached/);
});

test('raid recovery returns to the exact raid ID and stops at that boss’s defeat', async t => {
  const original = await pausedRun(t, { mode: 'raid', guardOnRequest: 2, hpLoss: 0 });
  assert.equal(savedRun(original).completed, 1);
  const list = fixture(t, { mode: 'raid', raidList: true, url: 'https://dankscape.com/raid.php', session: original.session() });
  await list.resume();
  assert.deepEqual(list.state.navigations, ['https://dankscape.com/raid.php?id=123']);
  assert.equal(list.state.requests.length, 0);
  const returned = fixture(t, { mode: 'raid', bossHP: 20, session: list.session(), hpLoss: 0 });
  await returned.advance(10000);
  assert.equal(returned.state.requests.length, 2);
  assert.ok(returned.state.requests.every(request => request.raid_id === '123'));
  assert.match(returned.ui.getElementById('stats').textContent, /^3 confirmed actions/);
  assert.match(returned.status(), /Boss defeated/);
});

test('a missing exact target never falls back to the page’s first resource', async t => {
  const original = await pausedRun(t, { skill: 'fishing' });
  const f = fixture(t, { skill: 'fishing', locked: true, session: original.session() });
  await f.resume();
  assert.equal(f.state.requests.length, 0);
  assert.match(f.status(), /exact saved target or boss is unavailable/);
});

test('a different hero cannot resume the previous hero’s run', async t => {
  const original = await pausedRun(t);
  const f = fixture(t, { session: original.session() });
  f.document.querySelector('aside h2').textContent = 'Another hero';
  await f.resume();
  assert.equal(f.state.requests.length, 0);
  assert.match(f.status(), /active hero changed/);
});

test('automatic restoration yields to another running tab without a retry loop', async t => {
  const original = await pausedRun(t, { skill: 'fishing' });
  const record = savedRun(original);
  record.restoreRequested = true;
  const locks = lockManager();
  const busy = fixture(t, { noResponse: true, locks });
  await busy.start();
  const f = fixture(t, { session: { [KEY]: JSON.stringify(record) }, locks });
  await f.advance(5000);
  assert.equal(f.state.requests.length, 0);
  assert.equal(f.state.navigations.length, 0);
  assert.equal(savedRun(f).restoreRequested, false);
  assert.match(f.status(), /Another tab/);
});

test('invalid checkpoint data disables resuming until it is discarded', async t => {
  const f = fixture(t, { session: { [KEY]: '{invalid json' } });
  await f.start();
  assert.equal(f.state.requests.length, 0);
  assert.match(f.ui.getElementById('recovery-info').textContent, /Could not read/);
  f.ui.getElementById('discard').click();
  await f.start({ actions: 1 });
  assert.equal(f.state.requests.length, 1);
});

test('checkpoint storage failures pause rather than losing the run silently', async t => {
  const f = fixture(t, { guardOnRequest: 1, beforeScript(window) {
    window.Storage.prototype.setItem = () => { throw new Error('Storage denied'); };
  } });
  await f.start();
  await f.advance(10000);
  assert.equal(f.state.requests.length, 1);
  assert.match(f.status(), /Could not save the activity.*Storage denied/);
  assert.equal(f.ui.getElementById('resume').disabled, true);
});

test('manual navigation to verification remembers an idle configured activity', async t => {
  const f = fixture(t, { skill: 'fishing', guard: true });
  f.document.querySelector('#fixture-guard a').click();
  await flush();
  assert.equal(savedRun(f).config.target, 'shark');
  assert.equal(savedRun(f).skill, 'fishing');
  assert.equal(f.state.requests.length, 0);
  assert.equal(f.state.verificationClicks, 1);
  const otherTab = fixture(t);
  assert.equal(otherTab.session()[KEY], undefined);
});
