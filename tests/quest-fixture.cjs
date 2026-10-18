'use strict';

function escapeHTML(value) {
  return String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
}

// Active-card layout observed on the live board. Completion variants, tokens,
// IDs, actions, and ready-delivery controls are modeled, not live captures.
function questContent(quests, level = 45, hero = 'Local test hero', token = 'fixture-quest-token') {
  const groups = ['Active', 'Available', 'Locked', 'Chronicled', 'Completed'];
  const render = quest => {
    const { name, target, kind = 'kill', goal = 2, progress = 0, level = 1, group = 'Active' } = quest;
    const completed = group === 'Chronicled' || group === 'Completed';
    const field = name => `<input type="hidden" name="${name}" value="${name === 'csrf' ? token : escapeHTML(quest.id || 'test-quest')}">`;
    const form = (action, label) => `<form method="post" data-ajax>${field('csrf')}<input type="hidden" name="action" value="${action}">${field('quest_id')}<button type="submit">${label}</button></form>`;
    const activity = quest.noRoute ? '' : kind === 'kill' ? quest.directFight
      ? `<a class="btn btn-primary" href="${escapeHTML(quest.fightHref || '/arena.php?target=1')}">⚔️ Fight ${escapeHTML(target)}</a>`
      : `<form method="post" action="/arena.php">${field('csrf')}<input type="hidden" name="action" value="travel"><input type="hidden" name="zone_id" value="1"><input type="hidden" name="target" value="fixture-enemy"><button type="submit">🗺️ Hunt in Meadowbrook Fields</button></form>`
      : `<a href="/gather.php?skill=fishing&target=shark">🎣 Fish ${escapeHTML(target)}</a>`;
    return `<div class="card"><h3>${escapeHTML(name)} ${quest.omitLevel ? '' : `<span class="dim">Lvl ${level}+</span>`}</h3>
      <p class="muted">Local quest fixture.</p>${completed && quest.compactCompleted ? '' : `<div class="stat-row"><span>${kind === 'kill' ? 'Target' : 'Collect'}</span><strong>${escapeHTML(target)}</strong></div>
      <div class="stat-row"><span>Goal</span><strong>${goal} ${kind === 'kill' ? 'kills' : 'items'}</strong></div>`}
      ${completed ? '<p>✓ Completed.</p>' : group === 'Locked' ? '<p>Requires first completing another quest.</p>' : group === 'Available' ? form('accept', 'Accept')
        : `<p class="dim">${progress} / ${goal}${kind === 'collect' ? ' (held in pack)' : ''}</p><div class="quest-actions">
          ${progress >= goal ? form('claim', quest.claimLabel || 'Claim reward') : activity}
          <form method="post" onsubmit="return confirm('Abandon this quest?');">${field('csrf')}<input type="hidden" name="action" value="abandon">${field('quest_id')}<button type="submit">Abandon</button></form></div>`}</div>`;
  };
  return `<div class="card"><h1>Quest Board</h1><p class="dim">⚔️ <strong>${escapeHTML(hero)}</strong> · combat level <strong>${level}</strong> · ${quests.filter(q => q.group === 'Active').length}/3 active</p></div>`
    + groups.map(group => `<h2>${group}</h2><div class="row">${quests.filter(q => (q.group || 'Active') === group).map(render).join('')}</div>`).join('');
}

module.exports = { questContent, escapeHTML };
