'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { fixture, flush, source } = require('./harness.cjs');

function audioFixture(t, options = {}) {
  const audio = { contexts: [], notes: [] };
  const f = fixture(t, { ...options, beforeScript(window) {
    window.AudioContext = class {
      constructor() {
        this.state = options.suspended ? 'suspended' : 'running';
        this.destination = {};
        this.listeners = new Map();
        audio.contexts.push(this);
      }
      get currentTime() { return window.Date.now() / 1000; }
      addEventListener(name, callback) { this.listeners.set(name, callback); }
      async resume() {
        if (options.resumeError) throw new Error('Audio permission denied');
        this.state = 'running';
        this.listeners.get('statechange')?.();
      }
      async close() { this.state = 'closed'; this.listeners.get('statechange')?.(); }
      createOscillator() {
        if (options.synthesisError) throw new Error('Audio output unavailable');
        const note = { frequency: null, started: null, stopped: null, connected: false };
        audio.notes.push(note);
        return {
          frequency: { setValueAtTime(value) { note.frequency = value; } },
          connect() { note.connected = true; }, disconnect() {},
          addEventListener() {}, start(at) { note.started = at; }, stop(at) { note.stopped = at; },
        };
      }
      createGain() {
        return { gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() {}, disconnect() {} };
      }
    };
    options.beforeScript?.(window);
  } });
  return { ...f, audio, chimes: () => audio.notes.length / 3,
    soundStatus: () => f.ui.getElementById('soundStatus').textContent,
    async mute() { f.ui.getElementById('alertSound').checked = false; f.ui.getElementById('alertSound').dispatchEvent(new f.window.Event('change')); await flush(); },
    async unmute() { f.ui.getElementById('alertSound').checked = true; f.ui.getElementById('alertSound').dispatchEvent(new f.window.Event('change')); await flush(); },
    async testSound() { f.ui.getElementById('testSound').click(); await flush(); },
  };
}

test('an idle human-check prompt sounds immediately and once every minute without game actions', async t => {
  const f = audioFixture(t);
  f.showGuard();
  assert.equal(f.chimes(), 1);
  assert.deepEqual(f.audio.notes.map(note => note.frequency), [880, 1108, 1320]);
  assert.ok(f.audio.notes.every(note => note.connected && note.stopped > note.started));
  await f.advance(59999);
  assert.equal(f.chimes(), 1);
  await f.advance(1);
  assert.equal(f.chimes(), 2);
  await f.advance(60000);
  assert.equal(f.chimes(), 3);
  assert.equal(f.state.requests.length, 0);
  assert.equal(f.state.verificationClicks, 0);
});

test('repeated DOM swaps do not duplicate the initial chime or postpone its reminder', async t => {
  const f = audioFixture(t);
  f.showGuard();
  await f.advance(20000);
  f.showGuard();
  for (let index = 0; index < 4; index += 1) f.document.dispatchEvent(new f.window.CustomEvent('dank:swapped'));
  await f.advance(40000);
  assert.equal(f.chimes(), 2);
});

test('clearing the check cancels reminders and a later check sounds immediately', async t => {
  const f = audioFixture(t);
  f.showGuard();
  f.clearGuard();
  await f.advance(180000);
  assert.equal(f.chimes(), 1);
  f.showGuard();
  assert.equal(f.chimes(), 2);
  await f.advance(60000);
  assert.equal(f.chimes(), 3);
});

test('mute is saved globally and unmuting a current check sounds immediately', async t => {
  const f = audioFixture(t, { guard: true, soundEnabled: false });
  await f.advance(120000);
  assert.equal(f.chimes(), 0);
  assert.equal(f.ui.getElementById('alertSound').checked, false);
  await f.unmute();
  assert.equal(f.chimes(), 1);
  assert.equal(f.state.savedValues['alerts:human-check-sound'], true);
  await f.advance(60000);
  assert.equal(f.chimes(), 2);
  await f.mute();
  assert.equal(f.state.savedValues['alerts:human-check-sound'], false);
  await f.advance(120000);
  assert.equal(f.chimes(), 2);
});

test('Test sound plays one chime without unmuting automatic reminders', async t => {
  const f = audioFixture(t, { guard: true, soundEnabled: false });
  await f.testSound();
  assert.equal(f.chimes(), 1);
  assert.equal(f.ui.getElementById('alertSound').checked, false);
  await f.advance(120000);
  assert.equal(f.chimes(), 1);
});

test('an audio status update during checkbox activation cannot cancel muting', async t => {
  const f = audioFixture(t, { guard: true });
  const checkbox = f.ui.getElementById('alertSound');
  f.document.addEventListener('click', event => {
    if (event.composedPath().includes(checkbox)) f.audio.contexts[0].listeners.get('statechange')();
  }, true);
  checkbox.click();
  await flush();
  assert.equal(checkbox.checked, false);
  assert.equal(f.state.savedValues['alerts:human-check-sound'], false);
  assert.match(f.soundStatus(), /muted/);
  await f.advance(120000);
  assert.equal(f.chimes(), 1);
});

test('Test sound unlocks a suspended audio context and starts minute reminders', async t => {
  const f = audioFixture(t, { guard: true, suspended: true });
  assert.equal(f.chimes(), 0);
  assert.match(f.soundStatus(), /Click Test sound/);
  await f.testSound();
  assert.equal(f.chimes(), 1);
  assert.equal(f.audio.contexts[0].state, 'running');
  await f.advance(60000);
  assert.equal(f.chimes(), 2);
});

test('audio permission failures are visible and never trigger a verification submission', async t => {
  const f = audioFixture(t, { guard: true, suspended: true, resumeError: true });
  await f.testSound();
  assert.match(f.soundStatus(), /Could not enable sound.*permission denied/);
  assert.equal(f.chimes(), 0);
  await f.advance(60000);
  assert.equal(f.state.requests.length, 0);
  assert.equal(f.state.verificationClicks, 0);
});

test('sound-output and preference-storage failures remain visible', async t => {
  const f = audioFixture(t, { guard: true, synthesisError: true });
  assert.match(f.soundStatus(), /Could not play the alert.*output unavailable/);
  const denied = audioFixture(t, { storageError: true });
  await denied.mute();
  assert.match(denied.soundStatus(), /Could not save the sound setting.*storage unavailable/);
});

test('a hidden prompt starts sounding when shown, and hiding it stops the reminder', async t => {
  const f = audioFixture(t);
  f.showGuard({ hidden: true, notice: false });
  await f.advance(60000);
  assert.equal(f.chimes(), 0);
  f.document.getElementById('fixture-guard').hidden = false;
  await flush();
  assert.equal(f.chimes(), 1);
  f.document.getElementById('fixture-guard').style.display = 'none';
  await f.advance(120000);
  assert.equal(f.chimes(), 1);
});

test('the guard page alerts while idle and navigation cancels its reminders', async t => {
  const f = audioFixture(t, { url: 'https://dankscape.com/guard.php?from=arena' });
  assert.equal(f.chimes(), 1);
  f.window.dispatchEvent(new f.window.Event('pagehide'));
  await f.advance(120000);
  assert.equal(f.chimes(), 1);
  assert.equal(f.audio.contexts[0].state, 'closed');
  f.window.dispatchEvent(new f.window.Event('pageshow'));
  assert.equal(f.chimes(), 2);
  assert.equal(f.state.requests.length, 0);
});

test('body replacement and reinjection keep exactly one sound reminder', async t => {
  const f = audioFixture(t);
  const replacement = f.document.body.cloneNode(true);
  replacement.querySelector('section.content').insertAdjacentHTML('afterbegin', '<a href="/guard.php?from=gather">Verify I’m human</a>');
  f.document.body.replaceWith(replacement);
  await flush();
  assert.equal(f.chimes(), 1);
  f.window.eval(source);
  await f.advance(60000);
  assert.equal(f.chimes(), 2);
});

test('Stop pauses automation but reminders persist until the human check is cleared or muted', async t => {
  const f = audioFixture(t, { guardOnRequest: 1 });
  await f.start();
  await f.advance(100);
  assert.equal(f.chimes(), 1);
  f.stop();
  await f.advance(60000);
  assert.equal(f.chimes(), 2);
  assert.equal(f.state.requests.length, 1);
  f.clearGuard();
  await f.advance(60000);
  assert.equal(f.chimes(), 2);
});
