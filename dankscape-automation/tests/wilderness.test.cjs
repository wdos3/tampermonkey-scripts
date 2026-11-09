'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { fixture, flush } = require('./harness.cjs');
const { wildernessContent } = require('./fixture.cjs');
const KEY = 'dankscape-assistant:verification-checkpoint:v1';
const bosses = [
  { name: 'Revenant Knight', key: 'knight', required: 5, maximum: 30 },
  { name: 'Chaos Fiend', key: 'fiend', required: 9, maximum: 40 },
  { name: 'Voidborn Tyrant', key: 'tyrant', required: 13, maximum: 50 },
];

function wilderness(t, options = {}) {
  let f;
  const initial = { depth: options.depth ?? 0, bosses: bosses.map(boss => ({ ...boss, slain: options.slain?.includes(boss.key) || false })),
    battle: options.battle ? { ...bosses[0], hp: 20, ...options.battle } : null };
  f = fixture(t, { ...options, mode: 'wild', url: options.url || 'https://dankscape.com/wild.php',
    wildContent(state, token) { state.wilderness ??= structuredClone(initial); return wildernessContent(state.wilderness, token); },
    wildSubmit(payload, state, window, startedAt) {
      if (options.noWildResponse) return;
      window.setTimeout(() => {
        const s = state.wilderness;
        if (options.guardOnWild) { f.showGuard(); return; }
        if (payload.action === 'enter') s.depth = 1;
        else if (payload.action === 'deeper') s.depth += 1;
        else if (payload.action === 'leave') s.depth = 0;
        else if (payload.action === 'hunt' || payload.action === 'boss-attack') {
          if (payload.action === 'hunt') { const boss = s.bosses.find(boss => boss.key === payload.boss); s.battle = { ...boss, hp: boss.maximum }; }
          const battle = s.battle;
          battle.hp = Math.max(0, battle.hp - (options.damage ?? 10));
          const hp = window.document.querySelector('.hp-text');
          hp.textContent = `${Math.max(0, Number(hp.textContent.split('/')[0]) - (options.wildHPLoss ?? 0))} / 100 HP`;
          if (!battle.hp) { s.bosses.find(boss => boss.key === battle.key).slain = true; s.battle = null; }
        } else throw new Error(`Unexpected wilderness action: ${payload.action}`);
        if (options.lostResponse) return;
        if (!options.noTransport) f.resource({ name: 'https://dankscape.com/wild.php', initiatorType: 'fetch', startTime: startedAt,
          responseStart: startedAt + 1, responseEnd: startedAt + 2, decodedBodySize: 1, responseStatus: 200 });
        f.refresh();
        const name = s.battle?.name || s.bosses.find(boss => boss.key === payload.boss)?.name;
        window.document.getElementById('flash-stack').innerHTML = ['hunt', 'boss-attack'].includes(payload.action)
          ? `<div class="flash flash-ok">${s.battle ? `You hit the ${name} for ${options.damage ?? 10}. It strikes back for 0. (Boss: ${s.battle.hp} / ${s.battle.maximum})` : `You fell the ${name}! +1g`}</div>` : '';
        window.document.dispatchEvent(new window.CustomEvent('dank:swapped'));
      }, options.wildLatency ?? 100);
    },
  });
  return f;
}

test('a wilderness run hunts all three once, reaches 15, leaves, and returns to arena without PvP', async t => {
  const f = wilderness(t);
  await f.start({ actions: 100, interval: 0.1 });
  await f.advance(15000);
  assert.deepEqual(f.state.requests.filter(p => p.action === 'hunt').map(p => p.boss), ['knight', 'fiend', 'tyrant']);
  assert.equal(f.state.requests.filter(p => p.action === 'deeper').length, 14);
  assert.equal(f.state.requests.filter(p => p.action === 'leave').length, 1);
  assert.equal(f.state.requests.some(p => p.action === 'pvp'), false);
  assert.equal(f.state.wilderness.depth, 0);
  assert.deepEqual(f.state.navigations, ['https://dankscape.com/arena.php']);
  assert.match(f.status(), /Wilderness complete/);
  assert.match(f.ui.getElementById('stats').textContent, /^12 confirmed actions/);
});

test('native daily markers skip finished bosses on later runs and even a one-hit hunt completes once', async t => {
  const f = wilderness(t, { depth: 9, slain: ['knight', 'fiend'], damage: 500 });
  await f.start(); await f.advance(5000);
  assert.deepEqual(f.state.requests.filter(p => p.action === 'hunt').map(p => p.boss), ['tyrant']);
  assert.equal(f.state.requests.some(p => p.action === 'boss-attack'), false);
  assert.equal(f.state.requests.filter(p => p.action === 'deeper').length, 6);
  assert.match(f.status(), /Wilderness complete/);
});

test('depth 15 with all daily bosses finished leaves without spending food or unused potions', async t => {
  const f = wilderness(t, { depth: 15, slain: ['knight', 'fiend', 'tyrant'],
    saved: { potions: [{ stat: 'attack', name: 'Unavailable potion' }] } });
  await f.start(); await f.advance(1000);
  assert.deepEqual(f.state.requests.map(p => p.action), ['leave']);
  assert.deepEqual(f.state.navigations, ['https://dankscape.com/arena.php']);
});

test('Start adopts an already active boss and heals immediately after hunt and every damaging turn', async t => {
  const f = wilderness(t, { depth: 5, battle: true, wildHPLoss: 1,
    foods: [{ id: 'food', name: 'Shark', gain: 20, quantity: 20 }] });
  await f.start({ actions: 2 }); await f.advance(2000);
  assert.deepEqual(f.state.requests.map(p => p.action || 'eat'), ['boss-attack', 'eat', 'boss-attack', 'eat']);
  assert.equal(f.state.requests.some(p => p.action === 'hunt'), false);
  assert.match(f.status(), /Action limit/);
  assert.equal(f.document.querySelector('.hp-text').textContent, '100 / 100 HP');
});

test('wilderness uses the shared potion selection and budget before a hunt without drinking for travel', async t => {
  const f = wilderness(t, { depth: 4, potions: [{ id: 'combat', name: 'Super Combat Elixir', stat: 'combat', boost: 8, quantity: 2 }] });
  await f.start({ actions: 1, potions: [{ stat: 'combat', name: 'Super Combat Elixir' }] });
  await f.advance(2000);
  assert.deepEqual(f.state.requests.map(p => p.action || 'eat'), ['deeper', 'drink', 'hunt']);
  assert.equal(f.ui.getElementById('potion-settings').hidden, false);
  assert.match(f.ui.getElementById('stats').textContent, /1 potions drunk/);
});

test('misses and repeated zero-damage turns continue only after their native response completes', async t => {
  const f = wilderness(t, { depth: 5, battle: true, damage: 0 });
  await f.start({ actions: 3 }); await f.advance(2000);
  assert.equal(f.state.requests.length, 3);
  assert.match(f.status(), /Action limit/);
  const unknown = wilderness(t, { depth: 5, battle: true, damage: 0, noTransport: true });
  await unknown.start({ actions: 3 }); await unknown.advance(2000);
  assert.equal(unknown.state.requests.length, 2);
  assert.match(unknown.status(), /Still waiting/);
});

test('unrelated refreshes never repeat a pending hunt, attack, or depth change', async t => {
  for (const setup of [{ depth: 4 }, { depth: 5 }, { depth: 5, battle: true }]) {
    const f = wilderness(t, { ...setup, noWildResponse: true });
    await f.start({ autoRecover: false }); f.refresh(); await f.advance(31000);
    assert.equal(f.state.requests.length, 1);
    assert.match(f.status(), /No confirmed response/);
  }
});

test('a lost solo-boss response is confirmed by the same boss HP and saved without another attack', async t => {
  const f = wilderness(t, { depth: 5, battle: true, lostResponse: true });
  await f.start({ actions: 2 }); await f.advance(200);
  f.window.fetch = async () => ({ ok: true, url: 'https://dankscape.com/wild.php', text: async () =>
    f.document.documentElement.outerHTML.replace(/<section class="content">[\s\S]*?<\/section>/, `<section class="content">${wildernessContent(f.state.wilderness)}</section>`) });
  await f.advance(31000);
  assert.equal(f.state.requests.length, 1);
  const saved = JSON.parse(f.session()[KEY]);
  assert.equal(saved.canResume, true); assert.equal(saved.completed, 1);
  assert.equal(saved.wilderness.boss.name, 'Revenant Knight');
  assert.deepEqual(f.state.navigations, ['https://dankscape.com/wild.php']);
});

test('lost final blows retain the completed boss and continue from the fresh daily board', async t => {
  const f = wilderness(t, { depth: 15, battle: { hp: 10 }, slain: ['fiend', 'tyrant'], lostResponse: true });
  await f.start(); await f.advance(200);
  f.window.fetch = async () => ({ ok: true, url: 'https://dankscape.com/wild.php', text: async () =>
    f.document.documentElement.outerHTML.replace(/<section class="content">[\s\S]*?<\/section>/, `<section class="content">${wildernessContent(f.state.wilderness)}</section>`) });
  await f.advance(31000);
  const saved = JSON.parse(f.session()[KEY]);
  assert.equal(saved.wilderness.boss, null); assert.ok(saved.wilderness.defeated.includes('Revenant Knight'));
  saved.restoreRequested = true;
  const next = wilderness(t, { depth: 15, slain: ['knight', 'fiend', 'tyrant'], now: 32000, session: { [KEY]: JSON.stringify(saved) } });
  await next.advance(1000);
  assert.deepEqual(next.state.requests.map(p => p.action), ['leave']);
  assert.match(next.status(), /Wilderness complete/);
});

test('confirmed lost travel resumes at the new depth without sending the previous move again', async t => {
  const f = wilderness(t, { depth: 4, lostResponse: true });
  await f.start(); await f.advance(200);
  f.window.fetch = async () => ({ ok: true, url: 'https://dankscape.com/wild.php', text: async () =>
    f.document.documentElement.outerHTML.replace(/<section class="content">[\s\S]*?<\/section>/, `<section class="content">${wildernessContent(f.state.wilderness)}</section>`) });
  await f.advance(31000);
  const saved = JSON.parse(f.session()[KEY]);
  assert.equal(saved.wilderness.depth, 5); assert.equal(saved.completed, 0);
  f.window.close(); await flush();
  const next = wilderness(t, { depth: 5, now: 32000, session: { [KEY]: JSON.stringify(saved) } });
  await next.advance(100);
  assert.equal(next.state.requests[0].action, 'hunt');
});

test('verification saves depth, encounter, shared settings and cumulative progress for resume', async t => {
  const f = wilderness(t, { depth: 9, slain: ['knight'], noWildResponse: true });
  await f.start({ reserve: 12, interval: 0.2, actions: 80 });
  // A rejected native action is distinguishable from an unknown POST.
  f.refresh(); f.showGuard(); await f.advance(200);
  const saved = JSON.parse(f.session()[KEY]);
  assert.equal(saved.wilderness.depth, 9); assert.equal(saved.config.reserve, 12);
  assert.equal(saved.config.interval, 0.2); assert.equal(saved.deadline, 1800000);
  assert.equal(saved.canResume, true);
  f.window.close(); await flush();
  saved.verification = false;
  const next = wilderness(t, { depth: 9, slain: ['knight'], session: { [KEY]: JSON.stringify(saved) }, now: 2000 });
  await next.resume(); await next.advance(1000);
  assert.equal(next.state.requests[0].action, 'hunt'); assert.equal(next.state.requests[0].boss, 'fiend');
});

test('changed depth, hero, or interrupted boss cannot authorize another hunt when restoring', async t => {
  const f = wilderness(t, { depth: 5, battle: true });
  await f.start(); f.showGuard({ notice: false }); await f.advance(200);
  const saved = JSON.parse(f.session()[KEY]);
  saved.canResume = true; saved.verification = false;
  f.window.close(); await flush();
  for (const options of [{ depth: 1 }, { depth: 5 }, { depth: 5, battle: true, beforeScript(w) { w.document.querySelector('aside h2').textContent = 'Other hero'; } }]) {
    const next = wilderness(t, { ...options, session: { [KEY]: JSON.stringify(saved) }, now: 2000 });
    await next.resume(); await next.advance(500);
    assert.equal(next.state.requests.length, 0);
    assert.match(next.status(), /no longer matches|hero changed/);
    next.window.close(); await flush();
  }
});

test('Stop, deadline, and death stop travel and combat; a late response never restarts the run', async t => {
  const stopped = wilderness(t, { wildLatency: 1000 });
  await stopped.start(); stopped.stop(); await stopped.advance(2000);
  assert.equal(stopped.state.requests.length, 1); assert.equal(stopped.state.navigations.length, 0);
  const timed = wilderness(t, { depth: 5, battle: true, damage: 0, wildLatency: 1000 });
  await timed.start({ minutes: 1, actions: 1000 }); await timed.advance(61000);
  assert.match(timed.status(), /Time limit|Stopped/);
  const requestsAtDeadline = timed.state.requests.length;
  await timed.advance(2000); assert.equal(timed.state.requests.length, requestsAtDeadline);
  const dead = wilderness(t, { hp: 0 }); await dead.start(); await dead.advance(1000);
  assert.equal(dead.state.requests.length, 0); assert.match(dead.status(), /defeated/);
});

test('changed controls, missing metadata, and a PvP form cannot send a wilderness action', async t => {
  for (const mutate of [
    doc => doc.querySelector('section.content form').action = 'https://example.com/wild.php',
    doc => doc.querySelector('section.content form').setAttribute('data-confirm', 'Proceed?'),
    doc => doc.querySelector('section.content form button').setAttribute('formaction', 'https://example.com/wild.php'),
    doc => doc.querySelector('section.content p').textContent = 'Wilderness depth unknown',
    doc => doc.querySelector('section.content h2').textContent = 'Wilderness bosses',
  ]) {
    const f = wilderness(t, { depth: 4, beforeScript(w) { mutate(w.document); } });
    await f.start(); await f.advance(1000);
    assert.equal(f.state.requests.length, 0);
  }
});
