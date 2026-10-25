'use strict';

// The current live Easy nonogram supplied this DOM shape and these hints.
function nonogramContent(rows = [[3], [2], [2], [2, 2], [1, 1]], columns = [[1, 1], [1, 2], [1], [1, 2], [1, 3]], bits = '0'.repeat(rows.length ** 2)) {
  const size = rows.length;
  return `<h2>Clue Trails</h2><div class="card"><h3>Current trail (Easy) — step 1 of 2 <span>Nonogram</span></h3>
    <form method="post" id="clue-form"><div style="display:grid;grid-template-columns:70px repeat(${size},40px);gap:4px"><div></div>${columns.map(runs => `<div>${runs.length ? runs.join('<br>') : '0'}</div>`).join('')}
    ${rows.map((runs, row) => `<div>${runs.length ? runs.join(' ') : '0'}</div>${Array.from({ length: size }, (_, col) => `<button type="button" class="nono" data-i="${row * size + col}" style="width:40px;height:40px;background:#1a120a"></button>`).join('')}`).join('')}</div>
    <input type="hidden" id="nono-cells" name="cells" value="${bits}"><button type="submit">Submit answer</button></form></div>`;
}

module.exports = { nonogramContent };
