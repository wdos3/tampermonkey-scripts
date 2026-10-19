// ==UserScript==
// @name         DankScape Gathering Assistant
// @namespace    local.dankscape.gathering
// @version      1.10.0
// @updateURL    https://github.com/wdos3/dankscape-automation/raw/refs/heads/main/dankscape-gather.user.js
// @downloadURL  https://github.com/wdos3/dankscape-automation/raw/refs/heads/main/dankscape-gather.user.js
// @description  Gathering, combat, raids, quests, Slayer, and Diaries with food, potions, limits, and verification recovery.
// @match        https://dankscape.com/*
// @run-at       document-idle
// @sandbox      DOM
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @noframes
// ==/UserScript==

(() => {
  'use strict';

  const PANEL_ID = 'dankscape-gather-assistant';
  const VERSION = '1.10.0';
  const existing = document.getElementById(PANEL_ID);
  if (existing?.shadowRoot?.getElementById('start')) return;
  existing?.remove();
  let restorePanel = null;
  let panelPosition = null;
  const POSITION_KEY = 'panel:position';

  function element(tag, attributes = {}, children = []) {
    const node = document.createElement(tag);
    for (const [name, value] of Object.entries(attributes)) node.setAttribute(name, value);
    for (const child of Array.isArray(children) ? children : [children]) {
      node.appendChild(typeof child === 'string' ? document.createTextNode(child) : child);
    }
    return node;
  }

  function positionPanel(host) {
    const bounds = host.getBoundingClientRect();
    if (panelPosition) panelPosition = {
      x: Math.max(8, Math.min(panelPosition.x, window.innerWidth - bounds.width - 8)),
      y: Math.max(8, Math.min(panelPosition.y, window.innerHeight - bounds.height - 8)),
    };
    for (const [property, value] of Object.entries({
      display: 'block', position: 'fixed', right: panelPosition ? 'auto' : '16px', bottom: panelPosition ? 'auto' : '16px',
      left: panelPosition ? `${panelPosition.x}px` : 'auto', top: panelPosition ? `${panelPosition.y}px` : 'auto',
      'z-index': '2147483646', width: 'min(340px, calc(100vw - 32px))',
      visibility: 'visible', opacity: '1', transform: 'none',
    })) host.style.setProperty(property, value, 'important');
    host.hidden = false;
  }

  function createCheckSounds(ui, humanCheckRequired) {
    const PREFERENCE_KEY = 'alerts:human-check-sound';
    const REMINDER_MS = 60000;
    let enabled = true;
    let context = null;
    let reminder = null;
    let required = false;
    let alive = true;
    let lastChimeAt = null;
    let audioIssue = '';
    let preferenceIssue = '';
    try {
      const stored = GM_getValue(PREFERENCE_KEY, true);
      if (typeof stored === 'boolean') enabled = stored;
    } catch (error) {
      preferenceIssue = `Could not read the sound setting: ${error.message}`;
    }

    function showStatus() {
      if (!alive) return;
      const issues = [preferenceIssue, audioIssue].filter(Boolean).join(' ');
      ui.soundStatus.textContent = issues || (!enabled ? 'Human-check sounds muted.'
        : context?.state !== 'running' ? 'Click Test sound or Start to enable audio on this page.'
        : required && lastChimeAt !== null ? `Last chime: ${new Date(lastChimeAt).toLocaleTimeString()}. Repeats every minute.`
        : 'Sound ready. Human-check reminders repeat every minute.');
      ui.soundStatus.hidden = !issues;
    }

    function getContext() {
      if (context && context.state !== 'closed') return context;
      try {
        if (!window.AudioContext) throw new Error('Audio is unavailable in this browser.');
        context = new AudioContext();
        context.addEventListener('statechange', showStatus);
        audioIssue = '';
        return context;
      } catch (error) {
        audioIssue = `Could not initialize sound: ${error.message}`;
        showStatus();
        return null;
      }
    }

    async function prepareAudio() {
      if (!alive) return false;
      const audio = getContext();
      if (!audio) return false;
      showStatus();
      try {
        if (audio.state !== 'running') await audio.resume();
        if (!alive || audio !== context) return false;
        audioIssue = '';
        showStatus();
        return audio.state === 'running';
      } catch (error) {
        audioIssue = `Could not enable sound: ${error.message}. Try Test sound again.`;
        showStatus();
        return false;
      }
    }

    function chime() {
      if (!alive) return;
      const audio = getContext();
      if (!audio || audio.state !== 'running') {
        showStatus();
        return;
      }
      try {
        for (const [index, frequency] of [880, 1108, 1320].entries()) {
          const at = audio.currentTime + index * 0.24;
          const oscillator = audio.createOscillator();
          const gain = audio.createGain();
          oscillator.type = 'sine';
          oscillator.frequency.setValueAtTime(frequency, at);
          gain.gain.setValueAtTime(0.0001, at);
          gain.gain.exponentialRampToValueAtTime(0.16, at + 0.015);
          gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.2);
          oscillator.connect(gain);
          gain.connect(audio.destination);
          oscillator.addEventListener('ended', () => { oscillator.disconnect(); gain.disconnect(); }, { once: true });
          oscillator.start(at);
          oscillator.stop(at + 0.21);
        }
        audioIssue = '';
        lastChimeAt = Date.now();
      } catch (error) {
        audioIssue = `Could not play the alert: ${error.message}`;
      }
      showStatus();
    }

    function cancelReminder() {
      clearTimeout(reminder);
      reminder = null;
    }

    function scheduleReminder() {
      cancelReminder();
      if (!alive || !enabled || !required) return;
      reminder = setTimeout(() => {
        reminder = null;
        update(humanCheckRequired());
        if (alive && enabled && required) {
          chime();
          scheduleReminder();
        }
      }, REMINDER_MS);
    }

    function update(needsCheck) {
      if (!alive || needsCheck === required) return;
      required = needsCheck;
      lastChimeAt = null;
      cancelReminder();
      if (alive && enabled && required) {
        chime();
        scheduleReminder();
      }
      showStatus();
    }

    // Sound controls stay usable while the activity is paused or awaiting verification.
    ui.alertSound.addEventListener('change', async () => {
      enabled = ui.alertSound.checked;
      cancelReminder();
      try {
        GM_setValue(PREFERENCE_KEY, enabled);
        preferenceIssue = '';
      } catch (error) {
        preferenceIssue = `Could not save the sound setting: ${error.message}. This change applies only to this page.`;
      }
      showStatus();
      if (enabled && await prepareAudio() && required && alive && enabled) chime();
      scheduleReminder();
    });
    ui.testSound.addEventListener('click', async () => {
      if (await prepareAudio()) chime();
      if (alive && required && enabled) scheduleReminder();
    });
    ui.alertSound.checked = enabled;
    showStatus();
    return {
      update,
      async arm() {
        if (!enabled || !await prepareAudio()) return;
        if (alive && required && enabled && lastChimeAt === null) {
          chime();
          scheduleReminder();
        }
      },
      dispose() {
        alive = false;
        required = false;
        lastChimeAt = null;
        cancelReminder();
        const audio = context;
        context = null;
        if (audio && audio.state !== 'closed') void audio.close().catch(error => {
          console.error('[DankScape Assistant] Could not close alert audio:', error);
        });
      },
      reactivate() { alive = true; showStatus(); },
    };
  }

  function boot() {
    if (!document.body) return;
    if (restorePanel) {
      restorePanel();
      return;
    }
    document.getElementById(PANEL_ID)?.remove();
    try {
      restorePanel = initialize();
    } catch (error) {
      console.error('[DankScape Assistant] Startup failed:', error);
      const host = document.getElementById(PANEL_ID) || element('div', { id: PANEL_ID });
      const surface = host.shadowRoot || host;
      const details = element('section', { role: 'alert' }, [
        element('strong', {}, `DankScape Assistant v${VERSION}`),
        element('p', {}, `Startup failed: ${error.message}. No automation started.`),
        element('button', { type: 'button' }, 'Retry startup'),
      ]);
      details.style.cssText = 'background:#17211f;color:#f0e9d9;border:1px solid #617267;padding:16px;font:14px/1.45 system-ui';
      details.querySelector('button').addEventListener('click', boot);
      surface.replaceChildren(details);
      positionPanel(host);
      document.documentElement.appendChild(host);
    }
  }

  if (typeof GM_registerMenuCommand === 'function') {
    try {
      GM_registerMenuCommand('Show DankScape Assistant', boot);
    } catch (error) {
      console.error('[DankScape Assistant] Could not register the panel menu:', error);
    }
  }
  document.addEventListener('keydown', event => {
    if (!event.repeat && event.altKey && event.shiftKey && event.code === 'KeyP') {
      event.preventDefault();
      boot();
    }
  });
  if (document.body) boot();
  else document.addEventListener('DOMContentLoaded', boot, { once: true });

  function initialize() {
    const LOCK_NAME = 'dankscape-gather-assistant:v1';
    const RESPONSE_TIMEOUT_MS = 30000;
    const RECOVERY_FETCH_TIMEOUT_MS = 10000;
    const MAX_RECOVERY_CHECKS = 2;
    const MAX_RECOVERY_RELOADS = 2;
    const POLL_MS = 100;
    const SETTINGS_KEY = 'settings:shared';
    const POTION_CATALOG_KEY = 'potions:catalog';
    const CHECKPOINT_KEY = 'dankscape-assistant:verification-checkpoint:v1';
    const QUEST_KEY = 'dankscape-assistant:quest-queue:v1';
    const MISSING_QUEST_REASON = 'No longer listed on the quest board; completion unconfirmed.';
    const SKILLS = new Set(['mining', 'woodcutting', 'fishing', 'herblore']);
    const POTION_STATS = { combat: 'Combat', attack: 'Attack', strength: 'Strength', defense: 'Defence', ranged: 'Ranged', magic: 'Magic' };
    const COMBAT_STATS = ['attack', 'strength', 'defense'];
    const DIARY_TIERS = ['Easy', 'Medium', 'Hard', 'Extreme', 'Legendary', 'Insane'];
    const TASK_BOARDS = { quest: '/quests.php', slayer: '/slayer.php', diary: '/diaries.php' };
    const NUMBER_SETTINGS = {
      interval: { label: 'Delay after result (s)', value: 0.1, min: 0.1, max: 3600, step: 0.1 },
      reserve: { label: 'Keep this much energy', value: 0, min: 0, max: 1000000 },
      actions: { label: 'Maximum actions', value: 100, min: 1, max: 1000000 },
      minutes: { label: 'Maximum minutes', value: 30, min: 1, max: 1440 },
      meals: { label: 'Maximum food items per run', value: 100, min: 1, max: 1000000 },
      battles: { label: 'Maximum arena wins', value: 100, min: 1, max: 1000000, modes: ['arena', 'quest', 'slayer', 'diary'] },
      quests: { label: 'Maximum quests', value: 20, min: 1, max: 1000, modes: ['quest'], optional: true },
      drinks: { label: 'Maximum potions per run', value: 100, min: 1, max: 1000000, modes: ['arena', 'raid', 'quest', 'slayer', 'diary'], optional: true },
      maxRaids: { label: 'Maximum raids', value: 1, min: 1, max: 1000000, modes: ['raid'], optional: true },
    };
    const CHECK_SETTINGS = ['autoEat', 'autoHeal', 'autoRecover', 'wait'];
    const DEFAULTS = { target: '', ...Object.fromEntries(Object.entries(NUMBER_SETTINGS).map(([id, setting]) => [id, setting.value])),
      autoEat: true, autoHeal: true, autoRecover: true, food: '', wait: false, potions: [], diaryTier: 'Easy' };

    const mode = { '/gather.php': 'gather', '/arena.php': 'arena', '/raid.php': 'raid', '/quests.php': 'quest', '/slayer.php': 'slayer', '/diaries.php': 'diary' }[location.pathname] || 'hall';
    const onTaskBoard = Object.hasOwn(TASK_BOARDS, mode);
    const skill = new URLSearchParams(location.search).get('skill') || 'mining';
    const settingsKey = `settings:${mode === 'gather' ? skill : mode}`;
    let run = null;
    let pending = null;
    let timer = null;
    let releaseLock = null;
    let starting = false;
    let generation = 0;
    let ownSubmit = false;
    let submitted = false;
    let checkpoint = null;
    let checkpointError = '';
    let restoring = false;
    let restoreDeadline = 0;
    let ownNavigation = false;
    let checkSounds = null;
    let responseRecovery = null;
    let serverGuardLink = null;
    let questQueue = null;
    let questError = '';
    let questNavigationDeadline = 0;
    let questRead = null;
    let gatherCatalog = null;
    let potionCatalog = [];
    let potionRead = null;
    let taskHero = '';
    let staleTaskBoard = false;
    let verificationTimer = null;
    let openingVerification = false;
    let message = 'Ready. Choose a target and press Start.';

    const host = document.createElement('div');
    host.id = PANEL_ID;
    const root = host.attachShadow({ mode: 'open' });
    const panelStyles = `
        :host { all: initial; position: fixed; right: 16px; bottom: 16px; z-index: 2147483646;
          width: min(340px, calc(100vw - 32px)); color: #f0e9d9; font: 14px/1.45 system-ui, sans-serif; }
        * { box-sizing: border-box; }
        section { background: #17211f; border: 1px solid #617267; border-radius: 12px; box-shadow: 0 6px 30px #0008;
          display: flex; flex-direction: column; max-height: calc(100vh - 32px); }
        header { display: flex; flex-shrink: 0; align-items: center; justify-content: space-between; padding: 12px 14px; cursor: move; touch-action: none; user-select: none; }
        #move { cursor: move; padding: 1px 5px; margin-right: 6px; } header h2 { flex: 1; }
        h2 { font-size: 16px; margin: 0; } h2 small { font-size: 11px; color: #b8c6ba; } button, input, select { font: inherit; }
        button { cursor: pointer; border: 1px solid #7f9186; border-radius: 6px; padding: 7px 11px;
          color: #f0e9d9; background: #2d4138; } button:disabled { opacity: .5; cursor: default; }
        button:focus-visible, input:focus-visible, select:focus-visible, a:focus-visible { outline: 2px solid #f5cb79; outline-offset: 2px; }
        #start { background: #365e45; } #stop { background: #713d39; }
        #collapse { padding: 1px 8px; } #controls { padding: 0 14px 12px; min-height: 0; max-height: 50vh; overflow-y: auto; }
        label { display: block; margin: 8px 0; } input[type=number], select { display: block; width: 100%;
          margin-top: 4px; padding: 5px 7px; background: #0c1613; color: #f0e9d9; border: 1px solid #617267; border-radius: 4px; }
        .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 0 12px; }
        details { border-top: 1px solid #41544a; padding: 7px 0; } summary { cursor: pointer; color: #d5dfd6; }
        .sound-controls { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; margin-bottom: 6px; }
        .sound-controls label { margin: 3px 0; font-size: 12px; } .sound-controls button { padding: 3px 7px; font-size: 12px; }
        #soundStatus { width: 100%; }
        .check { display: flex; gap: 8px; align-items: flex-start; } .check input { margin-top: 4px; }
        footer { padding: 0 14px 14px; flex-shrink: 0; } #status { margin: 0 0 8px; overflow-wrap: anywhere; }
        #stats, .hint { color: #b8c6ba; font-size: 12px; } #stats { margin: 0 0 10px; }
        #quest-info { max-height: 8em; overflow-y: auto; overflow-wrap: anywhere; }
        .buttons { display: flex; flex-wrap: wrap; gap: 8px; } a { color: #f5cb79; } .hint { margin: 10px 0 0; }
        #recovery { border-top: 1px solid #617267; padding-top: 10px; margin-bottom: 12px; }
        #recovery-info { margin: 0 0 8px; overflow-wrap: anywhere; }
        [hidden] { display: none !important; }
      `;
    function numberSetting(id) {
      const { label, min, max, step = 1 } = NUMBER_SETTINGS[id];
      return element('label', {}, [label, element('input', { id, type: 'number', min, max, step, required: '' })]);
    }
    function checkSetting(label, id) {
      return element('label', { class: 'check' }, [element('input', { id, type: 'checkbox' }), label]);
    }
    // Build DOM directly: HTML-string sinks can throw under Trusted Types enforcement.
    root.appendChild(element('style', {}, panelStyles));
    const battleSettings = numberSetting('battles');
    battleSettings.id = 'battle-settings';
    battleSettings.hidden = true;
    root.appendChild(element('section', { 'aria-label': 'DankScape automation' }, [
      element('header', {}, [
        element('button', { id: 'move', type: 'button', 'aria-label': 'Move Assistant', title: 'Drag to move. Arrow keys move; Home resets.' }, '⠿'),
        element('h2', {}, ['DankScape Assistant ', element('small', {}, `v${VERSION}`)]),
        element('button', { id: 'collapse', type: 'button', 'aria-label': 'Minimize panel', 'aria-expanded': 'true' }, '−'),
      ]),
      element('div', { id: 'controls' }, [
        element('p', {}, [element('a', { href: '/gather.php' }, 'Gathering'), ' · ',
          element('a', { href: '/arena.php' }, 'Combat'), ' · ', element('a', { href: '/raid.php' }, 'Raids'),
          ' · ', element('a', { href: '/quests.php' }, 'Quests'), ' · ', element('a', { href: '/slayer.php' }, 'Slayer'),
          ' · ', element('a', { href: '/diaries.php' }, 'Diaries')]),
        element('label', {}, [element('span', { id: 'target-label' }, 'Resource'), element('select', { id: 'target', 'aria-label': 'Resource' })]),
        element('div', { id: 'diary-settings', hidden: '' }, [element('label', {}, ['Diary tier',
          element('select', { id: 'diary-tier', 'aria-label': 'Diary tier' }, DIARY_TIERS.map(tier => element('option', { value: tier }, tier)))])]),
        element('details', { id: 'limits-settings' }, [element('summary', {}, 'Run limits'),
          element('div', { class: 'grid' }, ['interval', 'reserve', 'actions', 'minutes'].map(numberSetting)), battleSettings,
          element('div', { id: 'quest-settings', hidden: '' }, [numberSetting('quests')]),
          element('div', { id: 'raid-settings', hidden: '' }, [numberSetting('maxRaids')])]),
        element('details', { id: 'food-settings' }, [element('summary', {}, 'Food & healing'),
          checkSetting('Heal immediately whenever HP is below full', 'autoHeal'),
          checkSetting('Automatically eat when energy is too low to act', 'autoEat'),
          element('label', {}, ['Food', element('select', { id: 'food', 'aria-label': 'Food' })]), numberSetting('meals')]),
        element('details', { id: 'potion-settings', hidden: '' }, [element('summary', {}, 'Potions'),
          element('div', { class: 'grid' }, Object.entries(POTION_STATS).map(([stat, label]) => element('label', {}, [label,
            element('select', { id: `potion-${stat}`, 'aria-label': `${label} potion`, title: stat === 'combat'
              ? 'Covers Attack, Strength and Defence; takes priority over their individual potions.' : '' })]))),
          numberSetting('drinks'),
          element('button', { id: 'load-potions', type: 'button', hidden: '' }, 'Load potion choices from Combat'),
          element('p', { id: 'potion-info', class: 'hint', role: 'status' }),
        ]),
        element('details', {}, [element('summary', {}, 'Recovery'),
          checkSetting('Wait for regeneration when food recovery is unavailable', 'wait'),
          checkSetting('Automatically recover stalled responses', 'autoRecover')]),
      ]),
      element('footer', {}, [
        element('div', { id: 'quest-progress', hidden: '' }, [
          element('p', { id: 'quest-info', class: 'hint' }),
          element('div', { class: 'buttons' }, [element('button', { id: 'quest-resume', type: 'button' }, 'Resume quests'),
            element('button', { id: 'quest-discard', type: 'button' }, 'Discard quest queue')]),
          element('a', { id: 'quest-navigation', hidden: '' }),
        ]),
        element('div', { id: 'recovery', hidden: '' }, [
          element('p', { id: 'recovery-info' }),
          element('p', {}, [element('a', { id: 'verify-link', hidden: '' }, 'Open the game’s human check')]),
          element('div', { class: 'buttons' }, [
            element('button', { id: 'resume', type: 'button' }, 'Restore & resume'),
            element('button', { id: 'discard', type: 'button' }, 'Discard saved run'),
          ]),
          element('a', { id: 'return-activity', hidden: '' }, 'Return to saved activity'),
        ]),
        element('div', { class: 'sound-controls' }, [
          checkSetting('Sound for human checks', 'alertSound'),
          element('button', { id: 'testSound', type: 'button' }, 'Test sound'),
          element('p', { id: 'soundStatus', class: 'hint', role: 'status', 'aria-live': 'polite' }),
        ]),
        element('p', { id: 'status', role: 'status', 'aria-live': 'polite' }),
        element('p', { id: 'stats' }),
        element('div', { class: 'buttons' }, [element('button', { id: 'start', type: 'button' }, 'Start'),
          element('button', { id: 'stop', type: 'button', disabled: '' }, 'Stop')]),
      ]),
    ]));
    // Keep the panel outside the game's body/content replacement targets.
    document.documentElement.appendChild(host);
    const ui = Object.fromEntries(Array.from(root.querySelectorAll('[id]'), element => [element.id, element]));
    try {
      const savedPosition = GM_getValue(POSITION_KEY, null);
      if (savedPosition && Number.isFinite(savedPosition.x) && Number.isFinite(savedPosition.y)) panelPosition = savedPosition;
    } catch (error) { message = `Could not load panel position: ${error.message}`; }
    positionPanel(host);
    const header = root.querySelector('header');
    let drag = null;
    function savePanelPosition() {
      try { GM_setValue(POSITION_KEY, panelPosition); }
      catch (error) { status(`Could not save panel position: ${error.message}`); }
    }
    header.addEventListener('pointerdown', event => {
      if (drag || event.isPrimary === false || event.button !== 0 || (event.target.closest('button') && event.target !== ui.move)) return;
      if (event.target === ui.move) ui.move.focus();
      const bounds = host.getBoundingClientRect();
      drag = { id: event.pointerId, x: event.clientX, y: event.clientY, left: bounds.left, top: bounds.top };
      header.setPointerCapture(event.pointerId);
      event.preventDefault();
    });
    header.addEventListener('pointermove', event => {
      if (!drag || event.pointerId !== drag.id) return;
      panelPosition = { x: drag.left + event.clientX - drag.x, y: drag.top + event.clientY - drag.y };
      positionPanel(host);
    });
    function endDrag(event) {
      if (!drag || event.pointerId !== drag.id) return;
      drag = null;
      if (header.hasPointerCapture(event.pointerId)) header.releasePointerCapture(event.pointerId);
      savePanelPosition();
    }
    header.addEventListener('pointerup', endDrag);
    header.addEventListener('pointercancel', endDrag);
    header.addEventListener('lostpointercapture', endDrag);
    ui.move.addEventListener('keydown', event => {
      const directions = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
      if (event.key !== 'Home' && !directions[event.key]) return;
      event.preventDefault();
      if (event.key === 'Home') panelPosition = null;
      else {
        const bounds = host.getBoundingClientRect();
        const [x, y] = directions[event.key];
        const step = event.shiftKey ? 50 : 10;
        panelPosition = { x: bounds.left + x * step, y: bounds.top + y * step };
      }
      positionPanel(host);
      savePanelPosition();
    });
    window.addEventListener('resize', () => positionPanel(host));

    function isShown(node) {
      for (let current = node; current instanceof Element; current = current.parentElement) {
        const style = getComputedStyle(current);
        if (current.hidden || style.display === 'none' || style.visibility === 'hidden') return false;
      }
      return true;
    }

    function guardURL(link) {
      try {
        const url = new URL(link.getAttribute('href'), location.href);
        return url.origin === location.origin && url.pathname === '/guard.php' ? url : null;
      } catch {
        return null;
      }
    }

    function humanCheck() {
      // Mutation delivery can finish while the document is being torn down.
      if (!document?.documentElement) return { required: false, link: null };
      const link = humanCheckLink();
      const notice = Array.from(document.querySelectorAll('#flash-stack .flash:not(.flash-ok)'))
        .some(node => /quick check needed|confirm you are human|human (?:check|verification)/i.test(node.textContent));
      return { required: location.pathname === '/guard.php' || Boolean(link || serverGuardLink) || notice, link: link || serverGuardLink };
    }

    function humanCheckLink(page = document) {
      return Array.from(page.querySelectorAll('a[href*="guard.php"]'))
        .find(node => guardURL(node) && (page !== document || isShown(node)));
    }

    function verificationReturnPath() {
      const link = humanCheck().link;
      const url = location.pathname === '/guard.php' ? new URL(location.href) : link && guardURL(link);
      const from = url?.searchParams.get('from') || '';
      return /^[a-z][a-z0-9_-]{0,49}$/.test(from) ? `/${from}.php` : null;
    }

    function validVerificationIntent(value) {
      return value === undefined || value === false || Boolean(value && typeof value.visited === 'boolean'
        && /^\/[a-z][a-z0-9_-]{0,49}\.php$/.test(value.returnPath));
    }

    function scheduleVerification() {
      if (verificationTimer !== null) return;
      // Let the native response handler count or reject the pending action first.
      verificationTimer = setTimeout(() => { verificationTimer = null; handleVerification(); }, 0);
    }

    function handleVerification() {
      if (!document?.documentElement) return;
      const guard = humanCheck();
      const saved = questQueue || checkpoint;
      const save = questQueue ? saveQuestQueue : writeCheckpoint;
      if (location.pathname === '/guard.php') {
        const intent = saved?.verification;
        const returnPath = verificationReturnPath();
        if (!saved || questError || checkpointError || intent === false || !returnPath) return;
        // Adopt confirmed pre-update runs already waiting at the challenge.
        // Explicitly stopped runs and uncertain actions cannot authorize restart.
        const uncertain = questQueue ? questQueue.uncertain || questQueue.command : !checkpoint.canResume;
        if (!intent && (uncertain || Date.now() >= saved.deadline)) return;
        if (intent && intent.returnPath !== returnPath) return stop('The verification return page changed. Inspect the saved run before resuming.');
        if (!intent || !intent.visited) {
          saved.verification = { returnPath, visited: true };
          if (!save()) return stop(questError || checkpointError);
        }
        status(uncertain ? 'Complete verification yourself. The unconfirmed action still needs inspection before resuming.'
          : 'Complete the game’s verification yourself. The saved run will resume after the game returns.');
        return;
      }
      if (guard.required) {
        if (openingVerification || ownNavigation || pending || questError || checkpointError || !guard.link) return;
        const url = guardURL(guard.link);
        if (!url) return;
        pauseForVerification();
        if (questError || checkpointError) return;
        openingVerification = true;
        ownNavigation = true;
        ui['verify-link'].href = url.href;
        ui['verify-link'].target = '_self';
        ui['verify-link'].click();
        return;
      }
      const intent = saved?.verification;
      if (!intent || !intent.visited || intent.returnPath !== location.pathname
        || starting || run?.active || pending || ownNavigation || questError || checkpointError) return;
      // Consume the handoff before acquiring the lock or travelling. A failed
      // resume must not become an automatic retry on every DOM update.
      saved.verification = false;
      if (!save()) return stop(questError || checkpointError);
      if (questQueue) return void startQuestQueue(true);
      if (!checkpoint.canResume) return status('The saved activity’s last action is unconfirmed. Inspect its result before resuming.');
      if (Date.now() >= checkpoint.deadline) return status('The saved activity’s original time limit expired. Restore it or discard it before starting a new run.');
      void restoreSavedRun();
    }

    function characterName(page = document) {
      return page.querySelector('aside.sidebar h2')?.textContent.trim()
        || (page.querySelector('section.content h1')?.textContent.trim() === 'Quest Board'
          ? page.querySelector('section.content .card p.dim strong')?.textContent.trim() : '')
        || (page === document && ['slayer', 'diary'].includes(mode) ? taskHero : '') || '';
    }
    function arenaZone(page = document) { return page.querySelector('section.content h1')?.textContent.trim() || ''; }

    function validRunConfig(config) {
      if (!config || typeof config.target !== 'string' || !config.target || config.target.length > 200) return false;
      for (const [key, { min, max, optional }] of Object.entries(NUMBER_SETTINGS)) {
        // Older saved runs omit settings introduced after their version.
        if (optional && config[key] === undefined) continue;
        if (!Number.isFinite(config[key]) || config[key] < min || config[key] > max
          || (key !== 'interval' && !Number.isSafeInteger(config[key]))) return false;
      }
      if (!['autoEat', 'autoHeal', 'wait'].every(key => typeof config[key] === 'boolean')
        || typeof config.food !== 'string' || config.food.length > 200) return false;
      if (config.autoRecover !== undefined && typeof config.autoRecover !== 'boolean') return false;
      if (config.diaryTier !== undefined && !DIARY_TIERS.includes(config.diaryTier)) return false;
      if (config.potions !== undefined && (!Array.isArray(config.potions) || config.potions.length > Object.keys(POTION_STATS).length
        || !config.potions.every(potion => potion && Object.hasOwn(POTION_STATS, potion.stat)
          && typeof potion.name === 'string' && potion.name.length > 0 && potion.name.length <= 200)
        || new Set(config.potions.map(potion => potion.stat)).size !== config.potions.length)) return false;
      return true;
    }

    function validRunProgress(value) {
      if (value.raidsCompleted !== undefined && (!Number.isSafeInteger(value.raidsCompleted) || value.raidsCompleted < 0 || value.raidsCompleted > 1000000)) return false;
      if (value.drunk !== undefined && (!Number.isSafeInteger(value.drunk) || value.drunk < 0 || value.drunk > 1000000)) return false;
      if (value.recoveries !== undefined && (!Number.isSafeInteger(value.recoveries)
        || value.recoveries < 0 || value.recoveries > MAX_RECOVERY_RELOADS)) return false;
      return ['completed', 'eaten', 'wins'].every(key => Number.isSafeInteger(value[key]) && value[key] >= 0 && value[key] <= 1000000)
        && Number.isFinite(value.deadline) && value.deadline >= 0 && Number.isFinite(value.nextAt) && value.nextAt >= 0;
    }

    function runProgress(value) {
      return Object.fromEntries(['completed', 'eaten', 'wins', 'drunk', 'nextAt', 'recoveries'].map(key => [key, value?.[key] || 0]));
    }

    function validCheckpoint(value) {
      if (!value || value.version !== 1 || !['gather', 'arena', 'raid'].includes(value.mode)
        || !validRunConfig(value.config) || !validRunProgress(value) || !validVerificationIntent(value.verification)) return false;
      if (value.raidPhase !== undefined && (value.mode !== 'raid' || !['catalog', 'summon'].includes(value.raidPhase))) return false;
      if (!Number.isSafeInteger(value.steps) || value.steps < 0 || value.steps > 1000000
        || !['canResume', 'restoreRequested'].every(key => typeof value[key] === 'boolean')) return false;
      if (!['targetName', 'character', 'zone', 'finishReason'].every(key => typeof value[key] === 'string' && value[key].length <= 500)) return false;
      return (value.mode !== 'gather' || SKILLS.has(value.skill))
        && (value.mode !== 'arena' || Boolean(value.zone))
        && (value.mode !== 'raid' || /^\d{1,30}$/.test(value.raidId));
    }

    function readCheckpoint() {
      try {
        const text = sessionStorage.getItem(CHECKPOINT_KEY);
        if (!text) return null;
        const value = JSON.parse(text);
        if (!validCheckpoint(value)) throw new Error('Saved activity data is invalid. Discard it before starting a new run.');
        return value;
      } catch (error) {
        checkpointError = `Could not read the saved activity: ${error.message}`;
        return null;
      }
    }

    function writeCheckpoint() {
      try {
        if (checkpoint) sessionStorage.setItem(CHECKPOINT_KEY, JSON.stringify(checkpoint));
        else sessionStorage.removeItem(CHECKPOINT_KEY);
        checkpointError = '';
        return true;
      } catch (error) {
        checkpointError = `Could not save the activity for recovery: ${error.message}`;
        return false;
      }
    }

    function clearCheckpoint() {
      const previous = checkpoint;
      if (previous) {
        previous.restoreRequested = false;
        previous.verification = false;
        writeCheckpoint();
      }
      checkpoint = null;
      if (writeCheckpoint()) return true;
      checkpoint = previous;
      return false;
    }

    function checkpointURL(value) {
      const url = new URL(`/${value.mode}.php`, location.origin);
      if (value.mode === 'gather') url.searchParams.set('skill', value.skill);
      if (value.mode === 'raid' && value.raidPhase !== 'catalog') url.searchParams.set('id', value.raidId);
      return url.href;
    }

    function rememberActivity() {
      if (!['gather', 'arena', 'raid'].includes(mode)) return false;
      const config = run?.config || settingsFromUI();
      if (!config || !config.target) return false;
      const selected = targets().find(target => target.key === config.target);
      checkpoint = { version: 1, mode, skill, config: { ...config },
        ...runProgress(run),
        targetName: selected?.name || config.target, character: characterName(), zone: mode === 'arena' ? arenaZone() : '',
        raidId: run?.raidId || raidState()?.id || '', raidsCompleted: run?.raidsCompleted || 0,
        deadline: run?.deadline ?? Date.now() + config.minutes * 60000, finishReason: run?.finishReason || '',
        canResume: !pending, restoreRequested: false, verification: false, steps: 0 };
      if (!validCheckpoint(checkpoint)) {
        checkpoint = null;
        checkpointError = 'Could not identify the exact activity. Return to it manually after verification.';
        return false;
      }
      return writeCheckpoint();
    }

    function pauseForVerification() {
      if (questQueue) {
        const returnPath = verificationReturnPath();
        if (questQueue.active && returnPath && !questQueue.verification) {
          questQueue.verification = { returnPath, visited: location.pathname === '/guard.php' };
        }
        stop('Human verification required. Complete the game’s check yourself; the saved task will be checked for automatic resume after returning.', { preserveVerification: true });
        scheduleVerification();
        return;
      }
      const intent = checkpoint?.verification;
      const resumeAfterCheck = run?.active || restoring || checkpoint?.restoreRequested;
      if (checkpoint?.restoreRequested) {
        checkpoint.restoreRequested = false;
        if (pending) checkpoint.canResume = false;
        writeCheckpoint();
      } else if (run && checkpoint) {
        Object.assign(checkpoint, runProgress(run), { canResume: !pending });
        writeCheckpoint();
      } else if (!checkpoint) rememberActivity();
      const returnPath = verificationReturnPath();
      if (checkpoint && returnPath) {
        checkpoint.verification = intent || (resumeAfterCheck ? { returnPath, visited: location.pathname === '/guard.php' } : false);
        writeCheckpoint();
      }
      restoring = false;
      stop(checkpointError || 'Human verification required. Complete the game’s check yourself; the saved activity will be checked for automatic resume after returning.', { preserveVerification: true });
      scheduleVerification();
    }

    function numberFrom(text) {
      const value = String(text).trim().replaceAll(',', '').match(/^[−-]?\s*(\d+)$/);
      const number = value ? Number(value[1]) : NaN;
      return Number.isSafeInteger(number) ? number : null;
    }

    function parseMeter(text) {
      const match = String(text).replaceAll(',', '').match(/^\s*(\d+)\s*\/\s*(\d+)\s*(?:HP)?\s*$/);
      if (!match) return null;
      const current = Number(match[1]);
      const maximum = Number(match[2]);
      return Number.isSafeInteger(current) && Number.isSafeInteger(maximum) && maximum > 0 && current <= maximum ? { current, maximum } : null;
    }

    function meter(selector, page = document) { return parseMeter(page.querySelector(selector)?.textContent ?? ''); }
    function energy(page = document) { return meter('#hud-energy', page); }
    function health(page = document) { return meter('aside.sidebar .hp-bar .hp-text', page); }

    function arenaState(page = document) {
      const stage = page.querySelector('section.content .fight-stage');
      const button = stage?.querySelector('button[data-label="Strike!"]');
      const heading = stage?.querySelector('h2')?.textContent.trim() || '';
      const name = heading.match(/Combat:\s*(.+)$/)?.[1]?.trim() || '';
      const log = stage?.querySelector('.combat-log')?.textContent.trim() || '';
      return { name, log, form: button?.closest('form'), button, active: Boolean(button), victory: !button && /\bYou slay\b/i.test(log) };
    }

    function raidState(page = document) {
      const hpRow = Array.from(page.querySelectorAll('section.content .stat-row'))
        .find(row => row.querySelector('span')?.textContent.trim() === 'Boss HP');
      if (!hpRow) return null;
      const card = hpRow.closest('.card');
      const heading = card?.querySelector('h2');
      const name = Array.from(heading?.childNodes || []).filter(node => node.nodeType === Node.TEXT_NODE)
        .map(node => node.textContent).join('').trim();
      const hp = parseMeter(hpRow.querySelector('strong')?.textContent ?? '');
      const button = card?.querySelector('button[data-label="Attack the boss!"]');
      const form = button?.closest('form');
      const id = form?.querySelector('input[name="raid_id"]')?.value || new URLSearchParams(location.search).get('id');
      const state = heading?.querySelector('span')?.textContent.trim().toLowerCase() || '';
      return { name, id, hp: hp?.current ?? null, form, button, state };
    }

    function raidPersonalDamage(page = document) {
      const hero = characterName(page);
      const boards = Array.from(page.querySelectorAll('section.content .card'))
        .filter(card => card.querySelector('h3')?.textContent.trim() === 'Damage Board');
      if (!hero || boards.length !== 1) return null;
      const board = boards[0];
      const table = board.querySelector('table');
      if (!table) {
        const empty = Array.from(board.querySelectorAll('p')).some(node => node.textContent.trim() === 'No one has struck yet. Land the first hit!');
        return empty ? 0 : null;
      }
      const headings = Array.from(table.querySelectorAll('thead th'), node => node.textContent.trim().toLowerCase());
      if (headings.filter(label => label === 'hero').length !== 1 || headings.filter(label => label === 'damage').length !== 1) return null;
      const rows = Array.from(table.querySelectorAll('tbody tr'), row => Array.from(row.querySelectorAll('td')))
        .filter(cells => cells[headings.indexOf('hero')]?.textContent.trim() === hero);
      if (rows.length !== 1) return null;
      const text = rows[0][headings.indexOf('damage')]?.textContent.trim();
      return /^[\d,]+$/.test(text || '') ? numberFrom(text) : null;
    }

    function raidCatalogLink() {
      return Array.from(document.querySelectorAll('section.content a[href]')).find(link => {
        if (!/^(?:←\s*)?All raids$/i.test(link.textContent.trim())) return false;
        try {
          const url = new URL(link.getAttribute('href'), location.href);
          return url.origin === location.origin && url.pathname === '/raid.php' && !url.searchParams.has('id');
        } catch { return false; } // A malformed link cannot identify the raid catalogue.
      });
    }

    function raidSummonTarget(name) {
      const expected = name.replace(/\s+/g, ' ').toLowerCase();
      const heading = Array.from(document.querySelectorAll('section.content .card h3'))
        .find(heading => heading.textContent.trim().replace(/\s+/g, ' ').toLowerCase() === expected);
      const button = Array.from(heading?.closest('.card')?.querySelectorAll('form button[type="submit"]') || [])
        .find(button => button.textContent.trim().toLowerCase() === 'summon');
      return button ? { name, form: button.closest('form'), button } : null;
    }

    function gatheringTargets(page = document, activitySkill = skill) {
      if (!SKILLS.has(activitySkill)) return [];
      const level = numberFrom(page.querySelector('#hud-xp strong')?.textContent ?? '');
      return Array.from(page.querySelectorAll('section.content [data-fold-group] [data-fold]'))
        .filter(card => card.closest('[data-fold-group]').dataset.foldGroup === `gather-${activitySkill}`)
        .map(card => {
          const form = card.querySelector('form[data-ajax]');
          const button = form?.querySelector('button[type="submit"]');
          const row = Array.from(card.querySelectorAll('.stat-row')).find(item => item.querySelector('span')?.textContent.trim() === 'Energy');
          const cost = row ? numberFrom(row.querySelector('strong')?.textContent ?? '') : null;
          const requirement = card.querySelector('h3')?.textContent.match(/\bLv\s+(\d+)\s*\+/i);
          const available = Boolean(button) || (level !== null && requirement && level >= Number(requirement[1]));
          const item = Array.from(card.querySelectorAll('.stat-row')).find(row => row.querySelector('span')?.textContent.trim() === 'Yields')
            ?.querySelector('strong')?.textContent.trim() || '';
          return { key: card.dataset.fold, name: card.dataset.foldName || card.dataset.fold, form, button, cost, available, item };
        });
    }

    function targets() {
      if (mode === 'diary') return (diaryBoard()?.zones || []).map(zone => ({ key: zone.name, name: zone.name, available: !zone.locked }));
      if (mode === 'slayer') return [{ key: 'auto', name: 'Automatically repeat Slayer tasks', available: true }];
      if (mode === 'quest') return [{ key: 'auto', name: 'Automatically work through eligible quests', available: true }];
      if (mode === 'gather') return gatheringTargets();
      if (mode === 'arena') {
        const battle = arenaState();
        if (battle.active) return [{ key: battle.name, name: battle.name, available: Boolean(battle.name), cost: 0 }];
        return Array.from(document.querySelectorAll('section.content .foe')).map(foe => {
          const form = foe.querySelector('form[data-ajax]');
          const button = form?.querySelector('button[type="submit"]');
          const name = foe.querySelector('h4')?.textContent.trim() || '';
          return { key: name, name, form, button, available: Boolean(name && button), cost: 0 };
        });
      }
      if (mode === 'raid') {
        const boss = raidState();
        return boss ? [{ ...boss, key: boss.name, cost: 0, available: Boolean(boss.name && boss.id && boss.button) }] : [];
      }
      return [];
    }

    function questBoard(page = document) {
      const content = page.querySelector('section.content');
      const level = Number(content?.querySelector('.card')?.textContent.match(/combat level\s*(\d+)/i)?.[1]);
      const cards = [];
      const groups = new Map();
      let activeCount = null;
      for (const heading of content?.querySelectorAll('h2') || []) {
        const label = heading.textContent.trim();
        const group = label === 'Completed' ? 'Chronicled' : label;
        if (!['Active', 'Available', 'Chronicled'].includes(group)) continue;
        const row = heading.nextElementSibling;
        if (!row?.classList.contains('row')) continue;
        const entries = row.querySelectorAll(':scope > .card');
        if (group === 'Active') activeCount = entries.length;
        for (const card of entries) groups.set(card, group);
      }
      for (const card of content?.querySelectorAll('.card') || []) {
        const group = groups.get(card);
        // Match the card's status line, not completion prose or sidebar events.
        const completed = Array.from(card.children).some(node => node.matches('p, div, span')
          && !node.querySelector('a, button, form, input, select, textarea')
          && /^✓\s*Completed\.?$/.test(node.textContent.trim()));
        if (!group && !completed) continue;
        const title = card.querySelector(':scope > h3')?.cloneNode(true);
        const requiredLevel = Number(title?.textContent.match(/\bLvl\s+(\d+)\+/i)?.[1]);
        title?.querySelectorAll('.dim').forEach(node => node.remove());
        const name = title?.textContent.trim() || '';
        if (!name) continue;
        // A named completed card needs no eligibility or objective metadata.
        if (group === 'Chronicled' || completed) {
          cards.push({ name, group: 'Chronicled' });
          continue;
        }
        const stats = Object.fromEntries(Array.from(card.querySelectorAll('.stat-row'), stat =>
          [stat.querySelector('span')?.textContent.trim(), stat.querySelector('strong')?.textContent.trim()]));
        const goal = Number(stats.Goal?.replaceAll(',', '').match(/^(\d+) (?:kills|items)$/)?.[1]);
        const progressText = Array.from(card.querySelectorAll('p.dim')).map(node => node.textContent.trim())
          .find(text => /^\d[\d,]*\s*\//.test(text));
        const progress = progressText?.replaceAll(',', '').match(/^(\d+)\s*\/\s*(\d+)/);
        const buttons = Array.from(card.querySelectorAll('form button[type="submit"]'));
        const accept = buttons.find(button => button.textContent.trim() === 'Accept');
        const claim = buttons.find(button => /^(?:Claim(?: reward(?:s)?)?|Complete(?: quest)?|Turn in(?: items)?)$/i.test(button.textContent.trim()));
        const hunt = buttons.find(button => /Hunt in /i.test(button.textContent));
        let gather = null;
        let fight = null;
        for (const link of card.querySelectorAll('a[href]')) {
          let url;
          try { url = new URL(link.getAttribute('href'), location.href); }
          catch { continue; } // Malformed links cannot identify an activity route.
          if (url.origin !== location.origin) continue;
          if (url.pathname === '/gather.php' && SKILLS.has(url.searchParams.get('skill')) && url.searchParams.has('target')) gather = link;
          if (url.pathname === '/arena.php' && /^\d{1,30}$/.test(url.searchParams.get('target'))
            && /\bFight\s+/i.test(link.textContent) && link.textContent.replace(/^.*?\bFight\s+/i, '').trim() === stats.Target) fight = link;
        }
        if (!Number.isSafeInteger(goal) || goal < 1 || !Number.isSafeInteger(requiredLevel) || requiredLevel < 1) continue;
        cards.push({ name, group, requiredLevel, goal, kind: stats.Target ? 'kill' : 'collect', target: stats.Target || stats.Collect || '',
          progress: progress && Number(progress[2]) === goal ? Number(progress[1]) : null, accept, claim, hunt, gather, fight });
      }
      const slots = content?.querySelector('.card')?.textContent.match(/(\d+)\s*\/\s*(\d+) active/);
      return { level: Number.isSafeInteger(level) && level > 0 ? level : null, cards,
        activeReadable: Boolean(slots && activeCount === Number(slots[1])
          && cards.filter(card => card.group === 'Active').length === activeCount),
        capacity: slots ? Number(slots[2]) : null };
    }

    function slayerBoard(page = document) {
      const content = page.querySelector('section.content');
      if (content?.querySelector('h2')?.textContent.trim() !== '🗡️ The Slayer Master') return null;
      const row = Array.from(content.querySelectorAll('.stat-row')).find(row => row.querySelector('span')?.textContent.trim() === 'Tasks completed');
      const completed = numberFrom(row?.querySelector('strong')?.textContent || '');
      if (!Number.isSafeInteger(completed) || completed < 0) return null;
      const cards = Array.from(content.querySelectorAll(':scope > .card')).filter(card => card.querySelector(':scope > h3'));
      if (cards.length !== 1) return null;
      const card = cards[0];
      const title = card.querySelector('h3').cloneNode(true);
      title.querySelectorAll('.dim').forEach(node => node.remove());
      const buttons = Array.from(card.querySelectorAll('form button[type="submit"]'));
      const assign = buttons.find(button => button.textContent.trim() === 'Take a task');
      if (title.textContent.trim() === 'No active task') return assign ? { completed, task: null, assign } : null;
      const match = title.textContent.trim().match(/^Current task:\s*slay\s+([\d,]+)\s+(.+)$/i);
      const goal = numberFrom(match?.[1] || '');
      const target = match?.[2].trim();
      const line = Array.from(card.querySelectorAll('p')).find(node => /slain · found in /.test(node.textContent));
      const progress = line?.textContent.trim().match(/^([\d,]+)\s*\/\s*([\d,]+)\s+slain\s*·\s*found in (.+)\.$/);
      if (!target || target.length > 200 || !goal || !progress || numberFrom(progress[2]) !== goal || numberFrom(progress[1]) > goal) return null;
      const zone = progress[3].trim();
      const claim = buttons.find(button => button.textContent.replace(/^[^\p{L}]+/u, '').trim() === 'Claim reward');
      const hunt = buttons.find(button => button.textContent.split('Go hunt in ')[1]?.trim() === zone);
      const fight = Array.from(card.querySelectorAll('a[href]')).find(link => {
        let url;
        try { url = new URL(link.getAttribute('href'), location.href); }
        catch { return false; }
        const label = link.cloneNode(true);
        label.querySelectorAll('span').forEach(node => node.remove());
        return url.origin === location.origin && url.pathname === '/arena.php' && url.searchParams.get('from') === 'slayer'
          && /^\d{1,30}$/.test(url.searchParams.get('target')) && label.textContent.split('Fight ')[1]?.trim() === target;
      });
      return { completed, task: { target, goal, progress: numberFrom(progress[1]), zone, claim, hunt, fight } };
    }

    function diaryBoard(page = document) {
      const content = page.querySelector('section.content');
      if (!/^(?:📜\s*)?Zone Diaries$/.test(content?.querySelector('h2')?.textContent.trim() || '')) return null;
      const zones = [];
      for (const card of content.querySelectorAll(':scope > .card')) {
        const heading = card.querySelector(':scope > h3');
        if (!heading) continue;
        const title = heading.cloneNode(true);
        title.querySelectorAll('span').forEach(node => node.remove());
        const name = title.textContent.trim();
        const metadata = heading.querySelector('span')?.textContent.trim().match(/^Lv ([\d,]+)\+.*?·\s*([\d,]+) monsters$/i);
        if (!name || !metadata || zones.some(zone => zone.name === name)) return null;
        const expected = numberFrom(metadata[2]);
        const monsters = [];
        for (const count of heading.nextElementSibling?.children || []) {
          const match = count.textContent.trim().match(/^×\s*([\d,]+)$/);
          if (!match) continue;
          const control = count.previousElementSibling;
          const target = control?.textContent.trim();
          const kills = numberFrom(match[1]);
          if (!target || target.length > 200 || kills === null || monsters.some(mob => mob.name === target)) return null;
          monsters.push({ name: target, kills, link: control.matches('a.mob-link[href]') ? control : null,
            button: control.matches('button.mob-link[type="submit"]') ? control : null });
        }
        if (!expected || monsters.length !== expected) return null;
        const tiers = [];
        for (const requirements of card.querySelectorAll('ul.diary-reqs')) {
          const panel = requirements.parentElement;
          const tier = panel.querySelector('strong')?.textContent.trim();
          const lines = Array.from(requirements.querySelectorAll('li')).map(node => node.textContent.replace(/\s+/g, ' ').trim());
          const each = lines.map(line => line.match(/Kill every monster here (at least once|([\d,]+) times)\s*—\s*([\d,]+) of ([\d,]+) done/)).find(Boolean);
          const total = lines.map(line => line.match(/([\d,]+) kills here in total\s*—\s*([\d,]+) so far/)).find(Boolean);
          const perMonster = each && (each[1] === 'at least once' ? 1 : numberFrom(each[2]));
          if (!DIARY_TIERS.includes(tier) || tiers.some(entry => entry.name === tier) || !perMonster
            || numberFrom(each[4]) !== expected || lines.length !== (total ? 2 : 1)) return null;
          const minimumTotal = total ? numberFrom(total[1]) : 0;
          const totalKills = total ? numberFrom(total[2]) : 0;
          if (minimumTotal === null || totalKills === null) return null;
          const claimed = Array.from(panel.querySelectorAll('p, span, strong, button'))
            .some(node => /^(?:✓\s*)?Claimed(?:\s*✓)?[.!]?$/i.test(node.textContent.trim()));
          const claim = Array.from(panel.querySelectorAll('button[type="submit"], button:not([type])'))
            .find(button => /^Claim\b/i.test(button.textContent.replace(/^[^\p{L}]+/u, '').trim()));
          tiers.push({ name: tier, perMonster, minimumTotal, totalKills, claimed, claim,
            ready: monsters.every(mob => mob.kills >= perMonster) && totalKills >= minimumTotal });
        }
        if (tiers.length !== DIARY_TIERS.length) return null;
        zones.push({ name, locked: /\blocked\b/i.test(heading.textContent), monsters, tiers });
      }
      return zones.length ? { zones } : null;
    }

    function confirmDiaryCommand() {
      const command = questQueue.command;
      if (!command) return true;
      const zone = diaryBoard()?.zones.find(zone => zone.name === questQueue.config.target);
      if (!zone?.tiers.find(tier => tier.name === command.tier)?.claimed) return false;
      if (!questQueue.finished.includes(command.tier)) questQueue.finished.push(command.tier);
      questQueue.uncertain = false;
      questQueue.current = null;
      delete questQueue.command;
      questQueue.nextAt = Date.now() + questQueue.config.interval * 1000;
      return saveQuestQueue();
    }

    function tickDiaryBoard() {
      if (Date.now() < run.nextAt) { schedule(); return; }
      const zone = diaryBoard()?.zones.find(zone => zone.name === questQueue.config.target);
      if (!zone || zone.locked || !taskHero || taskHero !== questQueue.character) return stop('Cannot verify the selected diary area or active hero.');
      if (questQueue.command || questQueue.uncertain) return stop('The last diary request is unconfirmed. Inspect Diaries before resuming.');
      const tier = zone.tiers.find(tier => tier.name === questQueue.config.diaryTier);
      if (!tier) return stop('The selected diary tier is unavailable.');
      if (tier.claimed) return stop(`${zone.name}: ${tier.name} diary achieved.`);
      const current = questQueue.current;
      if (current && (!zone.monsters.some(mob => mob.name === current.target && mob.kills >= current.progress))) return stop('Diary kill counts went backwards or the target disappeared. Inspect Diaries.');
      const claim = zone.tiers.find(entry => DIARY_TIERS.indexOf(entry.name) <= DIARY_TIERS.indexOf(tier.name)
        && entry.ready && !entry.claimed && entry.claim && !entry.claim.disabled);
      if (claim) {
        const target = { form: claim.claim.form, button: claim.claim };
        if (!validForm(target, 'diary-claim')) return stop('The diary claim control changed. No request was sent.');
        questQueue.command = { kind: 'claim', tier: claim.name };
        questQueue.uncertain = true;
        return navigateQuest('board', target);
      }
      if (tier.ready) return stop(`${zone.name}: ${tier.name} requirements complete. Claim the reward using Diaries.`);
      const limit = questLimit();
      if (limit) return stop(limit);
      const mob = zone.monsters.find(mob => mob.kills < tier.perMonster)
        || (tier.totalKills < tier.minimumTotal && zone.monsters.find(mob => mob.link || mob.button));
      if (!mob) return stop('No verified monster can advance the selected diary.');
      questQueue.current = { name: `${zone.name} · ${tier.name}`, kind: 'kill', mode: 'arena', skill: '', target: mob.name,
        goal: Math.max(tier.perMonster, mob.kills + Math.max(0, tier.minimumTotal - tier.totalKills)),
        progress: mob.kills, zone: zone.name, stalled: 0, totalOnly: mob.kills >= tier.perMonster };
      // Finish individual requirements before allocating any extra area-total kills.
      if (mob.kills < tier.perMonster) questQueue.current.goal = tier.perMonster;
      if (!saveQuestQueue()) return stop(questError);
      if (mob.button) {
        const travel = { form: mob.button.form, button: mob.button };
        if (!validForm(travel, 'diary-travel')) return stop('The diary travel control is unavailable or changed.');
        return navigateQuest('activity', travel);
      }
      if (!mob.link || !diaryFightURL(mob.link)) return stop('The selected diary monster has no verified fighting route.');
      navigateQuest('activity', { link: mob.link });
    }

    function diaryFightURL(link) {
      try {
        const url = new URL(link.getAttribute('href'), location.href);
        return url.origin === location.origin && url.pathname === '/arena.php' && url.searchParams.get('from') === 'diary'
          && /^\d{1,30}$/.test(url.searchParams.get('target')) ? url : null;
      } catch { return null; }
    }

    async function identifyTaskHero() {
      const controller = new AbortController();
      questRead = controller;
      const timeout = setTimeout(() => controller.abort(), RECOVERY_FETCH_TIMEOUT_MS);
      status('Reading the active hero from Combat…');
      try {
        const page = await fetchQuestPage(new URL('/arena.php', location.origin), controller.signal);
        if (controller.signal.aborted) throw new Error('Hero lookup was cancelled.');
        const guard = humanCheckLink(page);
        if (guard) { serverGuardLink = guard; throw new Error('Complete the game’s human check manually before resuming.'); }
        const hero = characterName(page);
        if (!hero || !health(page) || health(page).current === 0) throw new Error('Cannot verify a living active hero in Combat.');
        return hero;
      } finally {
        clearTimeout(timeout);
        if (questRead === controller) questRead = null;
      }
    }

    function confirmSlayerCommand(board) {
      const command = questQueue.command;
      if (!command) return true;
      const confirmed = command.kind === 'assign'
        ? board.completed === command.before && Boolean(board.task)
        : board.completed === command.before + 1 && !board.task;
      if (!confirmed) return false;
      if (command.kind === 'claim') {
        questQueue.tasksCompleted += 1;
        questQueue.current = null;
      }
      questQueue.uncertain = false;
      delete questQueue.command;
      questQueue.nextAt = Date.now() + questQueue.config.interval * 1000;
      return saveQuestQueue();
    }

    function tickSlayerBoard() {
      if (Date.now() < run.nextAt) { schedule(); return; }
      const board = slayerBoard();
      if (!board || !taskHero || taskHero !== questQueue.character) return stop('Cannot verify the Slayer board or active hero.');
      if (questQueue.command || questQueue.uncertain) return stop('The last Slayer request is unconfirmed. Inspect the board before resuming.');
      const current = questQueue.current;
      if (current && (board.completed !== current.boardCompleted || !board.task || board.task.target !== current.target
        || board.task.goal !== current.goal || board.task.zone !== current.zone || board.task.progress < current.progress)) return stop('The Slayer task changed unexpectedly. Inspect the board.');
      const limit = questLimit();
      if (!board.task) {
        if (limit) return stop(limit);
        if (!board.assign || board.assign.disabled) return stop('The Slayer assignment button is unavailable.');
        return submitSlayerCommand(board.assign, 'assign', board.completed);
      }
      const task = board.task;
      questQueue.current = { name: `Slayer: ${task.target}`, kind: 'kill', mode: 'arena', skill: '', target: task.target,
        goal: task.goal, progress: task.progress, zone: task.zone, stalled: 0, boardCompleted: board.completed };
      if (!saveQuestQueue()) return stop(questError);
      if (task.progress >= task.goal) {
        if (!task.claim || task.claim.disabled) return stop('Slayer task complete, but its Claim reward button is unavailable.');
        return submitSlayerCommand(task.claim, 'claim', board.completed);
      }
      if (limit) return stop(limit);
      if (task.hunt) {
        const travel = { name: questQueue.current.name, form: task.hunt.form, button: task.hunt };
        if (!validForm(travel, 'slayer-travel') || task.hunt.disabled) return stop('The Slayer travel control is unavailable or changed.');
        return navigateQuest('activity', travel);
      }
      if (!task.fight) return stop('The Slayer target has no verified fighting route.');
      navigateQuest('activity', { link: task.fight });
    }

    function submitSlayerCommand(button, kind, before) {
      const target = { form: button.form, button };
      if (!validForm(target, `slayer-${kind}`)) return stop('The Slayer task form changed. No request was sent.');
      // Full-page POSTs can have unknown outcomes. Persist intent before clicking;
      // a fresh board must prove success before another command is permitted.
      questQueue.command = { kind, before };
      questQueue.uncertain = true;
      navigateQuest('board', target);
    }

    function validQuestQueue(value) {
      if (!value || value.version !== 1 || typeof value.active !== 'boolean' || typeof value.uncertain !== 'boolean'
        || ![null, 'board', 'activity'].includes(value.continuation) || !['board', 'activity'].includes(value.phase)
        || typeof value.character !== 'string' || !value.character || value.character.length > 500) return false;
      if (!validRunConfig(value.config) || !validRunProgress(value) || !Number.isSafeInteger(value.recoveries)
        || !Number.isSafeInteger(value.config.quests)) return false;
      if (value.source !== undefined && !['slayer', 'diary'].includes(value.source)) return false;
      if (!validVerificationIntent(value.verification)) return false;
      if (value.source === 'diary' && (!DIARY_TIERS.includes(value.config.diaryTier)
        || (value.current && (value.current.kind !== 'kill' || value.current.mode !== 'arena' || value.current.zone !== value.config.target))
        || (value.command && (value.command.kind !== 'claim' || !DIARY_TIERS.includes(value.command.tier))))) return false;
      if (value.source === 'slayer') {
        if (!Number.isSafeInteger(value.tasksCompleted) || value.tasksCompleted < 0 || value.tasksCompleted > 1000000) return false;
        if (value.command && (!['assign', 'claim'].includes(value.command.kind) || !Number.isSafeInteger(value.command.before)
          || value.command.before < 0 || value.command.before > 1000000)) return false;
        if (value.current && (!Number.isSafeInteger(value.current.boardCompleted) || value.current.boardCompleted < 0)) return false;
      }
      if (!Array.isArray(value.finished) || value.finished.length > 1000 || !value.finished.every(name => typeof name === 'string' && name.length <= 500)) return false;
      if (!Array.isArray(value.skipped) || value.skipped.length > 1000 || !value.skipped.every(entry => typeof entry?.name === 'string'
        && entry.name.length <= 500 && typeof entry.reason === 'string' && entry.reason.length <= 500)) return false;
      if (!value.current) return value.current === null;
      const current = value.current;
      if (current.totalOnly !== undefined && typeof current.totalOnly !== 'boolean') return false;
      if (current.unmeasured !== undefined && (!Number.isSafeInteger(current.unmeasured)
        || current.unmeasured < 0 || current.unmeasured > 1000000)) return false;
      return ['kill', 'collect'].includes(current.kind) && ['gather', 'arena'].includes(current.mode)
        && ['name', 'target', 'skill', 'zone'].every(key => typeof current[key] === 'string' && current[key].length <= 500)
        && Boolean(current.name && current.target) && (current.mode !== 'gather' || SKILLS.has(current.skill))
        && ['goal', 'progress', 'stalled'].every(key => Number.isSafeInteger(current[key]) && current[key] >= 0 && current[key] <= 1000000)
        && current.goal > 0;
    }

    function saveQuestQueue() {
      try {
        if (questQueue) sessionStorage.setItem(QUEST_KEY, JSON.stringify(questQueue));
        else sessionStorage.removeItem(QUEST_KEY);
        questError = '';
        return true;
      } catch (error) {
        questError = `Could not save the quest queue: ${error.message}`;
        return false;
      }
    }

    function readQuestQueue() {
      const text = sessionStorage.getItem(QUEST_KEY);
      if (!text) return null;
      const value = JSON.parse(text);
      if (!validQuestQueue(value)) throw new Error('Saved quest data is invalid. Discard it before starting.');
      return value;
    }

    function syncQuestQueue() {
      if (!questQueue || !run) return;
      Object.assign(questQueue, runProgress(run));
    }

    function questLimit() {
      if (!questQueue.source && questQueue.finished.length >= questQueue.config.quests) return 'Quest limit reached.';
      if (questQueue.completed >= questQueue.config.actions) return 'Action limit reached.';
      if (questQueue.wins >= questQueue.config.battles) return 'Arena win limit reached.';
      return '';
    }

    function skipQuest(name, reason) {
      if (!questQueue.skipped.some(entry => entry.name === name)) questQueue.skipped.push({ name, reason });
      questQueue.current = null;
      return saveQuestQueue();
    }

    function navigateQuest(destination, action = null) {
      syncQuestQueue();
      questQueue.continuation = destination;
      questQueue.phase = destination;
      if (!saveQuestQueue()) return stop(questError);
      questNavigationDeadline = Date.now() + RESPONSE_TIMEOUT_MS;
      ownNavigation = true;
      if (action?.form) {
        ownSubmit = true;
        submitted = false;
        try { action.button.click(); }
        catch (error) { return stop(`Could not open the task activity: ${error.message}`); }
        finally { ownSubmit = false; }
        if (!submitted) return stop('The task navigation button did not submit.');
      } else {
        ui['quest-navigation'].href = TASK_BOARDS[questQueue.source || 'quest'];
        (action?.link || ui['quest-navigation']).click();
      }
      status(destination === 'board' ? 'Checking task progress on the board…' : `Travelling for ${questQueue.current.name}…`);
      schedule();
    }

    async function prepareQuestCatalog() {
      if (questRead || gatherCatalog) return;
      const controller = new AbortController();
      questRead = controller;
      const attempt = generation;
      const timeout = setTimeout(() => controller.abort(), RECOVERY_FETCH_TIMEOUT_MS);
      status('Checking gathering levels and available delivery items…');
      try {
        const catalog = new Set();
        for (const activitySkill of SKILLS) {
          const url = new URL('/gather.php', location.origin);
          url.searchParams.set('skill', activitySkill);
          const page = await fetchQuestPage(url, controller.signal);
          if (attempt !== generation || !questQueue?.active) return;
          const guard = humanCheckLink(page);
          if (guard) { serverGuardLink = guard; return pauseForVerification(); }
          if (characterName(page) !== questQueue.character) throw new Error('The active hero changed while checking gathering levels.');
          for (const target of gatheringTargets(page, activitySkill)) if (target.available && target.item) catalog.add(target.item);
        }
        gatherCatalog = catalog;
      } catch (error) {
        if (attempt === generation) stop(`Could not check delivery quests: ${controller.signal.aborted ? 'The availability check timed out.' : error.message}`);
      } finally {
        clearTimeout(timeout);
        if (questRead === controller) questRead = null;
        if (attempt === generation && questQueue?.active) schedule();
      }
    }

    function tickQuestBoard() {
      if (mode === 'diary') return tickDiaryBoard();
      if (mode === 'slayer') return tickSlayerBoard();
      if (pending) {
        if (Date.now() >= pending.deadline) return stop('The quest request was not confirmed. Inspect the board before restarting.');
        schedule();
        return;
      }
      const board = questBoard();
      if (!board.level || !characterName()) return stop('Cannot read the quest board or active hero.');
      if (characterName() !== questQueue.character) return stop('The active hero changed. Quest automation paused.');
      if (Date.now() < run.nextAt || questRead) { schedule(); return; }
      // A skipped route can become supported after an update or a region change.
      // Recheck routes and previously missing quests against fresh controls.
      // Keep unavailable-target skips until an explicit new run.
      const skipped = questQueue.skipped.filter(entry => !['No supported gathering or arena route.', MISSING_QUEST_REASON].includes(entry.reason)
        || !board.cards.some(card => card.group === 'Active' && card.name === entry.name && questObjective(card)));
      if (skipped.length !== questQueue.skipped.length) {
        questQueue.skipped = skipped;
        if (!saveQuestQueue()) return stop(questError);
      }
      if (questQueue.current) {
        const current = questQueue.current;
        const card = board.cards.find(card => card.name === current.name);
        if (!card) {
          if (!board.activeReadable) return stop('Cannot verify the active quest list. Inspect the board before resuming.');
          if (!skipQuest(current.name, MISSING_QUEST_REASON)) return stop(questError);
        } else if (card.group === 'Chronicled') {
          if (!questQueue.finished.includes(card.name)) questQueue.finished.push(card.name);
          questQueue.current = null;
          if (!saveQuestQueue()) return stop(questError);
        } else if (card.group !== 'Active') return stop('The selected quest is no longer active.');
        else {
          if (card.target !== current.target || card.kind !== current.kind || card.goal !== current.goal) return stop('The selected quest objective changed. Inspect the board.');
          if (card.progress === null) return stop('Cannot read the selected quest’s progress.');
          current.progress = card.progress;
          current.unmeasured = 0;
        }
      }
      const currentCard = questQueue.current && board.cards.find(card => card.name === questQueue.current.name);
      const ready = currentCard?.progress >= currentCard?.goal ? currentCard
        : board.cards.find(card => card.group === 'Active' && card.progress !== null && card.progress >= card.goal
          && !questQueue.skipped.some(entry => entry.name === card.name));
      if (ready) {
        if (questQueue.finished.length >= run.config.quests) return stop('Quest limit reached.');
        if (!ready.claim) return stop(`Quest ready: ${ready.name}. Its turn-in button is unavailable; complete it using the game’s controls.`);
        questQueue.current = questQueue.current?.name === ready.name ? questQueue.current : questObjective(ready);
        return send({ name: ready.name, form: ready.claim.closest('form'), button: ready.claim }, 'quest-claim');
      }
      const limit = questLimit();
      if (limit) return stop(limit);
      let card = currentCard || board.cards.find(card => card.group === 'Active'
        && !questQueue.skipped.some(entry => entry.name === card.name));
      if (!card) {
        if (board.capacity !== null && board.cards.filter(card => card.group === 'Active').length >= board.capacity) return stop('Quest slots are full. Resolve an unsupported active quest using the game’s controls before resuming.');
        const candidates = board.cards.filter(card => card.group === 'Available' && card.requiredLevel <= board.level && card.accept
          && !card.accept.disabled && !questQueue.skipped.some(entry => entry.name === card.name));
        if (!gatherCatalog && candidates[0]?.kind === 'collect') return void prepareQuestCatalog();
        card = candidates.find(card => card.kind === 'kill' || gatherCatalog?.has(card.target));
        if (!card) return stop('No more supported eligible quests. Locked quests and unsupported deliveries were left unchanged.');
        return send({ name: card.name, form: card.accept.closest('form'), button: card.accept }, 'quest-accept');
      }
      if (card.progress === null) return stop(`Cannot read progress for ${card.name}.`);
      const objective = questObjective(card);
      if (!objective) {
        if (!skipQuest(card.name, 'No supported gathering or arena route.')) return stop(questError);
        schedule();
        return;
      }
      objective.stalled = questQueue.current?.stalled || 0;
      questQueue.current = objective;
      if (objective.mode === 'arena' && card.hunt) {
        if (card.hunt.disabled) {
          if (!skipQuest(card.name, 'The hunting area is unavailable.')) return stop(questError);
          schedule();
          return;
        }
        const travel = { name: card.name, form: card.hunt.closest('form'), button: card.hunt };
        if (!validForm(travel, 'quest-hunt')) return stop('The quest hunting route changed. No travel was sent.');
        return navigateQuest('activity', travel);
      }
      navigateQuest('activity', { link: objective.mode === 'arena' ? card.fight : card.gather });
    }

    function questObjective(card) {
      if (card.kind === 'kill' && (card.hunt || card.fight)) return { name: card.name, kind: card.kind, target: card.target, goal: card.goal,
        progress: card.progress || 0, mode: 'arena', skill: '', zone: card.hunt?.textContent.split('Hunt in ')[1]?.trim() || '', stalled: 0 };
      if (card.kind === 'collect' && card.gather) return { name: card.name, kind: card.kind, target: card.target, goal: card.goal,
        progress: card.progress || 0, mode: 'gather', skill: new URL(card.gather.href).searchParams.get('skill'), zone: '', stalled: 0 };
      // A ready delivery may have no activity link. Only its verified turn-in form is used.
      if (card.claim && card.progress >= card.goal) return { name: card.name, kind: card.kind, target: card.target, goal: card.goal,
        progress: card.progress, mode: 'arena', skill: '', zone: '', stalled: 0 };
      return null;
    }

    async function startQuestQueue(resume = false) {
      if (starting || run?.active || pending || restoring || potionRead || questError || humanCheck().required) return;
      if (resume && (!questQueue || (questQueue.uncertain && !questQueue.command))) return status('An unconfirmed task action needs inspection. Discard the queue after inspecting it.');
      if (resume && onTaskBoard && mode !== (questQueue.source || 'quest')) return status('Open the saved run’s own board before resuming it.');
      const config = resume ? questQueue.config : settingsFromUI();
      if (!config || (!resume && !onTaskBoard)) return;
      if (checkpoint && (!resume || !checkpoint.canResume)) return status('Inspect and discard the saved activity before starting quests.');
      if (resume && !['slayer', 'diary'].includes(mode) && questQueue.character !== characterName()) return status('The active hero changed. Return to the original hero or discard the quest queue.');
      if (resume && Date.now() >= questQueue.deadline) return status('The quest queue’s original time limit expired. Discard it and start a new queue.');
      if (resume && staleTaskBoard) {
        return void holdGameLock(() => {
          questQueue.active = true;
          navigateQuest('board');
        });
      }
      await holdGameLock(async () => {
        const attempt = generation;
        if (['slayer', 'diary'].includes(mode)) {
          starting = true;
          taskHero = await identifyTaskHero();
          if (attempt !== generation) return;
          starting = false;
          if (resume && (questQueue.source !== mode || questQueue.character !== taskHero)) return stop('The active hero or task queue changed. Return to the original hero.');
          if (mode === 'slayer') {
            const board = slayerBoard();
            if (!board || (resume && !confirmSlayerCommand(board))) return stop('The Slayer request was not confirmed. Inspect the board; no request was repeated.');
          } else if (!diaryBoard() || (resume && !confirmDiaryCommand())) return stop('The diary claim was not confirmed. Inspect Diaries; no request was repeated.');
        }
        if (!resume) saveSettings(config);
        if (!resume) questQueue = { version: 1, active: true, uncertain: false, phase: 'board', continuation: null,
          config: { ...config }, character: characterName(), deadline: Date.now() + config.minutes * 60000,
          ...runProgress(), finished: [], skipped: [], current: null };
        if (!resume && mode === 'slayer') Object.assign(questQueue, { source: 'slayer', tasksCompleted: 0 });
        if (!resume && mode === 'diary') questQueue.source = 'diary';
        questQueue.active = true;
        if (!questQueue.character || !saveQuestQueue()) return stop(questError || 'Cannot identify the quest hero.');
        if (checkpoint && !clearCheckpoint()) return stop(checkpointError);
        run = { active: true, config: { ...config }, ...runProgress(questQueue),
          deadline: questQueue.deadline, blockedAt: null, finishReason: '' };
        if (!onTaskBoard || staleTaskBoard) return navigateQuest('board');
        tick();
      });
    }

    async function continueQuestQueue() {
      const destination = questQueue.continuation;
      questQueue.continuation = null;
      if (!saveQuestQueue()) return stop(questError);
      if (humanCheck().required) return pauseForVerification();
      if (destination === 'board' && mode === (questQueue.source || 'quest')) return void startQuestQueue(true);
      if (questQueue.character !== characterName()) return stop('The active hero changed. Task automation paused.');
      const current = questQueue.current;
      if (destination !== 'activity' || !current || mode !== current.mode || (mode === 'gather' && skill !== current.skill)) return stop('Quest travel reached an unexpected page. Inspect it before resuming.');
      if (mode === 'arena' && ((current.zone && arenaZone() !== current.zone) || (arenaState().active && arenaState().name !== current.target))) return stop('The quest area or active enemy does not match the objective.');
      const selected = targets().find(target => target.available && (mode === 'gather' ? target.item === current.target : target.name === current.target));
      if (!selected) {
        if (questQueue.source) return stop('The exact task target is unavailable. No different enemy was selected.');
        if (!skipQuest(current.name, 'The required activity is locked or unavailable.')) return stop(questError);
        return void startQuestQueue(true);
      }
      if (mode === 'arena') {
        if (!arenaZone()) return stop('Cannot read the quest’s arena area. No enemy was attacked.');
        current.zone = arenaZone();
        if (!saveQuestQueue()) return stop(questError);
      }
      const config = { ...questQueue.config, target: selected.key };
      applySettings(config);
      await start({ config, ...runProgress(questQueue), deadline: questQueue.deadline });
    }

    function questObjectiveFinished() {
      const current = questQueue?.active && questQueue.current;
      return Boolean(current && questQueue.phase === 'activity' && current.progress >= current.goal
        && (mode !== 'arena' || !arenaState().active));
    }

    function escapeRegExp(text) { return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

    function updateQuestProgress(prior, flashes, page = document) {
      const current = questQueue?.phase === 'activity' && questQueue.current;
      if (!current || !['gather', 'strike'].includes(prior.kind)) return '';
      if (prior.kind === 'strike' && !arenaState(page).victory) return '';
      if (questQueue.source === 'diary') {
        current.progress = Math.min(current.goal, current.progress + 1);
        return '';
      }
      const texts = flashes.filter(flash => flash.classList.contains('flash-ok')).map(flash => flash.textContent);
      if (prior.kind === 'strike') texts.push(arenaState(page).log);
      const progressPattern = new RegExp(`(?:^|[\\r\\n]|📜\\s*)\\s*${escapeRegExp(current.name)}\\s*:\\s*([\\d,]+)\\s*/\\s*([\\d,]+)`, 'i');
      let measured = false;
      let progress = current.progress;
      for (const text of texts) {
        const match = text.match(progressPattern);
        if (!match) continue;
        const reported = numberFrom(match[1]);
        const goal = numberFrom(match[2]);
        if (reported === null || goal !== current.goal || reported < current.progress) return 'The reported quest progress changed unexpectedly. Inspect the objective before resuming.';
        progress = Math.min(current.goal, reported);
        current.unmeasured = 0;
        measured = true;
        break;
      }
      if (!measured && prior.kind === 'strike') {
        // One confirmed victory against this exact quest enemy is one kill.
        progress = Math.min(current.goal, progress + 1);
        measured = true;
      } else if (!measured) {
        const quantityPattern = new RegExp(`\\bYou gather\\s+([\\d,]+)\\s*(?:[×x]\\s*)?${escapeRegExp(current.target)}(?=\\s*(?:$|[.!?;(+·]|—))`, 'i');
        const quantities = texts.map(text => text.match(quantityPattern)).filter(Boolean)
          .map(match => numberFrom(match[1])).filter(quantity => quantity !== null);
        const quantity = quantities[0];
        if (quantity !== undefined && quantities.every(value => value === quantity)) {
          progress = Math.min(current.goal, progress + quantity);
          measured = true;
        } else current.unmeasured = (current.unmeasured || 0) + 1;
      }
      if (measured) {
        current.stalled = progress > current.progress ? 0 : current.stalled + 1;
        current.progress = progress;
      }
      return current.stalled >= 3 ? `Quest progress did not advance for ${current.name}. Inspect the objective and inventory.` : '';
    }

    function needsQuestProgressCheck() {
      const current = questQueue?.active && questQueue.current;
      return Boolean(mode === 'gather' && questQueue?.phase === 'activity' && current?.unmeasured > 0
        && (current.unmeasured >= Math.min(5, Math.max(1, current.goal - current.progress)) || run.finishReason));
    }

    async function fetchQuestPage(url, signal) {
      const response = await fetch(url.href, { method: 'GET', credentials: 'same-origin', cache: 'no-store', redirect: 'error', signal });
      const returned = new URL(response.url);
      if (!response.ok || returned.origin !== url.origin || returned.pathname !== url.pathname
        || Array.from(url.searchParams).some(([key, value]) => returned.searchParams.get(key) !== value)) throw new Error('The server returned a different quest activity page.');
      return new DOMParser().parseFromString(await response.text(), 'text/html');
    }

    async function checkQuestProgress() {
      if (questRead || pending) return;
      const controller = new AbortController();
      questRead = controller;
      const attempt = generation;
      const current = questQueue.current;
      const active = () => attempt === generation && run?.active && questQueue?.active && questQueue.current === current;
      const timeout = setTimeout(() => controller.abort(), RECOVERY_FETCH_TIMEOUT_MS);
      status('Checking quest counts in the background; staying in this area…');
      try {
        const page = await fetchQuestPage(new URL('/quests.php', location.origin), controller.signal);
        if (!active()) return;
        const guard = humanCheckLink(page);
        if (guard) { serverGuardLink = guard; return pauseForVerification(); }
        if (characterName(page) !== questQueue.character) throw new Error('The active hero changed.');
        const board = questBoard(page);
        const card = board.cards.find(card => card.name === current.name);
        if (!card && board.activeReadable) return navigateQuest('board');
        if (!card || (card.group !== 'Chronicled' && (card.group !== 'Active' || card.kind !== current.kind
          || card.target !== current.target || card.goal !== current.goal || card.progress === null))) throw new Error('The selected quest or its progress could not be verified.');
        const progress = card.group === 'Chronicled' ? current.goal : card.progress;
        current.stalled = progress > current.progress ? 0 : current.stalled + 1;
        current.progress = progress;
        current.unmeasured = 0;
        if (!saveQuestQueue()) return stop(questError);
        if (current.stalled >= 3) return stop(`Quest progress did not advance for ${current.name}. Inspect the objective and inventory.`);
      } catch (error) {
        if (active()) stop(`Could not check quest progress: ${controller.signal.aborted ? 'The background read timed out.' : error.message}`);
      } finally {
        clearTimeout(timeout);
        if (questRead === controller) questRead = null;
        if (active()) schedule();
      }
    }

    function refreshTargets(preferred = ui.target.value) {
      const choices = targets();
      ui.target.replaceChildren(...choices.map(target => {
        const option = element('option', { value: target.key }, `${target.name}${target.available ? '' : ' · Locked'}`);
        option.disabled = !target.available;
        return option;
      }));
      if (!choices.some(target => target.available)) {
        ui.target.appendChild(element('option', { value: '' }, mode === 'raid'
          ? 'Open a boss fight using the game’s raid controls' : 'No available targets on this page'));
      }
      const selected = choices.find(target => target.key === preferred && target.available) || choices.find(target => target.available);
      ui.target.value = selected?.key || '';
    }

    function refreshFood(preferred = ui.food.value) {
      ui.food.replaceChildren(element('option', { value: '' }, 'Use the game’s selected food'));
      const names = new Set();
      for (const food of document.querySelectorAll('#quick-eat-select option[data-food]')) {
        if (food.disabled || !food.dataset.food || names.has(food.dataset.food)) continue;
        names.add(food.dataset.food);
        ui.food.appendChild(element('option', { value: food.dataset.food }, food.textContent.trim()));
      }
      // At full energy the game hides its food form. Keep an explicit saved choice
      // until that form returns; never silently substitute a different food.
      if (preferred && !names.has(preferred)) {
        ui.food.appendChild(element('option', { value: preferred }, `${preferred} · not currently shown by the game`));
      }
      ui.food.value = preferred;
    }

    function foodAction() {
      const select = document.getElementById('quick-eat-select');
      const form = select?.closest('form.quick-eat[data-ajax]');
      const button = form?.querySelector('button.btn-eat:not(.btn-eat-energy):not(.btn-eat-hp)');
      if (!select || !form || !button || select.disabled) return null;
      const selected = run.config.food
        ? Array.from(select.options).find(option => option.dataset.food === run.config.food && !option.disabled)
        : select.selectedOptions[0];
      if (!selected || selected.disabled || !selected.dataset.food) return null;
      return { form, button, select, selected, name: selected.dataset.food };
    }

    function potionChoices(page = document) {
      return Array.from(page.querySelectorAll('#quick-drink-select option[data-elixir]')).flatMap(option => {
        const effect = option.textContent.match(/\(\+([\d,]+)\s+(Attack\/Strength\/Defen[cs]e|Attack|Strength|Defen[cs]e|Ranged|Magic)\)/i);
        const quantity = option.textContent.match(/×\s*([\d,]+)\s*$/);
        const name = option.dataset.elixir?.trim();
        if (!name || !effect || !(numberFrom(effect[1]) > 0)) return [];
        return [{ name, stat: effect[2].includes('/') ? 'combat' : effect[2].toLowerCase().replace('defence', 'defense'), boost: numberFrom(effect[1]),
          available: !option.disabled && numberFrom(quantity?.[1] || '') > 0, option }];
      });
    }

    function selectedPotions() {
      return Object.keys(POTION_STATS).filter(stat => ui[`potion-${stat}`].value)
        .map(stat => ({ stat, name: ui[`potion-${stat}`].value }));
    }

    function refreshPotions(preferred = selectedPotions(), page = document) {
      const liveInventory = Boolean(page.getElementById('quick-drink-select'));
      const choices = potionChoices(page).filter(potion => potion.available);
      let warning = '';
      if (liveInventory) {
        const observed = choices.map(({ name, stat, boost }) => ({ name, stat, boost }));
        if (JSON.stringify(observed) !== JSON.stringify(potionCatalog)) {
          potionCatalog = observed;
          try { GM_setValue(POTION_CATALOG_KEY, potionCatalog); }
          catch (error) { warning = `Could not remember potion choices: ${error.message}`; ui['potion-info'].textContent = warning; }
        }
      }
      for (const stat of Object.keys(POTION_STATS)) {
        const select = ui[`potion-${stat}`];
        const saved = preferred.find(potion => potion?.stat === stat);
        const name = typeof saved?.name === 'string' ? saved.name : '';
        select.replaceChildren(element('option', { value: '' }, 'None'));
        for (const potion of (liveInventory ? choices : potionCatalog).filter(potion => potion.stat === stat)) {
          select.appendChild(element('option', { value: potion.name }, liveInventory ? potion.option.textContent.trim()
            : `${potion.name} (+${potion.boost} ${POTION_STATS[stat]}) · stock checked in combat`));
        }
        if (name && !Array.from(select.options).some(option => option.value === name)) {
          select.appendChild(element('option', { value: name }, `${name} · unavailable`));
        }
        select.value = name;
      }
      return warning;
    }

    async function loadQuestPotions() {
      if (!onTaskBoard || potionRead || starting || run?.active || checkpoint || questQueue || humanCheck().required) return;
      const controller = new AbortController();
      potionRead = controller;
      const timeout = setTimeout(() => controller.abort(), RECOVERY_FETCH_TIMEOUT_MS);
      ui['potion-info'].textContent = 'Reading potion choices from Combat…';
      render();
      try {
        const page = await fetchQuestPage(new URL('/arena.php', location.origin), controller.signal);
        if (potionRead !== controller || controller.signal.aborted) return;
        if (humanCheckLink(page)) throw new Error('Complete the game’s human check manually in Combat, then try again.');
        if (['slayer', 'diary'].includes(mode) && !taskHero) taskHero = characterName(page);
        if (!characterName() || characterName(page) !== characterName()) throw new Error('The active hero changed.');
        if (!page.getElementById('quick-drink-select')) throw new Error('Quick drink is unavailable. Open Combat to inspect your potion inventory.');
        const warning = refreshPotions(selectedPotions(), page);
        ui['potion-info'].textContent = warning || 'Potion choices loaded. Selected buffs apply to task combat; stock is checked again before drinking.';
      } catch (error) {
        if (potionRead === controller) ui['potion-info'].textContent = controller.signal.aborted
          ? 'Loading potion choices timed out. Try again or open Combat.' : `Could not load potion choices: ${error.message}`;
      } finally {
        clearTimeout(timeout);
        if (potionRead === controller) { potionRead = null; render(); }
      }
    }

    function potionBoosts(page = document) {
      const panel = page.getElementById('boost-hud-wrap');
      if (!panel) return null;
      const boosts = new Map();
      for (const timer of panel.querySelectorAll('.boost-timer')) {
        const time = timer.textContent.trim();
        const remaining = time.match(/^(\d+):([0-5]\d)$/);
        if (time !== 'expired' && !remaining) return null;
        let effect = null;
        for (let row = timer.parentElement; row && panel.contains(row); row = row.parentElement) {
          if (row.querySelectorAll('.boost-timer').length !== 1) break;
          const label = row.cloneNode(true);
          label.querySelector('.boost-timer').remove();
          effect = label.textContent.match(/\+([\d,]+)\s*(Attack\/Strength\/Defen[cs]e|Attack|Strength|Defen[cs]e|Ranged|Magic)\b/i);
          if (effect) break;
        }
        if (!effect) return null;
        const stats = effect[2].includes('/') ? COMBAT_STATS : [effect[2].toLowerCase().replace('defence', 'defense')];
        if (stats.some(stat => boosts.has(stat)) || !(numberFrom(effect[1]) > 0)) return null;
        // The game's data-secs is decremented ahead of its displayed countdown.
        // Read the visible timer so 0:01 does not trigger an early renewal.
        for (const stat of stats) boosts.set(stat, { boost: numberFrom(effect[1]), seconds: remaining ? Number(remaining[1]) * 60 + Number(remaining[2]) : 0 });
      }
      return boosts;
    }

    function maintainPotions(now) {
      const selections = run.config.potions || [];
      if (!['arena', 'raid'].includes(mode) || !selections.length) return false;
      const boosts = potionBoosts();
      if (!boosts) { stop('Cannot read active potion boosts. No potion was sent.'); return true; }
      const combat = selections.some(potion => potion.stat === 'combat');
      const selection = selections.find(potion => !(combat && COMBAT_STATS.includes(potion.stat))
        && (potion.stat === 'combat' ? COMBAT_STATS : [potion.stat]).some(stat => !(boosts.get(stat)?.seconds > 0)));
      if (!selection) return false;
      if (run.drunk >= (run.config.drinks ?? DEFAULTS.drinks)) { stop('Potion item limit reached.'); return true; }
      const potion = potionChoices().find(potion => potion.name === selection.name && potion.stat === selection.stat && potion.available);
      if (!potion) { stop(`Selected potion (${selection.name}) is unavailable. No replacement was used.`); return true; }
      const select = document.getElementById('quick-drink-select');
      const form = select?.closest('form.quick-drink[data-ajax]');
      const button = Array.from(form?.querySelectorAll('button[type="submit"], button:not([type])') || [])
        .find(button => button.textContent.trim().toLowerCase() === 'drink');
      if (!select || select.disabled || !button) { stop('The game’s Quick drink control is unavailable.'); return true; }
      if (!waitForButton(button, now)) send({ ...potion, selected: potion.option, select, form, button }, 'drink');
      return true;
    }

    function render() {
      ui.status.textContent = message;
      const vitals = energy();
      const hp = health();
      const progress = run || checkpoint || questQueue;
      ui.stats.textContent = `${progress?.completed || 0} confirmed actions · ${progress?.eaten || 0} food eaten · Energy ${vitals ? `${vitals.current}/${vitals.maximum}` : 'unavailable'}${hp ? ` · HP ${hp.current}/${hp.maximum}` : ''}${mode === 'arena' ? ` · ${progress?.wins || 0} wins` : ''}`;
      if (progress?.drunk || progress?.config?.potions?.length) ui.stats.textContent += ` · ${progress.drunk || 0} potions drunk`;
      if (mode === 'raid') ui.stats.textContent += ` · ${progress?.raidsCompleted || 0} raids completed`;
      const busy = starting || restoring || Boolean(run?.active) || Boolean(pending) || Boolean(questNavigationDeadline) || Boolean(potionRead);
      const guard = humanCheck();
      checkSounds?.update(guard.required);
      for (const control of ui.controls.querySelectorAll('input, select')) control.disabled = busy || Boolean(checkpoint || questQueue);
      ui['potion-settings'].hidden = !['arena', 'raid', 'quest', 'slayer', 'diary'].includes(mode);
      ui['load-potions'].hidden = !onTaskBoard;
      ui['load-potions'].disabled = busy || guard.required || Boolean(checkpoint || questQueue);
      ui.start.disabled = busy || guard.required || Boolean(checkpoint || questQueue || questError) || Boolean(checkpointError) || mode === 'hall' || !ui.target.value || !navigator.locks?.request;
      ui.stop.disabled = !starting && !restoring && !run?.active && !checkpoint && !questQueue && !potionRead;
      ui['battle-settings'].hidden = mode !== 'arena' && !onTaskBoard;
      ui['quest-settings'].hidden = mode !== 'quest';
      ui['raid-settings'].hidden = mode !== 'raid';
      ui['diary-settings'].hidden = mode !== 'diary';
      ui['quest-progress'].hidden = !questQueue && !questError;
      ui['quest-resume'].disabled = busy || guard.required || !questQueue || (questQueue.uncertain && !questQueue.command) || Boolean(questError);
      ui['quest-resume'].hidden = busy;
      ui['quest-discard'].hidden = busy;
      const slayer = questQueue?.source === 'slayer';
      const diary = questQueue?.source === 'diary';
      ui['quest-resume'].textContent = diary ? 'Resume diary' : slayer ? 'Resume Slayer' : 'Resume quests';
      ui['quest-discard'].textContent = diary ? 'Discard diary run' : slayer ? 'Discard Slayer run' : 'Discard quest queue';
      ui['quest-discard'].disabled = busy;
      ui['quest-info'].textContent = questError || (questQueue ? `${questQueue.active ? 'Quest queue' : 'Paused quest queue'}: ${questQueue.finished.length}/${questQueue.config.quests} completed${questQueue.current ? ` · ${questQueue.current.name}: ${questQueue.current.progress}/${questQueue.current.goal}` : ''}.${questQueue.uncertain ? ' The last request is unconfirmed; inspect its result before discarding and restarting.' : ''}${questQueue.skipped.length ? ` Skipped: ${questQueue.skipped.map(entry => `${entry.name} (${entry.reason})`).join('; ')}` : ''}` : '');
      if (slayer && !questError) ui['quest-info'].textContent = `${questQueue.active ? 'Slayer' : 'Paused Slayer'}: ${questQueue.tasksCompleted} tasks completed${questQueue.current ? ` · ${questQueue.current.target}: ${questQueue.current.progress}/${questQueue.current.goal}` : ''}.${questQueue.uncertain ? ' The last request is unconfirmed; inspect the board.' : ''}`;
      if (diary && !questError) ui['quest-info'].textContent = `${questQueue.active ? 'Diary' : 'Paused diary'}: ${questQueue.config.target} · ${questQueue.config.diaryTier}${questQueue.current ? ` · ${questQueue.current.target}: ${questQueue.current.progress}/${questQueue.current.goal}${questQueue.current.totalOnly ? ' (area total)' : ''}` : ''}.${questQueue.uncertain ? ' Waiting for confirmation.' : ''}`;
      ui['quest-info'].hidden = Boolean(diary && !questQueue.current && !questError);
      ui.recovery.hidden = !checkpoint && !checkpointError && !guard.required;
      ui.resume.hidden = !checkpoint;
      ui.resume.disabled = busy || guard.required || Boolean(checkpointError || questQueue) || !navigator.locks?.request;
      ui.resume.textContent = checkpoint?.canResume && checkpoint.deadline > Date.now() ? 'Restore & resume' : 'Restore activity';
      ui.discard.hidden = !checkpoint && !checkpointError;
      ui.discard.disabled = busy;
      ui['verify-link'].hidden = !guard.link || location.pathname === '/guard.php';
      if (guard.link) ui['verify-link'].href = guardURL(guard.link).href;
      ui['return-activity'].hidden = !checkpoint || guard.required;
      if (checkpoint) ui['return-activity'].href = checkpointURL(checkpoint);
      const label = checkpoint ? `${checkpoint.mode === 'gather' ? checkpoint.skill : checkpoint.mode}: ${checkpoint.targetName}${checkpoint.zone ? ` · ${checkpoint.zone}` : ''}` : '';
      ui['recovery-info'].textContent = checkpointError || (checkpoint
        ? `Saved ${label}. ${checkpoint.completed} confirmed actions, ${checkpoint.eaten} food, ${checkpoint.wins} wins. ${guard.required
          ? 'Complete the game’s human check yourself first.' : !checkpoint.canResume
          ? 'The last request was not confirmed. Restore the activity, inspect its result, and press Start for a new run.'
          : checkpoint.deadline <= Date.now() ? 'The original time limit expired. Restore the activity and start a new run.'
          : 'Restore & resume continues with the original limits and progress.'}`
        : 'Human verification required. Use the game’s verification controls yourself.');
      if (panelPosition) positionPanel(host);
    }

    function status(text) {
      message = text;
      render();
    }

    function unlockIfIdle() {
      if (pending || !releaseLock) return;
      const release = releaseLock;
      releaseLock = null;
      release();
    }

    function stop(reason = 'Stopped.', { preserveVerification = false } = {}) {
      clearTimeout(verificationTimer);
      verificationTimer = null;
      cancelResponseRecovery();
      if (potionRead) ui['potion-info'].textContent = 'Loading potion choices cancelled.';
      potionRead?.abort();
      potionRead = null;
      questRead?.abort();
      questRead = null;
      questNavigationDeadline = 0;
      if (questQueue) {
        syncQuestQueue();
        questQueue.active = false;
        questQueue.continuation = null;
        if (!preserveVerification) questQueue.verification = false;
        if (!saveQuestQueue()) reason = `${reason} ${questError}`;
      }
      generation += 1;
      starting = false;
      if (run) run.active = false;
      if (checkpoint) {
        checkpoint.restoreRequested = false;
        if (!preserveVerification) checkpoint.verification = false;
        if (!writeCheckpoint()) reason = `${reason} ${checkpointError}`;
      }
      restoring = false;
      ownNavigation = false;
      clearTimeout(timer);
      timer = null;
      // Keep the cross-tab lock until the response arrives. Stop cannot unsend a POST.
      unlockIfIdle();
      status(reason + (pending ? ' The sent action may still finish; wait for its result or reload before restarting.' : ''));
    }

    function schedule() {
      clearTimeout(timer);
      if (run?.active || restoring || questNavigationDeadline) timer = setTimeout(tick, POLL_MS);
    }

    function settingsFromUI(report = true) {
      for (const [id, setting] of Object.entries(NUMBER_SETTINGS)) {
        if (setting.modes && !setting.modes.includes(mode)) continue;
        if (!(report ? ui[id].reportValidity() : ui[id].checkValidity())) return null;
      }
      return { target: ui.target.value, food: ui.food.value, potions: selectedPotions(),
        diaryTier: ui['diary-tier'].value,
        ...Object.fromEntries(Object.keys(NUMBER_SETTINGS).map(id => [id, Number(ui[id].value)])),
        ...Object.fromEntries(CHECK_SETTINGS.map(id => [id, ui[id].checked])) };
    }

    function saveSettings(config) {
      const { target, ...preferences } = config;
      GM_setValue(SETTINGS_KEY, preferences);
      GM_setValue(settingsKey, { target });
    }

    function readSettings() {
      const legacy = GM_getValue(settingsKey, {});
      const shared = GM_getValue(SETTINGS_KEY, null);
      const config = { ...DEFAULTS, ...(shared || legacy), target: typeof legacy?.target === 'string' ? legacy.target : '' };
      // Import the current profile once; other old profiles must not override shared choices later.
      if (!shared && legacy && Object.keys(DEFAULTS).some(key => key !== 'target' && Object.hasOwn(legacy, key))) {
        const preferences = { ...config };
        delete preferences.target;
        GM_setValue(SETTINGS_KEY, preferences);
      }
      return config;
    }

    async function holdGameLock(action) {
      if (!navigator.locks?.request) {
        status('Web Locks are unavailable. A browser with Web Locks support is required.');
        return;
      }
      const attempt = ++generation;
      starting = true;
      status('Checking for another running tab…');
      try {
        await navigator.locks.request(LOCK_NAME, { ifAvailable: true }, async lock => {
          if (attempt !== generation) return;
          if (!lock) {
            stop('Another tab is already running the Gathering Assistant. Stop it first.');
            return;
          }
          await new Promise(resolve => {
            releaseLock = resolve;
            starting = false;
            Promise.resolve(action()).catch(error => {
              if (attempt === generation) stop(`Could not start automation: ${error.message}`);
            });
          });
        });
      } catch (error) {
        if (attempt === generation) stop(`Could not start automation: ${error.message}`);
      }
    }

    async function start(savedRun = null) {
      if (onTaskBoard) return void startQuestQueue();
      if (questQueue && !savedRun) return status('Resume or discard the saved quest queue before starting a separate activity.');
      if (starting || restoring || run?.active || pending || potionRead || mode === 'hall') return;
      if (humanCheck().required) return status('Complete the game’s human verification yourself before starting.');
      if ((checkpoint || checkpointError) && !savedRun) return status('Use Restore & resume or discard the saved run before starting.');
      const config = savedRun ? { ...DEFAULTS, ...savedRun.config } : settingsFromUI();
      if (!config || (!targets().some(target => target.key === config.target && target.available) && !endedSavedRaid(savedRun))) return;
      await holdGameLock(() => {
        try {
          if (!savedRun) saveSettings(config);
        } catch (error) {
          stop(`Could not save settings: ${error.message}`);
          return;
        }
        if (savedRun) {
          if (!clearCheckpoint()) return stop(checkpointError);
        }
        run = { active: true, config, ...runProgress(savedRun),
          raidsCompleted: savedRun?.raidsCompleted || 0, raidId: savedRun?.raidId || raidState()?.id,
          finishReason: savedRun?.finishReason || '', deadline: savedRun?.deadline ?? Date.now() + config.minutes * 60000,
          blockedAt: null };
        tick();
      });
    }

    function applySettings(config) {
      ui['diary-tier'].value = config.diaryTier || DEFAULTS.diaryTier;
      for (const id of Object.keys(NUMBER_SETTINGS)) ui[id].value = Number.isFinite(config[id]) ? config[id] : DEFAULTS[id];
      for (const id of CHECK_SETTINGS) ui[id].checked = id === 'autoRecover' ? config[id] !== false : config[id] === true;
      refreshTargets(typeof config.target === 'string' ? config.target : '');
      refreshFood(typeof config.food === 'string' ? config.food : '');
      refreshPotions(Array.isArray(config.potions) ? config.potions : []);
    }

    function travelToZone(zone) {
      const form = Array.from(document.querySelectorAll('section.content form'))
        .find(candidate => candidate.querySelector('input[name="zone_id"]')
          && candidate.querySelector('button')?.textContent.trim().replace(/\s+/g, ' ').split('·')[0].replace('★', '').trim() === zone);
      const button = form?.querySelector('button');
      return button && !button.disabled ? { form, button, name: zone } : null;
    }

    async function beginRestore(action) {
      await holdGameLock(() => {
        checkpoint.restoreRequested = true;
        checkpoint.steps += 1;
        if (!writeCheckpoint()) return stop(checkpointError);
        restoring = true;
        restoreDeadline = Date.now() + RESPONSE_TIMEOUT_MS;
        ownNavigation = true;
        action();
        schedule();
      });
      if (checkpoint?.restoreRequested && !restoring && !pending) void restoreSavedRun();
    }

    async function restoreSavedRun() {
      if (!checkpoint || checkpointError || starting || restoring || run?.active || pending) return;
      if (humanCheck().required) return pauseForVerification();
      if (checkpoint.character && characterName() !== checkpoint.character) {
        checkpoint.restoreRequested = false;
        writeCheckpoint();
        return status('The active hero changed. Discard the saved run and choose an activity for this hero.');
      }
      // A summon landing only verifies a result; it may be the third page in
      // the handoff. Verify it before applying the cap on further navigation.
      if (mode === 'raid' && checkpoint.raidPhase === 'summon') return void restoreRaidLoop();
      if (checkpoint.steps >= 3) {
        checkpoint.restoreRequested = false;
        writeCheckpoint();
        return status('Could not restore the activity after three page changes. Return to it manually or discard the saved run.');
      }
      if (mode === 'raid' && checkpoint.raidPhase) return void restoreRaidLoop();
      const wrongPage = mode !== checkpoint.mode || (mode === 'gather' && skill !== checkpoint.skill)
        || (mode === 'raid' && new URLSearchParams(location.search).get('id') !== checkpoint.raidId);
      if (wrongPage) {
        await beginRestore(() => {
          status(`Returning to ${checkpoint.targetName}…`);
          ui['return-activity'].click();
        });
        return;
      }
      if (mode === 'arena' && arenaZone() !== checkpoint.zone) {
        if (arenaState().active) return status('A fight is active in a different area. Resolve it using the game’s controls before restoring the saved run.');
        const travel = travelToZone(checkpoint.zone);
        if (!travel || !validForm(travel, 'travel')) return status(`The saved area (${checkpoint.zone}) is unavailable. Restore it using the game’s travel controls.`);
        await beginRestore(() => send(travel, 'travel'));
        return;
      }
      const selected = targets().find(target => target.key === checkpoint.config.target && target.available);
      if ((!selected && !endedSavedRaid(checkpoint)) || (mode === 'raid' && raidState()?.id !== checkpoint.raidId)) {
        checkpoint.restoreRequested = false;
        writeCheckpoint();
        return status('The exact saved target or boss is unavailable. No different target was selected or attacked.');
      }
      const savedRun = checkpoint;
      applySettings(savedRun.config);
      if (!savedRun.canResume || Date.now() >= savedRun.deadline) {
        if (!clearCheckpoint()) return status(checkpointError);
        status(savedRun.canResume ? 'Activity restored. The original time limit expired; press Start for a new run.'
          : 'Activity restored. Inspect the unconfirmed request’s result before pressing Start for a new run.');
        return;
      }
      await start(savedRun);
    }

    function endedSavedRaid(value) {
      const boss = mode === 'raid' ? raidState() : null;
      return Boolean(value?.finishReason === 'Boss defeated.' && boss?.hp === 0
        && boss.id === value.raidId && boss.name === value.config.target);
    }

    function raidRepeatLimit(value) {
      if (Date.now() >= value.deadline) return 'Time limit reached.';
      if (value.completed >= value.config.actions) return 'Action limit reached.';
      if ((value.raidsCompleted || 0) >= (value.config.maxRaids || 1)) return 'Raid limit reached.';
      return '';
    }

    function restartRaid() {
      const link = raidCatalogLink();
      if (!link) return stop('Boss defeated. The All raids link is unavailable; open the raid catalogue using the game’s controls.');
      if (!rememberActivity()) return stop(checkpointError);
      Object.assign(checkpoint, { raidPhase: 'catalog', restoreRequested: true, steps: 1 });
      if (!writeCheckpoint()) return stop(checkpointError);
      run.active = false;
      restoring = true;
      ownNavigation = true;
      restoreDeadline = Date.now() + RESPONSE_TIMEOUT_MS;
      link.click();
      status(`Raid complete. Returning to summon ${checkpoint.targetName} again…`);
      schedule();
    }

    async function restoreRaidLoop() {
      const limit = raidRepeatLimit(checkpoint);
      if (limit) return stop(limit);
      const hp = health();
      if (!hp || hp.current === 0) return stop('Cannot continue raids without a living hero and readable HP.');
      if (checkpoint.raidPhase === 'summon') {
        const boss = raidState();
        if (!boss || boss.name !== checkpoint.targetName || boss.id === checkpoint.raidId
          || !/^\d{1,30}$/.test(boss.id) || !(boss.hp > 0) || boss.state !== 'active' || !boss.button) {
          return stop('The new raid was not confirmed. Inspect the summon result; no summon was repeated.');
        }
        Object.assign(checkpoint, { raidId: boss.id, finishReason: '', canResume: true, restoreRequested: false, steps: 0 });
        delete checkpoint.raidPhase;
        if (!writeCheckpoint()) return stop(checkpointError);
        applySettings(checkpoint.config);
        // If the site swapped the catalogue in place, open the confirmed raid's
        // URL before combat so its identity remains readable after defeat.
        return void restoreSavedRun();
      }
      if (!checkpoint.canResume) return stop('Inspect the unconfirmed raid action before starting another raid.');
      const boss = raidState();
      if (boss) {
        const link = boss.id === checkpoint.raidId && boss.hp === 0 ? raidCatalogLink() : null;
        if (!link) return stop('The raid catalogue is unavailable. No different raid was selected.');
        return void beginRestore(() => link.click());
      }
      if (checkpoint.config.autoHeal && hp.current < hp.maximum) return stop('Heal using the game’s controls before resuming the raid summon.');
      const target = raidSummonTarget(checkpoint.targetName);
      if (!target || target.button.disabled) return stop(`The summon for ${checkpoint.targetName} is unavailable. No different boss was selected.`);
      if (!validForm(target, 'raid-summon')) return stop('The raid summon form changed. No summon was sent.');
      await beginRestore(() => {
        // Persist the uncertain POST before clicking. A reload may verify the
        // new raid ID, but must never submit this summon a second time.
        checkpoint.raidPhase = 'summon';
        checkpoint.canResume = false;
        if (!writeCheckpoint()) return stop(checkpointError);
        send(target, 'raid-summon');
      });
    }

    function validForm(target, kind) {
      if (!target.form || !target.button || target.form.getAttribute('method')?.toLowerCase() !== 'post') return false;
      let destination;
      try {
        destination = new URL(target.form.getAttribute('action') || location.href, location.href);
      } catch {
        return false; // A malformed action URL is not an approved game destination.
      }
      if (destination.origin !== location.origin || target.form.hasAttribute('data-confirm')) return false;
      const hasFields = (...names) => names.every(name => target.form.querySelector(`input[name="${name}"]`));
      if (kind.startsWith('diary-')) {
        if (mode !== 'diary' || target.button.disabled || target.form.hasAttribute('onsubmit')
          || target.button.form !== target.form || !hasFields('csrf', 'action')) return false;
        const zone = diaryBoard()?.zones.find(zone => zone.name === questQueue.config.target);
        if (!zone || zone.locked) return false;
        if (kind === 'diary-travel') return destination.pathname === '/arena.php' && hasFields('zone_id', 'from')
          && target.button.name === 'target' && zone.monsters.some(mob => mob.name === questQueue.current?.target && mob.button === target.button);
        return destination.pathname === '/diaries.php' && zone.tiers.some(tier => tier.ready && !tier.claimed && tier.claim === target.button
          && DIARY_TIERS.indexOf(tier.name) <= DIARY_TIERS.indexOf(questQueue.config.diaryTier));
      }
      if (kind.startsWith('slayer-')) {
        if (mode !== 'slayer' || target.button.disabled || target.form.hasAttribute('onsubmit')
          || !hasFields('csrf', 'action')) return false;
        const board = slayerBoard();
        if (!board) return false;
        if (kind === 'slayer-travel') return destination.pathname === '/arena.php' && target.button === board.task?.hunt
          && hasFields('zone_id', 'target', 'from');
        return destination.pathname === '/slayer.php'
          && target.button === (kind === 'slayer-assign' ? board.assign : board.task?.claim);
      }
      if (kind.startsWith('quest-')) {
        if (mode !== 'quest' || target.button.disabled || target.form.hasAttribute('onsubmit')) return false;
        if (kind === 'quest-hunt') return destination.pathname === '/arena.php'
          && /Hunt in /i.test(target.button.textContent) && hasFields('csrf', 'action', 'zone_id', 'target');
        const card = questBoard().cards.find(card => card.name === target.name);
        return destination.pathname === '/quests.php' && target.form.hasAttribute('data-ajax')
          && hasFields('csrf', 'action', 'quest_id')
          && target.button === (kind === 'quest-accept' ? card?.accept : card?.claim);
      }
      if (kind === 'travel') {
        return mode === 'arena' && destination.pathname === '/arena.php' && target.button === target.form.querySelector('button')
          && hasFields('csrf', 'action', 'zone_id');
      }
      if (kind === 'gather') {
        return destination.pathname === '/gather.php'
          && hasFields('node', 'skill', 'action', 'csrf');
      }
      if (kind === 'engage' || kind === 'strike') {
        return mode === 'arena' && destination.pathname === '/arena.php' && target.form.hasAttribute('data-ajax')
          && hasFields('csrf', 'action', ...(kind === 'engage' ? ['monster_id'] : []))
          && (kind !== 'strike' || target.form.querySelector('input[name="action"]')?.value === 'swing');
      }
      if (kind === 'raid') {
        return mode === 'raid' && destination.pathname === '/raid.php' && target.form.hasAttribute('data-ajax')
          && hasFields('csrf', 'action', 'raid_id')
          && target.form.querySelector('input[name="raid_id"]')?.value === run.raidId;
      }
      if (kind === 'raid-summon') {
        return mode === 'raid' && Boolean(checkpoint?.raidPhase) && destination.pathname === '/raid.php'
          && !target.form.hasAttribute('onsubmit') && target.button === raidSummonTarget(checkpoint.targetName)?.button
          && hasFields('csrf', 'action', 'boss');
      }
      if (kind === 'drink') {
        // The game's native Quick drink form supplies its current destination
        // and field names. Never construct a drink POST or persist its fields.
        return ['arena', 'raid'].includes(mode) && target.form.matches('.quick-drink[data-ajax]')
          && !target.form.hasAttribute('onsubmit') && hasFields('csrf')
          && target.select === document.getElementById('quick-drink-select') && target.select.form === target.form
          && Boolean(target.select.name) && target.button.form === target.form && target.button.textContent.trim().toLowerCase() === 'drink'
          && potionChoices().some(potion => potion.option === target.selected && potion.name === target.name && potion.stat === target.stat);
      }
      return destination.pathname === '/eat.php' && target.form.matches('.quick-eat[data-ajax]')
        && hasFields('csrf', 'return', 'fill')
        && target.select?.name === 'inv_id' && target.select.form === target.form;
    }

    function send(target, kind) {
      if (!validForm(target, kind)) {
        stop(`The ${kind === 'drink' ? 'potion' : kind === 'eat' ? 'food' : kind === 'gather' ? 'gathering' : 'combat'} form changed. No action was sent; update the script.`);
        return;
      }
      if (questQueue) {
        syncQuestQueue();
        questQueue.uncertain = true;
        if (!saveQuestQueue()) return stop(questError);
      }
      if (kind === 'eat' || kind === 'drink') {
        target.select.value = target.selected.value;
        target.select.dispatchEvent(new Event('change', { bubbles: true }));
      }
      pending = { kind, name: target.name, purpose: target.purpose, stat: target.stat, boost: target.boost,
        hero: characterName(), raidDamage: kind === 'raid' ? raidPersonalDamage() : null,
        previousRaidId: kind === 'raid-summon' ? checkpoint.raidId : null,
        form: target.form, log: arenaState().log, xp: document.getElementById('hud-xp')?.textContent,
        flashes: new Set(document.querySelectorAll('#flash-stack .flash')),
        flashKeys: new Set(Array.from(document.querySelectorAll('#flash-stack .flash'), flashKey)),
        energy: energy()?.current, hp: health()?.current,
        deadline: Date.now() + RESPONSE_TIMEOUT_MS, recoveryChecks: 0, recoveryAt: Date.now() + RESPONSE_TIMEOUT_MS,
        transportURL: new URL(target.form.getAttribute('action') || location.href, location.href).href.split('#')[0],
        transportStartedAt: performance.now(), transportUntil: Infinity, transportComplete: false };
      ownSubmit = true;
      submitted = false;
      try {
        // Let the game's own handler serialize its current form and CSRF token.
        target.button.click();
      } catch (error) {
        // If submission started, its outcome is unknown. Keep pending until confirmed.
        if (!submitted) {
          pending = null;
          if (questQueue) { questQueue.uncertain = false; saveQuestQueue(); }
        }
        stop(`Could not click the game action: ${error.message}`);
        return;
      } finally {
        ownSubmit = false;
      }
      if (!submitted) {
        pending = null;
        if (questQueue) { questQueue.uncertain = false; saveQuestQueue(); }
        stop('The game did not accept the button click. No automatic retry was made.');
        return;
      }
      const verb = { eat: 'Eating', drink: 'Drinking', gather: 'Gathering', engage: 'Engaging', strike: 'Attacking', raid: 'Attacking', 'raid-summon': 'Summoning', travel: 'Returning to', 'quest-accept': 'Accepting', 'quest-claim': 'Turning in' }[kind];
      status(`${verb} ${target.name}; waiting for the game…`);
      schedule();
    }

    function waitForButton(button, now) {
      if (!button.disabled) {
        run.blockedAt = null;
        return false;
      }
      run.blockedAt ??= now;
      const cooldown = Number(button.dataset.cooldown) || 0;
      if (now - run.blockedAt > Math.max(RESPONSE_TIMEOUT_MS, cooldown * 1000 + 5000)) {
        stop('The game button stayed disabled unexpectedly.');
        return true;
      }
      status('Waiting for the game’s cooldown.');
      schedule();
      return true;
    }

    function recover(vitals, now, purpose) {
      let reason = purpose === 'hp' ? 'Automatic healing is disabled.' : 'Auto-eat is disabled.';
      if (purpose === 'hp' ? run.config.autoHeal : run.config.autoEat) {
        const food = foodAction();
        if (run.eaten >= run.config.meals) reason = 'Food item limit reached.';
        else if (!food) reason = run.config.food ? `Selected food (${run.config.food}) is unavailable.` : 'No food is available.';
        else {
          if (!waitForButton(food.button, now)) send({ ...food, purpose }, 'eat');
          return;
        }
      }
      if (!run.config.wait) return stop(`${purpose === 'hp' ? 'HP recovery required.' : 'Energy limit reached.'} ${reason}`);
      status(`${reason} Waiting for natural ${purpose === 'hp' ? 'HP' : 'energy'} regeneration (${vitals.current}/${vitals.maximum}).`);
      schedule();
    }

    function nextAction() {
      if (mode === 'arena') {
        const battle = arenaState();
        if (battle.active) {
          if (battle.name !== run.config.target) return null;
          return { ...battle, kind: 'strike', cost: 0 };
        }
        const target = targets().find(item => item.key === run.config.target);
        return target ? { ...target, kind: 'engage' } : null;
      }
      if (mode === 'raid') {
        const boss = raidState();
        if (!boss || boss.id !== run.raidId || boss.name !== run.config.target) return null;
        if (boss.hp === 0) {
          run.finishReason = 'Boss defeated.';
          return null;
        }
        if (boss.hp === null) {
          run.finishReason = 'Cannot read boss HP. No attack was sent.';
          return null;
        }
        if (!boss.button || boss.state !== 'active') return null;
        return { ...boss, kind: 'raid', cost: 0 };
      }
      const target = targets().find(item => item.key === run.config.target);
      return target ? { ...target, kind: 'gather' } : null;
    }

    function tick() {
      if (questNavigationDeadline) {
        if (humanCheck().required) return pauseForVerification();
        if (Date.now() >= questNavigationDeadline) return stop('Task navigation did not finish within 30 seconds. Inspect the page before resuming.');
        schedule();
        return;
      }
      if (restoring) {
        if (humanCheck().required) return pauseForVerification();
        if (Date.now() >= restoreDeadline) return stop('Activity restoration did not finish within 30 seconds. Inspect the page before trying again.');
        schedule();
        return;
      }
      if (!run?.active) return;
      const now = Date.now();
      if (now >= run.deadline) return stop('Time limit reached.');
      if (!navigator.onLine) return stop('Connection is offline.');
      if (humanCheck().required) return pauseForVerification();
      if (questQueue?.active && onTaskBoard) return tickQuestBoard();
      if (pending) {
        if (!pending.form.isConnected && confirmResult(pending, freshFlashes(pending))) {
          onSwapped();
          return;
        }
        if (now >= pending.deadline) {
          if (!run.config.autoRecover || !window.fetch || !window.AbortController) return stop('No confirmed response after 30 seconds. Automatic recovery is disabled or unavailable.');
          if (run.recoveries >= MAX_RECOVERY_RELOADS) return stop('Automatic recovery refresh limit reached. Inspect the result before restarting.');
          if (!responseRecovery && now >= pending.recoveryAt) void recoverResponse(pending);
        }
        schedule();
        return;
      }
      if (questRead) { schedule(); return; }
      const hp = health();
      if (!hp) return stop('Cannot read HP. No action was sent.');
      if (hp.current === 0) return stop('The hero was defeated.');
      updateFinishReason();
      // Heal before any further attack, including after the final allowed attack.
      // Never overlap healing with an unconfirmed request.
      if (run.config.autoHeal && hp.current < hp.maximum) return recover(hp, now, 'hp');
      if (questObjectiveFinished()) return navigateQuest('board');
      if (needsQuestProgressCheck()) return void checkQuestProgress();
      if (mode === 'raid' && run.finishReason === 'Boss defeated.' && run.config.maxRaids > 1) {
        const limit = raidRepeatLimit(run);
        if (limit) return stop(limit);
        if (now < run.nextAt) { schedule(); return; }
        return restartRaid();
      }
      if (run.finishReason) return stop(run.finishReason);
      const target = nextAction();
      if (!target) return stop(run.finishReason || 'The selected target or battle is no longer available.');
      const vitals = energy();
      if (!vitals || target.cost === null) return stop('Cannot read energy or the action cost. No action was sent.');
      if (vitals.maximum - target.cost < run.config.reserve) return stop('The energy reserve is too high for this action.');
      if (now < run.nextAt) {
        status(`Waiting ${Math.ceil((run.nextAt - now) / 100) / 10}s before the next action.`);
        schedule();
        return;
      }
      if (vitals.current - target.cost < run.config.reserve) return recover(vitals, now, 'energy');
      if (maintainPotions(now)) return;
      if (!target.button) return stop('The selected target is no longer available.');
      if (!waitForButton(target.button, now)) send(target, target.kind);
    }

    function flashKey(flash) { return JSON.stringify([flash.classList.contains('flash-ok'), flash.textContent.trim()]); }

    function freshFlashes(prior, page = document) {
      return Array.from(page.querySelectorAll('#flash-stack .flash'))
        .filter(flash => page === document ? !prior.flashes.has(flash) : !prior.flashKeys.has(flashKey(flash)));
    }

    function confirmResult(prior, flashes, page = document) {
      if (prior.kind === 'raid-summon') {
        const boss = raidState(page);
        return Boolean(boss && boss.name === prior.name && /^\d{1,30}$/.test(boss.id) && boss.id !== prior.previousRaidId
          && boss.hp > 0 && boss.state === 'active' && boss.button);
      }
      if (prior.kind === 'quest-accept' || prior.kind === 'quest-claim') {
        return questBoard(page).cards.some(card => card.name === prior.name
          && card.group === (prior.kind === 'quest-accept' ? 'Active' : 'Chronicled'));
      }
      const ok = flashes.filter(flash => flash.classList.contains('flash-ok'));
      const combatTurn = ok.some(flash => /\b(?:You (?:hit|miss(?:ed)?)|Your attack (?:misses|missed))\b/i.test(flash.textContent));
      if (prior.kind === 'eat') {
        const gained = prior.purpose === 'hp' ? (health(page)?.current ?? -1) > prior.hp : (energy(page)?.current ?? -1) > prior.energy;
        return gained && ok.some(flash => /\bYou (?:eat|ate)\b/i.test(flash.textContent));
      }
      if (prior.kind === 'drink') {
        const boosts = potionBoosts(page);
        const stats = prior.stat === 'combat' ? COMBAT_STATS : [prior.stat];
        const message = new RegExp(`\\bYou (?:drink|drank) (?:the )?${escapeRegExp(prior.name)}(?=\\s*(?:[.!?—–]|$))`, 'i');
        return Boolean(stats.every(stat => boosts?.get(stat)?.seconds > 0 && boosts.get(stat).boost >= prior.boost)
          && ok.some(flash => message.test(flash.textContent)));
      }
      if (prior.kind === 'engage') {
        const battle = arenaState(page);
        return battle.active && battle.name === run.config.target;
      }
      if (prior.kind === 'strike') {
        const battle = arenaState(page);
        const target = escapeRegExp(run.config.target);
        const personalTurn = new RegExp(`\\b(?:You (?:strike|hit|miss(?:ed)?|slay) (?:the )?${target}|Your attack (?:glances off|misses|missed) (?:the )?${target})(?=[\\s.!?,]|$)`, 'i').test(battle.log);
        // The live arena replaces its two result lines, so consecutive misses or
        // equal-damage hits can have identical text. Require the original fetch
        // to have completed before accepting a repeated outcome.
        const completedRepeat = page === document && prior.transportComplete
          && !humanCheck().required && !flashes.some(flash => !flash.classList.contains('flash-ok'));
        return Boolean(((personalTurn && (battle.log !== prior.log || completedRepeat)) || combatTurn)
          && ((battle.active && battle.name === run.config.target) || battle.victory));
      }
      if (prior.kind === 'raid') {
        const boss = raidState(page);
        if (!boss || boss.id !== run.raidId || boss.name !== run.config.target || !prior.hero || characterName(page) !== prior.hero) return false;
        const target = escapeRegExp(boss.name);
        const turn = new RegExp(`^You (?:hit|miss(?:ed)?) (?:the )?${target}(?=[\\s.!?,]|$)|^Your attack (?:misses|missed) (?:the )?${target}(?=[\\s.!?,]|$)`, 'i');
        const finishingBlow = new RegExp(`^You struck for ([\\d,]+) and felled ${target}!(?:\\s|$)`, 'i');
        const damage = raidPersonalDamage(page);
        // Boss HP may fall because of another player. Only this hero's own
        // persistent contribution can replace a missing transient hit message.
        const damageIncreased = prior.raidDamage !== null && damage !== null && damage > prior.raidDamage;
        return damageIncreased || ok.some(flash => {
          const text = flash.textContent.trim();
          const final = text.match(finishingBlow);
          return turn.test(text) || (boss.hp === 0 && ['defeated', 'slain'].includes(boss.state) && final && numberFrom(final[1]) > 0);
        });
      }
      const xp = page.getElementById('hud-xp')?.textContent;
      const xpChanged = Boolean(prior.xp && xp && prior.xp !== xp);
      return ok.some(flash => /\bYou gather\b/i.test(flash.textContent) || xpChanged)
        || (page !== document && xpChanged);
    }

    function cancelResponseRecovery() {
      responseRecovery?.abort();
      responseRecovery = null;
    }

    async function recoverResponse(prior) {
      // Recovery GETs must never be mistaken for the pending game POST.
      prior.transportUntil = Math.min(prior.transportUntil, performance.now());
      const controller = new AbortController();
      responseRecovery = controller;
      const attempt = generation;
      const timeout = setTimeout(() => controller.abort(), RECOVERY_FETCH_TIMEOUT_MS);
      const current = () => pending === prior && run?.active && attempt === generation && !ownNavigation;
      prior.recoveryChecks += 1;
      status(`Response stalled. Checking server state (${prior.recoveryChecks}/${MAX_RECOVERY_CHECKS})…`);
      let issue = 'The server still has no identifiable result for this action.';
      try {
        const url = new URL(location.href);
        url.hash = '';
        const response = await fetch(url.href, { method: 'GET', credentials: 'same-origin', cache: 'no-store', redirect: 'error', signal: controller.signal });
        if (!current()) return;
        if (!response.ok) throw new Error(`Server returned HTTP ${response.status}.`);
        const destination = new URL(response.url);
        if (destination.origin !== location.origin || destination.pathname !== location.pathname) throw new Error('The server returned a different page.');
        if ((mode === 'raid' && destination.searchParams.get('id') !== run.raidId)
          || (mode === 'gather' && (destination.searchParams.get('skill') || 'mining') !== skill)) throw new Error('The server returned a different activity.');
        const page = new DOMParser().parseFromString(await response.text(), 'text/html');
        if (!current()) return;
        if (!characterName() || characterName(page) !== characterName()) throw new Error('The active hero could not be verified.');
        const guard = humanCheckLink(page);
        if (guard) {
          serverGuardLink = guard;
          pauseForVerification();
          return;
        }
        if (mode === 'arena' && arenaZone(page) !== arenaZone()) throw new Error('The server returned a different arena area.');
        const flashes = freshFlashes(prior, page);
        const failure = flashes.find(flash => !flash.classList.contains('flash-ok'));
        if (failure) throw new Error(`Game message: ${failure.textContent.trim()}`);
        if (confirmResult(prior, flashes, page)) {
          reloadConfirmedResult(prior, page);
          return;
        }
      } catch (error) {
        if (!current()) return;
        issue = controller.signal.aborted ? 'The server-state check timed out.' : error.message;
      } finally {
        clearTimeout(timeout);
        if (responseRecovery === controller) responseRecovery = null;
      }
      if (!current()) return;
      if (prior.recoveryChecks >= MAX_RECOVERY_CHECKS) return stop(`Automatic recovery could not confirm the sent action. ${issue}`);
      prior.recoveryAt = Date.now() + 5000;
      status(`${issue} Checking once more in 5 seconds; no action has been resent.`);
    }

    function reloadConfirmedResult(prior, page) {
      if (!health(page)) return stop('Automatic recovery found a result but could not read HP. No further action was sent.');
      if (health(page).current === 0) return stop('The hero was defeated. No further action was sent.');
      if (!rememberActivity()) return stop(checkpointError || 'Could not save the exact activity for automatic recovery.');
      countConfirmedAction(checkpoint, prior.kind, page);
      if (mode === 'raid' && raidState(page)?.hp === 0) {
        if (checkpoint.finishReason !== 'Boss defeated.') checkpoint.raidsCompleted += 1;
        checkpoint.finishReason = 'Boss defeated.';
      } else if (mode === 'arena' && checkpoint.wins >= checkpoint.config.battles) checkpoint.finishReason = 'Arena win limit reached.';
      else if (checkpoint.completed >= checkpoint.config.actions) checkpoint.finishReason = 'Action limit reached.';
      checkpoint.recoveries += 1;
      checkpoint.nextAt = Date.now() + checkpoint.config.interval * 1000;
      checkpoint.canResume = true;
      checkpoint.restoreRequested = true;
      if (!writeCheckpoint()) return stop(checkpointError);
      Object.assign(run, runProgress(checkpoint), { active: false, raidsCompleted: checkpoint.raidsCompleted });
      if (questQueue) {
        const issue = updateQuestProgress(prior, freshFlashes(prior, page), page);
        syncQuestQueue();
        questQueue.uncertain = false;
        if (!saveQuestQueue()) return stop(questError);
        if (issue) {
          pending = null;
          return stop(issue);
        }
      }
      pending = null;
      ownNavigation = true;
      restoring = true;
      restoreDeadline = Date.now() + RESPONSE_TIMEOUT_MS;
      status('Server confirmed the action. Refreshing the saved activity and resuming…');
      ui['return-activity'].click();
      schedule();
    }

    function onSwapped() {
      scheduleVerification();
      refreshTargets(run?.active ? run.config.target : ui.target.value);
      refreshFood(run?.active ? run.config.food : ui.food.value);
      refreshPotions(run?.active ? run.config.potions || [] : selectedPotions());
      render();
      if (!pending || pending.form.isConnected) {
        if (humanCheck().required && (run?.active || restoring)) pauseForVerification();
        return;
      }
      const prior = pending;
      const flashes = freshFlashes(prior);
      const failure = flashes.find(flash => !flash.classList.contains('flash-ok'));
      const guardFailure = humanCheck().required && failure
        && /quick check needed|confirm you are human|human (?:check|verification)/i.test(failure.textContent);
      if (guardFailure && (run?.active || restoring || checkpoint)
        && (prior.kind === 'travel' || !confirmResult(prior, flashes))) {
        pending = null;
        if (questQueue) { questQueue.uncertain = false; saveQuestQueue(); }
        pauseForVerification();
        return;
      }
      if (failure && !guardFailure) {
        pending = null;
        if (questQueue) { questQueue.uncertain = false; saveQuestQueue(); }
        return stop(`Game message: ${failure.textContent.trim()}`);
      }
      if (prior.kind === 'travel') {
        pending = null;
        if (!checkpoint || arenaZone() !== checkpoint.zone) return stop('The saved arena area was not confirmed. No combat action was sent.');
        restoring = false;
        ownNavigation = false;
        clearTimeout(timer);
        unlockIfIdle();
        status('Arena area restored. Checking the saved target…');
        return;
      }
      if (!confirmResult(prior, flashes)) {
        // A content refresh can replace the form before its actual response arrives.
        // Keep the original request and deadline; never submit a replacement action.
        if (humanCheck().required && (run?.active || restoring)) pauseForVerification();
        else if (run?.active) status('Page updated. Still waiting for the game to confirm the sent action…');
        return;
      }
      cancelResponseRecovery();
      pending = null;
      if (prior.kind === 'raid-summon') {
        const resume = restoring && checkpoint?.restoreRequested;
        restoring = false;
        ownNavigation = false;
        clearTimeout(timer);
        unlockIfIdle();
        if (!checkpoint) return status('Stopped. The last raid summon completed.');
        checkpoint.canResume = true;
        if (!writeCheckpoint()) return stop(checkpointError);
        // beginRestore continues after its Web Lock has actually been released.
        if (resume) return status('Raid summon confirmed. Checking the new raid…');
        return status('The raid summon completed. Use Restore & resume when ready.');
      }
      if (run) countConfirmedAction(run, prior.kind);
      if (questQueue) {
        questQueue.uncertain = false;
        if (prior.kind === 'quest-claim') {
          if (!questQueue.finished.includes(prior.name)) questQueue.finished.push(prior.name);
          if (questQueue.current?.name === prior.name) questQueue.current = null;
        }
      }
      updateFinishReason();
      if (run) run.nextAt = Date.now() + run.config.interval * 1000;
      syncQuestQueue();
      const progressIssue = updateQuestProgress(prior, flashes);
      if (questQueue && !saveQuestQueue()) return stop(questError);
      if (progressIssue) return stop(progressIssue);
      if ((humanCheck().required && run?.active) || checkpoint) {
        pauseForVerification();
        return;
      }
      if (!run?.active) {
        unlockIfIdle();
        status('Stopped. The last sent action completed.');
        return;
      }
      if (questQueue && mode === 'quest') {
        schedule();
        status('Quest request confirmed. Checking the next objective.');
        return;
      }
      const hp = health();
      if (!hp) return stop('Cannot read HP. No further action was sent.');
      if (hp.current === 0) return stop('The hero was defeated.');
      if (run.config.autoHeal && hp.current < hp.maximum) {
        tick();
        return;
      }
      if (questQueue?.active) { tick(); return; }
      if (run.finishReason) return tick();
      schedule();
      status('Action confirmed. Waiting before the next action.');
    }

    function countConfirmedAction(progress, kind, page = document) {
      if (kind === 'eat') progress.eaten += 1;
      else if (kind === 'drink') progress.drunk += 1;
      else if (!['engage', 'quest-accept', 'quest-claim'].includes(kind)) progress.completed += 1;
      if (kind === 'strike' && arenaState(page).victory) progress.wins += 1;
    }

    function updateFinishReason() {
      if (!run || run.finishReason) return;
      if (mode === 'raid' && raidState()?.id === run.raidId && raidState()?.hp === 0) {
        run.raidsCompleted += 1;
        run.finishReason = 'Boss defeated.';
      } else if (mode === 'arena' && run.wins >= run.config.battles) run.finishReason = 'Arena win limit reached.';
      else if (run.completed >= run.config.actions) run.finishReason = 'Action limit reached.';
    }

    let saved = DEFAULTS;
    try {
      saved = readSettings();
    } catch (error) {
      message = `Could not load settings; using defaults: ${error.message}`;
    }
    try {
      const catalog = GM_getValue(POTION_CATALOG_KEY, []);
      if (Array.isArray(catalog)) potionCatalog = catalog.filter(potion => potion && Object.hasOwn(POTION_STATS, potion.stat)
        && typeof potion.name === 'string' && potion.name.length > 0 && potion.name.length <= 200
        && Number.isFinite(potion.boost) && potion.boost > 0);
    } catch (error) { ui['potion-info'].textContent = `Could not load remembered potion choices: ${error.message}`; }
    applySettings(saved);
    checkpoint = readCheckpoint();
    if (checkpoint) applySettings(checkpoint.config);
    try {
      questQueue = readQuestQueue();
      if (questQueue) {
        if (!questQueue.continuation && !checkpoint?.restoreRequested) questQueue.active = false;
        applySettings(questQueue.config);
        saveQuestQueue();
      }
    } catch (error) { questError = `Could not read the quest queue: ${error.message}`; }
    const targetLabel = { gather: 'Resource', arena: 'Enemy', raid: 'Boss', quest: 'Quest selection', slayer: 'Slayer tasks', diary: 'Area', hall: 'Target' }[mode];
    ui['target-label'].textContent = targetLabel;
    ui.target.setAttribute('aria-label', targetLabel);
    if (mode === 'hall') message = 'Choose an activity above.';
    else if (!ui.target.value) message = mode === 'gather' ? 'No unlocked gathering actions. Choose another skill or meet its level requirement.' : 'Choose a target using the game’s controls first.';
    if (!navigator.locks?.request) message = 'Web Locks are unavailable. A browser with Web Locks support is required.';
    if (humanCheck().required) message = 'Complete the game’s human check yourself before restoring or starting an activity.';
    else if (checkpoint) message = 'Saved activity ready. Use its Restore control or discard it to begin a new run.';
    if (checkpointError) message = checkpointError;
    if (questQueue) message = questQueue.source === 'diary' ? 'Diary run saved. Resume it or discard it to begin a new run.'
      : questQueue.source === 'slayer' ? 'Slayer run saved. Resume it or discard it to begin a new run.' : 'Quest queue saved. Resume it or discard it to begin a new run.';
    if (questError) message = questError;
    checkSounds = createCheckSounds(ui, () => humanCheck().required);
    render();

    const responseObserver = window.PerformanceObserver?.supportedEntryTypes?.includes('resource')
      ? new PerformanceObserver(entries => {
        const prior = pending;
        if (!prior || prior.kind !== 'strike') return;
        for (const entry of entries.getEntries()) {
          if (entry.name !== prior.transportURL || entry.initiatorType !== 'fetch'
            || entry.startTime < prior.transportStartedAt || entry.startTime >= prior.transportUntil
            || entry.responseStart <= 0 || entry.responseEnd < entry.responseStart || entry.decodedBodySize <= 0) continue;
          if (typeof entry.responseStatus === 'number' && (entry.responseStatus < 200 || entry.responseStatus >= 300)) continue;
          prior.transportComplete = true;
        }
      }) : null;
    responseObserver?.observe({ type: 'resource', buffered: true });

    document.addEventListener('dank:swapped', onSwapped);
    document.addEventListener('submit', event => {
      if (!(event.target instanceof HTMLFormElement)) return;
      if (ownSubmit) {
        submitted = true;
        return;
      }
      if (pending || questNavigationDeadline) {
        // A second form response could replace the pending action's result.
        event.preventDefault();
        event.stopImmediatePropagation();
        stop('Manual action paused while a game response is pending.');
        return;
      }
      if (run?.active || starting) stop('Stopped for a manual game action.');
    }, true);
    document.addEventListener('click', event => {
      if (event.isTrusted && !event.composedPath().some(node => node === ui.testSound || node === ui.alertSound)) void checkSounds.arm();
      const link = event.target.closest?.('a[href]');
      if (link && guardURL(link)) {
        if (!openingVerification) {
          if (!questQueue && !checkpoint && !['hall', 'quest'].includes(mode)) rememberActivity();
          pauseForVerification();
        }
        openingVerification = true;
        ownNavigation = true;
      } else if (!ownNavigation && (run?.active || starting || restoring) && link) stop('Stopped for navigation.');
    }, true);
    document.addEventListener('keydown', event => {
      if (event.key === 'Escape' && (run?.active || starting || restoring || potionRead || (questQueue || checkpoint)?.verification)) {
        event.preventDefault();
        stop();
      } else if (!event.repeat && event.altKey && event.shiftKey && event.code === 'KeyG') {
        event.preventDefault();
        void checkSounds.arm();
        if (run?.active || starting || restoring || potionRead) stop();
        else void start();
      }
    });
    window.addEventListener('offline', () => stop('Connection is offline.'));
    window.addEventListener('pagehide', () => {
      clearTimeout(verificationTimer);
      verificationTimer = null;
      responseObserver?.disconnect();
      cancelResponseRecovery();
      potionRead?.abort();
      potionRead = null;
      checkSounds.dispose();
      if (ownNavigation || (location.pathname === '/guard.php' && (questQueue || checkpoint)?.verification?.visited)) {
        if (run) run.active = false;
        clearTimeout(timer);
        return;
      }
      stop('Stopped for navigation.');
    });
    window.addEventListener('pageshow', event => {
      responseObserver?.observe({ type: 'resource', buffered: true });
      checkSounds.reactivate();
      checkSounds.update(humanCheck().required);
      if (event.persisted && (questQueue || checkpoint) && !pending) {
        // Back/forward restores an old JS heap. Read current counters before
        // exposing Resume; the cached page must not reset the run's budget.
        clearTimeout(timer);
        questNavigationDeadline = 0;
        ownNavigation = false;
        openingVerification = false;
        run = null;
        unlockIfIdle();
        try {
          checkpoint = readCheckpoint();
          if (checkpoint) { checkpoint.restoreRequested = false; checkpoint.verification = false; writeCheckpoint(); }
          questQueue = readQuestQueue();
          if (questQueue) { questQueue.active = false; questQueue.continuation = null; saveQuestQueue(); }
          staleTaskBoard = ['slayer', 'diary'].includes(mode) && questQueue?.source === mode;
        } catch (error) { questError = `Could not restore the quest queue: ${error.message}`; }
        status(questError || checkpointError || (checkpoint ? 'Returned to a cached activity. Inspect the page before using Restore & resume.'
          : staleTaskBoard ? `Returned to a cached ${mode === 'slayer' ? 'Slayer' : 'diary'} board. Resume reloads fresh task controls before continuing.`
          : 'Returned to a previous page. Use Resume quests to check fresh progress, or discard the queue.'));
      }
      scheduleVerification();
    });
    window.addEventListener('focus', () => {
      if (starting || run?.active || pending || restoring || checkpoint || questQueue || potionRead) return;
      try { applySettings(readSettings()); }
      catch (error) { status(`Could not load shared settings: ${error.message}`); }
    });
    function saveEditedSettings(event) {
      if (!event.target.matches('input, select') || event.target.disabled) return;
      const config = settingsFromUI(false);
      if (!config) return;
      try { saveSettings(config); }
      catch (error) { status(`Could not save settings: ${error.message}`); }
    }
    ui.controls.addEventListener('input', saveEditedSettings);
    ui.controls.addEventListener('change', saveEditedSettings);
    ui['load-potions'].addEventListener('click', () => void loadQuestPotions());
    ui.start.addEventListener('click', () => void start());
    function discardSavedRun() {
      questQueue = null;
      if (!saveQuestQueue()) return stop(questError);
      clearCheckpoint();
      stop(checkpointError || 'Stopped. Saved activity discarded.');
    }
    ui.stop.addEventListener('click', discardSavedRun);
    ui.discard.addEventListener('click', discardSavedRun);
    ui.resume.addEventListener('click', () => void restoreSavedRun());
    ui['quest-resume'].addEventListener('click', () => void startQuestQueue(true));
    ui['quest-discard'].addEventListener('click', discardSavedRun);
    ui.collapse.addEventListener('click', () => {
      ui.controls.hidden = !ui.controls.hidden;
      ui.collapse.textContent = ui.controls.hidden ? '+' : '−';
      ui.collapse.setAttribute('aria-expanded', String(!ui.controls.hidden));
      ui.collapse.setAttribute('aria-label', ui.controls.hidden ? 'Expand panel' : 'Minimize panel');
    });

    function restore() {
      if (!host.isConnected) {
        stop('Stopped because the panel was removed. Inspect the game before restarting.');
        document.documentElement.appendChild(host);
      }
      positionPanel(host);
      ui.controls.hidden = false;
      ui.collapse.textContent = '−';
      ui.collapse.setAttribute('aria-expanded', 'true');
      ui.collapse.setAttribute('aria-label', 'Minimize panel');
    }
    const observer = new MutationObserver(() => {
      if (!document?.documentElement) return;
      if (!host.isConnected) restore();
      if (document.body && document.body !== observedBody) {
        guardObserver.disconnect();
        observedBody = document.body;
        guardObserver.observe(observedBody, guardObservation);
        render();
        scheduleVerification();
      }
    });
    observer.observe(document.documentElement, { childList: true });
    const guardObserver = new MutationObserver(() => {
      if ((run?.active || restoring) && humanCheck().required) pauseForVerification();
      else if (document?.documentElement) render();
      scheduleVerification();
    });
    const guardObservation = { childList: true, subtree: true, attributes: true, attributeFilter: ['hidden', 'style', 'class', 'href'] };
    let observedBody = document.body;
    guardObserver.observe(observedBody, guardObservation);
    scheduleVerification();
    if (!questError && checkpoint?.restoreRequested) Promise.resolve().then(restoreSavedRun);
    else if (!questError && questQueue?.active && questQueue.continuation) Promise.resolve().then(continueQuestQueue);
    return restore;
  }
})();
