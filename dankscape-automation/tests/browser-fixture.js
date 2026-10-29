'use strict';

window.GM_getValue = (key, fallback) => {
  const stored = localStorage.getItem(`dankscape-preview:${key}`);
  return stored ? JSON.parse(stored) : fallback;
};
window.GM_setValue = (key, value) => localStorage.setItem(`dankscape-preview:${key}`, JSON.stringify(value));
window.GM_registerMenuCommand = (name, callback) => {
  if (name === 'Show DankScape Assistant') document.getElementById('show-panel').addEventListener('click', callback);
};
document.getElementById('hide-panel').addEventListener('click', () => {
  const host = document.getElementById('dankscape-gather-assistant');
  host.hidden = true;
  host.style.setProperty('display', 'none', 'important');
});
document.getElementById('remove-panel').addEventListener('click', () => {
  document.getElementById('dankscape-gather-assistant').remove();
});

const energyElement = document.getElementById('hud-energy');
const contentElement = document.querySelector('section.content');
const hpElement = document.querySelector('.hp-text');
const mode = location.pathname === '/arena.php' ? 'arena' : location.pathname === '/raid.php' ? 'raid' : 'gather';
let arena = { active: false, name: 'Field Mouse', hp: 8, log: '',
  zone: ['Meadowbrook Fields', 'Mossgill Sewers', 'Volcanic Caverns'][Number(new URLSearchParams(location.search).get('zone') || 1) - 1] || 'Meadowbrook Fields' };
const boss = { id: '123', name: 'Fixture Boss', hp: 30, maximum: 30, state: 'Active', fighters: [] };
let requests = Number(sessionStorage.getItem('dankscape-fixture:requests') || 0);
document.getElementById('request-count').textContent = String(requests);
let xp = 0;
const gatheringSkill = new URLSearchParams(location.search).get('skill') || 'mining';
if (mode === 'gather') contentElement.insertAdjacentHTML('afterbegin', skillProgressMarkup(gatheringSkill, xp));
let foodRemaining = 20;
const potions = [
  { id: 'super-attack', name: 'Super Attack Elixir', stat: 'attack', boost: 7, quantity: 20 },
  { id: 'super-strength', name: 'Super Strength Elixir', stat: 'strength', boost: 7, quantity: 20 },
  { id: 'defense', name: 'Defense Elixir', stat: 'defense', boost: 4, quantity: 20 },
];
let boosts = [];
const RAID_STATE_KEY = 'dankscape-fixture:raid-state';
if (mode === 'raid') {
  const saved = JSON.parse(sessionStorage.getItem(RAID_STATE_KEY) || 'null');
  if (saved) {
    Object.assign(boss, saved.boss);
    hpElement.textContent = saved.hp;
    energyElement.textContent = saved.energy;
    foodRemaining = saved.foodRemaining;
    potions.splice(0, potions.length, ...saved.potions);
    boosts = saved.boosts;
    document.getElementById('food-count').textContent = String(foodRemaining);
    updateFood();
  }
  contentElement.innerHTML = raidContent(new URLSearchParams(location.search).has('id') ? boss : null, `fixture-token-${requests}`);
}
function saveRaidState() {
  if (mode === 'raid') sessionStorage.setItem(RAID_STATE_KEY, JSON.stringify({ boss, hp: hpElement.textContent,
    energy: energyElement.textContent, foodRemaining, potions, boosts }));
}
const RECOVERY_STATE_KEY = 'dankscape-fixture:recovery-state';
let recoveryReads = Number(sessionStorage.getItem('dankscape-fixture:recovery-reads') || 0);
document.getElementById('recovery-count').textContent = String(recoveryReads);
const realFetch = window.fetch.bind(window);
window.fetch = async (url, options) => {
  const saved = sessionStorage.getItem(RECOVERY_STATE_KEY);
  if (!saved || options?.method !== 'GET' || new URL(url).origin !== location.origin) return realFetch(url, options);
  recoveryReads += 1;
  sessionStorage.setItem('dankscape-fixture:recovery-reads', String(recoveryReads));
  document.getElementById('recovery-count').textContent = String(recoveryReads);
  return { ok: true, status: 200, url: String(url), text: async () => JSON.parse(saved).html };
};
const restoredState = sessionStorage.getItem(RECOVERY_STATE_KEY);
if (restoredState) {
  const saved = JSON.parse(restoredState);
  if (saved.mode === mode) {
    Object.assign(arena, saved.arena);
    Object.assign(boss, saved.boss);
    xp = saved.xp;
    foodRemaining = saved.foodRemaining;
    if (saved.potions) potions.splice(0, potions.length, ...saved.potions);
    boosts = saved.boosts || [];
    const snapshot = new DOMParser().parseFromString(saved.html, 'text/html');
    for (const selector of ['section.content', '#flash-stack']) document.querySelector(selector).innerHTML = snapshot.querySelector(selector).innerHTML;
    for (const selector of ['#hud-energy', '.hp-text', '#hud-xp']) document.querySelector(selector).textContent = snapshot.querySelector(selector).textContent;
    document.getElementById('food-count').textContent = String(foodRemaining);
    sessionStorage.removeItem(RECOVERY_STATE_KEY);
    updateFood();
  }
}

function updatePotions() {
  document.querySelector('.quick-drink')?.remove();
  document.getElementById('boost-hud-wrap')?.remove();
  document.querySelector('aside').insertAdjacentHTML('beforeend', potionMarkup(potions,
    boosts.map(boost => ({ ...boost, seconds: Math.max(0, Math.ceil((boost.expiresAt - Date.now()) / 1000)) }))));
}
updatePotions();
setInterval(() => {
  for (const timer of document.querySelectorAll('.boost-timer')) {
    const boost = boosts.find(boost => boost.stat === timer.dataset.stat);
    const seconds = Math.max(0, Math.ceil((boost.expiresAt - Date.now()) / 1000));
    timer.textContent = seconds ? `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}` : 'expired';
    timer.dataset.secs = Math.max(0, seconds - 1);
  }
}, 1000);
for (const stat of ['attack', 'strength']) {
  document.getElementById(`expire-${stat}`).hidden = mode === 'gather';
  document.getElementById(`expire-${stat}`).addEventListener('click', () => {
    const boost = boosts.find(boost => boost.stat === stat);
    if (boost) boost.expiresAt = Date.now();
    updatePotions();
    document.dispatchEvent(new CustomEvent('dank:swapped'));
  });
}

function updateFood() {
  document.querySelector('.quick-eat')?.remove();
  if (foodRemaining < 1 || (Number(energyElement.textContent.split('/')[0]) >= 100 && Number(hpElement.textContent.split('/')[0]) >= 100)) return;
  const fragment = document.getElementById('food-template').content.cloneNode(true);
  const form = fragment.querySelector('form');
  form.querySelector('option').textContent = `Shark (+20 HP/energy) ×${foodRemaining}`;
  form.querySelector('[name="csrf"]').value = `fixture-food-token-${requests}`;
  form.querySelector('.btn-eat').addEventListener('click', () => { form.querySelector('[name="fill"]').value = ''; });
  document.querySelector('aside').appendChild(fragment);
}

document.getElementById('regen').addEventListener('click', () => {
  const current = Number(energyElement.textContent.split('/')[0]);
  energyElement.textContent = `${Math.min(100, current + 10)} / 100`;
  updateFood();
  document.dispatchEvent(new CustomEvent('dank:swapped'));
});

document.getElementById('low-energy').addEventListener('click', () => {
  energyElement.textContent = '2 / 100';
  updateFood();
  document.dispatchEvent(new CustomEvent('dank:swapped'));
});

document.getElementById('hurt').addEventListener('click', () => {
  const current = Number(hpElement.textContent.split('/')[0]);
  hpElement.textContent = `${Math.max(0, current - 1)} / 100 HP`;
  updateFood();
  document.dispatchEvent(new CustomEvent('dank:swapped'));
});

document.addEventListener('submit', event => {
  if (event.defaultPrevented || !(event.target instanceof HTMLFormElement)) return;
  const travel = event.target.querySelector('input[name="zone_id"]');
  const summoning = event.target.querySelector('input[name="boss"]');
  if (!event.target.matches('form[data-ajax]') && !travel && !summoning) return;
  event.preventDefault();
  const button = event.target.querySelector('button[type="submit"]');
  if (button.disabled) return;
  button.disabled = true;
  requests += 1;
  sessionStorage.setItem('dankscape-fixture:requests', String(requests));
  document.getElementById('request-count').textContent = String(requests);
  const scenario = document.getElementById('scenario').value;
  const eating = event.target.classList.contains('quick-eat');
  const drinking = event.target.classList.contains('quick-drink');
  const payload = Object.fromEntries(new FormData(event.target));
  const previous = { nodes: Array.from(contentElement.childNodes), energy: energyElement.textContent, hp: hpElement.textContent,
    xp: document.getElementById('hud-xp').textContent, flash: document.getElementById('flash-stack').innerHTML };
  if (scenario === 'timeout') return;
  // Generate a real localhost resource-timing entry for the fake native action.
  // The production userscript observes it without replacing the game's fetch.
  void realFetch(new URL(event.target.getAttribute('action') || location.href, location.href),
    { method: 'POST', body: new FormData(event.target) }).then(response => response.text()).catch(error => {
    document.getElementById('flash-stack').textContent = `Local fixture transport failed: ${error.message}`;
  });
  if (scenario === 'refresh' || scenario === 'miss') {
    // Simulate an unrelated content replacement before this request completes.
    setTimeout(() => {
      contentElement.replaceChildren(...contentElement.cloneNode(true).childNodes);
      document.dispatchEvent(new CustomEvent('dank:swapped'));
    }, 100);
  }
  if (travel && scenario !== 'guard') {
    const destination = new URL('/arena.php', location.origin);
    destination.searchParams.set('zone', payload.zone_id);
    location.assign(destination.href);
    return;
  }
  setTimeout(() => {
    if (scenario !== 'error' && scenario !== 'guard') {
      if (summoning) {
        Object.assign(boss, { id: String(Number(boss.id) + 1), hp: 30, maximum: 30, state: 'Active', fighters: [] });
        saveRaidState();
        location.assign(`/raid.php?id=${boss.id}`);
        return;
      }
      const current = Number(energyElement.textContent.split('/')[0]);
      if (eating) {
        foodRemaining -= 1;
        energyElement.textContent = `${Math.min(100, current + 20)} / 100`;
        hpElement.textContent = `${Math.min(100, Number(hpElement.textContent.split('/')[0]) + 20)} / 100 HP`;
        document.getElementById('food-count').textContent = String(foodRemaining);
      } else if (drinking) {
        const potion = potions.find(potion => potion.id === payload.inv_id);
        potion.quantity -= 1;
        boosts = boosts.filter(boost => boost.stat !== potion.stat);
        boosts.push({ stat: potion.stat, boost: potion.boost, expiresAt: Date.now() + 300000 });
      } else if (mode === 'arena') {
        if (payload.action === 'engage') {
          arena = { active: true, name: payload.monster_id === '2' ? 'Other Foe' : 'Field Mouse', hp: 8, zone: arena.zone, log: 'The hero and foe have entered the arena.' };
        } else if (payload.action === 'swing') {
          const misses = scenario === 'miss' || scenario === 'repeat';
          arena.hp = Math.max(0, arena.hp - (misses ? 0 : 3));
          arena.log = misses ? `Your attack glances off the ${arena.name}.` : `You strike the ${arena.name} for 3 damage.`;
          arena.log += `\nThe ${arena.name} swings and misses.`;
          if (arena.hp === 0) {
            arena.active = false;
            arena.log += `\nYou slay the ${arena.name}!`;
          } else if (scenario !== 'repeat') hpElement.textContent = `${Math.max(0, Number(hpElement.textContent.split('/')[0]) - 1)} / 100 HP`;
          if (scenario === 'unconfirmed') arena.log = '';
        } else {
          arena.active = false;
          arena.log = 'You flee from the battle.';
        }
      } else if (mode === 'raid') {
        boss.hp = Math.max(0, boss.hp - (scenario === 'miss' ? 0 : 10));
        if (scenario !== 'miss') {
          let hero = boss.fighters.find(fighter => fighter.hero === 'Local test hero');
          if (!hero) { hero = { hero: 'Local test hero', damage: 0 }; boss.fighters.push(hero); }
          hero.damage += 10;
        }
        hpElement.textContent = `${Math.max(0, Number(hpElement.textContent.split('/')[0]) - 1)} / 100 HP`;
      } else {
        energyElement.textContent = `${current - 4} / 100`;
        xp += 18;
        document.getElementById('fixture-skill-progress').outerHTML = skillProgressMarkup(gatheringSkill, xp);
        document.getElementById('hud-xp').textContent = `${gatheringSkill} ${document.querySelector('#fixture-skill-progress strong').textContent.replace(/^Level /, '')}`;
      }
    }
    const token = `fixture-token-${requests}`;
    if (mode === 'arena') contentElement.innerHTML = arenaContent(arena, token, true);
    else if (mode === 'raid') contentElement.innerHTML = raidContent(boss, token, true);
    else {
      const fresh = contentElement.cloneNode(true);
      const button = fresh.querySelector('button[type="submit"]');
      button.dataset.cooldown = '1';
      button.disabled = true;
      button.textContent = 'Wait 1s';
      fresh.querySelector('input[name="csrf"]').value = token;
      contentElement.replaceChildren(...fresh.childNodes);
    }
    updateFood();
    updatePotions();
    saveRaidState();
    const drunkPotion = drinking ? potions.find(potion => potion.id === payload.inv_id) : null;
    if (scenario === 'guard') {
      contentElement.insertAdjacentHTML('afterbegin', `<div class="card"><h2>Mock human check</h2><p>Complete this fixture check manually.</p><a href="/guard.php?from=${mode}">Open mock verification</a></div>`);
    }
    document.getElementById('flash-stack').innerHTML = scenario === 'guard'
      ? '<div class="flash flash-error">Quick check needed — confirm you are human.</div>' : scenario === 'error'
      ? '<div class="flash flash-error">Not enough energy.</div>'
      : scenario === 'unconfirmed' || (mode === 'arena' && !eating && !drinking) ? ''
      : drunkPotion ? `<div class="flash flash-ok">You drink the ${drunkPotion.name}. +${drunkPotion.boost} ${drunkPotion.stat === 'defense' ? 'Defence' : drunkPotion.stat[0].toUpperCase() + drunkPotion.stat.slice(1)} — active for 5 more minutes.</div>`
      : `<div class="flash flash-ok">${eating ? 'You eat the Shark and recover HP/energy.' : mode === 'raid' ? scenario === 'miss' ? 'You miss Fixture Boss.' : boss.hp === 0 ? 'You struck for 10 and felled Fixture Boss! Rewards are split by damage dealt.' : 'You hit Fixture Boss for 10.' : 'You gather 1 resource. +18 XP.'}</div>`;
    if (scenario === 'lost' && !eating && (drinking || mode !== 'arena' || payload.action === 'swing')) {
      // The simulated server committed the action, but the client never sees its response.
      // A raid GET retains contributions but no longer has its transient hit toast.
      if (mode === 'raid' && !drinking) document.getElementById('flash-stack').replaceChildren();
      sessionStorage.setItem(RECOVERY_STATE_KEY, JSON.stringify({ mode, arena, boss, xp, foodRemaining, potions, boosts, html: document.documentElement.outerHTML }));
      contentElement.replaceChildren(...previous.nodes);
      energyElement.textContent = previous.energy;
      hpElement.textContent = previous.hp;
      document.getElementById('hud-xp').textContent = previous.xp;
      document.getElementById('flash-stack').innerHTML = previous.flash;
      updateFood();
      return;
    }
    document.dispatchEvent(new CustomEvent('dank:swapped'));
    setTimeout(() => {
      for (const button of contentElement.querySelectorAll('button[data-cooldown]')) {
        button.disabled = false;
        button.textContent = button.dataset.label;
      }
    }, 1000);
  }, 400);
});
