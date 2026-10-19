'use strict';

const http = require('node:http');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { SKILLS, page, content, arenaContent, foodMarkup, potionMarkup } = require('../tests/fixture.cjs');
const { questContent, escapeHTML } = require('../tests/quest-fixture.cjs');
const { slayerContent } = require('../tests/slayer-fixture.cjs');
const { diaryContent } = require('../tests/diary-fixture.cjs');
const potions = [
  { id: 'combat', name: 'Super Combat Elixir', stat: 'combat', boost: 8, quantity: 20 },
  { id: 'attack', name: 'Super Attack Elixir', stat: 'attack', boost: 7, quantity: 20 },
  { id: 'strength', name: 'Super Strength Elixir', stat: 'strength', boost: 7, quantity: 20 },
];

// Separate browser fixture: real document navigations and localhost POSTs only.
const server = http.createServer((request, response) => {
  const url = new URL(request.url, 'http://127.0.0.1');
  if (request.method === 'POST' && ['/quests.php', '/slayer.php', '/diaries.php', '/arena.php', '/gather.php', '/eat.php', '/drink.php'].includes(url.pathname)) {
    request.resume();
    response.writeHead(200, { 'Content-Type': 'text/plain' }).end('Mock quest action completed.');
    return;
  }
  if (request.method !== 'GET') { response.writeHead(405).end(); return; }
  if (['/quests.php', '/slayer.php', '/diaries.php', '/arena.php', '/gather.php', '/guard.php'].includes(url.pathname)) {
    const body = page(url.searchParams.get('skill') || 'fishing').replace('</aside>', `${potionMarkup(potions)}</aside>`).replace('</head>', `<style>
      body { background:#101a17; color:#eee7d6; font:16px/1.5 system-ui; margin:28px; max-width:740px; }
      .card,aside { border:1px solid #617267; background:#22352b; padding:16px; margin:16px 0; border-radius:8px; }
      .stat-row { display:flex; justify-content:space-between; max-width:300px; } button { padding:8px 14px; } a { color:#f5cb79; }
    </style></head>`).replace('<body>', '<body><h1>Local quest automation test</h1><p>Mock contracts and localhost actions. No connection to DankScape.</p><p id="quest-test-summary"></p>')
      .replace('</body>', '<script src="/renderers.js"></script><script src="/quest-fixture.js"></script><script src="/assistant.js"></script></body>');
    response.writeHead(200, { 'Content-Type': 'text/html', 'Cache-Control': 'no-store' }).end(body);
    return;
  }
  const files = { '/assistant.js': '../dankscape-gather.user.js', '/quest-fixture.js': '../tests/quest-browser-fixture.js' };
  if (files[url.pathname]) {
    response.writeHead(200, { 'Content-Type': 'text/javascript', 'Cache-Control': 'no-store' }).end(readFileSync(join(__dirname, files[url.pathname])));
  } else if (url.pathname === '/renderers.js') {
    response.writeHead(200, { 'Content-Type': 'text/javascript' }).end([escapeHTML, questContent, slayerContent, diaryContent, content, arenaContent, foodMarkup, potionMarkup].map(fn => fn.toString()).join('\n')
      + `\nconst QUEST_POTIONS = ${JSON.stringify(potions)};\nconst SKILLS = ${JSON.stringify(SKILLS)};`);
  } else response.writeHead(404).end();
});
server.listen(0, '127.0.0.1', () => console.log(`Quest fixture: http://127.0.0.1:${server.address().port}/quests.php`));
