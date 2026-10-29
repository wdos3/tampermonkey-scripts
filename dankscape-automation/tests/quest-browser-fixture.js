'use strict';

const GAME_KEY = 'quest-browser-fixture:game';
let game = JSON.parse(sessionStorage.getItem(GAME_KEY) || 'null') || {
  requests: 0, hp: 100, energy: 8, food: 20, activeFight: false, potions: QUEST_POTIONS, boosts: [],
  zone: 'Meadowbrook Fields', combatLog: '',
  slayer: { completed: 2, task: { target: 'Yeti', progress: 21, goal: 22, zone: 'Meadowbrook Fields' } },
  autoCompleteKill: new URLSearchParams(location.search).get('completion') === 'automatic',
  verificationTest: ['manual', 'automatic'].includes(new URLSearchParams(location.search).get('verification')),
  automaticVerification: new URLSearchParams(location.search).get('verification') === 'automatic',
  raidCatalog: [{ key: 'first', name: 'Fixture Boss', limit: 1 }, { key: 'second', name: 'Other Boss', limit: 2 }, { key: 'locked', name: 'Locked Boss', locked: true }],
  raidCounts: {}, boss: null, nextRaid: 123,
  craftXP: 0,
  recipes: [{ id: '14', name: 'Cook Shark', xp: 18, materials: [{ name: 'Raw Shark', amount: 1, owned: 10000 }] }],
  diaries: ['Meadowbrook Fields', 'Volcanic Caverns'].map((name, index) => ({ name,
    monsters: [{ id: '1', name: 'Field Mouse', kills: index ? 9 : 10 }, { id: '2', name: 'Other Foe', kills: index ? 9 : 10 },
      { id: '3', name: 'Satisfied Foe', kills: 230 }], tiers: { Easy: { claimed: true }, Medium: { claimed: !index } } })),
  quests: [
    { id: 'hunt', name: 'Meadow Patrol', target: 'Field Mouse', kind: 'kill', goal: 3, progress: 0, group: 'Active' },
    { id: 'fish', name: 'Feast Supplies', target: 'Fixture resource', kind: 'collect', goal: 8, progress: 0,
      group: new URLSearchParams(location.search).get('completion') === 'automatic' ? 'Active' : 'Available' },
    { id: 'locked', name: 'Locked contract', target: 'Other Foe', kind: 'kill', goal: 1, progress: 0, group: 'Locked' },
  ],
};
const mode = { '/guard.php': 'guard', '/diaries.php': 'diary', '/slayer.php': 'slayer', '/quests.php': 'quest', '/arena.php': 'arena', '/raid.php': 'raid', '/craft.php': 'craft' }[location.pathname] || 'gather';
const skill = new URLSearchParams(location.search).get('skill') || 'fishing';
const slayerFight = new URLSearchParams(location.search).get('from') === 'slayer';
const diaryFight = new URLSearchParams(location.search).get('from') === 'diary';
const diaryMonster = diaryFight && game.diaries.find(zone => zone.name === game.zone)?.monsters
  .find(mob => mob.id === new URLSearchParams(location.search).get('target'));
let drinkMessage = '';
game.visits ||= { quest: 0, arena: 0, gather: 0, slayer: 0 };
game.visits[mode] = (game.visits[mode] || 0) + 1;
save();
window.GM_getValue = (key, fallback) => JSON.parse(localStorage.getItem(`quest-preview:${key}`) || 'null') ?? fallback;
window.GM_setValue = (key, value) => localStorage.setItem(`quest-preview:${key}`, JSON.stringify(value));
window.GM_registerMenuCommand = () => {};

function save() { sessionStorage.setItem(GAME_KEY, JSON.stringify(game)); }

function render() {
  const section = document.querySelector('section.content');
  if (mode === 'guard') {
    const complete = () => {
      game.guardRequired = false;
      const count = game.automaticVerification ? 'automaticChecks' : 'manualChecks';
      game[count] = (game[count] || 0) + 1;
      game.zone = 'Default area after verification';
      save();
      location.assign('/arena.php');
    };
    if (game.automaticVerification) {
      section.innerHTML = '<h1>Quick human check</h1><p>Local mock: native Continue succeeds without an extra challenge.</p><form method="post" action="/guard.php?from=arena"><button>I\'m human — continue</button></form>';
      section.querySelector('form').addEventListener('submit', async event => {
        event.preventDefault();
        await fetch('/guard.php?from=arena', { method: 'POST' });
        complete();
      });
    } else {
      section.innerHTML = '<h1>Quick human check</h1><p>Local mock check: the assistant must wait for this manual button.</p><button id="complete-mock-check">Complete mock check</button>';
      document.getElementById('complete-mock-check').addEventListener('click', complete);
    }
  } else if (mode === 'craft') {
    document.querySelector('aside')?.remove();
    section.innerHTML = craftContent(skill, game.recipes, `fixture-token-${game.requests}`, game.craftXP);
  } else if (mode === 'diary') {
    document.querySelector('aside')?.remove();
    section.innerHTML = diaryContent(game.diaries.map(zone => ({ ...zone, away: zone.name !== game.zone })), `fixture-token-${game.requests}`);
  } else if (mode === 'slayer') {
    document.querySelector('aside')?.remove();
    section.innerHTML = slayerContent({ ...game.slayer, away: game.slayer.task?.zone !== game.zone }, `fixture-token-${game.requests}`);
  } else if (mode === 'quest') {
    document.querySelector('aside')?.remove();
    section.innerHTML = questContent(game.quests.map(quest => ({ ...quest, directFight: quest.kind === 'kill' && quest.progress > 0 && game.zone === 'Meadowbrook Fields' })),
      45, 'Local test hero', `fixture-token-${game.requests}`);
  } else {
    document.getElementById('hud-energy').textContent = `${game.energy} / 100`;
    document.querySelector('.hp-text').textContent = `${game.hp} / 100 HP`;
    document.getElementById('hud-xp').innerHTML = `${skill} <strong>100</strong> · ${game.requests * 18} / 10000 XP`;
    section.innerHTML = mode === 'raid' ? raidContent(new URLSearchParams(location.search).has('id') ? game.boss : null, `fixture-token-${game.requests}`, false, game.raidCatalog)
      : mode === 'arena' ? arenaContent({ active: game.activeFight, hp: 8, zone: game.zone,
      name: diaryFight ? diaryMonster.name : slayerFight ? game.slayer.task.target : 'Field Mouse',
      log: game.activeFight ? 'The battle begins.' : game.combatLog || (game.quests[0].progress
        ? `You strike the Field Mouse for 8 damage. You slay the Field Mouse!\n📜 Meadow Patrol: ${game.quests[0].progress} / ${game.quests[0].goal}` : '') })
      : content(skill, `fixture-token-${game.requests}`);
    document.querySelector('.quick-eat')?.remove();
    if (game.hp < 100 || game.energy < 100) document.querySelector('aside').insertAdjacentHTML('beforeend', foodMarkup([{ id: 'fixture-food', name: 'Shark', gain: 20, quantity: game.food }]));
    const eat = document.querySelector('.btn-eat');
    eat?.addEventListener('click', () => { eat.form.querySelector('[name="fill"]').value = ''; });
    document.querySelector('.quick-drink')?.remove();
    document.getElementById('boost-hud-wrap')?.remove();
    document.querySelector('aside').insertAdjacentHTML('beforeend', potionMarkup(game.potions,
      game.boosts.map(boost => ({ ...boost, seconds: Math.max(0, Math.ceil((boost.expiresAt - Date.now()) / 1000)) }))));
  }
  if (mode !== 'guard' && game.guardRequired) {
    section.insertAdjacentHTML('afterbegin', `<div class="card"><h2>Quick human check</h2><a href="/guard.php?from=${location.pathname.slice(1, -4)}">Verify I’m human</a></div>`);
  }
  if (mode === 'raid' && !new URLSearchParams(location.search).has('id') && game.summonMessage) {
    document.getElementById('flash-stack').innerHTML = `<div class="flash flash-ok">${game.summonMessage}</div>`;
  }
  document.getElementById('quest-test-summary').textContent = `Mock requests: ${game.requests} · Completed quests: ${game.quests.filter(q => q.group === 'Chronicled').length} · Slayer tasks completed: ${game.slayer.completed - 2} · Food used: ${20 - game.food} · Board visits: ${game.visits.quest} · Arena visits: ${game.visits.arena} · Gathering visits: ${game.visits.gather} · Manual checks: ${game.manualChecks || 0} · Automatic checks: ${game.automaticChecks || 0} · Diary claims: ${game.diaryClaims || 0}`;
}
render();

document.addEventListener('submit', async event => {
  if (event.defaultPrevented) return;
  event.preventDefault();
  const form = event.target;
  const button = event.submitter || form.querySelector('button');
  if (button.disabled) return;
  const body = new FormData(form, button);
  const payload = Object.fromEntries(body);
  button.disabled = true;
  game.requests += 1;
  await fetch(new URL(form.getAttribute('action') || location.href, location.href), { method: 'POST', body });
  if (mode === 'craft') {
    const recipe = game.recipes.find(recipe => recipe.id === payload.recipe_id);
    for (const item of recipe.materials) item.owned -= Number(payload.times) * item.amount;
    game.craftXP += Number(payload.times) * 20;
    save();
    render();
    document.dispatchEvent(new CustomEvent('dank:swapped'));
    return;
  }
  if (mode === 'raid' && payload.action === 'summon') {
    const selected = game.raidCatalog.find(boss => boss.key === payload.boss);
    if ((game.raidCounts[selected.name] || 0) >= selected.limit) {
      game.summonMessage = `✓ You've already defeated ${selected.name} ${selected.limit} times today — it will return tomorrow. (${selected.limit} fights per boss per day thanks to your Fervor perk.)`;
      save();
      location.assign('/raid.php');
      return;
    }
    game.summonMessage = '';
    game.boss = { id: String(++game.nextRaid), name: selected.name, hp: 10, maximum: 10, state: 'Active', fighters: [] };
    save();
    location.assign(`/raid.php?id=${game.boss.id}`);
    return;
  }
  const checkProgress = diaryFight ? game.diaries.find(zone => zone.name === game.zone)?.monsters[0].kills === 10 : game.quests[0].progress === 1;
  if (game.verificationTest && !(game.manualChecks || game.automaticChecks) && checkProgress && payload.action === 'swing') {
    game.guardRequired = true;
    save();
    render();
    document.getElementById('flash-stack').innerHTML = '<div class="flash flash-error">Quick check needed — confirm you are human.</div>';
    document.dispatchEvent(new CustomEvent('dank:swapped'));
    return;
  }
  if (mode === 'diary' && payload.action === 'claim') {
    const zone = game.diaries[Number(payload.zone_id) - 1];
    zone.tiers[payload.tier] = { ...zone.tiers[payload.tier], claimed: true };
    game.diaryClaims = (game.diaryClaims || 0) + 1;
    save();
    location.assign('/diaries.php');
    return;
  }
  if (payload.zone_id) {
    game.zone = payload.from === 'diary' ? game.diaries[Number(payload.zone_id) - 1].name : payload.from === 'slayer' ? game.slayer.task.zone : 'Meadowbrook Fields';
    game.combatLog = '';
    save();
    location.assign(payload.from === 'diary' ? `/arena.php?target=${payload.target}&from=diary` : payload.from === 'slayer' ? '/arena.php?target=1&from=slayer' : '/arena.php');
    return;
  }
  if (mode === 'slayer') {
    if (payload.action === 'claim') { game.slayer.completed += 1; game.slayer.task = null; }
    if (payload.action === 'assign') game.slayer.task = { target: game.slayer.completed % 2 ? 'Permafrost Wraith' : 'Yeti',
      zone: game.slayer.completed % 2 ? 'Mossgill Sewers' : 'Meadowbrook Fields', goal: 2, progress: 0 };
    save();
    location.assign('/slayer.php');
    return;
  }
  if (mode === 'quest') {
    const quest = game.quests.find(q => q.id === payload.quest_id);
    if (payload.action === 'accept') quest.group = 'Active';
    if (payload.action === 'claim') quest.group = 'Chronicled';
  } else if (form.matches('.quick-eat')) {
    game.hp = Math.min(100, game.hp + 20);
    game.energy = Math.min(100, game.energy + 20);
    game.food -= 1;
  } else if (form.matches('.quick-drink')) {
    const potion = game.potions.find(potion => potion.id === payload.inv_id);
    potion.quantity -= 1;
    const stats = potion.stat === 'combat' ? ['attack', 'strength', 'defense'] : [potion.stat];
    game.boosts = game.boosts.filter(boost => !stats.includes(boost.stat));
    game.boosts.push(...stats.map(stat => ({ stat, boost: potion.boost, expiresAt: Date.now() + 300000 })));
    drinkMessage = `You drink the ${potion.name}. +${potion.boost} ${potion.stat === 'combat' ? 'Attack/Strength/Defence' : potion.stat === 'attack' ? 'Attack' : 'Strength'} — active for 5 more minutes.`;
  } else if (mode === 'raid') {
    game.boss.hp = 0;
    game.boss.fighters = [{ hero: 'Local test hero', damage: 10 }];
    game.raidCounts[game.boss.name] = (game.raidCounts[game.boss.name] || 0) + 1;
    game.hp -= 1;
    drinkMessage = `You struck for 10 and felled ${game.boss.name}! Rewards are split by damage dealt.`;
  } else if (mode === 'arena') {
    if (payload.action === 'engage') game.activeFight = true;
    if (payload.action === 'swing') {
      game.activeFight = false;
      if (diaryFight) {
        diaryMonster.kills += 1;
        game.combatLog = `You strike the ${diaryMonster.name} for 8 damage. You slay the ${diaryMonster.name}!`;
      } else if (slayerFight) {
        game.slayer.task.progress += 1;
        game.combatLog = `You strike the ${game.slayer.task.target} for 8 damage. You slay the ${game.slayer.task.target}!`;
      } else game.quests[0].progress += 1;
      game.hp -= 1;
      if (game.autoCompleteKill && game.quests[0].progress >= game.quests[0].goal) {
        Object.assign(game.quests[0], { group: 'Chronicled', omitLevel: true });
      }
    }
  } else {
    game.quests[1].progress += 1;
    game.energy -= 4;
  }
  save();
  render();
  document.getElementById('flash-stack').innerHTML = `<div class="flash flash-ok">${form.matches('.quick-drink') ? drinkMessage : form.matches('.quick-eat') ? 'You eat the food.' : mode === 'gather' ? 'You gather 1 Fixture resource.' : 'Mock quest result.'}</div>`;
  document.dispatchEvent(new CustomEvent('dank:swapped'));
});
