'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { fixture, flush } = require('./harness.cjs');
const { content, page, skillProgressMarkup } = require('./fixture.cjs');
const { craftContent } = require('./craft-fixture.cjs');
const CHECKPOINT = 'dankscape-assistant:verification-checkpoint:v1';

function levelRun(t, options = {}) {
  const mode = options.mode || 'gather', skill = options.skill || (mode === 'craft' ? 'cooking' : 'mining');
  const recipes = [{ id: '14', name: 'Cook Fish', xp: 18, materials: [{ name: 'Raw Fish', amount: 1, owned: options.owned ?? 10000 }] }];
  let total = options.total || 0, f;
  const markup = () => mode === 'craft' ? craftContent(skill, recipes, 'level-test-token', total) : content(skill, 'level-test-token', false, false, total);
  const html = () => page(skill).replace(/<section class="content">[\s\S]*?<\/section>/, `<section class="content">${markup()}</section>`)
    .replace(/<div id="hud-xp">[^<]*<\/div>/, `<div id="hud-xp">${skill} ${total} XP</div>`);
  f = fixture(t, { mode, skill, energy: options.energy, hp: options.hp, noResponse: true, session: options.session, now: options.now,
    beforeScript(window) {
      const document = window.document;
      if (mode === 'craft') document.querySelector('aside').remove();
      document.querySelector('section.content').innerHTML = markup();
      if (options.summary !== undefined) document.querySelector('section.content .stat-row').innerHTML = `<span>${skill}</span><strong>${options.summary}</strong>`;
      window.fetch = async url => ({ ok: true, status: 200, url, text: async () => new URL(url).pathname === '/arena.php' ? page('mining', false, 'arena') : html() });
      document.addEventListener('submit', event => {
        if (!event.target.closest('section.content') || options.stuck) return;
        const payload = Object.fromEntries(new window.FormData(event.target, event.submitter));
        window.setTimeout(() => {
          const operations = mode === 'craft' ? Number(payload.times) : 1;
          if (mode === 'craft') recipes[0].materials[0].owned -= operations;
          total += operations * (options.gain ?? (mode === 'craft' ? 20 : 18));
          if (options.lostSwap) return;
          f.respond();
        }, options.latency || 100);
      });
    },
  });
  return Object.assign(f, { recipes, total: () => total,
    goalText: () => f.ui.getElementById('level-progress').textContent,
    respond() {
      f.document.querySelector('section.content').innerHTML = markup();
      if (mode === 'gather') {
        f.document.getElementById('hud-xp').textContent = `${skill} ${total} XP`;
        f.document.getElementById('hud-energy').textContent = `${Math.max(0, Number(f.document.getElementById('hud-energy').textContent.split('/')[0]) - 4)} / 100`;
      }
      f.document.getElementById('flash-stack').innerHTML = '<div class="flash flash-ok">You gather a resource. +18 XP.</div>';
      f.document.dispatchEvent(new f.window.CustomEvent('dank:swapped'));
    },
  });
}

function editGoal(f, value) {
  const input = f.ui.getElementById('targetLevel');
  input.value = String(value);
  input.dispatchEvent(new f.window.Event('input', { bubbles: true }));
}

test('target XP matches observed live costs and remaining in-level progress across all ten skills', t => {
  const cases = [['mining', 83, 45394, 278259], ['woodcutting', 89, 427710, 504037], ['fishing', 98, 1018773, 1228825], ['herblore', 79, 112687, 187260],
    ['fletching', 91, 81405, 614422], ['smithing', 67, 10619, 57079], ['cooking', 99, 448730, 1356729], ['jewelcrafting', 83, 110751, 278259],
    ['alchemy', 82, 72577, 252027], ['enchanting', 79, 68226, 187260]];
  for (const [skill, level, current, required] of cases) {
    const f = levelRun(t, { skill, mode: ['mining', 'woodcutting', 'fishing', 'herblore'].includes(skill) ? 'gather' : 'craft',
      summary: `Level ${level} · ${current.toLocaleString('en-US')} / ${required.toLocaleString('en-US')} XP` });
    editGoal(f, level + 1);
    assert.match(f.goalText(), new RegExp(`${(required - current).toLocaleString('en-US')} XP remaining`), skill);
    assert.equal(f.values['settings:shared'].targetLevel, level + 1);
  }
  const partial = levelRun(t, { summary: 'Level 1 · 10 / 83 XP' });
  editGoal(partial, 4);
  assert.match(partial.goalText(), /266 XP remaining/);
  const other = fixture(t, { values: partial.values });
  editGoal(other, 3);
  partial.window.dispatchEvent(new partial.window.Event('focus'));
  assert.match(partial.goalText(), /164 XP remaining/);
});

test('all gathering skills stop on the confirmed target without another action or recovery meal', async t => {
  for (const skill of ['mining', 'woodcutting', 'fishing', 'herblore']) {
    const f = levelRun(t, { skill, energy: 20 });
    await f.start({ targetLevel: 2 }); await f.advance(5000);
    assert.equal(f.state.requests.length, 5, skill);
    assert.equal(f.total(), 90);
    assert.match(f.status(), new RegExp(`Target ${skill} level 2 reached`));
    assert.equal(f.ui.getElementById('stop').disabled, true);
    assert.equal(f.ui.getElementById('targetLevel').disabled, false);
  }
});

test('crafting measures bonus XP and shrinks the finishing batch to the remaining target', async t => {
  const f = levelRun(t, { mode: 'craft' });
  await f.start({ targetLevel: 3 }); await f.advance(5000);
  assert.deepEqual(f.state.requests.map(request => Number(request.times)), [1, 8]);
  assert.equal(f.total(), 180);
  assert.equal(f.recipes[0].materials[0].owned, 9991);
  assert.match(f.status(), /Target cooking level 3 reached/);
});

test('target crafting keeps the 1000-operation cap and can finish exactly on a threshold', async t => {
  const f = levelRun(t, { mode: 'craft', gain: 1 });
  await f.start({ targetLevel: 10 }); await f.advance(5000);
  assert.deepEqual(f.state.requests.map(request => Number(request.times)), [1, 1000, 153]);
  assert.equal(f.total(), 1154);
  assert.match(f.status(), /Target cooking level 10 reached/);
});

test('already achieved targets, including level 200, send nothing even when wounded or out of materials', async t => {
  for (const mode of ['gather', 'craft']) for (const targetLevel of [1, 2, 200]) {
    const f = levelRun(t, { mode, owned: 0, hp: 90, summary: `Level ${targetLevel} · Maximum level` });
    editGoal(f, targetLevel);
    await f.start(); await f.advance(1000);
    assert.equal(f.state.requests.length, 0);
    assert.match(f.goalText(), /0 XP remaining/);
  }
});

test('missing, ambiguous, or changed-curve progress pauses only when a target is enabled', async t => {
  for (const mode of ['gather', 'craft']) for (const summary of ['Level 0 · 0 / 83 XP', 'Level 1 · 0 / 84 XP', 'Level 1 · 83 / 83 XP', 'Level 1 · unreadable']) {
    const f = levelRun(t, { mode, summary });
    await f.start({ targetLevel: 2 }); await f.advance(500);
    assert.equal(f.state.requests.length, 0);
    assert.match(f.status(), /Cannot verify/);
  }
  const duplicated = levelRun(t);
  duplicated.document.querySelector('section.content').insertAdjacentHTML('afterbegin', skillProgressMarkup('mining', 0));
  await duplicated.start({ targetLevel: 2 });
  assert.equal(duplicated.state.requests.length, 0);
  const noGoal = levelRun(t, { summary: 'Level 1 · unreadable' });
  await noGoal.start({ targetLevel: 0, actions: 1 }); await noGoal.advance(1000);
  assert.equal(noGoal.state.requests.length, 1);
  assert.match(noGoal.status(), /Action limit/);
});

test('a target-looking page update cannot confirm an unknown gathering request', async t => {
  const f = levelRun(t, { stuck: true });
  await f.start({ targetLevel: 2, autoRecover: false });
  f.document.querySelector('section.content .stat-row strong').textContent = 'Level 2 · 0 / 91 XP';
  f.document.dispatchEvent(new f.window.CustomEvent('dank:swapped'));
  await f.advance(31000);
  assert.equal(f.state.requests.length, 1);
  assert.match(f.status(), /No confirmed response/);
  assert.match(f.ui.getElementById('stats').textContent, /^0 confirmed/);
});

test('crafting with no XP gain pauses instead of repeatedly consuming materials', async t => {
  const f = levelRun(t, { mode: 'craft', gain: 0 });
  await f.start({ targetLevel: 2 }); await f.advance(5000);
  assert.equal(f.state.requests.length, 1);
  assert.match(f.status(), /skill XP did not advance/);
});

test('manual-verification continuation retains the target and calibrates again without resetting limits', async t => {
  const first = levelRun(t, { mode: 'craft' });
  await first.start({ targetLevel: 3, actions: 5, interval: 1 }); await first.advance(150);
  first.showGuard(); await first.advance(200);
  const record = JSON.parse(first.session()[CHECKPOINT]);
  record.verification.visited = true;
  assert.equal(record.config.targetLevel, 3);
  first.window.close(); await flush();
  const next = levelRun(t, { mode: 'craft', total: first.total(), owned: first.recipes[0].materials[0].owned,
    session: { [CHECKPOINT]: JSON.stringify(record) } });
  await next.advance(5000);
  assert.deepEqual(next.state.requests.map(request => Number(request.times)), [1, 7]);
  assert.match(next.status(), /Target cooking level 3 reached/);
  assert.match(next.ui.getElementById('stats').textContent, /^3 confirmed crafting batches/);
});

test('lost-response recovery confirms a reached target and restores without another action', async t => {
  for (const mode of ['gather', 'craft']) {
    const first = levelRun(t, { mode, gain: 100, lostSwap: true });
    await first.start({ targetLevel: 2 }); await first.advance(32000);
    const record = JSON.parse(first.session()[CHECKPOINT]);
    assert.equal(record.completed, 1, first.status());
    assert.equal(record.config.targetLevel, 2);
    first.window.close(); await flush();
    const next = levelRun(t, { mode, total: first.total(), session: { [CHECKPOINT]: JSON.stringify(record) }, now: 32000 });
    await next.advance(2000);
    assert.equal(next.state.requests.length, 0, next.status());
    assert.match(next.status(), /Target .* level 2 reached/);
    assert.equal(next.session()[CHECKPOINT], undefined);
  }
});

test('target levels validate, default off for older saves, and do not appear in combat', async t => {
  const f = levelRun(t);
  for (const invalid of [-1, 1.5, 201]) {
    await f.start({ targetLevel: invalid }); await f.advance(100);
    assert.equal(f.state.requests.length, 0);
  }
  const older = fixture(t, { values: { 'settings:shared': { actions: 1 } } });
  assert.equal(older.ui.getElementById('targetLevel').value, '0');
  const combat = fixture(t, { mode: 'arena', values: { 'settings:shared': { targetLevel: 99 } } });
  assert.equal(combat.ui.getElementById('level-settings').hidden, true);
  assert.equal(combat.ui.getElementById('level-progress').hidden, true);
});
