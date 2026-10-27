"use strict";

const test = require('node:test');
const assert = require('node:assert/strict');
const { fixture, lockManager, flush } = require('./harness.cjs');
const { page } = require('./fixture.cjs');
const { clueContent, nonogramContent, cipherContent, codebreakerContent, wireCodebreaker } = require('./clue-fixture.cjs');
const { craftContent } = require('./craft-fixture.cjs');
const KEY = 'dankscape-assistant:quest-queue:v1';
const html = content => `<section class="content">${content}</section><div id="flash-stack"></div>`;
const bestiary = '<table class="data"><tbody><tr><td>5</td><td><strong>Goblin</strong></td></tr><tr><td>60</td><td><strong>Yeti</strong></td></tr></tbody></table>';

function trail(t, options = {}) {
  let clicks = 0;
  let f;
  const wire = window => {
    wireCodebreaker(window.document);
    const output = window.document.getElementById('nono-cells');
    if (output) for (const cell of window.document.querySelectorAll('button.nono')) cell.addEventListener('click', () => {
      clicks += 1;
      const i = Number(cell.dataset.i), bits = output.value.split('');
      bits[i] = bits[i] === '1' ? '0' : '1'; output.value = bits.join('');
    });
    options.wire?.(window);
  };
  f = fixture(t, { mode: 'clue', locks: options.locks, session: options.session, now: options.now,
    beforeScript(window) {
      window.document.querySelector('aside').remove();
      window.document.querySelector('section.content').innerHTML = options.content || nonogramContent(options.rows, options.columns, options.bits);
      window.fetch = async url => ({ ok: true, status: 200, url, text: async () => options.read?.(new URL(url), window)
        || (new URL(url).pathname === '/arena.php' ? page('mining', false, 'arena').replace('Local test hero', options.hero || 'Local test hero')
          : new URL(url).pathname === '/bestiary.php' ? bestiary : html(options.content || nonogramContent())) });
      wire(window);
      options.beforeScript?.(window);
    }, deedSubmit: options.submit,
  });
  return Object.assign(f, {
    clicks: () => clicks,
    answer: () => f.document.getElementById('nono-cells')?.value,
    queue: () => JSON.parse(f.session()[KEY] || 'null'),
    respond(content, message = '') {
      f.document.querySelector('section.content').innerHTML = content;
      f.document.getElementById('flash-stack').innerHTML = message ? `<div class="flash flash-ok">${message}</div>` : '';
      wire(f.window);
      f.document.dispatchEvent(new f.window.CustomEvent('dank:swapped'));
    },
  });
}

const runs = bits => (bits.match(/1+/g) || []).map(group => group.length);

function runePegs(secret, guess) {
  let exact = 0;
  const unmatchedSecret = [], unmatchedGuess = [];
  for (let i = 0; i < 4; i += 1) {
    if (secret[i] === guess[i]) exact += 1;
    else { unmatchedSecret.push(secret[i]); unmatchedGuess.push(guess[i]); }
  }
  let misplaced = 0;
  for (const rune of unmatchedGuess) {
    const i = unmatchedSecret.indexOf(rune);
    if (i >= 0) { unmatchedSecret.splice(i, 1); misplaced += 1; }
  }
  return { guess, exact, misplaced };
}

test('Codebreaker continues the observed history and submits its unique remaining solution', async t => {
  const history = [{ guess: '1122', exact: 0, misplaced: 0 }, { guess: '1333', exact: 2, misplaced: 1 }, { guess: '1134', exact: 1, misplaced: 1 }];
  const f = trail(t, { content: codebreakerContent(history) });
  await f.start(); await f.advance(100);
  assert.equal(f.state.requests[0].guess, '3433');
  assert.equal(f.queue().command.kind, 'guess');
  assert.equal(f.queue().command.history.length, 3);
  assert.equal(f.queue().uncertain, true);
  f.respond(clueContent({ index: 2, progress: 20 })); await f.advance(500);
  f.respond(clueContent({ idle: true }), 'The trail ends at a buried casket: 2,280g and a Emerald.'); await f.advance(500);
  assert.equal(f.queue().trailsCompleted, 1);
  assert.equal(f.queue().completed, 2);
});

test('Codebreaker solves all 256 repeat-allowed codes within the native guess budget', async t => {
  const f = trail(t, { content: codebreakerContent() });
  let maximum = 0;
  for (let n = 0; n < 256; n += 1) {
    const secret = n.toString(4).padStart(4, '0').replace(/[0-3]/g, digit => String(Number(digit) + 1));
    if (n) { f.ui.getElementById('quest-discard').click(); f.respond(codebreakerContent()); }
    const before = f.state.requests.length, history = [];
    await f.start({ interval: 0.1 }); await f.advance(100);
    for (let attempt = 0; attempt < 12; attempt += 1) {
      assert.equal(f.state.requests.length, before + attempt + 1, `${secret}: ${f.status()}`);
      const guess = f.state.requests.at(-1).guess;
      assert.match(guess, /^[1-4]{4}$/);
      assert.ok(!history.some(entry => entry.guess === guess), `Repeated guess for ${secret}`);
      if (guess === secret) break;
      history.push(runePegs(secret, guess));
      f.respond(codebreakerContent(history)); await f.advance(500);
    }
    assert.equal(f.state.requests.at(-1).guess, secret);
    maximum = Math.max(maximum, history.length + 1);
    f.respond(clueContent({ index: 2, progress: 20 })); await f.advance(500);
    f.respond(clueContent({ idle: true }), 'The trail ends at a buried casket: 2,280g and a Emerald.'); await f.advance(500);
    assert.equal(f.queue().trailsCompleted, 1);
  }
  assert.ok(maximum <= 6, `Required ${maximum} guesses`);
});

test('a saved Codebreaker guess resumes only with one matching new feedback row and retained limits', async t => {
  const first = trail(t, { content: codebreakerContent() });
  await first.start({ actions: 2 }); await first.advance(100);
  const session = first.session(), guess = first.state.requests[0].guess;
  first.window.close(); await flush();
  const next = trail(t, { session, content: codebreakerContent([runePegs('3433', guess)]) });
  await next.advance(500);
  assert.equal(next.state.requests.length, 1);
  assert.notEqual(next.state.requests[0].guess, guess);
  assert.equal(next.queue().completed, 1);
  assert.equal(next.queue().config.actions, 2);
  const second = next.state.requests[0].guess;
  next.respond(codebreakerContent([runePegs('3433', guess), runePegs('3433', second)])); await next.advance(500);
  assert.equal(next.queue().completed, 2);
  assert.equal(next.state.requests.length, 1);
  assert.match(next.status(), /Action limit/);
});

test('unchanged, reset, mismatched, contradictory or extra Codebreaker feedback never resends a guess', async t => {
  const first = trail(t, { content: codebreakerContent() });
  await first.start(); await first.advance(100);
  const session = first.session(), guess = first.state.requests[0].guess;
  first.window.close(); await flush();
  const cases = [[], [{ guess: '4444', exact: 0, misplaced: 0 }],
    [{ guess, exact: 3, misplaced: 1 }], [runePegs('3433', guess), { guess: '1234', exact: 1, misplaced: 1 }]];
  for (const history of cases) {
    const f = trail(t, { session, content: codebreakerContent(history) });
    await f.advance(31000);
    assert.equal(f.state.requests.length, 0);
    assert.match(f.status(), /unconfirmed/);
  }
  const f = trail(t, { content: codebreakerContent() });
  await f.start(); await f.advance(31000);
  assert.equal(f.state.requests.length, 1);
  assert.match(f.status(), /navigation did not finish/);
});

test('Codebreaker pauses on malformed controls and histories without submitting', async t => {
  const edits = [
    w => w.document.querySelector('[name="g3"]').remove(),
    w => w.document.querySelector('[name="g2"]').name = 'other',
    w => w.document.querySelector('[name="g1"] option').value = '9',
    w => w.document.getElementById('cb-guess').remove(),
    w => { w.document.querySelector('#clue-form').previousElementSibling.textContent = 'A changed rune-lock prompt.'; },
    w => { w.document.querySelector('tbody tr td').textContent = '2'; },
    w => { w.document.querySelector('tbody tr td:nth-child(3)').textContent = 'unknown'; },
    w => { w.document.querySelector('#clue-form p:last-of-type').textContent = '12 guesses left before the lock resets.'; },
  ];
  for (const beforeScript of edits) {
    const f = trail(t, { content: codebreakerContent([{ guess: '1122', exact: 0, misplaced: 0 }]), beforeScript });
    await f.start(); await f.advance(100);
    assert.equal(f.state.requests.length, 0);
    assert.match(f.status(), /Codebreaker/);
  }
});

test('Codebreaker uses the last attempt only for a proven solution and tolerates prior manual repeats', async t => {
  const zero = { guess: '1122', exact: 0, misplaced: 0 };
  const ambiguous = trail(t, { content: codebreakerContent(Array(11).fill(zero)) });
  await ambiguous.start(); await ambiguous.advance(100);
  assert.equal(ambiguous.state.requests.length, 0);
  assert.match(ambiguous.status(), /too close to a reset/);
  const unique = trail(t, { content: codebreakerContent([...Array(9).fill(zero),
    { guess: '1333', exact: 2, misplaced: 1 }, { guess: '1134', exact: 1, misplaced: 1 }]) });
  await unique.start(); await unique.advance(100);
  assert.equal(unique.state.requests[0].guess, '3433');
  const contradiction = trail(t, { content: codebreakerContent([zero, { guess: '1122', exact: 1, misplaced: 0 }]) });
  await contradiction.start(); await contradiction.advance(100);
  assert.equal(contradiction.state.requests.length, 0);
});

test('Start solves the observed nonogram through native clicks and persists intent before submitting once', async t => {
  const f = trail(t);
  await f.advance(1000);
  assert.equal(f.clicks(), 0);
  await f.start(); await f.advance(100);
  const answer = f.answer();
  assert.deepEqual(Array.from({ length: 5 }, (_, i) => runs(answer.slice(i * 5, i * 5 + 5))), [[3], [2], [2], [2, 2], [1, 1]]);
  assert.deepEqual(Array.from({ length: 5 }, (_, col) => runs(Array.from({ length: 5 }, (_, row) => answer[row * 5 + col]).join(''))), [[1, 1], [1, 2], [1], [1, 2], [1, 3]]);
  assert.equal(f.state.requests.length, 1);
  assert.equal(f.state.requests[0].cells, answer);
  assert.equal(f.queue().command.kind, 'answer');
  assert.equal(f.queue().uncertain, true);
  await f.advance(31000);
  assert.equal(f.state.requests.length, 1);
  assert.match(f.status(), /navigation did not finish/);
});

test('fresh step advancement and final reward are confirmed before continuing or reading another scroll', async t => {
  const f = trail(t);
  await f.start(); await f.advance(100);
  f.respond(clueContent({ index: 2, progress: 2052 }));
  await f.advance(500);
  assert.equal(f.state.requests.length, 2);
  f.respond(clueContent({ idle: true }), 'The trail ends at a buried casket: 2,160g and a Emerald.');
  await f.advance(500);
  assert.equal(f.queue().trailsCompleted, 1);
  assert.equal(f.queue().completed, 2);
  assert.match(f.status(), /trail limit reached.*Rewards collected/);
  assert.equal(f.state.requests.length, 2);
});

test('an idle trail reads the selected owned tier only after Start', async t => {
  const f = trail(t, { content: clueContent({ idle: true }) });
  await f.advance(500);
  assert.equal(f.state.requests.length, 0);
  await f.start({ target: 'hard' }); await f.advance(100);
  assert.equal(f.state.requests.length, 0);
  assert.match(f.status(), /No matching clue scrolls/);
  f.stop();
  await f.start({ target: 'easy' }); await f.advance(100);
  assert.equal(f.state.requests.length, 1);
  assert.equal(f.queue().command.kind, 'read');
});

test('ambiguous, impossible, malformed and oversized nonograms stay unchanged without submission', async t => {
  const cases = [
    { rows: [[1], [1]], columns: [[1], [1]] },
    { rows: [[2], [2]], columns: [[1], [1]] },
    { rows: Array(11).fill([1]), columns: Array(11).fill([1]) },
    { beforeScript: w => { w.document.querySelector('.nono').dataset.i = '24'; } },
    { beforeScript: w => { w.document.getElementById('nono-cells').value = 'broken'; } },
  ];
  for (const options of cases) {
    const f = trail(t, options);
    await f.start(); await f.advance(100);
    assert.equal(f.clicks(), 0);
    assert.equal(f.state.requests.length, 0);
    assert.match(f.status(), /No unique nonogram/);
  }
});

test('an already painted nonogram and zero runs are corrected before submission', async t => {
  const f = trail(t, { rows: [[2], []], columns: [[1], [1]], bits: '0111' });
  await f.start(); await f.advance(100);
  assert.equal(f.state.requests[0].cells, '1100');
});

test('Sudoku preserves given cells and submits a valid unique solution through native inputs', async t => {
  const givens = '075940031490138000310705649153000498060094300004503270809050760647389002021467983';
  const body = `<div id="sudoku-grid">${Array.from(givens, (n, i) => `<input class="sudoku-cell" name="cells[${i}]" ${n === '0' ? '' : `readonly value="${n}"`}>`).join('')}</div>`;
  const f = trail(t, { content: clueContent({ type: 'Sudoku', prompt: 'Nine by nine, every row, column and box holds one to nine.', body }) });
  await f.start(); await f.advance(100);
  const request = f.state.requests[0];
  assert.ok(request);
  const solved = Array.from({ length: 81 }, (_, i) => request[`cells[${i}]`]).join('');
  assert.equal(solved, '275946831496138527318725649153672498762894315984513276839251764647389152521467983');
  for (let i = 0; i < 81; i++) if (givens[i] !== '0') assert.equal(solved[i], givens[i]);
});

test('sliding tiles reset existing moves without stopping and submit a legal solution', async t => {
  const initial = '054132786';
  const f = trail(t, { content: clueContent({ type: 'Sliding tiles', prompt: 'Slide the tiles until they read one to eight with the gap in the last corner.',
    body: `<div id="slide" data-tiles="${initial}"></div><input type="hidden" name="moves" id="slide-moves"><a id="slide-reset" href="#">reset</a>` }),
    wire(window) {
      const d = window.document, grid = d.getElementById('slide');
      if (!grid) return;
      let tiles = initial.split(''), moves = [];
      const render = () => {
        grid.replaceChildren();
        tiles.forEach((n, i) => {
          const b = d.createElement('button'); b.type = 'button'; b.textContent = n === '0' ? '' : n;
          b.addEventListener('click', () => {
            const z = tiles.indexOf('0');
            assert.ok(Math.abs(z - i) === 3 || (Math.floor(z / 3) === Math.floor(i / 3) && Math.abs(z - i) === 1));
            [tiles[z], tiles[i]] = [tiles[i], tiles[z]]; moves.push(i); d.getElementById('slide-moves').value = moves.join(','); render();
          }); grid.append(b);
        });
      };
      d.getElementById('slide-reset').addEventListener('click', e => { e.preventDefault(); tiles = initial.split(''); moves = []; d.getElementById('slide-moves').value = ''; render(); });
      render();
      grid.querySelectorAll('button')[1].click();
    } });
  await f.start(); await f.advance(100);
  assert.equal(Array.from(f.document.querySelectorAll('#slide button'), b => b.textContent || '0').join(''), '123456780');
  assert.equal(f.state.requests[0].moves.split(',').length, 12);
  assert.equal(f.queue().active, true);
});

test('the observed Treasurer Ledger submits values satisfying all three sums', async t => {
  const f = trail(t, { content: clueContent({ type: "Treasurer's Ledger", prompt: 'The treasurer recorded only sums. Chests A and B together hold 5 gold; B and C together hold 5; A and C together hold 4. How much sits in each chest?',
    body: '<input type="number" name="a" min="0"><input type="number" name="b" min="0"><input type="number" name="c" min="0">' }) });
  await f.start(); await f.advance(100);
  assert.deepEqual([f.state.requests[0].a, f.state.requests[0].b, f.state.requests[0].c], ['2', '3', '2']);
});

for (const [type, text] of [['Anagram', 'L G O I B N'], ['Cipher', 'JREOLQ']]) test(`${type} uses a unique match from the live-shaped Bestiary`, async t => {
  const f = trail(t, { content: clueContent({ type, prompt: 'Name a foe of level 5 (6 letters).', body: `<p>${text}</p><input name="answer">` }) });
  await f.start(); await f.advance(500);
  assert.equal(f.state.requests[0].answer, 'Goblin');
});

test('the current saying Cipher decodes its declared shift and submits without a Bestiary lookup', async t => {
  const f = trail(t, { content: cipherContent(),
    read: url => { assert.notEqual(url.pathname, '/bestiary.php'); return null; } });
  await f.start(); await f.advance(500);
  assert.equal(f.state.requests.length, 1);
  assert.equal(f.state.requests[0].answer, 'NO CAPE WITHOUT A HUNDRED NIGHTS');
  f.respond(clueContent({ idle: true }), 'The trail ends at a buried casket: 2,160g and a Emerald.');
  await f.advance(500);
  assert.equal(f.queue().trailsCompleted, 1);
});

test('saying Ciphers preserve spaces and punctuation for every declared Caesar shift', async t => {
  const saying = "The HERO'S path, at last: 99 bones!";
  for (let shift = 0; shift < 26; shift++) {
    const encoded = saying.replace(/[A-Za-z]/g, c => { const base = c >= 'a' ? 97 : 65; return String.fromCharCode(base + (c.charCodeAt(0) - base + shift) % 26); });
    const f = trail(t, { content: clueContent({ type: 'Cipher', prompt: `A Caesar cipher hides a saying of the realm — by ${shift} places.`,
      body: `<p style="font-family:monospace">${encoded}</p><input name="answer" placeholder="Write the decoded saying">` }) });
    await f.start(); await f.advance(100);
    assert.equal(f.state.requests[0].answer, saying);
  }
});

test('ambiguous shifts and malformed saying Cipher controls pause without submitting', async t => {
  for (const [prompt, body] of [
    ['A Caesar cipher hides a saying of the realm.', '<p>ABC DEF</p>'],
    ['A Caesar cipher hides a saying of the realm — by 26 places.', '<p>ABC DEF</p>'],
    ['A Caesar cipher hides a saying of the realm — by 1 places or by 2 places.', '<p>ABC DEF</p>'],
    ['A Caesar cipher hides a saying of the realm — by 1 places.', '<p>ABC DEF</p><p>GHI JKL</p>'],
  ]) {
    const f = trail(t, { content: clueContent({ type: 'Cipher', prompt, body: `${body.replaceAll('<p>', '<p style="font-family:monospace">')}<input name="answer" placeholder="Write the decoded saying">` }) });
    await f.start(); await f.advance(100);
    assert.equal(f.state.requests.length, 0);
    assert.match(f.status(), /no single verified answer/);
  }
});

test('unknown clues, non-unique text matches, unconfirmed rewards and foreign destinations never repeat a submission', async t => {
  for (const type of ['Unknown puzzle', 'Riddle']) {
    const f = trail(t, { content: clueContent({ type, prompt: 'An unfamiliar riddle.', body: '<input name="answer">' }) });
    await f.start(); await f.advance(1000);
    assert.equal(f.state.requests.length, 0);
    assert.match(f.status(), /Unrecognized|no single verified answer/);
  }
  const f = trail(t, { beforeScript: w => w.document.getElementById('clue-form').action = 'https://example.com/collect' });
  await f.start(); await f.advance(100);
  assert.equal(f.state.requests.length, 0);
  assert.match(f.status(), /form changed/);
});

test('a saved answer resumes only after fresh step advancement and preserves the original budget', async t => {
  const first = trail(t);
  await first.start({ actions: 4 }); await first.advance(100);
  const session = first.session();
  first.window.close(); await flush();
  const next = trail(t, { session, content: clueContent({ index: 2, progress: 20 }) });
  await next.advance(500);
  assert.equal(next.state.requests.length, 1);
  assert.equal(next.queue().config.actions, 4);
  assert.equal(next.queue().completed, 1);
  const unchanged = trail(t, { session });
  await unchanged.advance(500);
  assert.equal(unchanged.state.requests.length, 0);
  assert.match(unchanged.status(), /unconfirmed/);
});

test('Stop, hero changes and the cross-tab lock prevent clue submission', async t => {
  const f = trail(t);
  await f.start(); await f.advance(100); f.stop();
  f.respond(clueContent({ index: 2, progress: 20 }));
  await f.advance(500);
  assert.equal(f.state.requests.length, 1);
  const locks = lockManager(); let release;
  const held = locks.request('dankscape-gather-assistant:v1', { ifAvailable: true }, () => new Promise(resolve => { release = resolve; }));
  const other = trail(t, { locks });
  await other.start();
  assert.equal(other.clicks(), 0); assert.match(other.status(), /Another tab/);
  release(); await held;
});

test('the exact bone riddle travels to the altar without changing prayers', async t => {
  const f = trail(t, { content: clueContent() });
  await f.start(); await f.advance(500);
  assert.equal(f.state.navigations[0], 'https://dankscape.com/altar.php');
  assert.equal(f.queue().current.mode, 'altar');
  assert.equal(f.queue().current.goal, 20);
  assert.equal(f.state.requests.length, 0);
});

test('an enchanting deed selects one available recipe and retains food and potion settings', async t => {
  const recipe = { id: '178', name: 'Inscribe Novice Precision Sigil', materials: [{ name: 'Sapphire', amount: 1, owned: 29 }] };
  const f = trail(t, { content: clueContent({ prompt: 'Bind a rune to a gem and listen for the hum.', goal: 40 }),
    read: url => url.pathname === '/craft.php' ? html(craftContent('enchanting', [recipe])) : null });
  await f.start({ meals: 28, actions: 17 }); await f.advance(500);
  assert.equal(f.state.navigations[0], 'https://dankscape.com/craft.php?skill=enchanting');
  assert.equal(f.queue().current.target, 'recipe-178');
  assert.equal(f.queue().config.actions, 17);
  assert.equal(f.queue().config.meals, 28);
});

test('word search selects native endpoints and submits only when every word is found', async t => {
  const letters = Array(100).fill('X');
  for (const [i, c] of [[0, 'C'], [11, 'A'], [22, 'T'], [95, 'D'], [85, 'O'], [75, 'G']]) letters[i] = c;
  const f = trail(t, { content: clueContent({ type: 'Word search', prompt: 'Find the listed words.',
    body: `<div id="ws-grid" data-words="CAT,DOG">${letters.map((c, i) => `<button type="button" class="ws-cell" data-i="${i}">${c}</button>`).join('')}</div><span class="ws-word" data-word="CAT">CAT</span><span class="ws-word" data-word="DOG">DOG</span><input type="hidden" name="answer" id="ws-answer">` }),
    wire(w) {
      const d = w.document, cells = Array.from(d.querySelectorAll('.ws-cell')), found = [];
      let start = null;
      d.getElementById('clue-submit').disabled = true;
      for (const cell of cells) cell.addEventListener('click', () => {
        const end = Number(cell.dataset.i);
        if (start === null) { start = end; cell.classList.add('sel'); return; }
        const dr = Math.floor(end / 10) - Math.floor(start / 10), dc = end % 10 - start % 10;
        assert.ok(dr === 0 || dc === 0 || Math.abs(dr) === Math.abs(dc));
        const picked = Array.from({ length: Math.max(Math.abs(dr), Math.abs(dc)) + 1 }, (_, n) => letters[start + n * (Math.sign(dr) * 10 + Math.sign(dc))]).join('');
        assert.ok(['CAT', 'DOG'].includes(picked));
        found.push(picked); cells[start].classList.remove('sel'); start = null;
        d.querySelector(`[data-word="${picked}"]`).classList.add('done');
        d.getElementById('ws-answer').value = found.join(' ');
        d.getElementById('clue-submit').disabled = found.length !== 2;
      });
    } });
  await f.start(); await f.advance(100);
  assert.equal(f.state.requests[0].answer, 'CAT DOG');
});

test('unseen Lights Out and Rune-lock formats pause without guesses, clicks or submissions', async t => {
  for (const type of ['Lights Out', 'Rune lock']) {
    const f = trail(t, { content: clueContent({ type, prompt: 'An unseen format.', body: '<input name="answer">' }) });
    await f.start(); await f.advance(1000);
    assert.equal(f.state.requests.length, 0);
    assert.match(f.status(), /Unrecognized clue puzzle/);
    assert.equal(f.queue().uncertain, false);
  }
});

function deedActivity(t, queue, options = {}) {
  let progress = options.progress || 0, stock = options.stock ?? 5, gold = options.gold ?? 100;
  const activity = queue.current.mode;
  const body = () => activity === 'altar' ? `<h1>The Altar</h1><table><tr><td>Big Bones</td><td>${stock}</td><td>+15</td><td>
    ${stock ? `<form method="post" class="altar-bury" data-ajax><input type="hidden" name="csrf" value="native-token"><input type="hidden" name="action" value="bury"><input type="hidden" name="inv_id" value="bones"><input name="qty" type="number" min="1" max="${stock}" value="${stock}"><button type="submit">Bury</button></form>` : ''}</td></tr></table>`
    : `<h1>The Arms Market</h1><p>You hold ${gold} gold.</p><table><tr><td class="name"><strong>Feather</strong></td><td class="price">2g</td><td><form method="post" class="shop-buy" data-ajax><input type="hidden" name="csrf" value="native-token"><input type="hidden" name="item_id" value="feather"><input name="qty" type="number" min="1" max="10000" value="9"><button type="submit">Buy</button></form></td></tr></table>`;
  const f = fixture(t, { mode: activity, session: { [KEY]: JSON.stringify(queue) },
    beforeScript(w) {
      w.document.querySelector('aside').remove();
      w.document.querySelector('section.content').innerHTML = body();
      w.fetch = async url => ({ ok: true, status: 200, url, text: async () => new URL(url).pathname === '/arena.php'
        ? page('mining', false, 'arena').replace('Local test hero', options.hero || 'Local test hero')
        : new URL(url).pathname === '/clue.php' ? html(clueContent({ index: 1, prompt: queue.current.mode === 'altar'
          ? "Give the dead their due at the Inn's altar; the bones know the way." : 'Trade with a merchant.', progress, goal: queue.current.goal }))
          : html(body()).replace('<div id="flash-stack"></div>', options.serverToast ? '<div id="flash-stack"><div class="flash flash-ok">You bury 1 Big Bones.</div></div>' : '<div id="flash-stack"></div>') });
    },
    deedSubmit(payload, state, w) {
      if (options.stuck) return;
      w.setTimeout(() => {
        assert.equal(payload.qty, '1');
        if (activity === 'altar') { stock -= 1; progress += options.noProgress ? 0 : 15; }
        else { gold -= 2; progress += options.noProgress ? 0 : 1; }
        if (options.lostSwap) return;
        w.document.querySelector('section.content').innerHTML = body();
        w.document.getElementById('flash-stack').innerHTML = `<div class="flash flash-ok">${activity === 'altar' ? 'You bury 1 Big Bones.' : 'You bought 1 Feather.'}</div>`;
        w.document.dispatchEvent(new w.CustomEvent('dank:swapped'));
      }, 100);
    } });
  return Object.assign(f, { queue: () => JSON.parse(f.session()[KEY]), progress: () => progress });
}

async function plannedQueue(t, prompt, goal = 20) {
  const f = trail(t, { content: clueContent({ prompt, goal }) });
  await f.start(); await f.advance(500);
  const q = f.queue(); f.window.close(); await flush();
  return q;
}

test('altar continuation buries one bone per action and returns to the board at the authoritative goal', async t => {
  const q = await plannedQueue(t, "Give the dead their due at the Inn's altar; the bones know the way.");
  const f = deedActivity(t, q);
  await f.advance(2000);
  assert.equal(f.state.requests.length, 2);
  assert.equal(f.progress(), 30);
  assert.ok(f.state.requests.every(r => r.qty === '1' && r.inv_id === 'bones'));
  assert.equal(f.queue().completed, 2);
  assert.equal(f.state.navigations.at(-1), 'https://dankscape.com/clue.php');
});

test('an action that does not advance the deed pauses after three confirmed results', async t => {
  const q = await plannedQueue(t, "Give the dead their due at the Inn's altar; the bones know the way.", 100);
  const f = deedActivity(t, q, { noProgress: true });
  await f.advance(2000);
  assert.equal(f.state.requests.length, 3);
  assert.match(f.status(), /did not advance the deed/);
});

test('merchant deeds use one cheap supply per action and enforce their cumulative gold budget', async t => {
  const q = await plannedQueue(t, 'Trade with a merchant.', 10);
  q.config.clueGold = 4;
  const f = deedActivity(t, q);
  await f.advance(2000);
  assert.equal(f.state.requests.length, 2);
  assert.equal(f.queue().goldSpent, 4);
  assert.match(f.status(), /gold budget/);
});

test('wrong heroes, uncertain actions and exhausted time cannot resume a clue deed', async t => {
  const q = await plannedQueue(t, "Give the dead their due at the Inn's altar; the bones know the way.");
  for (const [change, expected] of [
    [value => {}, /hero changed/],
    [value => { value.uncertain = true; }, /unconfirmed|inspection/],
    [value => { value.deadline = 0; }, /Time limit reached/],
  ]) {
    const copy = structuredClone(q); change(copy);
    const f = deedActivity(t, copy, { hero: 'Other hero' });
    await f.advance(1000);
    assert.equal(f.state.requests.length, 0);
    assert.match(f.status(), expected);
  }
});

test('a clue Workshop action crafts one item despite a large native inventory maximum', async t => {
  const recipe = { id: '178', name: 'Inscribe Novice Precision Sigil', materials: [{ name: 'Sapphire', amount: 1, owned: 29 }] };
  const prompt = 'Bind a rune to a gem and listen for the hum.';
  const first = trail(t, { content: clueContent({ prompt, goal: 40 }), read: url => url.pathname === '/craft.php' ? html(craftContent('enchanting', [recipe])) : null });
  await first.start(); await first.advance(500);
  const q = first.queue(); first.window.close(); await flush();
  let progress = 0;
  const f = fixture(t, { mode: 'craft', skill: 'enchanting', session: { [KEY]: JSON.stringify(q) },
    beforeScript(w) {
      w.document.querySelector('aside').remove();
      w.document.querySelector('section.content').innerHTML = craftContent('enchanting', [recipe]);
      w.fetch = async url => ({ ok: true, status: 200, url, text: async () => new URL(url).pathname === '/arena.php'
        ? page('mining', false, 'arena') : html(clueContent({ prompt, progress, goal: 40 })) });
    }, craftSubmit(payload, state, w) {
      w.setTimeout(() => {
        recipe.materials[0].owned -= Number(payload.times); progress += 21;
        w.document.querySelector('section.content').innerHTML = craftContent('enchanting', [recipe]);
        w.document.dispatchEvent(new w.CustomEvent('dank:swapped'));
      }, 100);
    } });
  await f.advance(2000);
  assert.equal(f.state.requests.length, 1);
  assert.equal(f.state.requests[0].times, '1');
  assert.equal(recipe.materials[0].owned, 28);
  assert.equal(f.state.navigations.at(-1), 'https://dankscape.com/clue.php');
  assert.equal(JSON.parse(f.session()[KEY]).current.progress, 21);
});

test('missing cooking materials can be gathered before replanning the recipe', async t => {
  const recipe = { id: '40', name: 'Cook Trout', materials: [{ name: 'Raw Trout', amount: 1, owned: 0 }] };
  const f = trail(t, { content: clueContent({ prompt: 'Where flame meets flesh, feed the pan until the smoke makes you weep.', goal: 30 }),
    read: url => url.pathname === '/craft.php' ? html(craftContent('cooking', [recipe]))
      : url.pathname === '/gather.php' ? page(url.searchParams.get('skill')).replaceAll('Fixture resource', url.searchParams.get('skill') === 'fishing' ? 'Raw Trout' : 'Other material') : null });
  await f.start(); await f.advance(1000);
  assert.equal(f.queue().current.preparation, true);
  assert.equal(f.queue().current.target, 'Raw Trout');
  assert.equal(f.state.navigations[0], 'https://dankscape.com/gather.php?skill=fishing');
  assert.equal(f.state.requests.length, 0);
});

test('verification return restores a clue run through its own board without resetting budgets', async t => {
  const q = await plannedQueue(t, "Give the dead their due at the Inn's altar; the bones know the way.");
  q.verification = { returnPath: '/altar.php', visited: true, continueClicked: true };
  q.continuation = null; q.active = false; q.completed = 7; q.eaten = 2; q.drunk = 1;
  const f = deedActivity(t, q);
  await f.advance(1000);
  assert.equal(f.state.requests.length, 0);
  assert.equal(f.state.navigations[0], 'https://dankscape.com/clue.php');
  assert.equal(f.queue().completed, 7);
  assert.equal(f.queue().eaten, 2);
  assert.equal(f.queue().drunk, 1);
  assert.equal(f.queue().verification, false);
});

test('a completed deed can collect its reward at the action limit without starting another activity', async t => {
  const f = trail(t);
  await f.start({ actions: 1 }); await f.advance(100);
  f.respond(clueContent({ index: 2, progress: 20 }));
  await f.advance(500);
  assert.equal(f.state.requests.length, 2);
  f.respond(clueContent({ idle: true }), 'The trail ends at a buried casket: 2,160g and a Emerald.');
  await f.advance(500);
  assert.equal(f.queue().trailsCompleted, 1);
  assert.equal(f.state.requests.length, 2);
});

test('a lost burial response without a matching success result pauses instead of repeating the bone', async t => {
  const q = await plannedQueue(t, "Give the dead their due at the Inn's altar; the bones know the way.");
  const f = deedActivity(t, q, { lostSwap: true });
  await f.advance(40000);
  // The recovery page lacks the original toast, so an inventory delta alone
  // cannot prove the action. It must pause rather than burying another bone.
  assert.equal(f.state.requests.length, 1);
  assert.match(f.status(), /could not confirm/);
});

test('a server-confirmed lost burial returns to the board with the original action counted once', async t => {
  const q = await plannedQueue(t, "Give the dead their due at the Inn's altar; the bones know the way.");
  const f = deedActivity(t, q, { lostSwap: true, serverToast: true });
  await f.advance(40000);
  assert.equal(f.state.requests.length, 1);
  assert.equal(f.queue().completed, 1);
  assert.equal(f.queue().recoveries, 1);
  assert.equal(f.queue().uncertain, false);
  assert.equal(f.state.navigations.at(-1), 'https://dankscape.com/clue.php');
});

test('ambiguous Bestiary anagrams do not send an answer', async t => {
  const f = trail(t, { content: clueContent({ type: 'Anagram', prompt: 'Name a foe of level 5 (6 letters).', body: '<p>L G O I B N</p><input name="answer">' }),
    read: url => url.pathname === '/bestiary.php' ? bestiary.replace('</tbody>', '<tr><td>5</td><td><strong>Gbolin</strong></td></tr></tbody>') : null });
  await f.start(); await f.advance(1000);
  assert.equal(f.state.requests.length, 0);
  assert.match(f.status(), /no single verified answer/);
});

test('multiple-trail mode confirms the first reward before reading and solving the next scroll', async t => {
  const f = trail(t);
  await f.start({ trails: 2 }); await f.advance(100);
  f.respond(clueContent({ index: 2, progress: 20 })); await f.advance(500);
  f.respond(clueContent({ idle: true }), 'The trail ends at a buried casket: 2,160g and a Emerald.'); await f.advance(500);
  assert.equal(f.queue().trailsCompleted, 1);
  assert.equal(f.state.requests.length, 3);
  assert.equal(f.queue().command.kind, 'read');
  f.respond(clueContent({ type: 'Anagram', prompt: 'Name a foe of level 60 (4 letters).', body: '<p>Y T I E</p><input name="answer">' }));
  await f.advance(500);
  assert.equal(f.state.requests.length, 4);
  assert.equal(f.state.requests[3].answer, 'Yeti');
  assert.equal(f.queue().trailsCompleted, 1);
});

test('Resume trail adopts a manually completed unseen puzzle only after fresh step advancement', async t => {
  const f = trail(t, { content: clueContent({ type: 'Lights Out', prompt: 'An unseen format.', body: '<input name="answer">' }) });
  await f.start(); await f.advance(500);
  assert.match(f.status(), /Unrecognized clue puzzle/);
  f.respond(clueContent({ index: 2, progress: 20 }));
  await f.advance(500);
  assert.equal(f.state.requests.length, 0);
  f.ui.getElementById('quest-resume').click();
  await f.advance(500);
  assert.equal(f.state.requests.length, 1);
  assert.equal(f.queue().command.index, 2);
  assert.equal(f.queue().trailsCompleted, 0);
});
