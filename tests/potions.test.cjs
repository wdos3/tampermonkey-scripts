'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { fixture, flush, lockManager } = require('./harness.cjs');
const { page, potionMarkup } = require('./fixture.cjs');
const { questContent } = require('./quest-fixture.cjs');

const inventory = [
  { id: 'super-attack', name: 'Super Attack Elixir', stat: 'attack', boost: 7, quantity: 10 },
  { id: 'super-strength', name: 'Super Strength Elixir', stat: 'strength', boost: 7, quantity: 10 },
  { id: 'defense', name: 'Defense Elixir', stat: 'defense', boost: 4, quantity: 10 },
];
const selections = inventory.slice(0, 2).map(({ name, stat }) => ({ name, stat }));
const actions = f => f.state.requests.map(request => request.action || 'eat');
const drinks = f => f.state.requests.filter(request => request.action === 'drink');
function combat(t, options = {}) {
  return fixture(t, { mode: 'arena', potions: inventory, hpLoss: 0, enemyHP: 3, ...options });
}

test('potion choices default to None and show the owned choices independently per stat', async t => {
  const f = combat(t);
  assert.equal(f.ui.getElementById('potion-attack').value, '');
  assert.equal(f.ui.getElementById('potion-strength').value, '');
  assert.match(f.ui.getElementById('potion-defense').textContent, /Defense Elixir/);
  await f.start({ interval: 1, actions: 1 });
  await f.advance(4000);
  assert.deepEqual(actions(f), ['engage', 'swing']);
});

test('multiple selected stats are drunk sequentially before combat without counting as attacks or food', async t => {
  const f = combat(t);
  await f.start({ interval: 1, actions: 1, potions: inventory.map(({ name, stat }) => ({ name, stat })) });
  await f.advance(7000);
  assert.deepEqual(actions(f), ['drink', 'drink', 'drink', 'engage', 'swing']);
  assert.deepEqual(drinks(f).map(request => request.inv_id), inventory.map(potion => potion.id));
  assert.match(f.ui.getElementById('stats').textContent, /^1 confirmed actions · 0 food eaten.*3 potions drunk/);
  assert.match(f.status(), /Action limit reached/);
  assert.equal(f.state.verificationClicks, 0);
});

test('existing boosts are kept without topping up or replacing a still-active weaker boost', async t => {
  const f = combat(t, { boosts: [{ stat: 'attack', boost: 4, seconds: 300 }, { stat: 'strength', boost: 7, seconds: 300 }] });
  await f.start({ interval: 1, actions: 2, potions: selections });
  await f.advance(8000);
  assert.equal(drinks(f).length, 0);
  assert.equal(f.state.requests.filter(request => request.action === 'swing').length, 2);
});

test('adjacent stat and timer elements need no literal whitespace between their text nodes', async t => {
  const f = combat(t, { boosts: [{ stat: 'attack', boost: 7, seconds: 290 }], beforeScript(window) {
    window.document.getElementById('boost-hud-wrap').innerHTML = '<div><span>+7 Attack</span><span class="boost-timer" data-stat="attack" data-secs="289">4:50</span></div>';
  } });
  await f.start({ interval: 1, actions: 1, potions: [selections[0]] });
  await f.advance(4000);
  assert.deepEqual(actions(f), ['engage', 'swing']);
});

test('each stat renews on its own expiry without refreshing the other active potion', async t => {
  const f = combat(t, { miss: true, potions: inventory.map(potion => ({ ...potion, duration: potion.stat === 'attack' ? 3 : 300 })) });
  await f.start({ interval: 1, actions: 20, potions: selections });
  await f.advance(11000);
  assert.ok(drinks(f).filter(request => request.inv_id === 'super-attack').length >= 3);
  assert.equal(drinks(f).filter(request => request.inv_id === 'super-strength').length, 1);
  assert.ok(f.state.requests.some(request => request.action === 'swing'));
});

test('data-secs at zero cannot renew a boost while its visible timer still says 0:01', async t => {
  const f = combat(t, { miss: true, boosts: [{ stat: 'attack', boost: 7, seconds: 1 }] });
  assert.equal(f.document.querySelector('.boost-timer').dataset.secs, '0');
  assert.equal(f.document.querySelector('.boost-timer').textContent, '0:01');
  await f.start({ interval: 1, potions: [selections[0]] });
  await f.advance(900);
  assert.equal(drinks(f).length, 0);
  await f.advance(600);
  assert.equal(drinks(f).length, 1);
});

test('HP healing takes priority before initial potions and after the final allowed attack', async t => {
  const f = combat(t, { hp: 99, hpLoss: 1, damageOnKill: true, foods: [{ id: 'food', name: 'Shark', gain: 20, quantity: 5 }] });
  await f.start({ interval: 1, actions: 1, potions: selections });
  await f.advance(8000);
  assert.deepEqual(actions(f), ['eat', 'drink', 'drink', 'engage', 'swing', 'eat']);
  assert.match(f.ui.getElementById('stats').textContent, /1 confirmed actions · 2 food eaten.*2 potions drunk/);
});

test('raid combat maintains multiple buffs and honors the attack and potion budgets', async t => {
  const f = combat(t, { mode: 'raid', hpLoss: 0, bossHP: 30 });
  await f.start({ interval: 1, actions: 2, drinks: 2, potions: selections });
  await f.advance(7000);
  assert.deepEqual(actions(f), ['drink', 'drink', 'attack', 'attack']);
  assert.match(f.status(), /Action limit reached/);
});

test('ordinary gathering never drinks combat potions', async t => {
  const f = fixture(t, { potions: inventory, saved: { potions: selections } });
  await f.start({ interval: 1, actions: 2 });
  await f.advance(5000);
  assert.deepEqual(actions(f), ['gather', 'gather']);
});

test('the potion cap stops on the next required renewal rather than interrupting an active buff', async t => {
  const f = combat(t, { miss: true, potions: inventory.map(potion => ({ ...potion, duration: 4 })) });
  await f.start({ interval: 1, actions: 30, drinks: 2, potions: selections });
  await f.advance(10000);
  assert.equal(drinks(f).length, 2);
  assert.ok(actions(f).includes('swing'));
  assert.match(f.status(), /Potion item limit reached/);
});

test('an empty selected stack allows its active buff to finish then stops without a substitute', async t => {
  const f = combat(t, { miss: true, potions: [{ id: 'regular', name: 'Attack Elixir', stat: 'attack', boost: 4, quantity: 20 }],
    boosts: [{ stat: 'attack', boost: 7, seconds: 4 }], saved: { potions: [selections[0]] } });
  await f.start({ interval: 1, actions: 20 });
  await f.advance(8000);
  assert.ok(actions(f).includes('swing'));
  assert.equal(drinks(f).length, 0);
  assert.match(f.status(), /Super Attack Elixir.*unavailable/);
});

test('unreadable timers or a missing boost panel pause before any potion or attack', async t => {
  for (const issue of ['panel', 'timer', 'stat']) {
    const f = combat(t, { boosts: [{ stat: 'attack', boost: 7, seconds: 30 }], beforeScript(window) {
      if (issue === 'panel') window.document.getElementById('boost-hud-wrap').remove();
      if (issue === 'timer') window.document.querySelector('.boost-timer').textContent = 'unknown';
      if (issue === 'stat') window.document.querySelector('#boost-hud-wrap div span').textContent = 'Unrecognized effect';
    } });
    await f.start({ potions: selections });
    assert.equal(f.state.requests.length, 0, issue);
    assert.match(f.status(), /Cannot read active potion boosts/, issue);
  }
});

test('native Quick drink form validation rejects external destinations and confirmation controls', async t => {
  for (const issue of ['origin', 'confirm', 'csrf']) {
    const f = combat(t, { beforeScript(window) {
      const form = window.document.querySelector('.quick-drink');
      if (issue === 'origin') form.action = 'https://example.com/drink.php';
      if (issue === 'confirm') form.setAttribute('data-confirm', 'Different action');
      if (issue === 'csrf') form.querySelector('[name="csrf"]').remove();
    } });
    await f.start({ potions: selections });
    assert.equal(f.state.requests.length, 0, issue);
    assert.match(f.status(), /potion form changed/, issue);
  }
});

test('a named drink message without the corresponding boost cannot confirm or resend the potion', async t => {
  const f = combat(t, { noPotionBoost: true });
  await f.start({ potions: selections, autoRecover: false });
  await f.advance(31000);
  assert.deepEqual(actions(f), ['drink']);
  assert.match(f.status(), /No confirmed response/);
  assert.match(f.ui.getElementById('stats').textContent, /0 potions drunk/);
});

test('a wrong or prefix potion name cannot confirm a fresh boost', async t => {
  for (const name of ['Super Strength Elixir', 'Super Attack Elixir fragment']) {
    const f = combat(t, { drinkResult: { flash: `You drink the ${name}. +7 Attack — active for 5 more minutes.` } });
    await f.start({ potions: selections, autoRecover: false });
    await f.advance(31000);
    assert.deepEqual(actions(f), ['drink'], name);
    assert.match(f.status(), /No confirmed response/, name);
  }
});

test('Stop during a pending drink permits only that response and retains the shared lock until it finishes', async t => {
  const locks = lockManager();
  const f = combat(t, { locks, drinkLatency: 2000 });
  await f.start({ potions: selections });
  f.stop();
  const other = combat(t, { locks });
  await other.start();
  assert.equal(other.state.requests.length, 0);
  assert.match(other.status(), /Another tab/);
  await f.advance(5000);
  assert.deepEqual(actions(f), ['drink']);
  assert.match(f.ui.getElementById('stats').textContent, /1 potions drunk/);
  await other.start({ actions: 1 });
  assert.equal(other.state.requests.length, 1);
});

test('an unrelated refresh during a drink cannot overlap another potion or attack', async t => {
  const f = combat(t, { drinkLatency: 3000 });
  await f.start({ interval: 1, potions: selections });
  f.refresh();
  await f.advance(2000);
  assert.deepEqual(actions(f), ['drink']);
  await f.advance(3000);
  assert.deepEqual(drinks(f).map(request => request.inv_id), ['super-attack', 'super-strength']);
});

test('confirmed potion recovery preserves its count and resumes with only the still-missing stat', async t => {
  const html = page('mining', false, 'arena').replace('</aside>', `${potionMarkup(inventory,
    [{ stat: 'attack', boost: 7, seconds: 299 }])}</aside>`).replace('<div id="flash-stack"></div>',
    '<div id="flash-stack"><div class="flash flash-ok">You drink the Super Attack Elixir. +7 Attack — active for 5 more minutes.</div></div>');
  const f = combat(t, { noDrinkResponse: true, beforeScript(window) {
    window.fetch = async url => ({ ok: true, url, text: async () => html });
  } });
  await f.start({ interval: 1, potions: selections });
  await f.advance(30000);
  const session = f.session();
  const checkpoint = JSON.parse(session['dankscape-assistant:verification-checkpoint:v1']);
  assert.equal(checkpoint.drunk, 1);
  assert.equal(checkpoint.completed, 0);
  assert.equal(checkpoint.eaten, 0);
  f.window.close();
  await flush();
  const resumed = combat(t, { session, now: 31000, boosts: [{ stat: 'attack', boost: 7, seconds: 299 }] });
  await resumed.advance(2500);
  assert.equal(drinks(resumed)[0].inv_id, 'super-strength');
  assert.match(resumed.ui.getElementById('stats').textContent, /2 potions drunk/);
});

test('quest travel preserves potion selections and counts while drinks never advance quest progress', async t => {
  const quest = { id: 'mice', name: 'Mouse Hunt', target: 'Field Mouse', goal: 2, progress: 0, group: 'Active' };
  const board = fixture(t, { mode: 'quest', potions: inventory, questContent: () => questContent([quest]) });
  await board.start({ interval: 1, potions: selections, drinks: 2 });
  const session = board.session();
  board.window.close();
  await flush();
  const f = combat(t, { session, noResponse: true });
  await f.advance(3500);
  const queue = JSON.parse(f.session()['dankscape-assistant:quest-queue:v1']);
  assert.equal(queue.drunk, 2);
  assert.equal(queue.completed, 0);
  assert.equal(queue.current.progress, 0);
  assert.equal(queue.config.drinks, 2);
  assert.deepEqual(queue.config.potions, selections);
});

test('invalid or duplicate saved potion stats and invalid counts cannot resume a checkpoint', async t => {
  const f = combat(t, { guardOnRequest: 2 });
  await f.start({ interval: 1, potions: selections });
  await f.advance(2500);
  const session = f.session();
  const key = 'dankscape-assistant:verification-checkpoint:v1';
  assert.equal(JSON.parse(session[key]).drunk, 1);
  for (const issue of ['duplicate', 'stat', 'count']) {
    const saved = JSON.parse(session[key]);
    if (issue === 'duplicate') saved.config.potions = [selections[0], selections[0]];
    if (issue === 'stat') saved.config.potions = [{ name: 'Anything', stat: 'unknown' }];
    if (issue === 'count') saved.drunk = -1;
    const next = combat(t, { session: { [key]: JSON.stringify(saved) } });
    assert.match(next.status(), /invalid/, issue);
    assert.equal(next.state.requests.length, 0, issue);
  }
});
