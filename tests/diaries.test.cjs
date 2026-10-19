'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { fixture, flush, lockManager } = require('./harness.cjs');
const { diaryContent } = require('./diary-fixture.cjs');
const { page, potionMarkup, arenaContent } = require('./fixture.cjs');
const KEY = 'dankscape-assistant:quest-queue:v1';
const record = f => JSON.parse(f.session()[KEY] || 'null');
const area = (extra = {}) => ({ name: 'Meadowbrook Fields', monsters: [
  { id: '1', name: 'Field Mouse', kills: 9 }, { id: '2', name: 'Other Foe', kills: 9 },
], tiers: { Easy: { claimed: true }, Medium: { minimumTotal: 20 } }, ...extra });

function board(t, zones = [area()], options = {}) {
  return fixture(t, { ...options, mode: 'diary', url: 'https://dankscape.com/diaries.php',
    diaryContent: () => diaryContent(zones), beforeScript(window) {
      window.document.querySelector('aside').remove();
      window.fetch = async (url, init) => {
        options.reads?.push({ url, init });
        return { ok: true, url, text: async () => page('mining', false, 'arena').replace('Local test hero', options.hero || 'Local test hero')
          .replace('</aside>', `${potionMarkup(options.potions || [])}</aside>`) };
      };
      options.beforeScript?.(window);
    } });
}

async function leave(f) { const session = f.session(); f.window.close(); await flush(); return session; }
async function begin(t, zones = [area()], settings = {}, options = {}) {
  const f = board(t, zones, options);
  await f.start({ interval: 0.1, 'diary-tier': 'Medium', ...settings });
  return f;
}
function fight(t, session, options = {}) {
  const current = JSON.parse(session[KEY]).current;
  return fixture(t, { mode: 'arena', enemyName: current.target, zone: current.zone, enemyHP: 3, hpLoss: 0, session, ...options });
}

test('Diaries expose the live areas and all six tiers, and remain idle until Start', t => {
  const f = board(t, [area(), area({ name: 'Locked area', locked: true })]);
  assert.equal(f.ui.getElementById('target-label').textContent, 'Area');
  assert.equal(f.ui.getElementById('target').options[1].disabled, true);
  assert.deepEqual(Array.from(f.ui.getElementById('diary-tier').options, option => option.value), ['Easy', 'Medium', 'Hard', 'Extreme', 'Legendary', 'Insane']);
  assert.equal(f.state.requests.length, 0);
  assert.equal(f.ui.querySelector('footer').lastElementChild.className, 'buttons');
});

test('Start reads the active hero and skips an already satisfied monster', async t => {
  const reads = [];
  const zones = [area({ monsters: [{ id: '1', name: 'Field Mouse', kills: 10 }, { id: '2', name: 'Other Foe', kills: 9 }] })];
  const f = await begin(t, zones, {}, { reads });
  assert.equal(reads.length, 1);
  assert.equal(reads[0].init.method, 'GET');
  assert.equal(record(f).source, 'diary');
  assert.equal(record(f).current.target, 'Other Foe');
  assert.equal(record(f).current.progress, 9);
  assert.equal(record(f).current.goal, 10);
  assert.deepEqual(f.state.navigations, ['https://dankscape.com/arena.php?target=2&from=diary']);
});

test('a different selected area uses its shared native form and external target submitter', async t => {
  const f = await begin(t, [area(), area({ name: 'Volcanic Caverns', away: true })], { target: 'Volcanic Caverns' });
  assert.equal(f.state.requests.length, 1);
  assert.equal(f.state.requests[0].zone_id, '2');
  assert.equal(f.state.requests[0].target, '1');
  assert.equal(f.state.requests[0].from, 'diary');
  assert.equal(record(f).current.zone, 'Volcanic Caverns');
});

test('a diary switches monsters at the requirement, heals, claims, and stops at the selected tier', async t => {
  const zones = [area()];
  const first = await begin(t, zones, { actions: 2, minutes: 10 });
  const food = [{ id: 'food', name: 'Shark', gain: 20, quantity: 5 }];
  const mouse = fight(t, await leave(first), { hpLoss: 1, damageOnKill: true, foods: food });
  await mouse.advance(3000);
  assert.equal(record(mouse).current.progress, 10);
  assert.equal(record(mouse).eaten, 1);
  assert.deepEqual(mouse.state.navigations, ['https://dankscape.com/diaries.php']);
  zones[0].monsters[0].kills = 10;
  const next = board(t, zones, { now: 3000, session: await leave(mouse) });
  await next.advance(500);
  assert.equal(record(next).current.target, 'Other Foe');
  const other = fight(t, await leave(next), { now: 4000, hpLoss: 1, damageOnKill: true, foods: food });
  await other.advance(3000);
  zones[0].monsters[1].kills = 10;
  const ready = board(t, zones, { now: 7000, session: await leave(other) });
  await ready.advance(500);
  assert.deepEqual(ready.state.requests.map(request => request.action), ['claim']);
  assert.equal(ready.state.requests[0].tier, 'Medium');
  assert.equal(record(ready).completed, 2);
  assert.equal(record(ready).eaten, 2);
  assert.equal(record(ready).deadline, 600000);
  zones[0].tiers.Medium.claimed = true;
  const done = board(t, zones, { now: 8000, session: await leave(ready) });
  await done.advance(1000);
  assert.match(done.status(), /Medium diary achieved/);
  assert.equal(done.state.requests.length, 0);
  assert.deepEqual(record(done).finished, ['Medium']);
});

test('the native Medium area-total requirement is completed after per-monster goals', async t => {
  const f = await begin(t, [area({ monsters: [{ id: '1', name: 'Field Mouse', kills: 120 }, { id: '2', name: 'Other Foe', kills: 125 }],
    tiers: { Easy: { claimed: true } } })]);
  assert.equal(record(f).current.totalOnly, true);
  assert.equal(record(f).current.goal, 125);
  assert.equal(record(f).current.progress, 120);
  const activity = fight(t, await leave(f));
  await activity.advance(10000);
  assert.equal(record(activity).wins, 5);
  assert.equal(record(activity).current.progress, 125);
  assert.deepEqual(activity.state.navigations, ['https://dankscape.com/diaries.php']);
});

test('all six tiers read their per-monster goal from the diary page', async t => {
  for (const [tier, goal] of Object.entries({ Easy: 1, Medium: 10, Hard: 50, Extreme: 250, Legendary: 500, Insane: 1000 })) {
    const f = await begin(t, [area({ tiers: {}, monsters: [{ id: '1', name: 'Field Mouse', kills: 0 }] })], { 'diary-tier': tier });
    assert.equal(record(f).current.goal, goal);
  }
});

test('an already claimed selected tier sends no travel, claim, or combat request', async t => {
  const f = await begin(t, [area({ tiers: { Medium: { claimed: true } } })]);
  assert.match(f.status(), /Medium diary achieved/);
  assert.equal(f.state.requests.length, 0);
  assert.equal(f.state.navigations.length, 0);
});

test('ready lower-tier rewards are claimed before stopping at the selected tier', async t => {
  const zones = [area({ monsters: [{ id: '1', name: 'Field Mouse', kills: 10 }, { id: '2', name: 'Other Foe', kills: 10 }],
    tiers: { Medium: { minimumTotal: 20 } } })];
  const easy = await begin(t, zones);
  assert.equal(easy.state.requests[0].tier, 'Easy');
  zones[0].tiers.Easy = { claimed: true };
  const medium = board(t, zones, { now: 1000, session: await leave(easy) });
  await medium.advance(500);
  assert.equal(medium.state.requests[0].tier, 'Medium');
  assert.deepEqual(record(medium).finished, ['Easy']);
});

test('locked areas and malformed native counts cannot start diary travel', async t => {
  const locked = await begin(t, [area({ locked: true })]);
  assert.equal(locked.state.requests.length, 0);
  assert.equal(locked.state.navigations.length, 0);
  const malformed = board(t, [area()], { beforeScript(window) {
    window.document.querySelector('h3 + p span').textContent = '×unknown';
  } });
  await malformed.start();
  assert.equal(malformed.state.requests.length, 0);
  assert.equal(malformed.state.navigations.length, 0);
});

test('an unknown diary claim cannot be automatically submitted twice', async t => {
  const zones = [area({ monsters: [{ id: '1', name: 'Field Mouse', kills: 10 }, { id: '2', name: 'Other Foe', kills: 10 }] })];
  const first = await begin(t, zones);
  assert.equal(first.state.requests.length, 1);
  const unchanged = board(t, zones, { session: await leave(first) });
  await unchanged.advance(1000);
  assert.equal(unchanged.state.requests.length, 0);
  assert.match(unchanged.status(), /claim was not confirmed/);
  assert.equal(record(unchanged).uncertain, true);
});

test('claim labels with an icon or tier description still require the same native ready-tier form', async t => {
  const zones = [area({ monsters: [{ id: '1', name: 'Field Mouse', kills: 10 }, { id: '2', name: 'Other Foe', kills: 10 }] })];
  const f = await begin(t, zones, {}, { beforeScript(window) {
    const button = Array.from(window.document.querySelectorAll('button')).find(button => button.textContent === 'Claim Medium');
    button.textContent = '🏆 Claim Medium reward';
  } });
  assert.equal(f.state.requests[0].tier, 'Medium');
  assert.equal(f.state.requests.length, 1);
});

test('an ordinary reload pauses the diary instead of restarting combat', async t => {
  const first = await begin(t);
  const active = fight(t, await leave(first), { noResponse: true });
  await active.advance(100);
  const reloaded = fight(t, active.session());
  await reloaded.advance(2000);
  assert.equal(reloaded.state.requests.length, 0);
  assert.equal(record(reloaded).uncertain, true);
});

test('human verification returns diary runs through their own board and restores the exact area', async t => {
  const active = fight(t, await leave(await begin(t)), { guardOnRequest: 1 });
  await active.advance(1000);
  const guard = fixture(t, { url: 'https://dankscape.com/guard.php?from=arena', session: await leave(active) });
  await guard.advance(500);
  assert.equal(guard.state.requests.length, 0);
  const reset = fixture(t, { mode: 'arena', zone: 'Default area', session: await leave(guard) });
  await reset.advance(1000);
  assert.deepEqual(reset.state.navigations, ['https://dankscape.com/diaries.php']);
  const restored = board(t, [area()], { session: await leave(reset) });
  await restored.advance(500);
  assert.equal(record(restored).config.diaryTier, 'Medium');
  assert.equal(record(restored).current.zone, 'Meadowbrook Fields');
});

test('diary travel carries combined potion choices, healing, and cumulative potion counts', async t => {
  const potion = { id: 'combat', name: 'Super Combat Elixir', stat: 'combat', boost: 8, quantity: 10 };
  const zones = [area()];
  const first = board(t, zones, { potions: [potion] });
  first.ui.getElementById('load-potions').click();
  await flush();
  await first.start({ actions: 2, 'diary-tier': 'Medium', potions: [{ stat: 'combat', name: potion.name }] });
  const activity = fight(t, await leave(first), { potions: [potion], hpLoss: 1, damageOnKill: true,
    foods: [{ id: 'food', name: 'Shark', gain: 20, quantity: 5 }] });
  await activity.advance(4000);
  assert.deepEqual(activity.state.requests.map(request => request.action || 'eat'), ['drink', 'engage', 'swing', 'eat']);
  assert.equal(record(activity).drunk, 1);
  assert.equal(record(activity).eaten, 1);
  zones[0].monsters[0].kills = 10;
  const next = board(t, zones, { now: 4000, session: await leave(activity) });
  await next.advance(500);
  assert.deepEqual(record(next).config.potions, [{ stat: 'combat', name: potion.name }]);
  const second = fight(t, await leave(next), { now: 5000, potions: [potion],
    boosts: ['attack', 'strength', 'defense'].map(stat => ({ stat, boost: 8, seconds: 300 })) });
  await second.advance(3000);
  assert.equal(second.state.requests.filter(request => request.action === 'drink').length, 0);
  assert.equal(record(second).drunk, 1);
  assert.equal(record(second).wins, 2);
});

test('a lost final response is counted once from a confirmed server snapshot before diary travel', async t => {
  const first = await begin(t);
  const activity = fight(t, await leave(first), { activeBattle: true, noResponse: true, beforeScript(window) {
    window.fetch = async url => ({ ok: true, url, text: async () => page('mining', false, 'arena')
      .replace(/<section class="content">[\s\S]*?<\/section>/, `<section class="content">${arenaContent({ active: false,
        name: 'Field Mouse', hp: 0, zone: 'Meadowbrook Fields', log: 'You strike the Field Mouse for 3 damage. You slay the Field Mouse!' })}</section>`) });
  } });
  await activity.advance(31000);
  assert.equal(activity.state.requests.length, 1);
  assert.equal(record(activity).completed, 1);
  assert.equal(record(activity).wins, 1);
  assert.equal(record(activity).current.progress, 10);
  assert.equal(record(activity).recoveries, 1);
  assert.deepEqual(activity.state.navigations, ['https://dankscape.com/arena.php']);
});

test('a cached diary board reloads fresh controls and current budgets before any claim', async t => {
  const f = await begin(t);
  const current = record(f);
  current.completed = 3;
  f.window.sessionStorage.setItem(KEY, JSON.stringify(current));
  f.window.dispatchEvent(new f.window.PageTransitionEvent('pageshow', { persisted: true }));
  await f.advance(0);
  assert.equal(record(f).completed, 3);
  assert.match(f.status(), /cached diary board/);
  f.ui.getElementById('quest-resume').click();
  await f.advance(500);
  assert.equal(f.state.requests.length, 0);
  assert.match(f.state.navigations.at(-1), /diaries.php$/);
});

test('changed heroes, missing monsters, and regressed diary counts stop the saved run', async t => {
  for (const issue of ['hero', 'missing', 'regressed']) {
    const zones = [area()];
    const activity = fight(t, await leave(await begin(t, zones)));
    await activity.advance(2500);
    if (issue === 'missing') zones[0].monsters.shift();
    if (issue === 'regressed') zones[0].monsters[0].kills = 8;
    const returned = board(t, zones, { now: 3000, session: await leave(activity), hero: issue === 'hero' ? 'Other hero' : 'Local test hero' });
    await returned.advance(1000);
    assert.equal(returned.state.requests.length, 0);
    assert.equal(returned.state.navigations.length, 0);
    assert.match(returned.status(), /hero.*changed|went backwards|disappeared/);
  }
});

test('external diary routes and inline-confirmation travel controls are rejected', async t => {
  for (const issue of ['link', 'form', 'confirmation']) {
    const f = await begin(t, [area({ away: issue !== 'link' })], {}, { beforeScript(window) {
      const control = window.document.querySelector('.mob-link');
      if (issue === 'link') control.href = 'https://example.com/arena.php?target=1&from=diary';
      else if (issue === 'form') control.form.action = 'https://example.com/arena.php';
      else control.form.setAttribute('onsubmit', 'return confirm("Unexpected");');
    } });
    assert.equal(f.state.requests.length, 0);
    assert.equal(f.state.navigations.length, 0);
  }
});

test('Stop cancels a pending diary hero read and another active tab blocks Start', async t => {
  let resolve;
  let signal;
  const locks = lockManager();
  const f = board(t, [area()], { locks, beforeScript(window) {
    window.fetch = (url, init) => { signal = init.signal; return new Promise(done => { resolve = () => done({ ok: true, url, text: async () => page() }); }); };
  } });
  await f.start();
  f.stop();
  assert.equal(signal.aborted, true);
  resolve();
  await f.advance(500);
  assert.equal(record(f), null);
  const other = fixture(t, { locks, noResponse: true });
  await other.start();
  const blocked = board(t, [area()], { locks });
  await blocked.start();
  assert.match(blocked.status(), /Another tab/);
  assert.equal(blocked.state.navigations.length, 0);
});
