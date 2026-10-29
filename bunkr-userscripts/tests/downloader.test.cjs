const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test, before, after } = require('node:test');
const { chromium } = require('playwright');

const source = fs.readFileSync(path.join(__dirname, '..', 'bunkr-download-all-files.user.js'), 'utf8');
const selector = (name) => `#bunkr-bulk-download-panel [data-ui="${name}"]`;
let browser;
before(async () => { browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL }); });
after(async () => { await browser?.close(); });

function escapeHtml(text) {
    return text.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function files(count, offset = 0) {
    return Array.from({ length: count }, (_, index) => ({
        slug: `file${index + offset}`,
        name: `File ${index + offset}.${['jpg', 'mp4', 'rar'][index % 3]}`,
        size: 100 + index + offset,
    }));
}

function album(entries, totalPages = 1, title = 'Test Album') {
    return `<h1>${escapeHtml(title)}</h1><div id="galleryGrid">${entries.map((file) => `
        <div class="theItem" title="${escapeHtml(file.name)}">
            <p class="theName">${escapeHtml(file.name)}</p><a href="/f/${file.slug}" aria-label="download"></a>
        </div>`).join('')}</div>${Array.from({ length: totalPages }, (_, index) =>
        `<a href="/a/test?page=${index + 1}">${index + 1}</a>`).join('')}`;
}

function albumMetadata(entries, title = 'Test Album') {
    return `<h1>${escapeHtml(title)}</h1><script>window.albumFiles = [${entries.map((file) => `{
        slug: ${JSON.stringify(file.slug)}, original: ${JSON.stringify(file.name)}, size: ${file.size},
    },`).join('')}]; console.log('Album files embedded');</script>`;
}

async function recover(page, entries) {
    await page.evaluate((entries) => {
        const transfer = new DataTransfer();
        for (const entry of entries) transfer.items.add(new File([new Uint8Array(entry.size)], entry.name));
        const input = document.querySelector('[data-ui="picker"]');
        input.files = transfer.files;
        input.dispatchEvent(new Event('change'));
    }, entries);
    await page.waitForFunction(() => !document.querySelector('[data-ui="start"]').disabled);
}

async function setup(t, options = {}) {
    const context = await browser.newContext();
    t.after(() => context.close());
    const page = await context.newPage();
    const entries = options.entries || files(3);
    const config = {
        entries,
        mode: 'browser',
        ...options,
        pages: { '/a/test?page=1': album(entries), '/a/test?advanced=1': albumMetadata(entries), ...options.pages },
        filePages: Object.fromEntries(entries.map((file, index) => [
            '/f/' + file.slug,
            `<h1>File</h1><a class="btn ic-download-01" href="https://dl.bunkr.cr/file/${1000 + index}">Download</a>`,
        ])),
    };
    await page.route('**/*', (route) => {
        const url = new URL(route.request().url());
        const html = config.pages[url.pathname + url.search] || config.fileReply || config.filePages[url.pathname];
        const response = typeof html === 'string' ? { body: html } : html;
        return route.fulfill({
            status: response?.status || 200,
            contentType: 'text/html', body: response?.body || album(entries.slice(0, 1)),
        });
    });
    await page.addInitScript((config) => {
        const nativeSetTimeout = window.setTimeout.bind(window);
        window.setTimeout = (callback, milliseconds, ...args) => nativeSetTimeout(
            callback, [250, 500].includes(milliseconds) ? 0 : milliseconds, ...args,
        );
        window.calls = { requests: [], requestDetails: [], downloads: [], active: 0, maxActive: 0 };
        window.GM_info = { downloadMode: config.mode };
        const storageKey = 'test-gm-progress';
        if (config.savedProgress && !localStorage.getItem(storageKey)) {
            localStorage.setItem(storageKey, JSON.stringify(config.savedProgress));
        }
        window.GM_getValue = (key, fallback) => JSON.parse(localStorage.getItem(storageKey) || '{}')[key] ?? fallback;
        let writes = 0;
        window.GM_setValue = (key, value) => {
            if (config.storageErrorAfter === writes++) throw new Error('Storage write failed');
            const stored = JSON.parse(localStorage.getItem(storageKey) || '{}');
            stored[key] = value;
            localStorage.setItem(storageKey, JSON.stringify(stored));
        };
        const respond = (options, channel) => {
            window.calls.requests.push(options.url);
            window.calls.requestDetails.push({
                url: options.url, method: options.method, headers: options.headers, data: options.data,
                channel, credentials: options.credentials,
            });
            const url = new URL(options.url);
            let reply = config.pages[url.pathname + url.search];
            if (url.hostname === 'glb-apisign.cdn.cr') {
                reply = config.signatureReply || JSON.stringify({ token: 'signed-token', ex: 2000000000 });
            } else if (url.pathname === '/api/_001_v2') {
                const index = Number(JSON.parse(options.data).id) - 1000;
                const entry = config.entries[index] || { name: `File ${index}.jpg` };
                const extension = entry.name.match(/\.(\w+)$/)?.[1] || 'bin';
                reply = config.metadataReply || JSON.stringify({
                    mediafiles: entry.mediaOrigin || 'https://c4s5-b.cdn.cr',
                    path: `/storage/media/file${index}.${extension}`,
                    original: entry.name,
                });
            } else if (url.pathname.startsWith('/f/')) {
                reply = config.fileReply || config.filePages[url.pathname];
            }
            const channelError = channel === 'browser' ? config.browserRequestError : config.gmRequestError;
            if (options.url.includes(config.requestError || 'NEVER_MATCH') ||
                options.url.includes(channelError || 'NEVER_MATCH')) {
                nativeSetTimeout(() => options.onerror({}), 0);
                return;
            }
            if (options.url.includes(config.requestTimeout || 'NEVER_MATCH')) {
                nativeSetTimeout(() => options.ontimeout(), 0);
                return;
            }
            const response = typeof reply === 'string' ? { body: reply } : reply || { status: 404, body: '' };
            const deliver = () => options.onload({
                status: response.status || 200,
                responseText: response.body,
                finalUrl: response.finalUrl || options.url,
            });
            if (config.holdRequest && options.url.includes(config.holdRequest)) {
                window.finishRequest = deliver;
            } else {
                nativeSetTimeout(deliver, 0);
            }
        };
        window.GM_xmlhttpRequest = (options) => respond(options, 'gm');
        if (!config.useNativeFetch) window.fetch = (url, options = {}) => new Promise((resolve, reject) => {
            const abort = () => reject(new DOMException('Browser request timed out', 'AbortError'));
            options.signal?.addEventListener('abort', abort, { once: true });
            respond({
                ...options, method: options.method || 'GET', url: String(url),
                onload: (response) => {
                    options.signal?.removeEventListener('abort', abort);
                    resolve({ status: response.status, url: response.finalUrl, text: async () => response.responseText });
                },
                onerror: () => {
                    options.signal?.removeEventListener('abort', abort);
                    reject(new TypeError('Failed to fetch'));
                },
                ontimeout: abort,
            }, 'browser');
        });
        window.GM_download = (options) => {
            const index = window.calls.downloads.length;
            window.calls.downloads.push({ url: options.url, name: options.name, conflictAction: options.conflictAction });
            window.calls.active += 1;
            window.calls.maxActive = Math.max(window.calls.maxActive, window.calls.active);
            options.onprogress({ loaded: 512, total: 1024 });
            const finish = () => {
                window.calls.active -= 1;
                if (config.downloadErrorIndex === index) options.onerror({
                    error: config.downloadError || 'not_succeeded', details: config.downloadErrorDetails,
                });
                else if (config.downloadTimeoutIndex === index) options.ontimeout();
                else options.onload();
            };
            if (config.holdDownload) window.finishDownload = finish;
            else nativeSetTimeout(finish, 0);
        };
    }, config);
    await page.goto(options.startUrl || 'https://bunkr.ac/a/test?advanced=1&page=2&q=hidden');
    await page.addScriptTag({ content: source });
    return page;
}

async function run(page) {
    await page.locator(selector('start')).click();
    await page.waitForFunction(() => !document.querySelector('[data-ui="start"]').disabled);
}

test('metadata covers arbitrary Bunkr domains while excluding unrelated hosts and pages', () => {
    const value = source.match(/^\/\/ @include\s+(.*)$/m)[1];
    const pattern = new RegExp(value.slice(1, -1));
    for (const host of ['bunkr.ac', 'bunkr.cr', 'bunkr.ws', 'bunkr.fi', 'bunkr.example', 'www.bunkr.si', 'album.bunkr.ph']) {
        assert.ok(pattern.test(`https://${host}/a/test?advanced=1&page=2`), host);
    }
    for (const url of ['https://bunkr.cr.evil.com/a/test', 'https://notbunkr.cr/a/test', 'https://bunkr.cr/f/test',
        'https://evil.com/a/test?site=bunkr.cr', 'https://bunkr.cr/a/', 'http://bunkr.cr/a/test']) {
        assert.equal(pattern.test(url), false, url);
    }
});

test('collects all 110 unique files across cdn.cr and scdn.st, signs just before download, and stays sequential', async (t) => {
    const entries = files(110).map((entry, index) => ({
        ...entry, mediaOrigin: index < 36 ? 'https://c4s5-b.cdn.cr' : 'https://pc9.scdn.st',
    }));
    const page = await setup(t, {
        entries,
        pages: {
            '/a/test?page=1': album(entries.slice(0, 100), 2, 'Album: Tests / 2026'),
            '/a/test?page=2': album(entries.slice(98), 2, 'Album: Tests / 2026'),
        },
    });
    await run(page);
    const calls = await page.evaluate(() => window.calls);
    assert.equal(calls.downloads.length, 110);
    assert.equal(calls.downloads.filter((file) => new URL(file.url).hostname === 'pc9.scdn.st').length, 74);
    assert.equal(new Set(calls.downloads.map((file) => file.url)).size, 110);
    assert.equal(calls.maxActive, 1);
    assert.deepEqual(calls.requests.slice(0, 2), ['https://bunkr.ac/a/test?page=1', 'https://bunkr.ac/a/test?page=2']);
    assert.equal(calls.requests[2], 'https://bunkr.ac/f/file0');
    assert.equal(calls.requests[3], 'https://dl.bunkr.cr/api/_001_v2');
    assert.equal(calls.requests[4], 'https://glb-apisign.cdn.cr/sign?path=%2Fstorage%2Fmedia%2Ffile0.jpg');
    assert.equal(calls.requestDetails[3].method, 'POST');
    assert.deepEqual(JSON.parse(calls.requestDetails[3].data), { id: '1000' });
    assert.equal(calls.requestDetails[3].headers.Origin, 'https://dl.bunkr.cr');
    assert.equal(calls.requestDetails[3].headers.Referer, 'https://dl.bunkr.cr/');
    assert.equal(calls.downloads[0].name, 'Album_ Tests _ 2026/File 0.jpg');
    const media = new URL(calls.downloads[0].url);
    assert.equal(media.pathname, '/storage/media/file0.jpg');
    assert.equal(new URL(calls.downloads[2].url).pathname, '/storage/media/file2.rar');
    assert.equal(media.searchParams.get('token'), 'signed-token');
    assert.equal(media.searchParams.get('ex'), '2000000000');
    assert.equal(calls.downloads[0].conflictAction, 'uniquify');
    assert.match(await page.locator(selector('stats')).innerText(), /110\/110 processed · 110 completed · 0 failed/);
    assert.equal(await page.locator(selector('status')).innerText(), 'All files downloaded');
    assert.equal(await page.locator(selector('progress')).getAttribute('value'), '100');
});

test('keeps byte progress visible and stops after the active download', async (t) => {
    const page = await setup(t, { holdDownload: true });
    await page.locator(selector('start')).click();
    await page.waitForFunction(() => window.calls.downloads.length === 1);
    assert.match(await page.locator(selector('current')).innerText(), /50% \(512 B \/ 1.0 KB\)/);
    await page.locator(selector('stop')).click();
    await page.evaluate(() => window.finishDownload());
    await page.waitForFunction(() => !document.querySelector('[data-ui="start"]').disabled);
    assert.equal(await page.evaluate(() => window.calls.downloads.length), 1);
    assert.match(await page.locator(selector('stats')).innerText(), /1\/3 processed · 1 completed/);
});

test('stopping during collection starts no file requests or downloads', async (t) => {
    const page = await setup(t, { holdRequest: '/a/test?page=1' });
    await page.locator(selector('start')).click();
    await page.waitForFunction(() => typeof window.finishRequest === 'function');
    await page.locator(selector('stop')).click();
    await page.evaluate(() => window.finishRequest());
    await page.waitForFunction(() => !document.querySelector('[data-ui="start"]').disabled);
    assert.equal(await page.evaluate(() => window.calls.downloads.length), 0);
    assert.equal(await page.locator(selector('status')).innerText(), 'Stopped while collecting files');
});

test('stopping during preparation does not start the pending file', async (t) => {
    const page = await setup(t, { holdRequest: '/f/file0' });
    await page.locator(selector('start')).click();
    await page.waitForFunction(() => typeof window.finishRequest === 'function');
    await page.locator(selector('stop')).click();
    await page.evaluate(() => window.finishRequest());
    await page.waitForFunction(() => !document.querySelector('[data-ui="start"]').disabled);
    assert.equal(await page.evaluate(() => window.calls.downloads.length), 0);
});

test('ordinary file failures remain visible and later files still download', async (t) => {
    const page = await setup(t, { requestError: '/f/file0', downloadErrorIndex: 0 });
    await run(page);
    assert.equal(await page.evaluate(() => window.calls.downloads.length), 2);
    assert.match(await page.locator(selector('stats')).innerText(), /3\/3 processed · 1 completed · 2 failed/);
    assert.match(await page.locator(selector('errors')).innerText(), /File 0.jpg: Could not reach/);
    assert.match(await page.locator(selector('errors')).innerText(), /File 1.mp4: not_succeeded/);
});

test('stop also prevents downloads during API metadata and signing requests', async (t) => {
    for (const holdRequest of ['/api/_001_v2', '/sign?']) {
        const page = await setup(t, { holdRequest });
        await page.locator(selector('start')).click();
        await page.waitForFunction(() => typeof window.finishRequest === 'function');
        await page.locator(selector('stop')).click();
        await page.evaluate(() => window.finishRequest());
        await page.waitForFunction(() => !document.querySelector('[data-ui="start"]').disabled);
        assert.equal(await page.evaluate(() => window.calls.downloads.length), 0);
    }
});

test('API original names and encoded media paths survive signing', async (t) => {
    const page = await setup(t, { entries: files(1), metadataReply: JSON.stringify({
        mediafiles: 'https://s.cdn.cr', path: '/storage/media/hello%20world.rar', original: 'Archive 日本語.rar',
    }) });
    await run(page);
    const calls = await page.evaluate(() => window.calls);
    const signer = new URL(calls.requests[3]);
    assert.equal(signer.searchParams.get('path'), '/storage/media/hello world.rar');
    assert.equal(calls.downloads[0].name, 'Test Album/Archive 日本語.rar');
    assert.equal(new URL(calls.downloads[0].url).pathname, '/storage/media/hello%20world.rar');
});

test('download timeouts count as failures while the rest of the queue completes', async (t) => {
    const page = await setup(t, { downloadTimeoutIndex: 0 });
    await run(page);
    assert.match(await page.locator(selector('errors')).innerText(), /Download timed out/);
    assert.match(await page.locator(selector('stats')).innerText(), /3\/3 processed · 2 completed · 1 failed/);
});

test('another run skips completed files and clears resolved errors', async (t) => {
    const page = await setup(t, { downloadErrorIndex: 0 });
    await run(page);
    assert.match(await page.locator(selector('stats')).innerText(), /2 completed · 1 failed/);
    await run(page);
    assert.match(await page.locator(selector('stats')).innerText(), /1\/1 processed · 1 completed · 0 failed/);
    assert.equal(await page.evaluate(() => window.calls.downloads.length), 4);
    assert.match(await page.locator(selector('saved')).innerText(), /3 completed · 0 failed · 0 pending/);
    assert.equal(await page.locator(selector('errors')).innerText(), '');
});

test('download permission failures stop the queue with an actionable message', async (t) => {
    const page = await setup(t, { downloadErrorIndex: 0, downloadError: 'not_permitted' });
    await run(page);
    assert.equal(await page.evaluate(() => window.calls.downloads.length), 1);
    assert.match(await page.locator(selector('errors')).innerText(), /Allow Tampermonkey the browser downloads permission/);
    assert.equal(await page.locator(selector('status')).innerText(), 'Bulk download stopped');
});

test('rejects repeated pagination rather than downloading an incomplete album', async (t) => {
    const repeated = album(files(2), 2);
    const page = await setup(t, { pages: { '/a/test?page=1': repeated, '/a/test?page=2': repeated } });
    await run(page);
    assert.equal(await page.evaluate(() => window.calls.downloads.length), 0);
    assert.match(await page.locator(selector('errors')).innerText(), /Page 2 was empty or repeated/);
});

test('an unavailable later page never downloads a partial album', async (t) => {
    const page = await setup(t, { pages: {
        '/a/test?page=1': album(files(2), 2), '/a/test?page=2': { status: 503, body: 'Maintenance' },
    } });
    await run(page);
    assert.equal(await page.evaluate(() => window.calls.downloads.length), 0);
    assert.match(await page.locator(selector('errors')).innerText(), /HTTP 503/);
});

test('follows canonical Bunkr domain redirects and resolves file pages on that domain', async (t) => {
    const page = await setup(t, { pages: { '/a/test?page=1': {
        body: album(files(1)), finalUrl: 'https://bunkr.cr/a/test?page=1',
    } } });
    await run(page);
    assert.equal(await page.evaluate(() => window.calls.requests[1]), 'https://bunkr.cr/f/file0');
    assert.equal(await page.evaluate(() => window.calls.downloads.length), 1);
});

test('rejects a redirect to another album or a non-Bunkr site', async (t) => {
    for (const finalUrl of ['https://bunkr.cr/a/another', 'https://example.com/a/test']) {
        const page = await setup(t, { pages: { '/a/test?page=1': { body: album(files(1)), finalUrl } } });
        await run(page);
        assert.equal(await page.evaluate(() => window.calls.downloads.length), 0);
        assert.match(await page.locator(selector('errors')).innerText(), /unexpected page/);
    }
});

test('rejects challenge pages, missing file links, and empty albums clearly', async (t) => {
    for (const [html, expected] of [
        ['<h1>Challenge</h1>', /did not return an album file list/],
        ['<h1>Test</h1><div id="galleryGrid"><div class="theItem"></div></div>', /no Bunkr file link/],
        [album([]), /No files were found/],
    ]) {
        const page = await setup(t, { pages: { '/a/test?page=1': html } });
        await run(page);
        assert.equal(await page.evaluate(() => window.calls.downloads.length), 0);
        assert.match(await page.locator(selector('errors')).innerText(), expected);
    }
});

test('malformed API data, signatures, and unexpected media hosts are never downloaded', async (t) => {
    for (const options of [
        { signatureReply: '{"token":"","ex":2000000000}' },
        { signatureReply: '<html>Challenge</html>' },
        { metadataReply: '{"mediafiles":"https://example.com","path":"/file.jpg"}' },
        { metadataReply: '{"mediafiles":"https://pc9.scdn.st.evil.com","path":"/file.jpg"}' },
        { metadataReply: '{"mediafiles":"https://notscdn.st","path":"/file.jpg"}' },
        { metadataReply: '{"mediafiles":"http://pc9.scdn.st","path":"/file.jpg"}' },
        { metadataReply: '{"mediafiles":"https://s.cdn.cr","path":"//example.com/file.jpg"}' },
        { metadataReply: 'null' },
        { metadataReply: '{}' },
        { fileReply: '<a class="ic-download-01" href="https://example.com/file/123">Download</a>' },
        { fileReply: '<h1>Maintenance</h1>' },
    ]) {
        const page = await setup(t, { entries: files(1), ...options });
        await run(page);
        assert.equal(await page.evaluate(() => window.calls.downloads.length), 0);
        assert.match(await page.locator(selector('stats')).innerText(), /0 completed · 1 failed/);
    }
});

test('filenames are safe on Windows while preserving Unicode and treating markup as text', async (t) => {
    const entries = [
        { slug: 'unicode', name: 'Tiếng Việt 🇻🇳 "photo".jpg' },
        { slug: 'device', name: 'CON.txt' },
        { slug: 'dot', name: '..' },
        { slug: 'markup', name: '<img src=x onerror=alert(1)>.jpg' },
    ];
    const page = await setup(t, { entries, pages: { '/a/test?page=1': album(entries, 1, 'A/B: C.. ') } });
    await run(page);
    const names = await page.evaluate(() => window.calls.downloads.map((file) => file.name));
    assert.deepEqual(names, [
        'A_B_ C/Tiếng Việt 🇻🇳 _photo_.jpg', 'A_B_ C/_CON.txt', 'A_B_ C/bunkr-file',
        'A_B_ C/_img src=x onerror=alert(1)_.jpg',
    ]);
    assert.equal(await page.locator('#bunkr-bulk-download-panel img').count(), 0);
});

test('native or disabled download mode fails before making network requests', async (t) => {
    for (const mode of ['native', 'disabled']) {
        const page = await setup(t, { mode });
        await run(page);
        assert.equal(await page.evaluate(() => window.calls.requests.length), 0);
        assert.match(await page.locator(selector('errors')).innerText(), /Download Mode to Browser API/);
    }
});

test('timeouts settle and the start button becomes usable again', async (t) => {
    const page = await setup(t, { requestTimeout: '/a/test?page=1' });
    await run(page);
    assert.match(await page.locator(selector('errors')).innerText(), /timed out/);
    assert.ok(await page.locator(selector('start')).isEnabled());
});

test('loading twice creates one panel and one active queue', async (t) => {
    const page = await setup(t, { entries: files(1) });
    await page.addScriptTag({ content: source });
    assert.equal(await page.locator('#bunkr-bulk-download-panel').count(), 1);
    await run(page);
    assert.equal(await page.evaluate(() => window.calls.downloads.length), 1);
});

test('panel fits a narrow mobile viewport and remains at the bottom right', async (t) => {
    const page = await setup(t);
    await page.setViewportSize({ width: 320, height: 568 });
    const bounds = await page.locator('#bunkr-bulk-download-panel').boundingBox();
    assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= 320);
    assert.ok(bounds.y >= 0 && bounds.y + bounds.height <= 568);
    assert.equal(Math.round(320 - bounds.x - bounds.width), 16);
    assert.equal(Math.round(568 - bounds.y - bounds.height), 16);
});

test('Retry failed prepares only failed files and leaves completed files untouched', async (t) => {
    const page = await setup(t, { downloadErrorIndex: 1 });
    await run(page);
    const initialRequests = await page.evaluate(() => window.calls.requests.length);
    assert.equal(await page.locator(selector('retry')).innerText(), 'Retry failed (1)');
    await page.locator(selector('retry')).click();
    await page.waitForFunction(() => !document.querySelector('[data-ui="start"]').disabled);
    const calls = await page.evaluate(() => window.calls);
    assert.deepEqual(calls.downloads.map((file) => file.name), [
        'Test Album/File 0.jpg', 'Test Album/File 1.mp4', 'Test Album/File 2.rar', 'Test Album/File 1.mp4',
    ]);
    assert.deepEqual(calls.requests.slice(initialRequests), [
        'https://bunkr.ac/f/file1', 'https://dl.bunkr.cr/api/_001_v2',
        'https://glb-apisign.cdn.cr/sign?path=%2Fstorage%2Fmedia%2Ffile1.mp4',
    ]);
    assert.match(await page.locator(selector('stats')).innerText(), /1\/1 processed · 1 completed · 0 failed/);
    assert.match(await page.locator(selector('saved')).innerText(), /3 completed · 0 failed · 0 pending/);
    assert.equal(await page.locator(selector('retry')).isVisible(), false);
});

test('failed history survives reload and retries use freshly signed URLs', async (t) => {
    const page = await setup(t, { requestError: '/f/file1' });
    await run(page);
    const saved = await page.evaluate(() => window.GM_getValue('bunkr-album-progress:test'));
    assert.deepEqual(saved.files.map((file) => file.status), ['completed', 'failed', 'completed']);
    assert.equal(JSON.stringify(saved).includes('signed-token'), false);
    const retryPage = await setup(t, { savedProgress: { 'bunkr-album-progress:test': saved } });
    await retryPage.reload();
    await retryPage.addScriptTag({ content: source });
    assert.equal(await retryPage.locator(selector('retry')).innerText(), 'Retry failed (1)');
    await retryPage.locator(selector('retry')).click();
    await retryPage.waitForFunction(() => !document.querySelector('[data-ui="start"]').disabled);
    const calls = await retryPage.evaluate(() => window.calls);
    assert.equal(calls.downloads.length, 1);
    assert.equal(calls.requests[0], 'https://bunkr.ac/f/file1');
    assert.equal(calls.requests.filter((url) => url.includes('/sign?')).length, 1);
});

test('saved progress follows the album across mirrors but stays separate from other albums', async (t) => {
    const saved = { folder: 'Test Album', files: files(3).map((file, index) => ({
        ...file, status: index === 1 ? 'failed' : 'completed', error: '',
    })) };
    const page = await setup(t, {
        startUrl: 'https://bunkr.cr/a/test', savedProgress: { 'bunkr-album-progress:test': saved },
    });
    await page.locator(selector('retry')).click();
    await page.waitForFunction(() => !document.querySelector('[data-ui="start"]').disabled);
    assert.equal(await page.evaluate(() => window.calls.requests[0]), 'https://bunkr.cr/f/file1');
    const other = await setup(t, { savedProgress: { 'bunkr-album-progress:other': saved } });
    await run(other);
    assert.equal(await other.evaluate(() => window.calls.downloads.length), 3);
});

test('Retry failed excludes unattempted files after a fatal error', async (t) => {
    const page = await setup(t, { downloadErrorIndex: 0, downloadError: 'not_permitted' });
    await run(page);
    assert.match(await page.locator(selector('saved')).innerText(), /0 completed · 1 failed · 2 pending/);
    await page.locator(selector('retry')).click();
    await page.waitForFunction(() => !document.querySelector('[data-ui="start"]').disabled);
    assert.equal(await page.evaluate(() => window.calls.downloads.length), 2);
    assert.match(await page.locator(selector('saved')).innerText(), /1 completed · 0 failed · 2 pending/);
    assert.match(await page.locator(selector('status')).innerText(), /2 unattempted file/);
    await run(page);
    assert.equal(await page.evaluate(() => window.calls.downloads.length), 4);
    assert.match(await page.locator(selector('saved')).innerText(), /3 completed · 0 failed · 0 pending/);
});

test('recovering 36 existing files saves only the remaining 74 after reload', async (t) => {
    const entries = files(110);
    const page = await setup(t, { entries, pages: {
        '/a/test?page=1': album(entries.slice(0, 100), 2), '/a/test?page=2': album(entries.slice(100), 2),
    } });
    await recover(page, entries.slice(0, 36));
    assert.equal(await page.evaluate(() => window.calls.downloads.length), 0);
    assert.match(await page.locator(selector('saved')).innerText(), /36 completed · 0 failed · 74 pending/);
    assert.equal(await page.locator(selector('start')).innerText(), 'Download remaining (74)');
    await page.reload();
    await page.addScriptTag({ content: source });
    await run(page);
    const calls = await page.evaluate(() => window.calls);
    assert.equal(calls.downloads.length, 74);
    assert.equal(calls.requests.filter((url) => /\/f\/file(?:[0-9]|[12][0-9]|3[0-5])$/.test(url)).length, 0);
    assert.match(await page.locator(selector('stats')).innerText(), /74\/74 processed · 74 completed · 0 failed/);
    assert.match(await page.locator(selector('saved')).innerText(), /110 completed · 0 failed · 0 pending/);
});

test('recovery distinguishes duplicate filenames by exact size and handles browser unique names', async (t) => {
    const entries = [
        { slug: 'file0', name: 'photo.jpg', size: 101 },
        { slug: 'file1', name: 'photo.jpg', size: 202 },
        { slug: 'file2', name: 'video.mp4', size: 303 },
    ];
    const page = await setup(t, { entries });
    await recover(page, [
        { name: 'photo.jpg', size: 101 }, { name: 'photo (1).jpg', size: 202 }, { name: 'video.mp4', size: 100 },
    ]);
    assert.match(await page.locator(selector('saved')).innerText(), /2 completed · 0 failed · 1 pending/);
    await run(page);
    assert.deepEqual(await page.evaluate(() => window.calls.downloads.map((file) => file.name)), ['Test Album/video.mp4']);
});

test('ambiguous recovery never guesses identities or overwrites saved progress', async (t) => {
    const entries = [
        { slug: 'file0', name: 'photo.jpg', size: 101 }, { slug: 'file1', name: 'photo.jpg', size: 101 },
    ];
    const saved = { folder: 'Test Album', files: entries.map((file) => ({ ...file, status: 'pending' })) };
    const page = await setup(t, { entries, savedProgress: { 'bunkr-album-progress:test': saved } });
    await recover(page, [{ name: 'photo.jpg', size: 101 }]);
    assert.match(await page.locator(selector('errors')).innerText(), /Cannot uniquely identify photo.jpg/);
    assert.deepEqual(await page.evaluate(() => window.GM_getValue('bunkr-album-progress:test')), saved);
    assert.equal(await page.evaluate(() => window.calls.downloads.length), 0);
});

test('recovery fails visibly if metadata is missing or selected files do not match', async (t) => {
    for (const options of [{}, { pages: { '/a/test?advanced=1': '<h1>No metadata</h1>' } }]) {
        const page = await setup(t, options);
        await recover(page, [{ name: 'File 0.jpg', size: 1 }]);
        assert.match(await page.locator(selector('errors')).innerText(), /No files matched|Exact album file sizes are unavailable/);
        assert.equal(await page.evaluate(() => window.GM_getValue('bunkr-album-progress:test', null)), null);
    }
});

test('metadata parsing preserves quoted punctuation and never executes expressions', async (t) => {
    const entries = [{ slug: 'file0', name: 'literal, } ]; name: .jpg', size: 101 }];
    const page = await setup(t, { entries });
    await recover(page, [{ name: 'literal, } ]; name_ .jpg', size: 101 }]);
    assert.match(await page.locator(selector('saved')).innerText(), /1 completed/);
    const unsafe = await setup(t, { pages: { '/a/test?advanced=1': `<h1>Test</h1><script>
        window.albumFiles = [{slug: "file0", original: (window.executed = true, "x"), size: 1}];
    </script>` } });
    await recover(unsafe, [{ name: 'x', size: 1 }]);
    assert.equal(await unsafe.evaluate(() => window.executed), undefined);
    assert.equal(await unsafe.evaluate(() => window.GM_getValue('bunkr-album-progress:test', null)), null);
});

test('stopping recovery preserves history without starting transfers', async (t) => {
    const page = await setup(t, { holdRequest: '/a/test?advanced=1' });
    const recovering = recover(page, [{ name: 'File 0.jpg', size: 100 }]);
    await page.waitForFunction(() => typeof window.finishRequest === 'function');
    await page.locator(selector('stop')).click();
    await page.evaluate(() => window.finishRequest());
    await recovering;
    assert.equal(await page.evaluate(() => window.GM_getValue('bunkr-album-progress:test', null)), null);
    assert.equal(await page.evaluate(() => window.calls.downloads.length), 0);
});

test('storage failures stop before starting another file and remain visible', async (t) => {
    const page = await setup(t, { storageErrorAfter: 1 });
    await run(page);
    assert.equal(await page.evaluate(() => window.calls.downloads.length), 1);
    assert.match(await page.locator(selector('errors')).innerText(), /Could not save album progress/);
    assert.equal(await page.locator(selector('status')).innerText(), 'Bulk download stopped');
});

test('corrupt saved progress is not silently discarded', async (t) => {
    const page = await setup(t, { savedProgress: { 'bunkr-album-progress:test': { files: 'invalid' } } });
    assert.equal(await page.locator(selector('start')).isEnabled(), false);
    assert.match(await page.locator(selector('errors')).innerText(), /Saved album progress is invalid/);
    assert.equal(await page.evaluate(() => window.calls.requests.length), 0);
});

test('checking an updated album downloads only newly added file identities', async (t) => {
    const entries = files(4);
    const saved = { folder: 'Test Album', files: entries.slice(0, 3).map((file) => ({ ...file, status: 'completed' })) };
    const page = await setup(t, { entries, savedProgress: { 'bunkr-album-progress:test': saved } });
    assert.equal(await page.locator(selector('start')).innerText(), 'Check for new files');
    await run(page);
    assert.deepEqual(await page.evaluate(() => window.calls.downloads.map((file) => file.name)), ['Test Album/File 3.jpg']);
    assert.match(await page.locator(selector('saved')).innerText(), /4 completed · 0 failed · 0 pending/);
    await run(page);
    assert.equal(await page.evaluate(() => window.calls.downloads.length), 1);
});

test('retry sanitizes C1 controls in saved folders, filenames, and the CDN filename parameter', async (t) => {
    const entries = [
        { slug: 'file0', name: 'Already saved.mp4', size: 100 },
        { slug: 'file1', name: 'Sin ti\u00cc\u0081tul0_teaser.mp4', size: 101 },
        { slug: 'file2', name: 'omegle MOTHERLESS.COM \u00e2\u0084\u00a2 (3)_teaser.mp4', size: 102 },
        { slug: 'file3', name: 'omegle MOTHERLESS.COM \u00e2\u0084\u00a2 (1)_teaser.mp4', size: 103 },
    ];
    const saved = { folder: 'Album\u0084', files: entries.map((file, index) => ({
        ...file, status: index === 0 ? 'completed' : 'failed',
    })) };
    const page = await setup(t, { entries, savedProgress: { 'bunkr-album-progress:test': saved } });
    await page.locator(selector('retry')).click();
    await page.waitForFunction(() => !document.querySelector('[data-ui="start"]').disabled);
    const calls = await page.evaluate(() => window.calls);
    assert.deepEqual(calls.downloads.map((file) => file.name), [
        'Album_/Sin ti\u00cc_tul0_teaser.mp4',
        'Album_/omegle MOTHERLESS.COM \u00e2_\u00a2 (3)_teaser.mp4',
        'Album_/omegle MOTHERLESS.COM \u00e2_\u00a2 (1)_teaser.mp4',
    ]);
    for (const file of calls.downloads) {
        const remoteName = new URL(file.url).searchParams.get('n');
        assert.equal(/[\u007f-\u009f]/.test(file.name + remoteName), false);
        assert.equal(remoteName, file.name.slice(file.name.indexOf('/') + 1));
    }
    const persisted = await page.evaluate(() => window.GM_getValue('bunkr-album-progress:test'));
    assert.equal(persisted.files[1].name, entries[1].name);
    assert.ok(persisted.files.every((file) => file.status === 'completed'));
});

test('download errors retain structured browser details instead of collapsing to unknown', async (t) => {
    const page = await setup(t, {
        entries: files(1), downloadErrorIndex: 0, downloadError: 'unknown',
        downloadErrorDetails: { current: 'FILE_FAILED', message: 'Native download failure' },
    });
    await run(page);
    const errors = await page.locator(selector('errors')).innerText();
    assert.match(errors, /unknown/);
    assert.match(errors, /FILE_FAILED/);
    assert.match(errors, /Native download failure/);
    assert.equal(errors.includes('[object Object]'), false);
});

test('working browser session reads album and file pages when Tampermonkey page requests fail', async (t) => {
    const page = await setup(t, { gmRequestError: 'https://bunkr.ac/' });
    await run(page);
    const calls = await page.evaluate(() => window.calls);
    assert.equal(calls.downloads.length, 3);
    const html = calls.requestDetails.filter((request) => new URL(request.url).origin === 'https://bunkr.ac');
    assert.equal(html.length, 4);
    assert.ok(html.every((request) => request.channel === 'browser' && request.credentials === 'include'));
    assert.ok(calls.requestDetails.filter((request) => request.method === 'POST').every((request) => request.channel === 'gm'));
});

test('failed browser page reads can use Tampermonkey and still validate redirects', async (t) => {
    const page = await setup(t, { browserRequestError: 'https://bunkr.ac/' });
    await run(page);
    assert.equal(await page.evaluate(() => window.calls.downloads.length), 3);
    const requests = await page.evaluate(() => window.calls.requestDetails);
    assert.deepEqual(requests.slice(0, 2).map((request) => request.channel), ['browser', 'gm']);
    const redirected = await setup(t, {
        browserRequestError: '/a/test',
        pages: { '/a/test?page=1': { body: album(files(1)), finalUrl: 'https://example.com/a/test' } },
    });
    await run(redirected);
    assert.equal(await redirected.evaluate(() => window.calls.downloads.length), 0);
    assert.match(await redirected.locator(selector('errors')).innerText(), /unexpected page/);
});

test('a browser HTTP error is reported without repeating the request in Tampermonkey', async (t) => {
    const page = await setup(t, { pages: { '/a/test?page=1': { status: 403, body: 'Forbidden' } } });
    await run(page);
    assert.match(await page.locator(selector('errors')).innerText(), /HTTP 403/);
    const requests = await page.evaluate(() => window.calls.requestDetails);
    assert.equal(requests.length, 1);
    assert.equal(requests[0].channel, 'browser');
});

test('dual transport failures retain both errors without claiming permissions are the cause', async (t) => {
    const page = await setup(t, { requestError: '/a/test' });
    await run(page);
    const errors = await page.locator(selector('errors')).innerText();
    assert.match(errors, /Browser: Failed to fetch/);
    assert.match(errors, /Tampermonkey:/);
    assert.match(errors, /bunkr.ac\/a\/test/);
    assert.equal(errors.includes("check Tampermonkey's connection permission"), false);
    assert.equal(await page.evaluate(() => window.calls.downloads.length), 0);
});

test('native browser fetch reads fixture HTML with session cookies despite blocked GM page requests', async (t) => {
    const page = await setup(t, { useNativeFetch: true, gmRequestError: 'https://bunkr.ac/' });
    await page.context().addCookies([{ name: 'album_session', value: 'fixture-session', domain: 'bunkr.ac', path: '/', secure: true }]);
    const pageReads = [];
    page.on('request', (request) => {
        if (request.url().startsWith('https://bunkr.ac/')) pageReads.push(request);
    });
    await run(page);
    assert.equal(await page.evaluate(() => window.calls.downloads.length), 3);
    assert.equal(pageReads.length, 4);
    for (const request of pageReads) {
        assert.match((await request.allHeaders()).cookie, /album_session=fixture-session/);
    }
    assert.equal(await page.evaluate(() => window.calls.requestDetails.filter((request) => request.url.startsWith('https://bunkr.ac/')).length), 0);
});
