// ==UserScript==
// @name         Filester: Open Files in New Tabs
// @namespace    local.filester.open-files
// @version      1.1.3
// @updateURL      https://raw.githubusercontent.com/wdos3/tampermonkey-scripts/main/filester-userscripts/filester-open-files-new-tab.user.js
// @downloadURL    https://raw.githubusercontent.com/wdos3/tampermonkey-scripts/main/filester-userscripts/filester-open-files-new-tab.user.js
// @description  Middle-click or right-click a Filester file card to open its file page in a new tab.
// @match        https://filester.me/f/*
// @match        https://www.filester.me/f/*
// @match        https://filester.gg/f/*
// @match        https://www.filester.gg/f/*
// @match        https://filester.si/f/*
// @match        https://www.filester.si/f/*
// @run-at       document-start
// @noframes
// @grant        GM_openInTab
// ==/UserScript==

(function () {
    'use strict';

    const FILE_CARD_SELECTOR = '#filesGrid .file-item';
    const EXCLUDED_SELECTOR = 'button, a, input, select, textarea, [contenteditable="true"]';

    function getFileCard(event) {
        const target = event.target;

        if (!target || typeof target.closest !== 'function') {
            return null;
        }

        const card = target.closest(FILE_CARD_SELECTOR);

        if (!card || target.closest(EXCLUDED_SELECTOR)) {
            return null;
        }

        return card;
    }

    function getFileUrl(card) {
        // The revamped folder page still stores each destination in onclick.
        // Read the URL without executing the site's handler.
        const inlineHandler = card.getAttribute('onclick') || '';
        const match = inlineHandler.match(
            /window\.location\.href\s*=\s*(['"])(\/d\/[^'"\s]+)\1/,
        );

        return match ? new URL(match[2], window.location.href).href : null;
    }

    // Prevent middle-button autoscroll before opening exactly one tab.
    document.addEventListener(
        'mousedown',
        (event) => {
            if (event.button !== 1) {
                return;
            }

            const card = getFileCard(event);
            const fileUrl = card && getFileUrl(card);

            if (!fileUrl) {
                return;
            }

            event.preventDefault();
            event.stopPropagation();
            GM_openInTab(fileUrl, { active: false, setParent: true });
        },
        true,
    );

    // Right-click is intentionally repurposed, so the browser context menu is
    // suppressed only when the pointer is over a file card's non-control area.
    document.addEventListener(
        'contextmenu',
        (event) => {
            const card = getFileCard(event);
            const fileUrl = card && getFileUrl(card);

            if (!fileUrl) {
                return;
            }

            event.preventDefault();
            event.stopPropagation();
            GM_openInTab(fileUrl, { active: false, setParent: true });
        },
        true,
    );
})();
