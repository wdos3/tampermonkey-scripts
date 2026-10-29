'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { fixture, flush } = require('./harness.cjs');
const { questContent } = require('./quest-fixture.cjs');

const KEY = 'dankscape-assistant:quest-queue:v1';
const druid = { id: 'druid', name: "Druid's Bane", target: 'Cursed Druid', group: 'Active', goal: 40, progress: 39 };
const next = { id: 'imps', name: 'Imps of Cinder', target: 'Lava Imp', group: 'Active', goal: 150, progress: 1 };
const record = f => JSON.parse(f.session()[KEY]);

async function returningQueue(t, config = {}) {
  const f = fixture(t, { mode: 'quest', questContent: () => questContent([druid]) });
  await f.start({ interval: 1, actions: 100, ...config });
  const saved = record(f);
  Object.assign(saved, { phase: 'board', continuation: 'board', completed: 7, wins: 3, eaten: 2, recoveries: 1 });
  saved.current.progress = 40;
  f.window.close();
  await flush();
  return { [KEY]: JSON.stringify(saved) };
}

function board(t, session, quests, options = {}) {
  return fixture(t, { mode: 'quest', session, questContent: () => questContent(quests), ...options });
}

test('completed entries with target and goal need no eligibility badge to advance to the next active quest', async t => {
  for (const group of ['Chronicled', 'Completed']) {
    const f = board(t, await returningQueue(t), [{ ...druid, group, omitLevel: true }, next]);
    await f.advance(500);
    assert.deepEqual(record(f).finished, [druid.name], group);
    assert.equal(record(f).current.name, next.name, group);
    assert.deepEqual(f.state.requests.map(r => r.action), ['travel'], group);
    for (const [key, value] of Object.entries({ completed: 7, wins: 3, eaten: 2, recoveries: 1, deadline: 1800000 })) {
      assert.equal(record(f)[key], value, key);
    }
  }
});

test('compact completed entries and styled titles also confirm completion', async t => {
  const f = board(t, await returningQueue(t), [{ ...druid, group: 'Chronicled', omitLevel: true, compactCompleted: true }, next], {
    beforeScript(window) {
      const title = Array.from(window.document.querySelectorAll('h3')).find(node => node.textContent.includes(druid.name));
      title.innerHTML = `<strong>${druid.name}</strong>`;
    },
  });
  await f.advance(500);
  assert.deepEqual(record(f).finished, [druid.name]);
  assert.equal(record(f).current.name, next.name);
});

test('the reported completion marker identifies the exact quest under an unfamiliar section heading', async t => {
  const f = board(t, await returningQueue(t), [{ ...druid, group: 'Chronicled', omitLevel: true }, next], {
    beforeScript(window) {
      Array.from(window.document.querySelectorAll('h2')).find(node => node.textContent === 'Chronicled').textContent = 'Quest History';
      const card = Array.from(window.document.querySelectorAll('section.content .card')).find(node => node.querySelector('h3')?.textContent.includes(druid.name));
      card.insertAdjacentHTML('beforeend', '<div class="stat-row"><span>Reward</span><strong>+6,480g · +1,260 hp XP · +8 fame</strong></div>');
    },
  });
  await f.advance(500);
  assert.deepEqual(record(f).finished, [druid.name]);
  assert.equal(record(f).current.name, next.name);
  assert.deepEqual(f.state.requests.map(r => r.action), ['travel']);
});

test('a completion marker does not require a section heading or eligibility badge', async t => {
  const f = board(t, await returningQueue(t), [{ ...druid, group: 'Chronicled', omitLevel: true }, next], {
    beforeScript(window) {
      Array.from(window.document.querySelectorAll('h2')).find(node => node.textContent === 'Chronicled').remove();
    },
  });
  await f.advance(500);
  assert.deepEqual(record(f).finished, [druid.name]);
  assert.equal(record(f).current.name, next.name);
});

test('completion status can be a paragraph, div, or span, including a styled checkmark', async t => {
  for (const tag of ['p', 'div', 'span']) {
    const f = board(t, await returningQueue(t), [{ ...druid, group: 'Chronicled', omitLevel: true }, next], {
      beforeScript(window) {
        Array.from(window.document.querySelectorAll('h2')).find(node => node.textContent === 'Chronicled').textContent = 'Quest History';
        const status = Array.from(window.document.querySelectorAll('section.content p')).find(node => node.textContent === '✓ Completed.');
        const replacement = window.document.createElement(tag);
        replacement.innerHTML = '<span>✓</span> Completed.';
        status.replaceWith(replacement);
      },
    });
    await f.advance(500);
    assert.deepEqual(record(f).finished, [druid.name], tag);
    assert.equal(record(f).current.name, next.name, tag);
  }
});

test('a different quest marker, completion prose, interactive control, or sidebar marker cannot confirm the selected quest', async t => {
  for (const issue of ['other quest', 'prose', 'button', 'sidebar']) {
    const f = board(t, await returningQueue(t), [{ ...druid, group: 'Chronicled', omitLevel: true }, next], {
      beforeScript(window) {
        Array.from(window.document.querySelectorAll('h2')).find(node => node.textContent === 'Chronicled').textContent = 'Quest History';
        const card = Array.from(window.document.querySelectorAll('section.content .card')).find(node => node.querySelector('h3')?.textContent.includes(druid.name));
        if (issue === 'other quest') card.querySelector('h3').textContent = 'Another quest';
        if (issue === 'prose') card.querySelector('p:last-child').textContent = '✓ Completed. Return when the objective is completed.';
        if (issue === 'button') card.querySelector('p:last-child').innerHTML = '<button>✓ Completed.</button>';
        if (issue === 'sidebar') window.document.querySelector('aside').appendChild(card);
      },
    });
    await f.advance(500);
    assert.deepEqual(record(f).finished, [], issue);
    assert.equal(record(f).current.name, next.name, issue);
    assert.equal(record(f).skipped[0].name, druid.name, issue);
  }
});

test('native claim confirmation accepts the completion marker under a different heading', async t => {
  const quests = [{ ...druid, progress: 40 }, next];
  const f = board(t, {}, quests, {
    questContent: () => questContent(quests).replace('<h2>Chronicled</h2>', '<h2>Quest History</h2>'),
    questSubmit(payload) {
      if (payload.action === 'claim') Object.assign(quests[0], { group: 'Chronicled', omitLevel: true });
    },
  });
  await f.start({ interval: 1 });
  await f.advance(2500);
  assert.deepEqual(f.state.requests.map(r => r.action), ['claim', 'travel']);
  assert.deepEqual(record(f).finished, [druid.name]);
  assert.equal(record(f).uncertain, false);
});

test('an unlisted previous quest is reported as skipped while another verified active quest continues', async t => {
  const f = board(t, await returningQueue(t), [next]);
  await f.advance(500);
  assert.deepEqual(record(f).finished, []);
  assert.match(record(f).skipped[0].reason, /completion unconfirmed/i);
  assert.equal(record(f).skipped[0].name, druid.name);
  assert.equal(record(f).current.name, next.name);
  assert.deepEqual(f.state.requests.map(r => r.action), ['travel']);
});

test('a previously unlisted quest is reconsidered if it reappears as active', async t => {
  const session = await returningQueue(t);
  const saved = JSON.parse(session[KEY]);
  Object.assign(saved, { current: null, skipped: [{ name: druid.name, reason: 'No longer listed on the quest board; completion unconfirmed.' }] });
  session[KEY] = JSON.stringify(saved);
  const f = board(t, session, [druid, next]);
  await f.advance(500);
  assert.equal(record(f).current.name, druid.name);
  assert.deepEqual(record(f).skipped, []);
  assert.deepEqual(record(f).finished, []);
});

test('an incomplete or inconsistent active section cannot cause a missing quest to be skipped', async t => {
  for (const issue of ['section', 'count', 'card']) {
    const f = board(t, await returningQueue(t), [next], { beforeScript(window) {
      const heading = Array.from(window.document.querySelectorAll('h2')).find(node => node.textContent === 'Active');
      if (issue === 'section') heading.nextElementSibling.remove();
      if (issue === 'count') {
        const header = window.document.querySelector('section.content .card p');
        header.innerHTML = header.innerHTML.replace('1/3 active', '2/3 active');
      }
      if (issue === 'card') heading.nextElementSibling.querySelector('.stat-row:nth-of-type(2)').remove();
    } });
    await f.advance(500);
    assert.equal(f.state.requests.length, 0, issue);
    assert.deepEqual(record(f).finished, [], issue);
    assert.deepEqual(record(f).skipped, [], issue);
    assert.equal(record(f).current.name, druid.name, issue);
  }
});

test('an active quest with a changed objective still pauses instead of moving on', async t => {
  const f = board(t, await returningQueue(t), [{ ...druid, target: 'Other Druid' }, next]);
  await f.advance(500);
  assert.equal(f.state.requests.length, 0);
  assert.match(f.status(), /objective changed/);
  assert.deepEqual(record(f).finished, []);
});

test('a new completion respects the cumulative quest and action caps', async t => {
  for (const config of [{ quests: 1 }, { actions: 7 }]) {
    const f = board(t, await returningQueue(t, config), [{ ...druid, group: 'Completed', omitLevel: true }, next]);
    await f.advance(500);
    assert.deepEqual(record(f).finished, [druid.name]);
    assert.equal(f.state.requests.length, 0);
    assert.match(f.status(), /limit reached/);
  }
});

test('resuming a completed quest counts it once and recovers the previously paused queue', async t => {
  const session = await returningQueue(t);
  const saved = JSON.parse(session[KEY]);
  saved.active = false;
  saved.continuation = null;
  saved.finished = [druid.name];
  session[KEY] = JSON.stringify(saved);
  const f = board(t, session, [{ ...druid, group: 'Chronicled', omitLevel: true }, next]);
  f.ui.getElementById('quest-resume').click();
  await f.advance(500);
  assert.deepEqual(record(f).finished, [druid.name]);
  assert.equal(record(f).current.name, next.name);
});

test('claim responses can confirm a completed entry without a level badge and proceed to an active quest', async t => {
  const quests = [{ ...druid, progress: 40 }, next];
  const f = board(t, {}, quests, { questSubmit(payload) {
    if (payload.action === 'claim') Object.assign(quests[0], { group: 'Completed', omitLevel: true });
  } });
  await f.start({ interval: 1 });
  await f.advance(2500);
  assert.deepEqual(f.state.requests.map(r => r.action), ['claim', 'travel']);
  assert.deepEqual(record(f).finished, [druid.name]);
  assert.equal(record(f).uncertain, false);
});

test('a claim response with no completed entry remains uncertain and cannot start the next quest', async t => {
  const quests = [{ ...druid, progress: 40 }, next];
  const f = board(t, {}, quests, { questSubmit(payload) {
    if (payload.action === 'claim') quests.shift();
  } });
  await f.start({ interval: 1 });
  await f.advance(31000);
  assert.deepEqual(f.state.requests.map(r => r.action), ['claim']);
  assert.deepEqual(record(f).finished, []);
  assert.equal(record(f).uncertain, true);
  assert.match(f.status(), /request was not confirmed/);
});
