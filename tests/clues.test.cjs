'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { fixture, lockManager } = require('./harness.cjs');
const { nonogramContent } = require('./clue-fixture.cjs');
const runs = bits => (bits.match(/1+/g) || []).map(group => group.length);

function clue(t, options = {}) {
  let clicks = 0;
  const f = fixture(t, { mode: 'clue', locks: options.locks, beforeScript(window) {
    window.document.querySelector('aside').remove();
    window.document.querySelector('section.content').innerHTML = nonogramContent(options.rows, options.columns, options.bits);
    const output = window.document.getElementById('nono-cells');
    const bits = output.value.split('');
    for (const cell of window.document.querySelectorAll('button.nono')) cell.addEventListener('click', () => {
      clicks += 1;
      const index = Number(cell.dataset.i);
      bits[index] = bits[index] === '1' ? '0' : '1';
      output.value = bits.join('');
    });
    options.beforeScript?.(window);
  } });
  return Object.assign(f, { clicks: () => clicks, answer: () => f.document.getElementById('nono-cells').value });
}

test('the observed Easy nonogram is filled through native cell controls without submitting or starting scrolls', async t => {
  const f = clue(t);
  await f.advance(1000);
  assert.equal(f.clicks(), 0);
  await f.start();
  const answer = f.answer();
  assert.deepEqual(Array.from({ length: 5 }, (_, i) => runs(answer.slice(i * 5, (i + 1) * 5))), [[3], [2], [2], [2, 2], [1, 1]]);
  assert.deepEqual(Array.from({ length: 5 }, (_, col) => runs(Array.from({ length: 5 }, (_, row) => answer[row * 5 + col]).join(''))), [[1, 1], [1, 2], [1], [1, 2], [1, 3]]);
  assert.ok(f.clicks() > 0);
  assert.equal(f.state.requests.length, 0);
  assert.match(f.status(), /Solution filled/);
  const before = f.clicks();
  await f.start();
  assert.equal(f.clicks(), before);
});

test('ambiguous and impossible nonograms are left unchanged', async t => {
  for (const rows of [[[1], [1]], [[2], [2]]]) {
    const f = clue(t, { rows, columns: [[1], [1]] });
    await f.start();
    assert.equal(f.clicks(), 0);
    assert.equal(f.state.requests.length, 0);
    assert.match(f.status(), /No unique/);
  }
});

test('empty nonogram runs and an already painted board are handled correctly', async t => {
  const f = clue(t, { rows: [[2], []], columns: [[1], [1]], bits: '0111' });
  await f.start();
  assert.equal(f.answer(), '1100');
  assert.match(f.status(), /Solution filled/);
});

test('unsupported clue types, broken controls and oversized boards do not fill or submit', async t => {
  for (const change of ['type', 'index', 'output', 'hints', 'size']) {
    const f = clue(t, { beforeScript(window) {
      if (change === 'type') window.document.querySelector('h3 span').textContent = 'Rune lock';
      if (change === 'index') window.document.querySelector('.nono').dataset.i = '24';
      if (change === 'output') window.document.getElementById('nono-cells').value = 'broken';
      if (change === 'hints') window.document.querySelector('#clue-form div div:nth-child(2)').textContent = 'unknown';
      if (change === 'size') window.document.querySelector('section.content').innerHTML = nonogramContent(Array(11).fill([1]), Array(11).fill([1]));
    } });
    await f.start();
    assert.equal(f.clicks(), 0, change);
    assert.equal(f.state.requests.length, 0, change);
  }
});

test('clue filling respects the shared game lock', async t => {
  const locks = lockManager();
  let release;
  const held = locks.request('dankscape-gather-assistant:v1', { ifAvailable: true }, () => new Promise(resolve => { release = resolve; }));
  const f = clue(t, { locks });
  await f.start();
  assert.equal(f.clicks(), 0);
  assert.match(f.status(), /Another tab/);
  release();
  await held;
});
