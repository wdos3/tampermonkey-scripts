'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { fixture, flush } = require('./harness.cjs');
const { page } = require('./fixture.cjs');
const { questContent } = require('./quest-fixture.cjs');
const KEY = 'dankscape-assistant:quest-queue:v1';
const baseQuest = { id: 'supplies', name: 'Feast Supplies', kind: 'collect', target: 'Fixture resource', group: 'Active', goal: 8, progress: 0 };
function record(f) { return JSON.parse(f.session()[KEY]); }
function boardHTML(quest, progress, hero = 'Local test hero') {
  return page('fishing').replace(/<section class="content">[\s\S]*?<\/section>/,
    `<section class="content">${questContent([{ ...quest, progress }], 45, hero)}</section>`).replace('Local test hero</h2>', `${hero}</h2>`);
}
async function activity(t, options = {}) {
  const quest = { ...baseQuest, ...options.quest };
  const board = fixture(t, { mode: 'quest', questContent: () => questContent([quest]) });
  await board.start({ interval: 1, actions: 100, ...options.config });
  const session = board.session();
  board.window.close();
  await flush();
  return fixture(t, { mode: quest.kind === 'kill' ? 'arena' : 'gather', skill: 'fishing',
    session, hpLoss: 0, enemyHP: 3, ...options });
}

test('three confirmed victories finish one quest without intermediate board navigation or reads', async t => {
  let reads = 0;
  const f = await activity(t, { quest: { kind: 'kill', target: 'Field Mouse', goal: 3 },
    beforeScript(window) { window.fetch = async () => { reads += 1; throw new Error('Unexpected read'); }; } });
  await f.advance(8000);
  assert.equal(record(f).wins, 3);
  assert.equal(record(f).current.progress, 3);
  assert.equal(f.state.requests.filter(r => r.action === 'engage').length, 3);
  assert.deepEqual(f.state.navigations, ['https://dankscape.com/quests.php']);
  assert.equal(reads, 0);
});

test('the observed named combat-counter format overrides the local kill estimate', async t => {
  const f = await activity(t, { quest: { name: 'Troll Toll', kind: 'kill', target: 'Field Mouse', goal: 135, progress: 30 },
    result: { combatLog: 'You strike the Field Mouse for 3 damage.\nYou slay the Field Mouse!\n📜 Troll Toll: 32 / 135 — 103 more to go.' } });
  await f.advance(1500);
  assert.equal(record(f).current.progress, 32);
  assert.equal(record(f).wins, 1);
  assert.equal(f.state.navigations.length, 0);
});

test('another quest’s completion and stale sidebar events do not finish the selected objective', async t => {
  const f = await activity(t, { quest: { kind: 'kill', target: 'Field Mouse', goal: 3 },
    result: { combatLog: 'You strike the Field Mouse for 3 damage.\nYou slay the Field Mouse!\n📜 Other Quest: 3 / 3' },
    beforeScript(window) {
      window.document.querySelector('aside').insertAdjacentHTML('beforeend', '<div class="logfeed">📜 Feast Supplies: 3 / 3</div>');
    } });
  await f.advance(1500);
  assert.equal(record(f).current.progress, 1);
  assert.equal(f.state.navigations.length, 0);
});

test('misses and unfinished fights never add quest kills or navigate to the board', async t => {
  const f = await activity(t, { quest: { kind: 'kill', target: 'Field Mouse', goal: 1 }, miss: true });
  await f.advance(5000);
  assert.equal(record(f).wins, 0);
  assert.equal(record(f).current.progress, 0);
  assert.equal(f.state.navigations.length, 0);
  assert.ok(f.state.requests.filter(r => r.action === 'swing').length > 1);
});

test('multi-item gathering results count quantities rather than actions or periodic batches', async t => {
  let reads = 0;
  const f = await activity(t, { quest: { goal: 5, progress: 1 }, result: { flash: 'You gather 2× Fixture resource. +18 XP.' },
    beforeScript(window) { window.fetch = async () => { reads += 1; throw new Error('Unexpected read'); }; } });
  await f.advance(5000);
  assert.equal(f.state.requests.length, 2);
  assert.equal(record(f).current.progress, 5);
  assert.equal(f.state.navigations.length, 1);
  assert.equal(reads, 0);
});

test('a named gathering counter can confirm completion even when item quantity is absent', async t => {
  const f = await activity(t, { quest: { name: "Cook's (new) request", goal: 8 },
    result: { flash: "You gather resources.\n📜 Cook's (new) request: 8 / 8 — ready for turn-in." } });
  await f.advance(2000);
  assert.equal(f.state.requests.length, 1);
  assert.equal(record(f).current.progress, 8);
  assert.equal(f.state.navigations.length, 1);
});

test('unknown gathering quantities use batched background GETs and navigate only when ready', async t => {
  const reads = [];
  const f = await activity(t, { result: { flash: 'You gather resources. +18 XP.' }, beforeScript(window) {
    window.fetch = async (url, init) => {
      reads.push({ url, init });
      const count = Number(window.document.getElementById('hud-xp').textContent.match(/·\s*(\d+)/)[1]) / 18;
      return { ok: true, url, text: async () => boardHTML(baseQuest, count) };
    };
  } });
  await f.advance(15000);
  assert.equal(f.state.requests.length, 8);
  assert.equal(reads.length, 2);
  assert.ok(reads.every(read => read.url === 'https://dankscape.com/quests.php' && read.init.method === 'GET'
    && read.init.credentials === 'same-origin' && read.init.redirect === 'error' && read.init.body === undefined));
  assert.equal(record(f).current.progress, 8);
  assert.deepEqual(f.state.navigations, ['https://dankscape.com/quests.php']);
});

test('pending background reads hold further actions and Stop ignores a late result', async t => {
  let resolveRead;
  let signal;
  const f = await activity(t, { quest: { goal: 1 }, result: { flash: 'You gather resources.' },
    foods: [{ id: 'food', name: 'Shark', gain: 20, quantity: 3 }], beforeScript(window) {
    window.fetch = (url, init) => { signal = init.signal; return new Promise(resolve => { resolveRead = () => resolve({ ok: true, url,
      text: async () => boardHTML({ ...baseQuest, goal: 1 }, 1) }); }); };
  } });
  await f.advance(5000);
  assert.equal(f.state.requests.length, 1);
  assert.equal(f.state.navigations.length, 0);
  f.document.querySelector('.hp-text').textContent = '99 / 100 HP';
  f.refresh();
  await f.advance(1000);
  assert.equal(f.state.requests.length, 1, 'An unrelated HP refresh cannot overlap a POST with the background read');
  f.stop();
  assert.equal(signal.aborted, true);
  resolveRead();
  await flush();
  await f.advance(5000);
  assert.equal(f.state.requests.length, 1);
  assert.equal(f.state.navigations.length, 0);
  assert.equal(f.session()[KEY], undefined);
});

test('a completed entry without eligibility metadata ends a background check without another gather', async t => {
  const f = await activity(t, { quest: { goal: 1 }, result: { flash: 'You gather resources.' }, beforeScript(window) {
    window.fetch = async url => ({ ok: true, url, text: async () => boardHTML({ ...baseQuest, goal: 1,
      group: 'Completed', omitLevel: true, compactCompleted: true }, 1) });
  } });
  await f.advance(3000);
  assert.equal(f.state.requests.length, 1);
  assert.equal(record(f).current.progress, 1);
  assert.deepEqual(f.state.navigations, ['https://dankscape.com/quests.php']);
});

test('background checks recognize a completion marker without a recognized completion heading', async t => {
  const f = await activity(t, { quest: { goal: 1 }, result: { flash: 'You gather resources.' }, beforeScript(window) {
    window.fetch = async url => ({ ok: true, url, text: async () => boardHTML({ ...baseQuest, goal: 1,
      group: 'Chronicled', omitLevel: true }, 1).replace('<h2>Chronicled</h2>', '<h2>Quest History</h2>') });
  } });
  await f.advance(3000);
  assert.equal(f.state.requests.length, 1);
  assert.equal(record(f).current.progress, 1);
  assert.deepEqual(f.state.navigations, ['https://dankscape.com/quests.php']);
});

test('a missing quest in a complete background board returns for reconciliation without claiming completion', async t => {
  const f = await activity(t, { quest: { goal: 1 }, result: { flash: 'You gather resources.' }, beforeScript(window) {
    window.fetch = async url => ({ ok: true, url, text: async () => boardHTML({ ...baseQuest, name: 'Next supplies' }, 0) });
  } });
  await f.advance(3000);
  assert.equal(f.state.requests.length, 1);
  assert.equal(record(f).current.progress, 0);
  assert.deepEqual(record(f).finished, []);
  assert.deepEqual(f.state.navigations, ['https://dankscape.com/quests.php']);
});

test('background count checks reject changed heroes, objectives, routes, and failed reads', async t => {
  for (const issue of ['hero', 'target', 'goal', 'route', 'network']) {
    const f = await activity(t, { quest: { goal: 1 }, result: { flash: 'You gather resources.' }, beforeScript(window) {
      window.fetch = async url => {
        if (issue === 'network') throw new Error('Network unavailable');
        return { ok: true, url: issue === 'route' ? 'https://example.com/quests.php' : url,
          text: async () => boardHTML({ ...baseQuest, goal: issue === 'goal' ? 2 : 1, target: issue === 'target' ? 'Other item' : baseQuest.target },
            1, issue === 'hero' ? 'Other hero' : 'Local test hero') };
      };
    } });
    await f.advance(3000);
    assert.equal(f.state.requests.length, 1, issue);
    assert.equal(f.state.navigations.length, 0, issue);
    assert.match(f.status(), /Could not check quest progress/, issue);
  }
});

test('background human checks open the guard page without submitting verification', async t => {
  const f = await activity(t, { quest: { goal: 1 }, result: { flash: 'You gather resources.' }, beforeScript(window) {
    window.fetch = async url => ({ ok: true, url, text: async () => boardHTML({ ...baseQuest, goal: 1 }, 1)
      .replace('<section class="content">', '<section class="content"><a href="/guard.php?from=gather">Verify I’m human</a>') });
  } });
  await f.advance(3000);
  assert.equal(f.state.requests.length, 1);
  assert.deepEqual(f.state.navigations, ['https://dankscape.com/guard.php?from=gather']);
  assert.equal(f.state.verificationClicks, 0);
  assert.match(f.status(), /Human verification required/);
});

test('the last allowed unknown gather gets a background check before a ready quest is turned in', async t => {
  const f = await activity(t, { quest: { goal: 10 }, config: { actions: 1 }, result: { flash: 'You gather resources.' }, beforeScript(window) {
    window.fetch = async url => ({ ok: true, url, text: async () => boardHTML({ ...baseQuest, goal: 10 }, 10) });
  } });
  await f.advance(3000);
  assert.equal(f.state.requests.length, 1);
  assert.equal(record(f).completed, 1);
  assert.equal(f.state.navigations.length, 1);
});

test('three background checks with no credited items pause in place', async t => {
  const f = await activity(t, { result: { flash: 'You gather resources.' }, beforeScript(window) {
    window.fetch = async url => ({ ok: true, url, text: async () => boardHTML(baseQuest, 0) });
  } });
  await f.advance(25000);
  assert.equal(f.state.requests.length, 15);
  assert.equal(f.state.navigations.length, 0);
  assert.match(f.status(), /Quest progress did not advance/);
});

test('contradictory named progress pauses rather than counting a different objective', async t => {
  const f = await activity(t, { quest: { kind: 'kill', target: 'Field Mouse', goal: 3 },
    result: { combatLog: 'You strike the Field Mouse for 3 damage.\nYou slay the Field Mouse!\n📜 Feast Supplies: 1 / 4' } });
  await f.advance(5000);
  assert.equal(record(f).current.progress, 0);
  assert.equal(f.state.requests.filter(r => r.action === 'swing').length, 1);
  assert.equal(f.state.navigations.length, 0);
  assert.match(f.status(), /quest progress changed unexpectedly/);
});

test('an item name prefix cannot count a different gathered item toward the objective', async t => {
  const f = await activity(t, { result: { flash: 'You gather 1 Fixture resource fragment. +18 XP.' } });
  await f.advance(500);
  assert.equal(record(f).current.progress, 0);
  assert.equal(record(f).current.unmeasured, 1);
  assert.equal(f.state.navigations.length, 0);
});

test('a stalled background read has a bounded timeout and sends no replacement gather', async t => {
  let signal;
  const f = await activity(t, { quest: { goal: 1 }, result: { flash: 'You gather resources.' }, beforeScript(window) {
    window.fetch = (url, init) => { signal = init.signal; return new Promise((resolve, reject) => {
      init.signal.addEventListener('abort', () => reject(new Error('Read aborted')));
    }); };
  } });
  await f.advance(12000);
  assert.equal(signal.aborted, true);
  assert.equal(f.state.requests.length, 1);
  assert.equal(f.state.navigations.length, 0);
  assert.match(f.status(), /background read timed out/);
});

test('the original time limit aborts a pending background progress read', async t => {
  let signal;
  const f = await activity(t, { quest: { goal: 1 }, config: { minutes: 1 }, result: { flash: 'You gather resources.' }, now: 59000,
    beforeScript(window) { window.fetch = (url, init) => { signal = init.signal; return new Promise(() => {}); }; } });
  await f.advance(2000);
  assert.equal(signal.aborted, true);
  assert.equal(f.state.requests.length, 1);
  assert.equal(f.state.navigations.length, 0);
  assert.match(f.status(), /Time limit reached/);
});
