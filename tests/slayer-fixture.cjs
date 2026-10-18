'use strict';

const { escapeHTML } = require('./quest-fixture.cjs');

// Board labels, card structure, field names, and full-page navigation were
// observed live. Hidden values and monster IDs below are synthetic.
function slayerContent({ task = null, completed = 2, away = false } = {}, token = 'fixture-slayer-token') {
  const field = (name, value) => `<input type="hidden" name="${name}" value="${escapeHTML(value)}">`;
  const form = (action, label) => `<form method="post">${field('csrf', token)}${field('action', action)}<button type="submit">${label}</button></form>`;
  return `<div class="card"><h2>🗡️ The Slayer Master</h2><p>Complete tasks to keep the streak alive. Skipping costs gold.</p>
    <div class="stat-row"><span>Tasks completed</span><strong>${completed}</strong></div></div>
    <div class="card">${task ? `<h3>Current task: slay ${task.goal} ${escapeHTML(task.target)} <span class="dim">(level 60)</span></h3>
      <p class="dim"><strong>${task.progress} / ${task.goal}</strong> slain · found in ${escapeHTML(task.zone)}.</p>
      <div class="row">${task.progress >= task.goal ? form('claim', '🏆 Claim reward') : away
        ? `<form method="post" action="/arena.php">${field('csrf', token)}${field('action', 'travel')}${field('zone_id', 1)}${field('target', 1)}${field('from', 'slayer')}<button type="submit">🗺️ Go hunt in ${escapeHTML(task.zone)}</button></form>`
        : `<a href="/arena.php?target=1&amp;from=slayer">⚔️ Fight ${escapeHTML(task.target)} <span class="dim">(you are in ${escapeHTML(task.zone)})</span></a>`}
      ${task.progress >= task.goal ? '' : form('skip', 'Skip (26,750g)')}</div>`
      : `<h3>No active task</h3><p class="dim">Take another task.</p>${form('assign', 'Take a task')}`}</div>`;
}

module.exports = { slayerContent };
