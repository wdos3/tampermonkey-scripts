// ==UserScript==
// @name         Bunkr: Download All Files
// @namespace    local.bunkr.download-all
// @version      1.1.3
// @downloadURL    https://raw.githubusercontent.com/wdos3/tampermonkey-scripts/main/bunkr-userscripts/bunkr-download-all-files.user.js
// @updateURL      https://raw.githubusercontent.com/wdos3/tampermonkey-scripts/main/bunkr-userscripts/bunkr-download-all-files.user.js
// @description  Download every file across a Bunkr album's pages into an album-named folder, with progress and stop controls.
// @include      /^https:\/\/(?:[a-z0-9-]+\.)*bunkr\.[a-z]{2,}\/a\/[^/?#]+\/?(?:\?[^#]*)?$/
// @run-at       document-idle
// @noframes
// @grant        GM_download
// @grant        GM_xmlhttpRequest
// @grant        GM_info
// @grant        GM_getValue
// @grant        GM_setValue
// @connect      *
// ==/UserScript==

(function () {
    'use strict';

    const PANEL_ID = 'bunkr-bulk-download-panel';
    const BUNKR_HOST = /^(?:[a-z0-9-]+\.)*bunkr\.[a-z]{2,}$/;
    const SIGN_SERVICE_URL = 'https://glb-apisign.cdn.cr/sign';
    const albumPath = window.location.pathname.match(/^\/a\/([^/]+)\/?$/);

    if (!BUNKR_HOST.test(window.location.hostname) || !albumPath || document.getElementById(PANEL_ID)) {
        return;
    }
    const PROGRESS_KEY = 'bunkr-album-progress:' + albumPath[1];

    const state = {
        running: false,
        stopRequested: false,
        total: 0,
        processed: 0,
        completed: 0,
        failed: 0,
        current: null,
        loaded: 0,
        bytes: 0,
        folder: '',
        queue: [],
        historyError: null,
    };

    const panel = document.createElement('aside');
    panel.id = PANEL_ID;
    panel.setAttribute('aria-label', 'Bunkr bulk downloader');
    panel.innerHTML = `
        <strong>Bunkr bulk downloader</strong>
        <div data-ui="status" role="status" aria-live="polite">Ready</div>
        <div data-ui="stats">No files collected yet</div>
        <small data-ui="saved"></small>
        <progress data-ui="progress" max="100" value="0" aria-label="Overall progress"></progress>
        <div data-ui="current">Files are downloaded one at a time.</div>
        <div data-ui="errors" role="log" aria-label="Download errors"></div>
        <div class="bunkr-actions">
            <button type="button" data-ui="start">Download all files</button>
            <button type="button" data-ui="retry" hidden>Retry failed</button>
            <button type="button" data-ui="stop" hidden>Stop after current</button>
        </div>
        <button class="bunkr-import" type="button" data-ui="recover">Skip downloaded files…</button>
        <input type="file" data-ui="picker" webkitdirectory multiple hidden>
        <small data-ui="folder">Save to: Downloads/&lt;album name&gt;/</small>
        <small>Select your existing album folder to recover progress from older script versions. Files stay on your computer.</small>
        <small>Use Tampermonkey's Browser API download mode for album subfolders. Keep this tab open.</small>
    `;
    const style = document.createElement('style');
    style.textContent = `
        #${PANEL_ID} {
            position: fixed; right: 16px; bottom: 16px; z-index: 2147483647;
            width: min(360px, calc(100vw - 32px)); max-height: calc(100vh - 32px);
            overflow: auto; box-sizing: border-box; padding: 14px;
            border: 1px solid #555; border-radius: 12px; background: #171717;
            color: #f5f5f5; box-shadow: 0 8px 30px #0007;
            font: 13px/1.4 system-ui, sans-serif; text-align: left;
        }
        #${PANEL_ID} * { box-sizing: border-box; }
        #${PANEL_ID} strong { display: block; font-size: 15px; }
        #${PANEL_ID} [data-ui="status"] { color: #8ee6aa; margin-top: 6px; }
        #${PANEL_ID} [data-ui="stats"], #${PANEL_ID} [data-ui="current"],
        #${PANEL_ID} small { display: block; margin-top: 6px; color: #bdbdbd; overflow-wrap: anywhere; }
        #${PANEL_ID} progress { display: block; width: 100%; height: 8px; margin-top: 10px; accent-color: #35d07f; }
        #${PANEL_ID} [data-ui="errors"] { max-height: 90px; overflow: auto; color: #ff9b9b; overflow-wrap: anywhere; }
        #${PANEL_ID} .bunkr-actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 12px; }
        #${PANEL_ID} button {
            flex: 1 1 130px; min-height: 34px; padding: 6px 10px; border: 0; border-radius: 7px;
            background: #35d07f; color: #07130c; cursor: pointer; font: inherit; font-weight: 700;
        }
        #${PANEL_ID} [hidden] { display: none; }
        #${PANEL_ID} button:disabled { cursor: wait; opacity: .65; }
        #${PANEL_ID} [data-ui="stop"] { background: #555; color: #fff; }
        #${PANEL_ID} .bunkr-import { width: 100%; margin-top: 8px; background: #333; color: #fff; }
        #${PANEL_ID} small { font-size: 11px; }
    `;
    document.head.append(style);
    document.body.append(panel);
    const ui = Object.fromEntries(
        [...panel.querySelectorAll('[data-ui]')].map((element) => [element.dataset.ui, element]),
    );

    function formatBytes(bytes) {
        if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
        const units = ['B', 'KB', 'MB', 'GB', 'TB'];
        const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
        return (bytes / 1024 ** index).toFixed(index ? 1 : 0) + ' ' + units[index];
    }

    function updatePanel(status) {
        if (status) ui.status.textContent = status;
        const fraction = state.current && state.bytes > 0 ? Math.min(state.loaded / state.bytes, 1) : 0;
        ui.progress.value = state.total ? ((state.processed + fraction) / state.total) * 100 : 0;
        ui.stats.textContent = state.total
            ? `${state.processed}/${state.total} processed · ${state.completed} completed · ${state.failed} failed`
            : 'No files collected yet';
        ui.current.textContent = 'Files are downloaded one at a time.';
        if (state.current) {
            let progress = 'preparing…';
            if (state.bytes > 0) {
                progress = `${Math.floor(fraction * 100)}% (${formatBytes(state.loaded)} / ${formatBytes(state.bytes)})`;
            } else if (state.loaded > 0) {
                progress = formatBytes(state.loaded);
            }
            ui.current.textContent = state.current.name + ' — ' + progress;
        }
        ui.folder.textContent = `Save to: Downloads/${state.folder || '<album name>'}/`;
        const completed = state.queue.filter((file) => file.status === 'completed').length;
        const failed = state.queue.filter((file) => file.status === 'failed').length;
        const remaining = state.queue.length - completed;
        ui.saved.textContent = state.queue.length
            ? `Saved progress: ${completed} completed · ${failed} failed · ${remaining - failed} pending`
            : '';
        ui.start.textContent = !state.queue.length ? 'Download all files'
            : remaining ? `Download remaining (${remaining})` : 'Check for new files';
        ui.retry.textContent = `Retry failed (${failed})`;
        ui.retry.hidden = !failed;
        ui.start.disabled = state.running || Boolean(state.historyError);
        ui.retry.disabled = state.running || Boolean(state.historyError);
        ui.recover.disabled = state.running || Boolean(state.historyError);
        ui.stop.hidden = !state.running;
        ui.stop.disabled = state.stopRequested;
    }

    function reportError(error, filename) {
        const message = (error instanceof Error ? error.message : String(error)).slice(0, 400);
        const entry = document.createElement('div');
        entry.textContent = (filename ? filename + ': ' : '') + message;
        ui.errors.append(entry);
    }

    function restoreProgress() {
        const saved = GM_getValue(PROGRESS_KEY, null);
        if (!saved) return;
        if (typeof saved.folder !== 'string' || !Array.isArray(saved.files) ||
            !saved.files.every((file) => typeof file.slug === 'string' && typeof file.name === 'string' &&
                ['pending', 'completed', 'failed'].includes(file.status)) ||
            new Set(saved.files.map((file) => file.slug)).size !== saved.files.length) {
            throw new Error('Saved album progress is invalid; it has not been overwritten');
        }
        state.folder = safeFilename(saved.folder);
        state.queue = saved.files;
    }

    function saveProgress() {
        try {
            GM_setValue(PROGRESS_KEY, {
                folder: state.folder,
                files: state.queue.map(({ slug, name, status }) => ({ slug, name, status })),
            });
        } catch (error) {
            throw new Error('Could not save album progress; downloads stopped: ' + error.message, { cause: error });
        }
    }

    function mergeQueue(files, completed = new Set()) {
        const previous = new Map(state.queue.map((file) => [file.slug, file]));
        state.queue = files.map((file) => ({
            ...file,
            status: completed.has(file.slug) ? 'completed' : previous.get(file.slug)?.status || 'pending',
        }));
    }

    function request(url, options = {}) {
        return new Promise((resolve, reject) => {
            GM_xmlhttpRequest({
                method: 'GET', url: url.href, timeout: 45000,
                ...options,
                onload: (response) => {
                    if (response.status < 200 || response.status >= 300) {
                        reject(new Error(`HTTP ${response.status} from ${url.hostname}`));
                    } else {
                        resolve(response);
                    }
                },
                onerror: (details) => {
                    const reason = details?.error || details?.statusText;
                    reject(new Error(`Could not reach ${url.hostname}${url.pathname} (network request failed${reason ? ': ' + reason : ''})`));
                },
                ontimeout: () => reject(new Error(`Request to ${url.hostname} timed out`)),
                onabort: () => reject(new Error('Request cancelled')),
            });
        });
    }

    async function fetchPage(url) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 45000);
        try {
            const response = await fetch(url.href, {
                credentials: 'include',
                headers: { Accept: 'text/html' },
                signal: controller.signal,
            });
            return {
                status: response.status,
                finalUrl: response.url || url.href,
                responseText: await response.text(),
            };
        } finally {
            clearTimeout(timer);
        }
    }

    async function readPage(url) {
        let response;
        let browserError;
        // Same-origin HTML reads use the page's working session and cookies.
        // Tampermonkey remains available for cross-origin redirects and services.
        if (url.origin === window.location.origin) {
            try {
                response = await fetchPage(url);
            } catch (error) {
                if (state.stopRequested) throw error;
                browserError = error;
            }
        }
        if (!response) {
            try {
                response = await request(url);
            } catch (error) {
                if (!browserError) throw error;
                throw new Error(`Could not reach ${url.hostname}${url.pathname}. Browser: ${browserError.message}; Tampermonkey: ${error.message}`, { cause: error });
            }
        }
        if (response.status < 200 || response.status >= 300) {
            throw new Error(`HTTP ${response.status} from ${url.hostname}${url.pathname}`);
        }
        const finalUrl = new URL(response.finalUrl || url.href);
        if (finalUrl.protocol !== 'https:' || !BUNKR_HOST.test(finalUrl.hostname) || finalUrl.pathname !== url.pathname) {
            throw new Error('Bunkr redirected to an unexpected page; open the album again');
        }
        return {
            doc: new DOMParser().parseFromString(response.responseText, 'text/html'),
            url: finalUrl,
        };
    }

    function getTotalPages(doc, baseUrl) {
        let total = 1;
        for (const link of doc.querySelectorAll('a[href]')) {
            const url = new URL(link.getAttribute('href'), baseUrl);
            const page = Number(url.searchParams.get('page'));
            if (BUNKR_HOST.test(url.hostname) && url.pathname === baseUrl.pathname && Number.isSafeInteger(page) && page > total) {
                total = page;
            }
        }
        return total;
    }

    function extractFiles(doc, baseUrl) {
        const grid = doc.querySelector('#galleryGrid');
        if (!grid) throw new Error('Bunkr did not return an album file list; check for a challenge or maintenance page');
        return [...grid.querySelectorAll('.theItem')].map((card) => {
            const link = card.querySelector('a[href]');
            const url = link && new URL(link.getAttribute('href'), baseUrl);
            const match = url && url.pathname.match(/^\/(?:f|v|d|i)\/([^/]+)$/);
            if (!match || !BUNKR_HOST.test(url.hostname)) {
                throw new Error('An album card has no Bunkr file link; collection stopped to avoid missing files');
            }
            return {
                slug: match[1],
                name: (card.getAttribute('title') || card.querySelector('.theName')?.textContent || match[1]).trim(),
            };
        });
    }

    async function collectFiles() {
        // Always request the unfiltered, paginated album, even when started from
        // advanced view or a later page. Advanced view only renders its first 100 cards.
        let baseUrl = new URL('/a/' + albumPath[1], window.location.origin);
        const files = new Map();
        const seenPages = new Set();
        let totalPages = 1;
        for (let page = 1; page <= totalPages; page += 1) {
            if (state.stopRequested) return null;
            const pageUrl = new URL(baseUrl);
            pageUrl.searchParams.set('page', String(page));
            const result = await readPage(pageUrl);
            if (state.stopRequested) return null;
            if (page === 1) {
                baseUrl = new URL(result.url.origin + result.url.pathname);
                const title = result.doc.querySelector('h1')?.textContent.trim();
                if (!title) throw new Error('Could not determine the album name');
                state.folder = safeFilename(title);
            }
            totalPages = Math.max(totalPages, getTotalPages(result.doc, baseUrl));
            const entries = extractFiles(result.doc, baseUrl);
            const signature = entries.map((file) => file.slug).sort().join('\n');
            if ((page > 1 && !entries.length) || seenPages.has(signature)) {
                throw new Error(`Page ${page} was empty or repeated; collection stopped to avoid an incomplete download`);
            }
            seenPages.add(signature);
            for (const file of entries) files.set(file.slug, file);
            updatePanel('Collecting album pages…');
            ui.stats.textContent = `Page ${page}/${totalPages} · ${files.size} unique files found`;
            if (page < totalPages) await new Promise((resolve) => setTimeout(resolve, 250));
        }
        return { files: [...files.values()], origin: baseUrl.origin };
    }

    async function readAlbumMetadata() {
        const url = new URL('/a/' + albumPath[1], window.location.origin);
        url.searchParams.set('advanced', '1');
        const result = await readPage(url);
        const script = [...result.doc.scripts].find((element) => /^\s*window\.albumFiles\s*=/.test(element.textContent));
        const match = script?.textContent.match(/^\s*window\.albumFiles\s*=\s*(\[[\s\S]*\])\s*;/);
        if (!match) throw new Error('Exact album file sizes are unavailable; saved progress was not changed');
        // Normalize object keys and trailing commas outside quoted strings only.
        // The embedded array is parsed as data; website JavaScript is never evaluated.
        const json = match[1].replace(/"(?:\\.|[^"\\])*"|([A-Za-z_$][\w$]*)\s*:|(,)(?=\s*[}\]])/g,
            (token, key, comma) => key ? JSON.stringify(key) + ':' : comma ? '' : token);
        const entries = JSON.parse(json);
        if (!Array.isArray(entries) || !entries.length || !entries.every((file) =>
            typeof file.slug === 'string' && /^[^/\s?#]+$/.test(file.slug) &&
            typeof (file.original || file.name) === 'string' && Number.isSafeInteger(file.size) && file.size >= 0)) {
            throw new Error('Album metadata is invalid; saved progress was not changed');
        }
        const folder = result.doc.querySelector('h1')?.textContent.trim();
        if (!folder) throw new Error('Could not determine the album name');
        const files = entries.map((file) => ({ slug: file.slug, name: file.original || file.name, size: file.size }));
        if (new Set(files.map((file) => file.slug)).size !== files.length) {
            throw new Error('Album metadata contains duplicate file identities; saved progress was not changed');
        }
        return { folder: safeFilename(folder), files };
    }

    function matchesDownloadedName(actual, original) {
        const expected = safeFilename(original);
        if (actual === expected) return true;
        const duplicate = actual.match(/^(.*) \(\d+\)(\.[^.]*)?$/);
        return Boolean(duplicate && duplicate[1] + (duplicate[2] || '') === expected);
    }

    async function recoverProgress(localFiles) {
        if (state.running || !localFiles.length) return;
        state.running = true;
        state.stopRequested = false;
        ui.errors.replaceChildren();
        updatePanel('Comparing downloaded filenames and exact sizes…');
        try {
            restoreProgress();
            const album = await readAlbumMetadata();
            if (state.stopRequested) {
                updatePanel('Stopped; saved progress was not changed');
                return;
            }
            const completed = new Set();
            for (const local of localFiles) {
                const matches = album.files.filter((file) => file.size === local.size && matchesDownloadedName(local.name, file.name));
                if (matches.length > 1) {
                    throw new Error(`Cannot uniquely identify ${local.name}; saved progress was not changed`);
                }
                if (matches.length === 1) completed.add(matches[0].slug);
            }
            if (!completed.size) throw new Error('No files matched by filename and exact size; select the existing album folder');
            state.folder = album.folder;
            mergeQueue(album.files, completed);
            saveProgress();
            updatePanel(`Recognized ${completed.size} saved file(s). Use Download remaining to save the rest.`);
        } catch (error) {
            reportError(error);
            updatePanel('Could not recover downloaded files');
        } finally {
            state.running = false;
            updatePanel();
            ui.picker.value = '';
        }
    }

    async function createDownloadInfo(file, origin) {
        const fileUrl = new URL('/f/' + file.slug, origin);
        const { doc } = await readPage(fileUrl);
        if (state.stopRequested) return null;
        const link = doc.querySelector('a.ic-download-01[href]');
        if (!link) throw new Error('The file has no download link; it may be unavailable or under maintenance');
        const downloadUrl = new URL(link.getAttribute('href'), fileUrl);
        const id = downloadUrl.pathname.match(/^\/file\/(\d+)$/)?.[1];
        if (downloadUrl.protocol !== 'https:' || !BUNKR_HOST.test(downloadUrl.hostname) || !id) {
            throw new Error('Unrecognized Bunkr download link');
        }

        // This is Bunkr's download-button API for every file type. Archives have
        // no preview/jsCDN data, so using the API also covers those files.
        const response = await request(new URL('/api/_001_v2', downloadUrl), {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Origin: downloadUrl.origin,
                Referer: downloadUrl.origin + '/',
            },
            data: JSON.stringify({ id }),
        });
        if (state.stopRequested) return null;
        const metadata = JSON.parse(response.responseText);
        if (typeof metadata?.mediafiles !== 'string' || typeof metadata.path !== 'string' ||
            !metadata.path.startsWith('/') || metadata.path.startsWith('//')) {
            throw new Error('Bunkr returned invalid download metadata');
        }
        const media = new URL(metadata.path, metadata.mediafiles);
        if (media.protocol !== 'https:' || !/(?:^|\.)(?:cdn\.cr|scdn\.st)$/.test(media.hostname)) {
            throw new Error('Unrecognized Bunkr media host: ' + media.hostname);
        }
        const signer = new URL(SIGN_SERVICE_URL);
        signer.searchParams.set('path', decodeURIComponent(media.pathname));
        const signature = JSON.parse((await request(signer)).responseText);
        if (typeof signature?.token !== 'string' || !signature.token ||
            !['string', 'number'].includes(typeof signature.ex) || !String(signature.ex)) {
            throw new Error('Bunkr returned an invalid media signature');
        }
        const name = typeof metadata.original === 'string' && metadata.original.trim() ? metadata.original : file.name;
        const filename = safeFilename(name);
        media.searchParams.set('token', signature.token);
        media.searchParams.set('ex', String(signature.ex));
        media.searchParams.set('n', filename);
        return { url: media.href, name: state.folder + '/' + filename };
    }

    function safeFilename(name) {
        const safe = name.replace(/[<>:"/\\|?*\u0000-\u001F\u007F-\u009F]/g, '_').trim().replace(/[. ]+$/, '') || 'bunkr-file';
        return /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(safe) ? '_' + safe : safe;
    }

    function downloadFile(info) {
        return new Promise((resolve, reject) => {
            GM_download({
                url: info.url, name: info.name, saveAs: false, conflictAction: 'uniquify',
                onprogress: (progress) => {
                    state.loaded = Number(progress.loaded) || 0;
                    state.bytes = Number(progress.total) || 0;
                    updatePanel();
                },
                onload: resolve,
                onerror: (details) => {
                    const messages = {
                        not_enabled: 'Enable downloads in Tampermonkey settings',
                        not_permitted: 'Allow Tampermonkey the browser downloads permission',
                        not_whitelisted: 'Allow this file extension in Tampermonkey download settings',
                        not_supported: 'Use a browser with Tampermonkey download support',
                    };
                    const code = details?.error;
                    const detail = details?.details || details?.message;
                    const detailText = detail && typeof detail === 'object' ? JSON.stringify(detail) : String(detail || '');
                    const reason = [code, detailText].filter(Boolean).join(': ') || 'Download failed';
                    const error = new Error(messages[code] || reason);
                    error.fatal = Boolean(messages[code]);
                    reject(error);
                },
                ontimeout: () => reject(new Error('Download timed out')),
            });
        });
    }

    async function startDownloads(mode) {
        if (state.running) return;
        Object.assign(state, {
            running: true, stopRequested: false, total: 0, processed: 0,
            completed: 0, failed: 0, current: null, loaded: 0, bytes: 0,
        });
        ui.errors.replaceChildren();
        updatePanel();
        try {
            if (typeof GM_download !== 'function' || typeof GM_xmlhttpRequest !== 'function') {
                throw new Error('Install this script in Tampermonkey to enable downloads');
            }
            restoreProgress();
            if (typeof GM_info !== 'undefined' && GM_info.downloadMode !== 'browser') {
                throw new Error('Set Tampermonkey Settings → Download Mode to Browser API so album subfolders are preserved');
            }
            let origin = window.location.origin;
            if (mode !== 'failed') {
                updatePanel('Collecting album pages…');
                const collected = await collectFiles();
                if (state.stopRequested) {
                    updatePanel('Stopped while collecting files');
                    return;
                }
                if (!collected.files.length) throw new Error('No files were found in this album');
                origin = collected.origin;
                mergeQueue(collected.files);
                saveProgress();
            }
            const files = state.queue.filter((file) => mode === 'failed' ? file.status === 'failed' : file.status !== 'completed');
            if (!files.length) {
                updatePanel(mode === 'failed' ? 'No failed files to retry' : 'All album files are already completed');
                return;
            }
            state.total = files.length;
            for (const file of files) {
                if (state.stopRequested) break;
                state.current = file;
                state.loaded = 0;
                state.bytes = 0;
                updatePanel(`Preparing ${state.processed + 1}/${state.total}…`);
                let fatalError = null;
                try {
                    const info = await createDownloadInfo(file, origin);
                    if (state.stopRequested) break;
                    updatePanel(`Downloading ${state.processed + 1}/${state.total}…`);
                    await downloadFile(info);
                    file.status = 'completed';
                    state.completed += 1;
                } catch (error) {
                    file.status = 'failed';
                    state.failed += 1;
                    reportError(error, file.name);
                    if (error.fatal) {
                        fatalError = new Error('Fix the Tampermonkey setting shown above, then try again');
                    }
                }
                state.processed += 1;
                state.current = null;
                // Store only file identities and outcomes, never expiring signed URLs.
                // A storage failure stops the queue instead of silently losing progress.
                saveProgress();
                updatePanel();
                if (fatalError) throw fatalError;
                if (!state.stopRequested && state.processed < state.total) {
                    await new Promise((resolve) => setTimeout(resolve, 500));
                }
            }
            const pending = state.queue.filter((file) => file.status === 'pending').length;
            if (state.stopRequested) updatePanel('Stopped; no more downloads will start');
            else if (state.failed) updatePanel(`Finished with ${state.failed} failed file(s)`);
            else if (pending) updatePanel(`Retry finished; ${pending} unattempted file(s) remain`);
            else updatePanel('All files downloaded');
        } catch (error) {
            reportError(error);
            updatePanel('Bulk download stopped');
        } finally {
            state.running = false;
            state.current = null;
            updatePanel();
        }
    }

    ui.start.addEventListener('click', () => startDownloads('remaining'));
    ui.retry.addEventListener('click', () => startDownloads('failed'));
    ui.recover.addEventListener('click', () => ui.picker.click());
    ui.picker.addEventListener('change', () => {
        const files = [...ui.picker.files]
            .filter((file) => !file.webkitRelativePath || file.webkitRelativePath.split('/').length === 2)
            .map((file) => ({ name: file.name, size: file.size }));
        recoverProgress(files);
    });
    ui.stop.addEventListener('click', () => {
        state.stopRequested = true;
        ui.stop.disabled = true;
        updatePanel('Stopping after the current download or request…');
    });
    try {
        restoreProgress();
        for (const file of state.queue.filter((entry) => entry.status === 'failed')) {
            reportError('Download failed in a previous run', file.name);
        }
        updatePanel(state.queue.length ? 'Saved album progress restored' : 'Ready');
    } catch (error) {
        state.historyError = error;
        reportError(error);
        updatePanel('Could not load saved progress');
    }
})();
