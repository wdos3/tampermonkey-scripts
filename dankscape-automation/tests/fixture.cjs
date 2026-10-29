'use strict';

const SKILLS = {
  mining: ['copper', 'Copper Rock', 'Mine'],
  woodcutting: ['normal', 'Tree', 'Chop'],
  fishing: ['shark', 'Shark Waters', 'Cast Line'],
  herblore: ['sunleaf', 'Sunleaf Patch', 'Pick'],
};

function skillProgressMarkup(skill, total) {
  let points = 0, threshold = 0;
  for (let level = 1; level < 200; level += 1) {
    points += Math.floor(level + 300 * Math.pow(2, level / 7));
    const next = Math.floor(points / 4);
    if (total < next) return `<div class="stat-row" id="fixture-skill-progress"><span>${skill[0].toUpperCase() + skill.slice(1)}</span><strong>Level ${level} · ${(total - threshold).toLocaleString('en-US')} / ${(next - threshold).toLocaleString('en-US')} XP</strong></div>`;
    threshold = next;
  }
  return `<div class="stat-row" id="fixture-skill-progress"><span>${skill}</span><strong>Level 200 · Maximum level</strong></div>`;
}

function content(skill = 'mining', token = 'fixture-token', cooldown = false, locked = false, totalXP = null) {
  if (locked) return '<h1>Gathering</h1><p>Herblore unlocks at combat level 30.</p>';
  const [key, name, label] = SKILLS[skill] || SKILLS.mining;
  return `<h1>Gathering</h1>
    <nav><a href="/gather.php?skill=mining">Mining</a> · <a href="/gather.php?skill=woodcutting">Woodcutting</a> · <a href="/gather.php?skill=fishing">Fishing</a></nav>
    ${totalXP === null ? '' : skillProgressMarkup(skill, totalXP)}<div data-fold-group="gather-${skill}">
      <div class="card" data-fold="${key}" data-fold-name="${name}">
        <h3>${name} <small>Lv 1+</small></h3>
        <div class="stat-row"><span>Yields</span><strong>Fixture resource</strong></div>
        <div class="stat-row"><span>XP</span><strong>+18</strong></div>
        <div class="stat-row"><span>Energy</span><strong>−4</strong></div>
        <form method="post" data-ajax><input type="hidden" name="csrf" value="${token}">
          <input type="hidden" name="action" value="gather"><input type="hidden" name="skill" value="${skill}">
          <input type="hidden" name="node" value="${key}">
          <button type="submit" data-cooldown="${cooldown ? '1' : '0'}" data-label="${label}" ${cooldown ? 'disabled' : ''}>${cooldown ? 'Wait 1s' : label}</button>
        </form>
      </div>
      <div class="card" data-fold="locked" data-fold-name="Locked Resource"><h3>Locked Resource</h3><p>Requires level 15.</p></div>
    </div>`;
}

function foodMarkup(foods, selected = '') {
  const available = foods.filter(food => food.quantity > 0);
  if (!available.length) return '';
  return `<form class="quick-eat" method="post" action="/eat.php" data-ajax data-keep-scroll>
    <input type="hidden" name="csrf" value="fixture-food-token"><input type="hidden" name="return" value="/gather.php">
    <label for="quick-eat-select">Quick eat</label><select name="inv_id" id="quick-eat-select">
      ${available.map(food => `<option value="${food.id}" data-food="${food.name}" ${food.name === selected ? 'selected' : ''}>${food.name} (+${food.gain} HP/energy) ×${food.quantity}</option>`).join('')}
    </select><input type="hidden" name="fill" class="quick-eat-fill" value="hp">
    <button type="submit" class="btn-eat">Eat</button><button type="submit" class="btn-eat btn-eat-hp">HP Full</button>
    <button type="submit" class="btn-eat btn-eat-energy">Energy Full</button>
  </form>`;
}

// Quick-drink selectors and timer behavior came from saved game captures;
// the form path/fields and boost-row markup below are synthetic.
function potionMarkup(potions, boosts = []) {
  const owned = potions.filter(potion => potion.quantity > 0);
  const label = stat => stat === 'combat' ? 'Attack/Strength/Defence' : stat === 'defense' ? 'Defence' : stat[0].toUpperCase() + stat.slice(1);
  return `${owned.length ? `<form class="quick-drink" method="post" action="/drink.php" data-ajax>
    <input type="hidden" name="csrf" value="fixture-drink-token"><input type="hidden" name="action" value="drink">
    <label for="quick-drink-select">Quick drink</label><select id="quick-drink-select" name="inv_id">
      ${owned.map(potion => `<option value="${potion.id}" data-elixir="${potion.name}">${potion.name} (+${potion.boost} ${label(potion.stat)}) ×${potion.quantity}</option>`).join('')}
    </select><button type="submit">Drink</button></form>` : ''}
    <div id="boost-hud-wrap">${boosts.length ? '<h3>Active boosts</h3>' : ''}${boosts.map(boost => `<div><span>+${boost.boost} ${label(boost.stat)}</span>
      <span class="boost-timer" data-stat="${boost.stat}" data-secs="${Math.max(0, boost.seconds - 1)}">${boost.seconds > 0 ? `${Math.floor(boost.seconds / 60)}:${String(boost.seconds % 60).padStart(2, '0')}` : 'expired'}</span></div>`).join('')}</div>`;
}

function arenaContent(battle = { active: false, name: 'Field Mouse', hp: 8, log: '' }, token = 'fixture-token', cooldown = false) {
  const stage = battle.active ? `<div class="card fight-stage"><h2>⚔ Combat: ${battle.name}</h2>
    <div class="combat-log">${battle.log}</div>
    <form method="post" action="/arena.php" data-ajax><input type="hidden" name="csrf" value="${token}"><input type="hidden" name="action" value="swing">
      <button type="submit" data-label="Strike!" data-cooldown="${cooldown ? 1 : 0}" ${cooldown ? 'disabled' : ''}>Strike!</button></form>
    <form method="post" action="/arena.php" data-ajax><input type="hidden" name="csrf" value="${token}"><input type="hidden" name="action" value="flee"><button type="submit">Flee</button></form></div>`
    : battle.log ? `<div class="card fight-stage"><h2>⚔ Battle Report</h2><div class="combat-log">${battle.log}</div></div>` : '';
  const foes = battle.active ? '' : [battle.name || 'Field Mouse', 'Other Foe'].map((name, index) => `<div class="foe"><h4>${name}</h4><div class="stats">HP 8 · Atk 1 · Def 1</div>
    <form method="post" action="/arena.php" data-ajax><input type="hidden" name="csrf" value="${token}"><input type="hidden" name="action" value="engage">
      <input type="hidden" name="monster_id" value="${index + 1}"><button type="submit">Engage</button></form></div>`).join('');
  const zones = ['Meadowbrook Fields', 'Mossgill Sewers', 'Volcanic Caverns'];
  const travel = battle.active ? '' : zones.map((zone, index) => zone === (battle.zone || zones[0])
    ? `<button disabled>${zone} ★</button>`
    : `<form method="post" action="/arena.php"><input type="hidden" name="csrf" value="${token}"><input type="hidden" name="action" value="travel">
      <input type="hidden" name="zone_id" value="${index + 1}"><button type="submit">${zone} · Lvl 5+</button></form>`).join('');
  return `<h1>${battle.zone || zones[0]}</h1>${stage}${foes}<h3>Travel</h3>${travel}`;
}

function raidContent(boss = { id: '123', name: 'Fixture Boss', hp: 30, maximum: 30, state: 'Active' }, token = 'fixture-token', cooldown = false,
  catalog = [{ key: 'fixture-boss', name: 'Fixture Boss' }, { key: 'other-boss', name: 'Other Boss' }]) {
  // Catalogue headings and csrf/action/boss field names came from a saved live
  // capture; tokens, boss keys, action values, and reward amounts are modeled.
  if (!boss) return `<h1>Raids</h1><h2>Summon a Boss</h2>${catalog.map(boss => `<div class="card"><h3>${boss.name}</h3>
    <form method="post"><input type="hidden" name="csrf" value="${token}"><input type="hidden" name="action" value="summon">
    <input type="hidden" name="boss" value="${boss.key}"><button type="submit" ${boss.locked ? 'disabled' : ''}>Summon</button></form></div>`).join('')}`;
  // Damage Board labels, empty state, and table columns were inspected live.
  const board = Array.isArray(boss.fighters) ? `<div class="card"><h3>Damage Board</h3>${boss.fighters.length
    ? `<table class="data"><thead><tr><th>#</th><th>Hero</th><th>Damage</th>${boss.hp === 0 ? '<th>Gold won</th>' : ''}</tr></thead><tbody>${boss.fighters.map((fighter, index) => `<tr><td>#${index + 1}</td><td>${fighter.hero}</td><td>${fighter.damage.toLocaleString('en-US')}</td>${boss.hp === 0 ? '<td>7,966g</td>' : ''}</tr>`).join('')}</tbody></table>`
    : '<p>No one has struck yet. Land the first hit!</p>'}<a href="/raid.php">← All raids</a></div>` : '';
  return `<h1>Raids</h1><div class="card"><h2>${boss.name} <span class="dim">${boss.hp === 0 ? 'Defeated' : boss.state}</span></h2>
    <div class="stat-row"><span>Boss HP</span><strong>${boss.hp} / ${boss.maximum}</strong></div>
    ${boss.hp > 0 && boss.state === 'Active' ? `<form method="post" data-ajax data-keep-scroll><input type="hidden" name="csrf" value="${token}">
      <input type="hidden" name="action" value="attack"><input type="hidden" name="raid_id" value="${boss.id}">
      <button type="submit" data-label="Attack the boss!" data-cooldown="${cooldown ? 1 : 0}" ${cooldown ? 'disabled' : ''}>Attack the boss!</button></form>` : ''}</div>
      ${board || (boss.hp === 0 ? '<div class="card"><h3>Damage Board</h3><p>This boss has been defeated. Loot was shared among its attackers.</p><a href="/raid.php">← All raids</a></div>' : '')}`;
}

function page(skill = 'mining', locked = false, mode = 'gather') {
  const initial = mode === 'arena' ? arenaContent() : mode === 'raid' ? raidContent() : content(skill, 'fixture-token', false, locked);
  return `<!doctype html><html><head><meta charset="utf-8"><title>Gathering Assistant — Local Test</title></head><body>
    <aside class="sidebar"><h2>Local test hero</h2><div>Energy <strong id="hud-energy">100 / 100</strong></div>
      <div class="hp-bar"><span class="hp-text">100 / 100 HP</span></div><div id="hud-xp">${skill} 1 · 0 / 83 XP</div></aside>
    <div id="flash-stack"></div><section class="content">${initial}</section>
  </body></html>`;
}

module.exports = { SKILLS, arenaContent, raidContent, content, foodMarkup, potionMarkup, page, skillProgressMarkup };
