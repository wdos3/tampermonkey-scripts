# Bunkr bulk downloader

[bunkr-download-all-files.user.js](bunkr-download-all-files.user.js) adds a bottom-right downloader panel to Bunkr album pages. It collects all pages, removes duplicate file links, then downloads one file at a time with byte progress, saved progress, **Retry failed**, and **Stop after current**.

Files request this location relative to your browser's download directory:

```text
Downloads/<Bunkr album name>/<original filename>
```

Invalid Windows filename characters, C0/C1 control characters, and reserved device names are sanitized. Valid Unicode is preserved; the script does not guess how to repair corrupted text. The sanitized filename is used for both the local save path and the CDN filename parameter. Existing filenames are uniquified rather than overwritten. Keep the album tab open until downloads finish. Completed files are recorded and skipped on later runs.

## Install

1. Open the [public userscript install link](https://raw.githubusercontent.com/wdos3/tampermonkey-scripts/main/bunkr-userscripts/bunkr-download-all-files.user.js) and install it with Tampermonkey.
2. For an existing installation, update the existing script to v1.1.3, preserving its name and namespace so saved progress remains available.
3. In Tampermonkey settings, choose **Config mode: Advanced**, then set **Download Mode** to **Browser API**. The script checks this mode before starting so album folder paths can be used.
4. Reload the Bunkr album and click **Download all files**. Allow Tampermonkey's download/connection permissions when prompted, and permit the file extensions you want to save in its download settings. Turn off the browser's “Ask where to save each file” setting to avoid repeated save dialogs.

The script uses a regular-expression `@include` for HTTPS album URLs on `bunkr.<TLD>` and its subdomains. This covers `bunkr.ac`, `bunkr.cr`, `bunkr.ws`, and other TLDs without maintaining an extension list. The domain must still be reachable and serve Bunkr's supported page format. Different brand names such as `bunkrr` are not matched.

`@connect *` lets Tampermonkey request rotating Bunkr domains and CDN hosts. Runtime checks restrict album/file/API pages to Bunkr domains and HTTPS media URLs to `cdn.cr`, `scdn.st`, and their subdomains. The script reads each file's download link, requests its metadata through Bunkr's download API, and signs the media URL immediately before downloading. This also covers archives, which have no media preview. It does not evaluate website JavaScript, open ads, or click site download buttons.

If a page is unavailable, repeated, or no longer has the expected album markup, collection stops before any downloads start. Individual file errors remain visible while later files continue; a missing Tampermonkey permission or file-extension setting stops the queue. Stop waits for an active download to finish; during collection or preparation it waits for the current request and starts no downloads afterward.

Version 1.1.3 adds public `@updateURL` and `@downloadURL` metadata in this shared repository. Enable Tampermonkey update checks after installing this version once. Installed-profile automatic updates remain unverified.

Version 1.0.1 fixed `Unrecognized Bunkr media host` errors for `scdn.st` servers, verified in a failed file's live page configuration (`pc9.scdn.st`). Version 1.1.0 adds saved outcomes, retries, and recovery of existing downloads.

Version 1.1.1 fixes hidden control characters in filenames, including the U+0081/U+0084 characters found in exactly three names in the supplied 87-file album. It also displays structured browser download errors instead of discarding their detail. Replace the installed script contents, reload the album, and use **Retry failed**; saved completed files stay excluded.

Version 1.1.2 reads same-origin album and file pages through the browser's existing session with cookies. If that read fails at the network level, it tries Tampermonkey once; cross-origin reads and the API/signing requests still use Tampermonkey. HTTP errors and invalid redirects remain errors. A generic network failure no longer claims that connection permissions are necessarily the cause. If both methods fail, the panel includes both errors and the affected path. Saved completion history is preserved.

## Retry failed files

After a run with errors, click **Retry failed (N)**. Only files recorded as failed are requested again, each with a fresh signed URL. Completed files are skipped. Stopped or unattempted files remain pending; **Download remaining (N)** includes both pending and failed files. **Check for new files** refreshes an already completed album and downloads only new file identities.

Progress is stored in Tampermonkey under the album ID, so it survives page reloads and follows the album across Bunkr mirrors. Only the album folder name, file identities/names, and outcomes are stored; signed URLs, detailed errors, and file contents are not saved. Error details remain visible in the current tab. Keep the script's name and namespace when updating. Use one active downloader tab per album. Recorded completion is not a live check that the file still exists on disk.

## Recover the 36 files downloaded with an older version

Versions 1.0.0 and 1.0.1 did not save file outcomes. After installing 1.1.0 and reloading the album:

1. Click **Skip downloaded files…** and select the album folder containing your existing downloads.
2. Check the recognized count. For 36 matching files in a 110-file album, the panel shows **36 completed** and **Download remaining (74)**.
3. Click **Download remaining (74)**. Later failures can be retried with **Retry failed**.

The folder is inspected locally by filename and exact byte size using the album's full metadata. File contents are neither read nor uploaded. Browser-added names such as `photo (1).jpg` are recognized. Incomplete files with a different size are not marked complete. Ambiguous matches stop recovery without changing saved progress, and recovery itself starts no transfers. Select the album folder itself; nested subfolders are not included.

## Validation

The supplied example album was inspected live on October 21, 2026: the normal first page contained 100 files, the second page contained 10, and advanced view reported all 110. Image and archive pages exposed the download-link/API/signing contracts used here. Actual Tampermonkey transfers and final folder placement still need verification in the installed browser profile.

The automated browser tests use synthetic album pages and mocked Tampermonkey callbacks. They cover 110 unique files spread across both CDN domains, pagination, domain matching/redirects, byte progress, stopping, errors/timeouts, safe filenames, and a mobile viewport. Retry/recovery cases cover saved outcomes after reload, mirror/album separation, skipping 36 existing files and downloading only 74, duplicate names with distinct sizes, ambiguity, and storage failures. The mixed-domain fixture reproduced 36 successes and 74 host rejections before the CDN fix. They do not download the example album's media.

With Node.js installed:

```sh
npm install
npx playwright install chromium
npm run check
npm test
```

To use installed Google Chrome instead of the downloaded Chromium, set the `PLAYWRIGHT_CHANNEL` environment variable to `chrome` before running the tests.

Tampermonkey references: [regular-expression includes](https://www.tampermonkey.net/documentation.php?locale=en&q=include), [downloads and browser mode](https://www.tampermonkey.net/documentation.php?locale=en&q=GM_download), and [cross-origin requests](https://www.tampermonkey.net/documentation.php?locale=en&q=GM_xmlhttpRequest).
