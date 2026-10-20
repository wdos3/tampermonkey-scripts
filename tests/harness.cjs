'use strict';

const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { JSDOM } = require('jsdom');
const { arenaContent, raidContent, content, foodMarkup, potionMarkup, page } = require('./fixture.cjs');

const source = readFileSync(join(__dirname, '..', 'dankscape-gather.user.js'), 'utf8');

function lockManager() {
  let held = false;
  return {
    async request(name, options, callback) {
      assert.equal(name, 'dankscape-gather-assistant:v1');
      assert.equal(options.ifAvailable, true);
      if (held) return callback(null);
      held = true;
      try { return await callback({ name }); }
      finally { held = false; }
    },
  };
}

async function flush() {
  for (let i = 0; i < 8; i += 1) await Promise.resolve();
}

function fixture(t, options = {}) {
  const skill = options.skill || 'mining';
  const mode = options.mode || 'gather';
  const dom = new JSDOM(page(skill, options.locked, mode), { url: options.url || `https://dankscape.com/${options.hall ? 'game' : mode === 'quest' ? 'quests' : mode}.php?${mode === 'raid' ? 'id=123' : `skill=${skill}`}`, runScripts: 'outside-only' });
  const { window } = dom;
  const { document } = window;
  const clock = { now: options.now || 0, nextId: 0, timers: new Map() };
  window.Date.now = () => clock.now;
  window.performance.now = () => clock.now;
  let resourceCallback = null;
  window.PerformanceObserver = class {
    static supportedEntryTypes = ['resource'];
    constructor(callback) { this.callback = callback; }
    observe() { resourceCallback = this.callback; }
    disconnect() { resourceCallback = null; }
  };
  function resource(entry) { resourceCallback?.({ getEntries: () => [entry] }); }
  window.setTimeout = (callback, delay = 0) => {
    const id = ++clock.nextId;
    clock.timers.set(id, { at: clock.now + delay, callback });
    return id;
  };
  window.clearTimeout = id => clock.timers.delete(id);
  Object.defineProperty(window.navigator, 'locks', { value: options.noLocks ? undefined : options.locks || lockManager() });
  const values = options.values || {};
  if (options.saved) values[`settings:${mode === 'gather' ? skill : mode}`] = options.saved;
  window.GM_getValue = (key, fallback) => key === 'alerts:human-check-sound' ? options.soundEnabled ?? fallback : values[key] ?? fallback;
  window.GM_setValue = (key, value) => {
    if (options.storageError) throw new Error('storage unavailable');
    state.savedValues[key] = value;
    values[key] = value;
  };
  for (const [key, value] of Object.entries(options.session || {})) window.sessionStorage.setItem(key, value);
  const state = { requests: [], navigations: [], savedValues: {}, verificationClicks: 0, xp: 0, foods: (options.foods || []).map(food => ({ ...food })) };
  state.potions = (options.potions || []).map(potion => ({ ...potion }));
  state.boosts = (options.boosts || []).map(boost => ({ ...boost, expiresAt: clock.now + boost.seconds * 1000 }));
  state.arena = { active: Boolean(options.activeBattle), name: options.enemyName || 'Field Mouse', zone: options.zone || 'Meadowbrook Fields', hp: options.enemyHP ?? 8, log: options.activeBattle ? 'The battle begins.' : '' };
  state.raid = options.raidList ? null : { id: options.raidId || '123', name: options.bossName || 'Fixture Boss', hp: options.bossHP ?? 30, maximum: options.bossMaximum ?? Math.max(1, options.bossHP ?? 30), state: 'Active' };
  if (state.raid && options.raidFighters) state.raid.fighters = options.raidFighters.map(fighter => ({ ...fighter }));
  const vitals = document.getElementById('hud-energy');
  const hpElement = document.querySelector('.hp-text');
  const hpMaximum = options.hpMaximum ?? 100;
  hpElement.textContent = `${options.hp ?? hpMaximum} / ${hpMaximum} HP`;
  vitals.textContent = `${options.energy ?? 100} / 100`;
  if (options.missingGatherForm) {
    document.querySelector('section.content form').remove();
    document.getElementById('hud-xp').innerHTML = `${skill} <strong>1</strong> · 0 / 83 XP`;
  }

  function renderContent(token = 'fixture-token', cooldown = false) {
    document.querySelector('section.content').innerHTML = mode === 'diary' ? options.diaryContent(state, token) : mode === 'slayer' ? options.slayerContent(state, token) : mode === 'quest' ? options.questContent(state, token) : mode === 'arena' ? arenaContent(state.arena, token, cooldown)
      : mode === 'raid' ? raidContent(state.raid, token, cooldown, options.raidCatalog) : content(skill, token, cooldown, options.locked);
  }
  if (mode !== 'gather') renderContent();

  function updateFood() {
    document.querySelector('.quick-eat')?.remove();
    const current = Number(vitals.textContent.split('/')[0]);
    if (current >= 100 && Number(hpElement.textContent.split('/')[0]) >= hpMaximum) return;
    document.querySelector('aside').insertAdjacentHTML('beforeend', foodMarkup(state.foods, options.selectedFood));
    const form = document.querySelector('.quick-eat');
    if (!form) return;
    form.querySelector('.btn-eat').addEventListener('click', () => { form.querySelector('[name="fill"]').value = ''; });
  }
  updateFood();

  function updatePotions() {
    document.querySelector('.quick-drink')?.remove();
    document.getElementById('boost-hud-wrap')?.remove();
    document.querySelector('aside').insertAdjacentHTML('beforeend', potionMarkup(state.potions,
      state.boosts.map(boost => ({ ...boost, seconds: Math.max(0, Math.ceil((boost.expiresAt - clock.now) / 1000)) }))));
  }
  updatePotions();
  function updateBoostTimers() {
    for (const timer of document.querySelectorAll('.boost-timer')) {
      const boost = state.boosts.find(boost => boost.stat === timer.dataset.stat);
      const seconds = Math.max(0, Math.ceil((boost.expiresAt - clock.now) / 1000));
      timer.textContent = seconds ? `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}` : 'expired';
      timer.dataset.secs = Math.max(0, seconds - 1);
    }
    window.setTimeout(updateBoostTimers, 1000);
  }
  window.setTimeout(updateBoostTimers, 1000);

  function showGuard({ notice = true, hidden = false, dispatch = true } = {}) {
    document.getElementById('fixture-guard')?.remove();
    document.querySelector('section.content').insertAdjacentHTML('afterbegin', `<div id="fixture-guard" ${hidden ? 'hidden' : ''}><h2>Quick human check</h2><a href="/guard.php?from=${mode}">Verify I’m human</a></div>`);
    document.querySelector('#fixture-guard a').addEventListener('click', event => { event.preventDefault(); state.verificationClicks += 1; });
    if (notice) document.getElementById('flash-stack').innerHTML = '<div class="flash flash-error">Quick check needed — confirm you are human to keep gathering.</div>';
    if (dispatch) document.dispatchEvent(new window.CustomEvent('dank:swapped'));
  }

  function swap({ fail = false, guard = false, confirmed = true, cooldown = true, kind = 'gather', selectedId, energyGain, hpGain, hpText, showCheck = false, combatLog, flash } = {}) {
    if (guard) {
      renderContent();
      showGuard();
      return;
    }
    if (!fail) {
      if (kind === 'eat') {
        const food = state.foods.find(item => item.id === selectedId);
        if (!food || food.quantity < 1) throw new Error('Fixture submitted unavailable food');
        food.quantity -= 1;
        const current = Number(vitals.textContent.split('/')[0]);
        vitals.textContent = `${Math.min(100, current + (energyGain ?? food.gain))} / 100`;
        const hp = Number(hpElement.textContent.split('/')[0]);
        hpElement.textContent = `${Math.min(hpMaximum, hp + (hpGain ?? food.hpGain ?? food.gain))} / ${hpMaximum} HP`;
      } else if (kind === 'drink') {
        const potion = state.potions.find(potion => potion.id === selectedId);
        if (!potion || potion.quantity < 1) throw new Error('Fixture submitted an unavailable potion');
        potion.quantity -= 1;
        if (!options.noPotionBoost) {
          const stats = potion.stat === 'combat' ? ['attack', 'strength', 'defense'] : [potion.stat];
          state.boosts = state.boosts.filter(boost => !stats.includes(boost.stat));
          state.boosts.push(...stats.map(stat => ({ stat, boost: potion.boost, expiresAt: clock.now + (potion.duration ?? 300) * 1000 })));
        }
      } else if (kind === 'engage') {
        state.arena = { active: true, name: selectedId === '2' ? 'Other Foe' : options.enemyName || 'Field Mouse', zone: state.arena.zone, hp: options.enemyHP ?? 8, log: 'The hero and foe have entered the arena.' };
      } else if (kind === 'strike') {
        const damage = options.miss ? 0 : options.damage ?? 3;
        state.arena.hp = Math.max(0, state.arena.hp - damage);
        state.arena.log = options.miss ? `Your attack glances off the ${state.arena.name}.` : `You strike the ${state.arena.name} for ${damage} damage.`;
        state.arena.log += `\nThe ${state.arena.name} swings and misses.`;
        if (state.arena.hp === 0) {
          state.arena.active = false;
          state.arena.log += `\nYou slay the ${state.arena.name}!`;
        }
        const lost = state.arena.active || options.damageOnKill ? options.hpLoss ?? 1 : 0;
        hpElement.textContent = `${Math.max(0, Number(hpElement.textContent.split('/')[0]) - lost)} / ${hpMaximum} HP`;
        if (!confirmed) state.arena.log = '';
      } else if (kind === 'travel') {
        state.arena.zone = ['Meadowbrook Fields', 'Mossgill Sewers', 'Volcanic Caverns'][Number(selectedId) - 1];
      } else if (kind === 'raid-summon') {
        state.raid = { id: '124', name: 'Fixture Boss', hp: 10, maximum: 10, state: 'Active', ...options.summonedBoss };
      } else if (kind === 'raid') {
        state.raid.hp = Math.max(0, state.raid.hp - (options.miss ? 0 : options.damage ?? 10));
        if (state.raid.fighters && !options.miss) {
          let hero = state.raid.fighters.find(fighter => fighter.hero === 'Local test hero');
          if (!hero) { hero = { hero: 'Local test hero', damage: 0 }; state.raid.fighters.push(hero); }
          hero.damage += options.damage ?? 10;
        }
        hpElement.textContent = `${Math.max(0, Number(hpElement.textContent.split('/')[0]) - (options.hpLoss ?? 1))} / ${hpMaximum} HP`;
      } else {
        state.xp += 18;
        vitals.textContent = `${Number(vitals.textContent.split('/')[0]) - 4} / 100`;
        document.getElementById('hud-xp').textContent = `${skill} 1 · ${state.xp} / 83 XP`;
      }
    }
    if (hpText !== undefined) hpElement.textContent = hpText;
    if (combatLog !== undefined) state.arena.log = combatLog;
    renderContent(`fixture-token-${state.requests.length}`, cooldown);
    updateFood();
    updatePotions();
    const drunkPotion = kind === 'drink' ? state.potions.find(potion => potion.id === selectedId) : null;
    document.getElementById('flash-stack').innerHTML = fail
      ? '<div class="flash flash-error">Not enough energy.</div>'
      : flash !== undefined ? `<div class="flash flash-ok">${flash}</div>`
      : !confirmed || kind === 'engage' || kind === 'strike' || kind === 'travel' ? ''
      : drunkPotion ? `<div class="flash flash-ok">You drink the ${drunkPotion.name}. +${drunkPotion.boost} ${drunkPotion.stat === 'defense' ? 'Defence' : drunkPotion.stat[0].toUpperCase() + drunkPotion.stat.slice(1)} — active for 5 more minutes.</div>`
      : kind === 'raid-summon' ? '<div class="flash flash-ok">You summon the boss.</div>'
      : `<div class="flash flash-ok">${kind === 'eat' ? 'You eat the food and recover energy.' : kind === 'raid' ? options.miss ? `You miss ${state.raid.name}.` : `You hit ${state.raid.name} for ${options.damage ?? 10}.` : 'You gather 1 Fixture resource. +18 XP.'}</div>`;
    if (showCheck) showGuard({ notice: false, dispatch: false });
    document.dispatchEvent(new window.CustomEvent('dank:swapped'));
    if (cooldown) window.setTimeout(() => {
      for (const button of document.querySelectorAll('section.content button[data-cooldown]')) button.disabled = false;
    }, 1000);
  }

  document.addEventListener('submit', event => {
    if (event.defaultPrevented) return;
    event.preventDefault();
    const form = event.target;
    const button = event.submitter || form.querySelector('button');
    assert.ok(button, 'A native submitter must be present');
    if (button.disabled) return;
    if (window.location.pathname === '/guard.php') { state.verificationClicks += 1; return; }
    const payload = Object.fromEntries(new window.FormData(form, button));
    button.disabled = true;
    const startedAt = clock.now;
    const requestURL = new URL(form.getAttribute('action') || window.location.href, window.location.href).href;
    state.requests.push(payload);
    if (mode === 'diary') { options.diarySubmit?.(payload, state, window); return; }
    if (mode === 'slayer') { options.slayerSubmit?.(payload, state, window); return; }
    if (mode === 'quest') {
      options.questSubmit?.(payload, state, window);
      if (!options.noResponse && !payload.zone_id) window.setTimeout(() => {
        renderContent(`fixture-token-${state.requests.length}`);
        document.dispatchEvent(new window.CustomEvent('dank:swapped'));
      }, options.latency ?? 100);
      return;
    }
    const kind = form.classList.contains('quick-eat') ? 'eat' : form.classList.contains('quick-drink') ? 'drink' : payload.zone_id ? 'travel' : payload.action === 'summon' ? 'raid-summon' : mode === 'arena' ? payload.action === 'swing' ? 'strike' : 'engage' : mode === 'raid' ? 'raid' : 'gather';
    const noResponse = kind === 'eat' ? options.noEatResponse : kind === 'drink' ? options.noDrinkResponse : kind === 'travel' ? options.noTravelResponse : options.noResponse;
    const latency = kind === 'eat' ? options.eatLatency ?? options.latency : kind === 'drink' ? options.drinkLatency ?? options.latency : options.latency;
    const guarded = options.guardOnRequest === state.requests.length;
    if (!noResponse) window.setTimeout(() => {
      resource({ name: requestURL, initiatorType: 'fetch', startTime: startedAt,
        responseStart: clock.now || 0.01, responseEnd: clock.now || 0.01, decodedBodySize: 1, responseStatus: 200 });
      swap({ ...(kind === 'eat' ? options.eatResult : kind === 'drink' ? options.drinkResult : options.result), guard: guarded,
        kind, selectedId: payload.inv_id || payload.monster_id || payload.zone_id || payload.boss });
    }, latency ?? 100);
  });
  if (options.guard) showGuard({ dispatch: false });
  options.beforeScript?.(window);
  window.eval(source);
  const ui = document.getElementById('dankscape-gather-assistant').shadowRoot;
  ui.addEventListener('click', event => {
    if (['return-activity', 'quest-navigation', 'verify-link'].includes(event.target.id)) {
      event.preventDefault();
      state.navigations.push(event.target.href);
    }
  });
  document.addEventListener('click', event => {
    const link = event.target.closest?.('a[href]');
    if (!link) return;
    event.preventDefault();
    state.navigations.push(link.href);
  });

  async function advance(ms) {
    await flush();
    const until = clock.now + ms;
    let count = 0;
    while (true) {
      const next = Array.from(clock.timers).filter(([, timer]) => timer.at <= until).sort((a, b) => a[1].at - b[1].at)[0];
      if (!next) break;
      if (++count > 10000) throw new Error('Timer loop did not settle');
      clock.now = next[1].at;
      clock.timers.delete(next[0]);
      next[1].callback();
      await flush();
    }
    clock.now = until;
    await flush();
  }

  async function start(settings = {}) {
    for (const [id, value] of Object.entries(settings)) {
      if (id === 'potions') {
        for (const potion of value) ui.getElementById(`potion-${potion.stat}`).value = potion.name;
        continue;
      }
      const element = ui.getElementById(id);
      if (element.type === 'checkbox') element.checked = value;
      else element.value = String(value);
    }
    ui.getElementById('start').click();
    await flush();
  }

  t.after(() => window.close());
  return { window, document, state, ui, advance, start, swap, showGuard, resource, values,
    refresh: () => { renderContent(); updateFood(); updatePotions(); document.dispatchEvent(new window.CustomEvent('dank:swapped')); },
    clearGuard: () => { document.getElementById('fixture-guard')?.remove(); document.getElementById('flash-stack').replaceChildren(); },
    session: () => ({ ...window.sessionStorage }),
    resume: async () => { ui.getElementById('resume').click(); await flush(); },
    status: () => ui.getElementById('status').textContent,
    stop: () => ui.getElementById('stop').click() };
}


module.exports = { fixture, lockManager, flush, source };
