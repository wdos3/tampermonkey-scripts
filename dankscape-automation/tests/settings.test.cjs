'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { fixture, flush } = require('./harness.cjs');
const { page, potionMarkup } = require('./fixture.cjs');
const { questContent } = require('./quest-fixture.cjs');

const SHARED = 'settings:shared';
const CATALOG = 'potions:catalog';
const CHECKPOINT = 'dankscape-assistant:verification-checkpoint:v1';
const inventory = [
  { id: 'attack', name: 'Super Attack Elixir', stat: 'attack', boost: 7, quantity: 5 },
  { id: 'strength', name: 'Super Strength Elixir', stat: 'strength', boost: 7, quantity: 8 },
];
const selections = inventory.map(({ name, stat }) => ({ name, stat }));
const quest = { id: 'hunt', name: 'Meadow Patrol', target: 'Field Mouse', goal: 2 };

function edit(f, id, value) {
  const control = f.ui.getElementById(id);
  if (control.type === 'checkbox') control.checked = value;
  else control.value = String(value);
  control.dispatchEvent(new f.window.Event('change', { bubbles: true }));
}

function board(t, options = {}) {
  return fixture(t, { mode: 'quest', questContent: () => questContent([quest]), ...options,
    beforeScript(window) {
      window.document.querySelector('aside').remove();
      options.beforeScript?.(window);
    } });
}

test('valid edits persist immediately across every skill, Arena, Raids, and Quests without sharing targets', t => {
  const values = {};
  const first = fixture(t, { values, mode: 'arena', potions: inventory });
  const settings = { interval: 0.1, reserve: 9, actions: 234, minutes: 78, meals: 345, battles: 67,
    quests: 12, drinks: 89, maxRaids: 4, targetLevel: 99, autoEat: false, autoHeal: false, autoRecover: false, wait: true };
  for (const [id, value] of Object.entries(settings)) edit(first, id, value);
  edit(first, 'potion-attack', inventory[0].name);
  edit(first, 'potion-strength', inventory[1].name);
  assert.equal(Object.hasOwn(values[SHARED], 'target'), false);
  assert.equal(first.state.requests.length, 0);
  const modes = [{ skill: 'mining' }, { skill: 'woodcutting' }, { skill: 'fishing' }, { skill: 'herblore' },
    { mode: 'arena' }, { mode: 'raid' }, { mode: 'quest', questContent: () => questContent([quest]) }];
  for (const options of modes) {
    const f = fixture(t, { values, ...options });
    for (const [id, value] of Object.entries(settings)) {
      const control = f.ui.getElementById(id);
      assert.equal(control.type === 'checkbox' ? control.checked : control.value, typeof value === 'boolean' ? value : String(value), `${JSON.stringify(options)} ${id}`);
    }
    assert.equal(f.ui.getElementById('potion-strength').value, inventory[1].name);
    assert.ok(f.ui.getElementById('target').value);
    if (!options.mode) assert.notEqual(f.ui.getElementById('target').value, first.ui.getElementById('target').value);
    assert.equal(f.state.requests.length, 0);
  }
});

test('explicit food and hidden combat preferences survive gathering edits when inventory controls are absent', t => {
  const values = {};
  const arena = fixture(t, { values, mode: 'arena', hp: 90, potions: inventory,
    foods: [{ id: 'food', name: 'Shark', gain: 20, quantity: 5 }] });
  edit(arena, 'food', 'Shark');
  edit(arena, 'potion-attack', inventory[0].name);
  edit(arena, 'drinks', 9);
  const gather = fixture(t, { values, skill: 'woodcutting' });
  assert.equal(gather.document.getElementById('quick-eat-select'), null);
  assert.equal(gather.document.getElementById('quick-drink-select'), null);
  edit(gather, 'actions', 321);
  const next = board(t, { values });
  assert.equal(next.ui.getElementById('food').value, 'Shark');
  assert.equal(next.ui.getElementById('potion-attack').value, inventory[0].name);
  assert.equal(next.ui.getElementById('drinks').value, '9');
  assert.equal(next.ui.getElementById('actions').value, '321');
});

test('an old current-page profile is imported once and other legacy profiles cannot reset shared choices', t => {
  const values = { 'settings:woodcutting': { interval: 1.5, actions: 222, reserve: 8, target: 'normal', potions: selections },
    'settings:mining': { interval: 9, actions: 777, target: 'copper' } };
  fixture(t, { values, skill: 'woodcutting' });
  assert.equal(values[SHARED].interval, 1.5);
  const next = fixture(t, { values, skill: 'mining' });
  assert.equal(next.ui.getElementById('interval').value, '1.5');
  assert.equal(next.ui.getElementById('actions').value, '222');
  assert.equal(next.ui.getElementById('target').value, 'copper');
  assert.deepEqual(JSON.parse(JSON.stringify(values[SHARED].potions)), selections);
});

test('invalid edits do not replace the last valid shared settings and storage errors are visible', t => {
  const f = fixture(t);
  edit(f, 'actions', 8);
  edit(f, 'interval', 0.01);
  assert.equal(f.values[SHARED].interval, 0.1);
  edit(f, 'interval', 0.15);
  assert.equal(f.values[SHARED].interval, 0.1);
  const broken = fixture(t, { storageError: true });
  edit(broken, 'actions', 9);
  assert.match(broken.status(), /Could not save settings.*storage unavailable/);
});

test('saved budgets outside supported ranges cannot restore or send an action', async t => {
  const original = fixture(t, { guardOnRequest: 1 });
  await original.start();
  await original.advance(200);
  const saved = JSON.parse(original.session()[CHECKPOINT]);
  for (const [id, value] of Object.entries({ interval: 0.01, reserve: -1, actions: 0, minutes: 1441,
    battles: 1000001, meals: 0.5, quests: 1001, drinks: 0, maxRaids: 0.5, targetLevel: 201 })) {
    const record = { ...saved, config: { ...saved.config, [id]: value }, restoreRequested: true };
    const f = fixture(t, { session: { [CHECKPOINT]: JSON.stringify(record) } });
    await f.advance(1000);
    assert.match(f.status(), /Saved activity data is invalid/, id);
    assert.equal(f.state.requests.length, 0, id);
    assert.equal(f.ui.getElementById('start').disabled, true, id);
  }
});

test('older activity checkpoints restore missing newer settings and counters without resetting the action cap', async t => {
  const original = fixture(t, { guardOnRequest: 1 });
  await original.start({ actions: 2 });
  await original.advance(200);
  const record = JSON.parse(original.session()[CHECKPOINT]);
  for (const key of ['quests', 'drinks', 'maxRaids', 'targetLevel', 'autoRecover', 'potions']) delete record.config[key];
  for (const key of ['drunk', 'recoveries', 'raidsCompleted']) delete record[key];
  original.window.close();
  await flush();
  const f = fixture(t, { session: { [CHECKPOINT]: JSON.stringify(record) } });
  assert.equal(f.ui.getElementById('drinks').value, '100');
  assert.equal(f.ui.getElementById('quests').value, '20');
  assert.equal(f.ui.getElementById('maxRaids').value, '1');
  assert.equal(f.ui.getElementById('targetLevel').value, '0');
  assert.equal(f.ui.getElementById('autoRecover').checked, true);
  await f.resume();
  await f.advance(5000);
  assert.equal(f.state.requests.length, 2);
  assert.match(f.status(), /Action limit reached/);
  assert.match(f.ui.getElementById('stats').textContent, /^2 confirmed actions/);
});

test('pending actions lock every run preference while human-check sound controls remain usable', async t => {
  for (const mode of ['gather', 'arena', 'raid']) {
    const f = fixture(t, { mode, noResponse: true });
    await f.start();
    for (const id of ['target', 'food', 'interval', 'reserve', 'actions', 'minutes', 'battles', 'meals', 'quests',
      'drinks', 'maxRaids', 'targetLevel', 'autoEat', 'autoHeal', 'autoRecover', 'wait', 'potion-attack', 'potion-strength',
      'potion-defense', 'potion-ranged', 'potion-magic']) assert.equal(f.ui.getElementById(id).disabled, true, `${mode} ${id}`);
    assert.equal(f.ui.getElementById('alertSound').disabled, false);
    assert.equal(f.ui.getElementById('testSound').disabled, false);
    assert.equal(f.state.requests.length, 1);
  }
});

test('focusing an idle page reloads shared edits without changing that page’s target', t => {
  const values = {};
  const first = fixture(t, { values, skill: 'mining' });
  const other = fixture(t, { values, skill: 'fishing' });
  edit(other, 'actions', 88);
  first.window.dispatchEvent(new first.window.Event('focus'));
  assert.equal(first.ui.getElementById('actions').value, '88');
  assert.equal(first.ui.getElementById('target').value, 'copper');
});

test('typing a valid numeric value saves before blur or navigation', t => {
  const values = {};
  const first = fixture(t, { values });
  const input = first.ui.getElementById('meals');
  input.value = '12';
  input.dispatchEvent(new first.window.Event('input', { bubbles: true }));
  const other = fixture(t, { mode: 'raid', values });
  assert.equal(other.ui.getElementById('meals').value, '12');
});

test('a running or saved run keeps its original limits without overwriting newer shared preferences on resume', async t => {
  const values = {};
  const first = fixture(t, { values, guardOnRequest: 1 });
  await first.start({ actions: 8, interval: 0.1 });
  await first.advance(200);
  const session = first.session();
  first.window.close();
  const other = fixture(t, { values, mode: 'arena' });
  edit(other, 'actions', 99);
  const restored = fixture(t, { values, session });
  assert.equal(restored.ui.getElementById('actions').value, '8');
  restored.window.dispatchEvent(new restored.window.Event('focus'));
  assert.equal(restored.ui.getElementById('actions').value, '8');
  await restored.resume();
  restored.window.dispatchEvent(new restored.window.Event('focus'));
  assert.equal(restored.ui.getElementById('actions').value, '8');
  assert.equal(values[SHARED].actions, 99);
  assert.equal(restored.state.requests.length, 1);
});

test('the 0.1-second default resumes 100 ms after a result when no native cooldown remains', async t => {
  const f = fixture(t);
  assert.equal(f.ui.getElementById('interval').min, '0.1');
  assert.equal(f.ui.getElementById('interval').step, '0.1');
  await f.start({ actions: 2 });
  await f.advance(100);
  const button = f.document.querySelector('section.content button[type="submit"]');
  button.disabled = false;
  button.dataset.cooldown = '0';
  await f.advance(99);
  assert.equal(f.state.requests.length, 1);
  await f.advance(1);
  assert.equal(f.state.requests.length, 2);
  await f.advance(200);
  assert.match(f.status(), /Action limit reached/);
});

test('fast delay respects game cooldowns and never overlaps a slow unconfirmed response', async t => {
  for (const options of [{}, { noResponse: true }]) {
    const f = fixture(t, options);
    await f.start({ actions: 3 });
    await f.advance(1000);
    assert.equal(f.state.requests.length, 1);
    await f.advance(100);
    assert.equal(f.state.requests.length, options.noResponse ? 1 : 2);
  }
});

test('Quest pages without Quick drink can select remembered multiple-stat potions', async t => {
  const values = {};
  fixture(t, { mode: 'arena', values, potions: inventory });
  assert.deepEqual(JSON.parse(JSON.stringify(values[CATALOG])), inventory.map(({ name, stat, boost }) => ({ name, stat, boost })));
  const f = board(t, { values });
  assert.equal(f.document.getElementById('quick-drink-select'), null);
  assert.equal(f.ui.getElementById('potion-settings').hidden, false);
  for (const potion of selections) edit(f, `potion-${potion.stat}`, potion.name);
  await f.start({ interval: 0.1, drinks: 6 });
  const session = f.session();
  const queue = JSON.parse(session['dankscape-assistant:quest-queue:v1']);
  assert.deepEqual(queue.config.potions, selections);
  const combat = fixture(t, { values, session, mode: 'arena', potions: inventory, noResponse: true });
  await combat.advance(500);
  assert.deepEqual(combat.state.requests.filter(r => r.action === 'drink').map(r => r.inv_id), ['attack', 'strength']);
});

test('a fresh Quest page loads choices with a read-only Combat request and never submits fetched controls', async t => {
  const reads = [];
  const f = board(t, { beforeScript(window) {
    window.fetch = async (url, init) => {
      reads.push({ url, init });
      return { ok: true, url, text: async () => page('mining', false, 'arena').replace('</aside>', `${potionMarkup(inventory)}</aside>`)
        .replace('</body>', '<script>window.remoteScriptRan = true;</script></body>') };
    };
  } });
  f.ui.getElementById('load-potions').click();
  assert.equal(f.ui.getElementById('start').disabled, true);
  await flush();
  assert.equal(reads.length, 1);
  assert.equal(reads[0].url, 'https://dankscape.com/arena.php');
  assert.equal(reads[0].init.method, 'GET');
  assert.equal(reads[0].init.redirect, 'error');
  assert.equal(f.window.remoteScriptRan, undefined);
  assert.equal(f.state.requests.length, 0);
  assert.equal(f.document.getElementById('quick-drink-select'), null);
  assert.ok(Array.from(f.ui.getElementById('potion-strength').options).some(o => o.value === inventory[1].name));
  edit(f, 'potion-strength', inventory[1].name);
  assert.equal(f.values[SHARED].potions[0].name, inventory[1].name);
  assert.match(f.ui.getElementById('potion-info').textContent, /choices loaded/);
});

test('potion discovery rejects a different hero, guard, wrong route, or unreadable inventory', async t => {
  for (const issue of ['hero', 'guard', 'route', 'inventory']) {
    const f = board(t, { beforeScript(window) {
      window.fetch = async url => ({ ok: true, url: issue === 'route' ? 'https://dankscape.com/guard.php' : url,
        text: async () => page().replace('Local test hero', issue === 'hero' ? 'Another hero' : 'Local test hero')
          .replace('</aside>', issue === 'inventory' ? '</aside>' : `${potionMarkup(inventory)}</aside>`)
          .replace('</body>', issue === 'guard' ? '<a href="/guard.php?from=arena">Verify</a></body>' : '</body>') });
    } });
    f.ui.getElementById('load-potions').click();
    await flush();
    assert.match(f.ui.getElementById('potion-info').textContent, /Could not load/, issue);
    assert.equal(f.ui.getElementById('potion-attack').options.length, 1, issue);
    assert.equal(f.state.requests.length, 0, issue);
  }
});

test('Stop cancels potion discovery and ignores a late response', async t => {
  let resolve;
  let signal;
  const f = board(t, { beforeScript(window) {
    window.fetch = (url, init) => { signal = init.signal; return new Promise(done => { resolve = () => done({ ok: true, url,
      text: async () => page().replace('</aside>', `${potionMarkup(inventory)}</aside>`) }); }); };
  } });
  f.ui.getElementById('load-potions').click();
  f.stop();
  assert.equal(signal.aborted, true);
  assert.match(f.ui.getElementById('potion-info').textContent, /cancelled/);
  resolve();
  await flush();
  assert.equal(f.ui.getElementById('potion-attack').options.length, 1);
  assert.equal(f.state.requests.length, 0);
});

test('potion discovery times out visibly and can be retried', async t => {
  const f = board(t, { beforeScript(window) {
    window.fetch = (url, { signal }) => new Promise((resolve, reject) => {
      signal.addEventListener('abort', () => reject(new Error('aborted')));
    });
  } });
  f.ui.getElementById('load-potions').click();
  await f.advance(10000);
  assert.match(f.ui.getElementById('potion-info').textContent, /timed out/);
  assert.equal(f.ui.getElementById('load-potions').disabled, false);
  assert.equal(f.state.requests.length, 0);
});
