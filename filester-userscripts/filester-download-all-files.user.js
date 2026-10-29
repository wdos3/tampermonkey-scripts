// ==UserScript==
// @name         Filester: Download All Files
// @namespace    local.filester.download-all
// @version      1.1.2
// @updateURL    https://github.com/wdos3/filester-userscripts/raw/refs/heads/main/filester-download-all-files.user.js
// @downloadURL  https://github.com/wdos3/filester-userscripts/raw/refs/heads/main/filester-download-all-files.user.js
// @description  Download every file in a Filester folder into a folder named after that Filester folder, with visible progress.
// @match        https://filester.me/f/*
// @match        https://www.filester.me/f/*
// @match        https://filester.gg/f/*
// @match        https://www.filester.gg/f/*
// @match        https://filester.si/f/*
// @match        https://www.filester.si/f/*
// @run-at       document-idle
// @noframes
// @grant        GM_download
// @connect      filester.me
// @connect      www.filester.me
// @connect      filester.gg
// @connect      www.filester.gg
// @connect      filester.si
// @connect      www.filester.si
// @connect      cn1.filester.me
// @connect      p1.filester.me
// @connect      rs2.filester.me
// @connect      fsc2.cdn.cr
// ==/UserScript==

(function () {
    'use strict';

    const PANEL_ID = 'filester-bulk-download-panel';
    const CDN_URLS = [
        'https://cn1.filester.me',
        'https://p1.filester.me',
        'https://rs2.filester.me',
    ];
    const PAGE_DELAY_MS = 200;
    const DOWNLOAD_DELAY_MS = 500;

    if (document.getElementById(PANEL_ID)) {
        return;
    }

    const state = {
        running: false,
        stopRequested: false,
        total: 0,
        processed: 0,
        completed: 0,
        failed: 0,
        current: null,
        currentPercent: 0,
        currentLoaded: 0,
        currentTotal: 0,
        downloadSubfolder: null,
        errors: [],
    };

    const panel = document.createElement('aside');
    panel.id = PANEL_ID;
    panel.innerHTML = `
        <div class="filester-bulk-title">Filester bulk downloader</div>
        <div class="filester-bulk-status" id="filester-bulk-status" role="status" aria-live="polite">Ready</div>
        <div class="filester-bulk-stats" id="filester-bulk-stats">No files collected yet</div>
        <div class="filester-bulk-progress">
            <div class="filester-bulk-progress-bar" id="filester-bulk-progress-bar"></div>
        </div>
        <div class="filester-bulk-current" id="filester-bulk-current">Files are downloaded one at a time.</div>
        <div class="filester-bulk-errors" id="filester-bulk-errors"></div>
        <div class="filester-bulk-actions">
            <button type="button" id="filester-bulk-start">Download all files</button>
            <button type="button" id="filester-bulk-stop" hidden>Stop after current</button>
        </div>
        <div class="filester-bulk-note" id="filester-bulk-folder">Mass-download folder: detecting…</div>
        <div class="filester-bulk-note">
            If the browser asks, allow multiple downloads for this site.
        </div>
    `;

    const style = document.createElement('style');
    style.textContent = `
        #${PANEL_ID} {
            position: fixed;
            right: 16px;
            bottom: 16px;
            z-index: 2147483647;
            width: min(360px, calc(100vw - 32px));
            box-sizing: border-box;
            padding: 14px;
            border: 1px solid rgba(255, 255, 255, 0.2);
            border-radius: 12px;
            background: #171717;
            color: #f5f5f5;
            box-shadow: 0 8px 30px rgba(0, 0, 0, 0.45);
            font: 13px/1.4 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        }

        #${PANEL_ID} * {
            box-sizing: border-box;
        }

        #${PANEL_ID} .filester-bulk-title {
            margin-bottom: 6px;
            font-size: 15px;
            font-weight: 700;
        }

        #${PANEL_ID} .filester-bulk-status {
            color: #8ee6aa;
        }

        #${PANEL_ID} .filester-bulk-stats,
        #${PANEL_ID} .filester-bulk-current,
        #${PANEL_ID} .filester-bulk-note {
            margin-top: 6px;
            color: #bdbdbd;
        }

        #${PANEL_ID} .filester-bulk-current {
            min-height: 19px;
            overflow-wrap: anywhere;
        }

        #${PANEL_ID} .filester-bulk-progress {
            height: 8px;
            margin-top: 10px;
            overflow: hidden;
            border-radius: 999px;
            background: #3a3a3a;
        }

        #${PANEL_ID} .filester-bulk-progress-bar {
            width: 0;
            height: 100%;
            border-radius: inherit;
            background: #35d07f;
            transition: width 120ms linear;
        }

        #${PANEL_ID} .filester-bulk-errors {
            min-height: 0;
            margin-top: 6px;
            color: #ff9b9b;
            overflow-wrap: anywhere;
        }

        #${PANEL_ID} .filester-bulk-actions {
            display: flex;
            gap: 8px;
            margin-top: 12px;
        }

        #${PANEL_ID} button {
            flex: 1;
            min-height: 32px;
            padding: 6px 10px;
            border: 0;
            border-radius: 7px;
            background: #35d07f;
            color: #07130c;
            cursor: pointer;
            font: inherit;
            font-weight: 700;
        }

        #${PANEL_ID} button:disabled {
            cursor: wait;
            opacity: 0.65;
        }

        #${PANEL_ID} #filester-bulk-stop {
            background: #555;
            color: #fff;
        }

        #${PANEL_ID} .filester-bulk-note {
            font-size: 11px;
        }
    `;

    document.head.appendChild(style);
    document.body.appendChild(panel);

    const ui = {
        status: panel.querySelector('#filester-bulk-status'),
        stats: panel.querySelector('#filester-bulk-stats'),
        progressBar: panel.querySelector('#filester-bulk-progress-bar'),
        current: panel.querySelector('#filester-bulk-current'),
        errors: panel.querySelector('#filester-bulk-errors'),
        folder: panel.querySelector('#filester-bulk-folder'),
        start: panel.querySelector('#filester-bulk-start'),
        stop: panel.querySelector('#filester-bulk-stop'),
    };

    function delay(milliseconds) {
        return new Promise((resolve) => setTimeout(resolve, milliseconds));
    }

    function formatBytes(bytes) {
        if (!Number.isFinite(bytes) || bytes <= 0) {
            return '';
        }

        const units = ['B', 'KB', 'MB', 'GB', 'TB'];
        let value = bytes;
        let unitIndex = 0;

        while (value >= 1024 && unitIndex < units.length - 1) {
            value /= 1024;
            unitIndex += 1;
        }

        return value.toFixed(value >= 100 || unitIndex === 0 ? 0 : 1) + ' ' + units[unitIndex];
    }

    function errorMessage(error) {
        const message = error && error.message ? error.message : String(error);
        return message.length > 180 ? message.slice(0, 177) + '...' : message;
    }

    function updatePanel(statusText) {
        if (statusText) {
            ui.status.textContent = statusText;
        }

        const currentFraction = state.running
            ? Math.max(0, Math.min(100, state.currentPercent)) / 100
            : 0;
        const overallPercent = state.total
            ? ((state.processed + currentFraction) / state.total) * 100
            : 0;

        ui.progressBar.style.width = Math.max(0, Math.min(100, overallPercent)) + '%';

        if (state.total) {
            ui.stats.textContent =
                state.processed + '/' + state.total + ' processed · ' +
                state.completed + ' completed · ' +
                state.failed + ' failed';
        } else {
            ui.stats.textContent = 'No files collected yet';
        }

        if (state.current) {
            const percentText = state.currentPercent > 0
                ? Math.floor(state.currentPercent) + '%'
                : 'starting';
            const byteText = state.currentTotal > 0
                ? ' (' + formatBytes(state.currentLoaded) + ' / ' + formatBytes(state.currentTotal) + ')'
                : '';
            ui.current.textContent = state.current.name + ' — ' + percentText + byteText;
        } else if (!state.running && state.total) {
            ui.current.textContent = 'Ready for another run.';
        } else {
            ui.current.textContent = 'Files are downloaded one at a time.';
        }

        ui.errors.textContent = state.errors.length
            ? state.errors.slice(-3).join(' | ')
            : '';
        ui.folder.textContent = state.downloadSubfolder
            ? 'Save to: Downloads/' + state.downloadSubfolder + '/'
            : 'The folder name will be read when the download starts.';
    }

    function updateCollectionProgress(page, totalPages, fileCount) {
        ui.status.textContent = 'Collecting files…';
        ui.stats.textContent = 'Page ' + page + '/' + totalPages + ' · ' + fileCount + ' files found';
        ui.progressBar.style.width = (page / totalPages) * 100 + '%';
        ui.current.textContent = 'Reading folder pages; current downloads have not started.';
    }

    function getTotalPages(sourceDocument) {
        const loadAllButton = sourceDocument.querySelector('#loadAllPagesBtn');
        const buttonTotal = Number(loadAllButton && loadAllButton.dataset.total);

        if (Number.isInteger(buttonTotal) && buttonTotal > 0) {
            return buttonTotal;
        }

        const pageInfo = sourceDocument.querySelector(
            '.pagination-bottom .page-info, .pagination .page-info',
        );
        const match = pageInfo && pageInfo.textContent.match(/\/\s*(\d+)/);
        const pageTotal = Number(match && match[1]);

        return Number.isInteger(pageTotal) && pageTotal > 0 ? pageTotal : 1;
    }

    function getFolderName() {
        const titleElement = document.querySelector('main h1');
        const folderName = titleElement && titleElement.textContent
            ? titleElement.textContent.trim()
            : '';

        return folderName || null;
    }

    async function fetchFolderPage(page) {
        const pageUrl = new URL(window.location.href);
        pageUrl.searchParams.set('page', String(page));

        const response = await fetch(pageUrl.href, {
            credentials: 'include',
            headers: {
                Accept: 'text/html',
            },
        });

        if (!response.ok) {
            throw new Error('Could not read page ' + page + ' (HTTP ' + response.status + ')');
        }

        const html = await response.text();
        const parsed = new DOMParser().parseFromString(html, 'text/html');

        if (!parsed.querySelector('#filesGrid')) {
            throw new Error('Page ' + page + ' did not contain the Filester file list');
        }

        return parsed;
    }

    function extractFileEntries(sourceDocument) {
        return Array.from(sourceDocument.querySelectorAll('#filesGrid .file-item'))
            .map((card) => {
                const detailHandler = card.getAttribute('onclick') || '';
                const detailMatch = detailHandler.match(
                    /window\.location\.href\s*=\s*(['"])(.*?)\1/i,
                );
                const downloadHandler = card.querySelector('.download-btn')?.getAttribute('onclick') || '';
                const downloadMatch = downloadHandler.match(
                    /downloadFile\s*\(\s*['"]([^'"]+)['"]\s*\)/i,
                );
                let slug = downloadMatch ? downloadMatch[1] : null;

                if (!slug && detailMatch) {
                    const detailUrl = new URL(detailMatch[2], window.location.origin);
                    const slugMatch = detailUrl.pathname.match(/^\/d\/([^/]+)$/);
                    slug = slugMatch ? slugMatch[1] : null;
                }

                if (!slug) {
                    return null;
                }

                const nameElement = card.querySelector('.file-name');
                const name = (
                    card.dataset.name ||
                    (nameElement && nameElement.textContent) ||
                    slug
                ).trim();

                return { slug, name };
            })
            .filter(Boolean);
    }

    async function collectAllFiles() {
        // Read page 1 afresh: filters and "Load all pages" can remove or replace
        // the visible pagination, including when the user started on a later page.
        const firstPage = await fetchFolderPage(1);
        const totalPages = getTotalPages(firstPage);
        const filesBySlug = new Map();

        for (let page = 1; page <= totalPages; page += 1) {
            if (state.stopRequested) {
                return [];
            }

            const sourceDocument = page === 1
                ? firstPage
                : await fetchFolderPage(page);

            extractFileEntries(sourceDocument).forEach((file) => {
                if (!filesBySlug.has(file.slug)) {
                    filesBySlug.set(file.slug, file);
                }
            });

            updateCollectionProgress(page, totalPages, filesBySlug.size);

            if (page < totalPages) {
                await delay(PAGE_DELAY_MS);
            }
        }

        return Array.from(filesBySlug.values());
    }

    async function createDownloadInfo(file) {
        const response = await fetch(window.location.origin + '/v2/api/public/download', {
            method: 'POST',
            credentials: 'include',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                file_slug: file.slug,
            }),
        });

        const responseText = await response.text();
        let payload;

        try {
            payload = JSON.parse(responseText);
        } catch (error) {
            throw new Error('Invalid download-token response');
        }

        if (!response.ok) {
            throw new Error(
                (payload && payload.message) || responseText || 'HTTP ' + response.status,
            );
        }

        const tokenData = payload && payload.data && payload.data.file && payload.data.token
            ? payload.data
            : payload;

        if (!tokenData || !tokenData.file || !tokenData.token) {
            throw new Error('Download-token response did not contain a file and token');
        }

        const baseUrl = new URL(
            tokenData.server || CDN_URLS[Math.floor(Math.random() * CDN_URLS.length)],
            window.location.href,
        );
        baseUrl.pathname =
            baseUrl.pathname.replace(/\/+$/, '') +
            '/v2/' +
            encodeURIComponent(String(tokenData.file));
        baseUrl.search = '';
        baseUrl.searchParams.set('token', tokenData.token);
        baseUrl.searchParams.set('download', 'true');

        if (tokenData.name) {
            baseUrl.searchParams.set('n', tokenData.name);
        }

        return {
            url: baseUrl.href,
            name: tokenData.name || file.name,
        };
    }

    function safeFilename(name) {
        return String(name)
            .replace(/[<>:"/\\|?*\u0000-\u001F]/g, '_')
            .trim()
            .replace(/[. ]+$/, '') || 'filester-file';
    }

    function downloadFilename(name) {
        return (state.downloadSubfolder ? state.downloadSubfolder + '/' : '') + safeFilename(name);
    }

    function downloadFile(downloadInfo, onProgress) {
        if (typeof GM_download !== 'function') {
            return Promise.reject(new Error('GM_download is unavailable; verify this is running in Tampermonkey'));
        }

        return new Promise((resolve, reject) => {
            try {
                GM_download({
                    url: downloadInfo.url,
                    name: downloadFilename(downloadInfo.name),
                    saveAs: false,
                    conflictAction: 'uniquify',
                    onprogress: (progress) => {
                        const loaded = Number(progress.loaded);
                        const total = Number(progress.total);
                        const percent = total > 0
                            ? Math.max(0, Math.min(100, (loaded / total) * 100))
                            : 0;
                        onProgress({ loaded, total, percent });
                    },
                    onload: resolve,
                    onerror: (details) => reject(new Error(
                        details && (details.details || details.error || details.message)
                            ? (details.details || details.error || details.message)
                            : 'Download failed',
                    )),
                    ontimeout: () => reject(new Error('Download timed out')),
                });
            } catch (error) {
                reject(error);
            }
        });
    }

    async function startDownloads() {
        if (state.running) {
            return;
        }

        state.running = true;
        state.stopRequested = false;
        state.total = 0;
        state.processed = 0;
        state.completed = 0;
        state.failed = 0;
        state.current = null;
        state.currentPercent = 0;
        state.currentLoaded = 0;
        state.currentTotal = 0;
        state.downloadSubfolder = null;
        state.errors = [];
        ui.start.disabled = true;
        ui.stop.hidden = false;
        ui.stop.disabled = false;

        try {
            const folderName = getFolderName();

            if (!folderName) {
                throw new Error('Could not determine the current Filester folder name');
            }

            state.downloadSubfolder = safeFilename(folderName);
            updatePanel('Collecting files…');
            const files = await collectAllFiles();

            if (state.stopRequested) {
                updatePanel('Stopped while collecting files');
                return;
            }

            if (!files.length) {
                throw new Error('No downloadable file cards were found on this folder');
            }

            state.total = files.length;
            updatePanel('Starting downloads…');

            for (let index = 0; index < files.length; index += 1) {
                if (state.stopRequested) {
                    break;
                }

                const file = files[index];
                state.current = file;
                state.currentPercent = 0;
                state.currentLoaded = 0;
                state.currentTotal = 0;
                updatePanel('Preparing ' + (index + 1) + '/' + state.total + '…');

                try {
                    const downloadInfo = await createDownloadInfo(file);
                    updatePanel('Downloading ' + (index + 1) + '/' + state.total + '…');

                    await downloadFile(downloadInfo, (progress) => {
                        state.currentPercent = progress.percent;
                        state.currentLoaded = progress.loaded;
                        state.currentTotal = progress.total;
                        updatePanel();
                    });

                    state.completed += 1;
                } catch (error) {
                    state.failed += 1;
                    state.errors.push(file.name + ': ' + errorMessage(error));
                }

                state.processed = state.completed + state.failed;
                state.current = null;
                state.currentPercent = 0;
                state.currentLoaded = 0;
                state.currentTotal = 0;
                updatePanel(
                    state.failed
                        ? 'Continuing; one or more downloads failed'
                        : 'Download complete',
                );

                if (!state.stopRequested && index < files.length - 1) {
                    await delay(DOWNLOAD_DELAY_MS);
                }
            }

            if (state.stopRequested) {
                updatePanel('Stopped after the current file');
            } else if (state.failed) {
                updatePanel('Finished with ' + state.failed + ' failed file(s)');
            } else {
                updatePanel('All files downloaded');
            }
        } catch (error) {
            state.errors.push(errorMessage(error));
            updatePanel('Bulk download stopped');
        } finally {
            state.running = false;
            state.current = null;
            state.currentPercent = 0;
            state.currentLoaded = 0;
            state.currentTotal = 0;
            ui.start.disabled = false;
            ui.stop.hidden = true;
            updatePanel();
        }
    }

    ui.start.addEventListener('click', startDownloads);
    ui.stop.addEventListener('click', () => {
        state.stopRequested = true;
        ui.stop.disabled = true;
        updatePanel('Will stop after the current file…');
    });

    updatePanel();
})();
