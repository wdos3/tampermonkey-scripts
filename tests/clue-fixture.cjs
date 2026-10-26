'use strict';

function clueContent({ type = 'Deed', prompt = 'Give the dead their due at the Inn\'s altar; the bones know the way.', index = 1, total = 2, body = '', progress = 0, goal = 20, idle = false } = {}) {
  const read = '<form method="post"><input name="csrf" type="hidden" value="fixture-token"><input name="action" type="hidden" value="read"><button type="submit">📜 Read an Easy scroll</button></form>';
  return `<h1>🗺️ Clue Trails</h1>${idle ? read : `<div class="card"><h3>Current trail (Easy) — step ${index} of ${total} <span>${type}</span></h3><p>“${prompt}”</p>
    <form method="post" id="clue-form"><input name="csrf" type="hidden" value="fixture-token"><input name="action" type="hidden" value="answer">
    ${type === 'Deed' ? `<p>Progress since this step began: <strong>${progress} / ${goal}</strong></p>` : body}
    <button type="submit" id="clue-submit">${type === 'Deed' ? '🔍 Check the riddle' : '🔍 Submit answer'}</button></form></div>`}`;
}

// The current live Easy nonogram supplied this DOM shape and these hints.
function nonogramContent(rows = [[3], [2], [2], [2, 2], [1, 1]], columns = [[1, 1], [1, 2], [1], [1, 2], [1, 3]], bits = '0'.repeat(rows.length ** 2)) {
  const size = rows.length;
  return clueContent({ type: 'Nonogram', prompt: 'Paint the squares to match the row and column hints.', body:
    `<div style="display:grid;grid-template-columns:70px repeat(${size},40px);gap:4px"><div></div>${columns.map(runs => `<div>${runs.length ? runs.join('<br>') : '0'}</div>`).join('')}
    ${rows.map((runs, row) => `<div>${runs.length ? runs.join(' ') : '0'}</div>${Array.from({ length: size }, (_, col) => `<button type="button" class="nono" data-i="${row * size + col}" style="width:40px;height:40px;background:#1a120a"></button>`).join('')}`).join('')}</div>
    <input type="hidden" id="nono-cells" name="cells" value="${bits}">` });
}

function cipherContent() {
  return clueContent({ type: 'Cipher', index: 2,
    prompt: 'A Caesar cipher hides a saying of the realm. Every letter was shifted by the same amount — by 11 places. Write the true words.',
    body: '<p style="font-family:monospace">YZ NLAP HTESZFE L SFYOCPO YTRSED</p><input name="answer" placeholder="Write the decoded saying">' });
}

module.exports = { clueContent, nonogramContent, cipherContent };
