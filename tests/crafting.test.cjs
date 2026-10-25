'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { fixture, flush, lockManager } = require('./harness.cjs');
const { page } = require('./fixture.cjs');
const { craftContent } = require('./craft-fixture.cjs');
const KEY = 'dankscape-assistant:verification-checkpoint:v1';

function workshop(t, options = {}) {
  const skill = options.skill || 'cooking';
  const recipes = structuredClone(options.recipes || [{ id: '14', name: 'Cook Shark', materials: [{ name: 'Raw Shark', amount: 1, owned: 10000 }] }]);
  let heroReads = 0;
  const f = fixture(t, { mode: 'craft', skill, session: options.session, now: options.now, locks: options.locks,
    beforeScript(window) {
      window.document.querySelector('aside').remove();
      window.document.querySelector('section.content').innerHTML = craftContent(skill, recipes);
      window.fetch = async url => {
        const isHero = new URL(url).pathname === '/arena.php';
        if (isHero) heroReads += 1;
        const html = isHero ? page('mining', false, 'arena').replace('Local test hero', options.hero || 'Local test hero')
          : page().replace(/<aside[\s\S]*?<\/aside>/, '').replace(/<section class="content">[\s\S]*?<\/section>/, `<section class="content">${craftContent(skill, recipes)}</section>`);
        return { ok: true, status: 200, url, text: async () => html };
      };
      options.beforeScript?.(window);
    },
    craftSubmit(payload, state, window) {
      if (options.stuck) return;
      window.setTimeout(() => {
        const recipe = recipes.find(recipe => recipe.id === payload.recipe_id);
        assert.ok(Number(payload.times) > 0 && Number(payload.times) <= 1000);
        if (!options.unchanged) for (const item of recipe.materials) item.owned -= item.amount * Number(payload.times);
        if (options.lostSwap) return;
        window.document.querySelector('section.content').innerHTML = craftContent(skill, recipes, `fixture-token-${state.requests.length}`);
        window.document.dispatchEvent(new window.CustomEvent('dank:swapped'));
      }, options.latency || 100);
    },
  });
  return Object.assign(f, { recipes, heroReads: () => heroReads });
}

test('Craft all drains 10,000 fish through ten fresh native batches capped at 1,000', async t => {
  const f = workshop(t);
  assert.equal(f.ui.getElementById('start').textContent, 'Craft all');
  await f.start();
  await f.advance(10000);
  assert.equal(f.state.requests.length, 10);
  assert.ok(f.state.requests.every(request => request.times === '1000' && request.recipe_id === '14'));
  assert.equal(f.state.requests[1].csrf, 'fixture-token-1');
  assert.equal(f.recipes[0].materials[0].owned, 0);
  assert.equal(f.heroReads(), 1);
  assert.match(f.status(), /All craftable materials used/);
  assert.match(f.ui.getElementById('stats').textContent, /^10 confirmed crafting batches/);
});

test('batch sizes respect all ingredients and finish with a smaller last batch', async t => {
  const f = workshop(t, { skill: 'smithing', recipes: [{ id: '9', name: 'Smelt Steel', materials: [
    { name: 'Coal', amount: 2, owned: 4505 }, { name: 'Iron Ore', amount: 1, owned: 10000 },
  ] }] });
  await f.start();
  await f.advance(5000);
  assert.deepEqual(f.state.requests.map(request => Number(request.times)), [1000, 1000, 252]);
  assert.equal(f.recipes[0].materials[0].owned, 1);
  assert.match(f.status(), /All craftable materials used/);
});

test('a fresh page without changed material counts never confirms or repeats the craft', async t => {
  const f = workshop(t, { unchanged: true });
  await f.start();
  await f.advance(10000);
  assert.equal(f.state.requests.length, 1);
  assert.match(f.status(), /waiting for the game to confirm/);
});

test('Stop waits for the sent crafting batch and sends no replacement', async t => {
  const f = workshop(t, { latency: 1000 });
  await f.start();
  f.stop();
  await f.advance(5000);
  assert.equal(f.state.requests.length, 1);
  assert.equal(f.recipes[0].materials[0].owned, 9000);
});

test('crafting honors the shared action, time, and cross-tab limits', async t => {
  const f = workshop(t);
  await f.start({ actions: 2 });
  await f.advance(5000);
  assert.equal(f.state.requests.length, 2);
  assert.match(f.status(), /Action limit/);
  const expired = workshop(t);
  await expired.start({ minutes: 1, interval: 120 });
  await expired.advance(60050);
  assert.equal(expired.state.requests.length, 1);
  assert.match(expired.status(), /Time limit/);
  const locks = lockManager();
  const stuck = workshop(t, { stuck: true, locks });
  await stuck.start();
  const other = workshop(t, { locks });
  await other.start();
  assert.equal(other.state.requests.length, 0);
  assert.match(other.status(), /Another tab/);
});

test('human-check recovery keeps the exact recipe, skill, hero and crafting budget', async t => {
  const original = workshop(t);
  await original.start({ actions: 3 });
  await original.advance(150);
  original.showGuard();
  await original.advance(500);
  const record = JSON.parse(original.session()[KEY]);
  assert.equal(record.mode, 'craft');
  assert.equal(record.skill, 'cooking');
  assert.equal(record.config.target, 'recipe-14');
  assert.equal(record.completed, 1);
  record.verification.visited = true;
  original.window.close();
  await flush();
  const restored = workshop(t, { session: { [KEY]: JSON.stringify(record) }, recipes: original.recipes });
  await restored.advance(5000);
  assert.equal(restored.state.requests.length, 2);
  assert.match(restored.ui.getElementById('stats').textContent, /^3 confirmed crafting batches/);
  const changed = workshop(t, { session: { [KEY]: JSON.stringify(record) }, hero: 'Other hero' });
  await changed.advance(1000);
  assert.equal(changed.state.requests.length, 0);
  assert.match(changed.status(), /hero changed/);
});

test('lost crafting responses use fresh material counts before resuming, including the final batch', async t => {
  for (const owned of [10000, 1000]) {
    const f = workshop(t, { lostSwap: true, recipes: [{ id: '14', name: 'Cook Shark', materials: [{ name: 'Raw Shark', amount: 1, owned }] }] });
    await f.start({ actions: 2 });
    await f.advance(32000);
    const saved = JSON.parse(f.session()[KEY]);
    assert.equal(saved.completed, 1, f.status());
    assert.equal(saved.restoreRequested, true);
    f.window.close();
    await flush();
    const restored = workshop(t, { session: { [KEY]: JSON.stringify(saved) }, recipes: f.recipes, now: 32000 });
    await restored.advance(5000);
    assert.equal(restored.state.requests.length, owned === 1000 ? 0 : 1, restored.status());
    assert.match(restored.status(), owned === 1000 ? /All craftable materials/ : /Action limit/);
  }
});

test('missing material counts, locked recipes, and changed form destinations do not craft', async t => {
  for (const change of ['materials', 'locked', 'destination']) {
    const f = workshop(t, { beforeScript(window) {
      const form = window.document.querySelector('section.content form');
      if (change === 'materials') window.document.querySelector('p.muted').textContent = 'Needs: unavailable';
      if (change === 'locked') form.remove();
      if (change === 'destination') form.action = 'https://example.com/craft.php';
    } });
    await f.start();
    await f.advance(1000);
    assert.equal(f.state.requests.length, 0, change);
  }
});
