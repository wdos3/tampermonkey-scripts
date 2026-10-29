'use strict';

const http = require('node:http');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { SKILLS, page, content, arenaContent, raidContent, foodMarkup, potionMarkup, skillProgressMarkup } = require('../tests/fixture.cjs');
const { questContent, escapeHTML } = require('../tests/quest-fixture.cjs');
const { slayerContent } = require('../tests/slayer-fixture.cjs');
const { diaryContent } = require('../tests/diary-fixture.cjs');
const { craftContent } = require('../tests/craft-fixture.cjs');
const { clueContent, nonogramContent, cipherContent, codebreakerContent, wireCodebreaker } = require('../tests/clue-fixture.cjs');
const potions = [
  { id: 'combat', name: 'Super Combat Elixir', stat: 'combat', boost: 8, quantity: 20 },
  { id: 'attack', name: 'Super Attack Elixir', stat: 'attack', boost: 7, quantity: 20 },
  { id: 'strength', name: 'Super Strength Elixir', stat: 'strength', boost: 7, quantity: 20 },
];

let clueStep = 1, bones = 5, deedProgress = 0, cluePuzzle = 'nonogram';
let runeHistory = [];
const clueMarkup = () => clueStep === 1 ? (cluePuzzle === 'cipher' ? cipherContent() : cluePuzzle === 'codebreaker' ? codebreakerContent(runeHistory) : nonogramContent()) : clueStep === 2
  ? clueContent({ index: 2, progress: deedProgress }) : clueContent({ idle: true });
const altarMarkup = () => `<h1>The Altar</h1><table><tr><td>Big Bones</td><td>${bones}</td><td>+15</td><td>
  <form method="post" class="altar-bury" data-ajax><input name="csrf" type="hidden" value="local-token"><input name="action" type="hidden" value="bury">
  <input name="inv_id" type="hidden" value="bones"><input type="number" name="qty" min="1" max="${bones}" value="${bones}"><button type="submit">Bury</button></form></td></tr></table>`;
function cluePreview(markup, message = '') {
  return `<!doctype html><html><head><meta charset="utf-8"><title>Local clue runner test</title><style>body{background:#101a17;color:#eee7d6;font:16px/1.5 system-ui;margin:28px;max-width:740px}.card{border:1px solid #617267;padding:16px;margin:16px 0}button,input{padding:8px}td{padding:10px}</style></head><body>
    <h2>Local clue runner test</h2><p>Mock scroll, native puzzle, altar deed, and reward. No live game actions.</p>
    <section class="content">${markup}</section><div id="flash-stack">${message ? `<div class="flash flash-ok">${message}</div>` : ''}</div>
    <script>window.GM_getValue=(key,fallback)=>JSON.parse(localStorage.getItem('clue-preview:'+key)||'null')??fallback;
      window.GM_setValue=(key,value)=>localStorage.setItem('clue-preview:'+key,JSON.stringify(value));window.GM_registerMenuCommand=()=>{};
      (${wireCodebreaker.toString()})(document);
      const out=document.getElementById('nono-cells');if(out)document.querySelectorAll('button.nono').forEach(b=>b.addEventListener('click',()=>{const bits=out.value.split(''),i=+b.dataset.i;bits[i]=bits[i]==='1'?'0':'1';out.value=bits.join('');b.style.background=bits[i]==='1'?'#f0c860':'#1a120a';}));
      document.addEventListener('submit',async e=>{const f=e.target;if(!f.matches('[data-ajax]'))return;e.preventDefault();const b=e.submitter,body=new URLSearchParams(new FormData(f,b));b.disabled=true;
        const r=await fetch(location.href,{method:'POST',body});const d=new DOMParser().parseFromString(await r.text(),'text/html');
        document.querySelector('section.content').replaceWith(d.querySelector('section.content'));document.getElementById('flash-stack').replaceWith(d.getElementById('flash-stack'));document.dispatchEvent(new CustomEvent('dank:swapped'));});
    </script><script src="/assistant.js"></script></body></html>`;
}

// Separate browser fixture: real document navigations and localhost POSTs only.
const server = http.createServer((request, response) => {
  const url = new URL(request.url, 'http://127.0.0.1');
  if (['/clue.php', '/altar.php'].includes(url.pathname)) {
    if (request.method === 'POST') {
      let body = '';
      request.on('data', chunk => { body += chunk; });
      request.on('end', () => {
        const fields = new URLSearchParams(body);
        if (url.pathname === '/altar.php') {
          if (fields.get('qty') !== '1') { response.writeHead(400).end('Expected one bone.'); return; }
          bones -= 1; deedProgress += 15;
          response.writeHead(200, { 'Content-Type': 'text/html' }).end(cluePreview(altarMarkup(), 'You bury 1 Big Bones.'));
        } else {
          if (clueStep === 1 && cluePuzzle === 'cipher' && fields.get('answer') === 'NO CAPE WITHOUT A HUNDRED NIGHTS') clueStep = 3;
          else if (clueStep === 1 && cluePuzzle === 'codebreaker') {
            const secret = '3433', guess = fields.get('guess');
            if (!/^[1-4]{4}$/.test(guess) || runeHistory.some(entry => entry.guess === guess)) { response.writeHead(400).end('Invalid or repeated rune guess.'); return; }
            if (guess === secret) clueStep = 2;
            else {
              const exact = Array.from(secret).filter((rune, i) => rune === guess[i]).length;
              const total = ['1', '2', '3', '4'].reduce((sum, rune) => sum + Math.min(secret.split(rune).length - 1, guess.split(rune).length - 1), 0);
              runeHistory.push({ guess, exact, misplaced: total - exact });
            }
          } else if (clueStep === 1 && cluePuzzle === 'nonogram' && fields.get('cells') === '0011111000000111101101001') clueStep = 2;
          else if (clueStep === 2 && deedProgress >= 20) clueStep = 3;
          response.writeHead(303, { Location: '/clue.php' }).end();
        }
      });
      return;
    }
    if (url.pathname === '/clue.php' && ['cipher', 'codebreaker'].includes(url.searchParams.get('puzzle'))) {
      cluePuzzle = url.searchParams.get('puzzle'); clueStep = 1; runeHistory = []; bones = 5; deedProgress = 0;
    }
    response.writeHead(200, { 'Content-Type': 'text/html', 'Cache-Control': 'no-store' }).end(cluePreview(url.pathname === '/altar.php' ? altarMarkup() : clueMarkup(),
      url.pathname === '/clue.php' && clueStep === 3 ? 'The trail ends at a buried casket: 2,160g and a Emerald.' : ''));
    return;
  }
  if (request.method === 'POST' && ['/quests.php', '/slayer.php', '/diaries.php', '/arena.php', '/raid.php', '/craft.php', '/gather.php', '/eat.php', '/drink.php', '/guard.php'].includes(url.pathname)) {
    request.resume();
    response.writeHead(200, { 'Content-Type': 'text/plain' }).end('Mock quest action completed.');
    return;
  }
  if (request.method !== 'GET') { response.writeHead(405).end(); return; }
  if (['/quests.php', '/slayer.php', '/diaries.php', '/arena.php', '/raid.php', '/craft.php', '/gather.php', '/guard.php'].includes(url.pathname)) {
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
    response.writeHead(200, { 'Content-Type': 'text/javascript' }).end([escapeHTML, questContent, slayerContent, diaryContent, craftContent, content, arenaContent, raidContent, foodMarkup, potionMarkup, skillProgressMarkup].map(fn => fn.toString()).join('\n')
      + `\nconst QUEST_POTIONS = ${JSON.stringify(potions)};\nconst SKILLS = ${JSON.stringify(SKILLS)};`);
  } else response.writeHead(404).end();
});
server.listen(0, '127.0.0.1', () => console.log(`Quest fixture: http://127.0.0.1:${server.address().port}/quests.php`));
