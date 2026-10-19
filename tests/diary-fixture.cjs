'use strict';

const { escapeHTML } = require('./quest-fixture.cjs');

// Travel buttons, hidden shared forms, kill-count rows and requirements follow
// the inspected live page. Claim controls and hidden values are modeled.
function diaryContent(zones, token = 'fixture-diary-token') {
  const tiers = { Easy: [1, 0], Medium: [10, 250], Hard: [50, 1500], Extreme: [250, 0], Legendary: [500, 0], Insane: [1000, 0] };
  const field = (name, value) => `<input type="hidden" name="${name}" value="${escapeHTML(value)}">`;
  return '<div class="card"><h2>📜 Zone Diaries</h2><p>Kill every monster to complete each diary tier.</p></div>' + zones.map((zone, index) => {
    const total = zone.monsters.reduce((sum, mob) => sum + mob.kills, 0);
    const route = mob => zone.locked ? `<span>${escapeHTML(mob.name)}</span>` : zone.away
      ? `<button type="submit" class="mob-link" form="diary-go-${index}" name="target" value="${mob.id}">${escapeHTML(mob.name)}</button>`
      : `<a class="mob-link" href="/arena.php?target=${mob.id}&amp;from=diary">${escapeHTML(mob.name)}</a>`;
    return `<div class="card">${zone.away && !zone.locked ? `<form method="post" action="/arena.php" id="diary-go-${index}" hidden>
      ${field('csrf', token)}${field('action', 'travel')}${field('zone_id', index + 1)}${field('from', 'diary')}</form>` : ''}
      <h3>${escapeHTML(zone.name)} <span class="dim">Lv ${zone.level || 1}+${zone.locked ? ' — Locked' : ''} · ${zone.monsters.length} monsters</span></h3>
      <p class="dim">${zone.monsters.map(mob => `${route(mob)} <span>×${mob.kills.toLocaleString('en-US')}</span>`).join(' · ')}</p>
      <div>${Object.entries(tiers).map(([name, [perMonster, minimumTotal]]) => {
        const config = { perMonster, minimumTotal, ...zone.tiers?.[name] };
        const ready = zone.monsters.every(mob => mob.kills >= config.perMonster) && total >= config.minimumTotal;
        return `<div><div><strong>${name}</strong><span>${ready ? '100' : '0'}%</span></div><ul class="diary-reqs">
          <li>• Kill every monster here ${config.perMonster === 1 ? 'at least once' : `${config.perMonster} times`} — <strong>${zone.monsters.filter(mob => mob.kills >= config.perMonster).length} of ${zone.monsters.length}</strong> done</li>
          ${config.minimumTotal ? `<li>• ${config.minimumTotal.toLocaleString('en-US')} kills here in total — <strong>${total.toLocaleString('en-US')}</strong> so far</li>` : ''}</ul>
          ${config.claimed ? '<p>✓ Claimed</p>' : ready && config.claim !== false ? `<form method="post" action="/diaries.php">${field('csrf', token)}${field('action', 'claim')}${field('zone_id', index + 1)}${field('tier', name)}<button type="submit">Claim ${name}</button></form>` : ''}</div>`;
      }).join('')}</div></div>`;
  }).join('');
}

module.exports = { diaryContent };
