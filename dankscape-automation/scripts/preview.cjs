'use strict';

const http = require('node:http');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { arenaContent, raidContent, foodMarkup, potionMarkup, page } = require('../tests/fixture.cjs');

const directory = join(__dirname, '..');
const port = Number(process.env.DANKSCAPE_PREVIEW_PORT || 0);
const server = http.createServer((request, response) => {
  const url = new URL(request.url, 'http://127.0.0.1');
  if (request.method === 'POST' && ['/arena.php', '/raid.php', '/gather.php', '/eat.php', '/drink.php'].includes(url.pathname)) {
    request.resume();
    response.writeHead(200, { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' }).end('Local mock action response.');
    return;
  }
  if (request.method !== 'GET') {
    response.writeHead(405).end('This fixture never sends game actions.');
    return;
  }
  let body;
  let type;
  if (['/gather.php', '/game.php', '/arena.php', '/raid.php', '/characters.php', '/guard.php'].includes(url.pathname)) {
    const requested = url.searchParams.get('skill') || 'mining';
    const skill = ['mining', 'woodcutting', 'fishing', 'herblore'].includes(requested) ? requested : 'mining';
    const mode = url.pathname === '/arena.php' ? 'arena' : url.pathname === '/raid.php' ? 'raid' : 'gather';
    body = page(skill, false, mode);
    if (mode === 'arena') {
      const zone = ['Meadowbrook Fields', 'Mossgill Sewers', 'Volcanic Caverns'][Number(url.searchParams.get('zone') || 1) - 1] || 'Meadowbrook Fields';
      body = body.replace(/<section class="content">[\s\S]*?<\/section>/,
        `<section class="content">${arenaContent({ active: false, zone, name: 'Field Mouse', hp: 8, log: '' })}</section>`);
    }
    if (url.pathname === '/guard.php') {
      const from = ['gather', 'arena', 'raid'].includes(url.searchParams.get('from')) ? url.searchParams.get('from') : 'gather';
      body = body.replace(/<section class="content">[\s\S]*?<\/section>/,
        `<section class="content"><h1>Mock human check</h1><p>This local test contains no CAPTCHA and never contacts DankScape.</p><a href="/${from}.php">Complete mock check and return to the default page</a></section>`);
    }
    if (mode === 'raid' && !url.searchParams.get('id')) {
      body = body.replace(/<section class="content">[\s\S]*?<\/section>/, `<section class="content">${raidContent(null)}</section>`);
    }
    body = body.replace('</head>', `<style>
      body { font: 16px/1.5 system-ui; color: #eee7d6; background: #101a17; margin: 30px; max-width: 800px; }
      aside, .card, .test-controls { background: #22352b; border: 1px solid #54665a; border-radius: 8px; padding: 16px; margin: 16px 0; }
      .stat-row { display: flex; justify-content: space-between; max-width: 260px; } a { color: #f5cb79; }
      .foe { border: 1px solid #54665a; border-radius: 8px; padding: 12px; margin: 10px 0; }
      .combat-log { white-space: pre-line; }
      button, select { font: inherit; padding: 6px 12px; margin: 5px; } h1, h3 { margin-top: 0; }
      .flash { padding: 10px; } .flash-ok { background: #254b33; } .flash-error { background: #602f2b; }
    </style></head>`).replace('<body>', `<body><h1>Local automation test</h1>
      <p>This simulates the inspected gathering DOM. It never contacts DankScape.</p>
      <div class="test-controls"><label>Response scenario <select id="scenario"><option value="normal">Success</option><option value="repeat">Repeated misses; unchanged HP</option><option value="lost">Lost response; server completed action</option><option value="refresh">Unrelated refresh before response</option><option value="miss">Miss + unrelated refresh</option><option value="guard">Mock verification required</option><option value="error">Game error</option><option value="timeout">No response</option><option value="unconfirmed">Unconfirmed response</option></select></label>
      <button id="regen" type="button">Add 10 energy</button><button id="low-energy" type="button">Set energy to 2</button><button id="hurt" type="button">Lose 1 HP</button>
      <button id="expire-attack" type="button">Expire Attack boost</button><button id="expire-strength" type="button">Expire Strength boost</button>
      <button id="hide-panel" type="button">Hide assistant for test</button><button id="show-panel" type="button">Show assistant menu command</button><button id="remove-panel" type="button">Remove assistant for test</button>
      <span>Requests: <strong id="request-count">0</strong> · Food left: <strong id="food-count">20</strong> · Recovery reads: <strong id="recovery-count">0</strong></span>
      <p><a href="/gather.php">Gathering</a> · <a href="/arena.php">Arena</a> · <a href="/raid.php?id=123">Boss fight</a> · <a href="/characters.php">Navigation page</a></p></div>
      <template id="food-template">${foodMarkup([{ id: 'shark-row', name: 'Shark', gain: 20, quantity: 20 }])}</template>`)
      .replace('</body>', '<script src="/fixture-renderers.js"></script><script src="/fixture.js"></script><script src="/dankscape-gather.user.js"></script></body>');
    type = 'text/html; charset=utf-8';
  } else if (url.pathname === '/fixture.js') {
    body = readFileSync(join(directory, 'tests', 'browser-fixture.js'));
    type = 'text/javascript; charset=utf-8';
  } else if (url.pathname === '/fixture-renderers.js') {
    body = `'use strict';\n${arenaContent.toString()}\n${raidContent.toString()}\n${potionMarkup.toString()}\n`;
    type = 'text/javascript; charset=utf-8';
  } else if (url.pathname === '/dankscape-gather.user.js') {
    body = readFileSync(join(directory, 'dankscape-gather.user.js'));
    type = 'text/javascript; charset=utf-8';
  } else {
    response.writeHead(404).end('Not found');
    return;
  }
  const headers = { 'Content-Type': type, 'Cache-Control': 'no-store' };
  if (url.searchParams.get('trustedtypes') === '1') {
    headers['Content-Security-Policy'] = "require-trusted-types-for 'script'; trusted-types 'none'";
  }
  response.writeHead(200, headers);
  response.end(body);
});

server.on('error', error => {
  console.error(`Could not start the local fixture: ${error.message}`);
  process.exitCode = 1;
});
server.listen(port, '127.0.0.1', () => console.log(`Local fixture: http://127.0.0.1:${server.address().port}/gather.php`));
