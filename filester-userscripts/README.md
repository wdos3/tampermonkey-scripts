# Filester userscripts

Two Tampermonkey scripts for Filester folder pages.

Supported domains: `filester.me`, `filester.gg`, and `filester.si`, including their `www` variants.

## Scripts

- [Open files in new tabs](filester-open-files-new-tab.user.js): middle-click or right-click a file card to open its file page in a background tab. Buttons and other interactive controls keep their normal behavior.
- [Download all files](filester-download-all-files.user.js): collect files across every page of the current folder, deduplicate them, and download them one at a time. A bottom-right panel displays collection progress, per-file progress, completed/failed counts, and a **Stop after current** control.

Bulk downloads request paths under the current Filester folder's own name:

```text
Downloads/<Filester folder name>/<filename>
```

For example, files from a folder named `ABC` request `ABC/<filename>` relative to the browser's download directory. Filesystem-invalid characters in folder and file names are sanitized. Subfolder placement depends on the browser and Tampermonkey download settings.

The bulk downloader covers files directly in the current folder across all its pages; it does not recurse into subfolders.

## Installation

1. Install Tampermonkey in your browser.
2. Open the public installation links below; GitHub sign-in is not required.
3. Open the [new-tab script](https://raw.githubusercontent.com/wdos3/tampermonkey-scripts/main/filester-userscripts/filester-open-files-new-tab.user.js) or [bulk downloader](https://raw.githubusercontent.com/wdos3/tampermonkey-scripts/main/filester-userscripts/filester-download-all-files.user.js) and confirm the Tampermonkey installation. If the browser displays the source instead, copy the entire file into Tampermonkey's editor and save it.
4. Repeat for the other script, enable update checks for both scripts in Tampermonkey, then reload the Filester folder page.
5. Use the panel's **Download all files** button to start a bulk download.

Allow Tampermonkey's download permissions and any browser download prompts when requested.

## Automatic updates

Both scripts declare `@updateURL` and `@downloadURL` pointing to their own files on this repository's `main` branch. Tampermonkey handles checking and installing newer versions; the scripts do not run a separate updater.

Install v1.1.3 once using the links above, or replace the entire installed script contents including the metadata header. Existing copies pointing to the retired repository cannot discover the new URL. Keep the existing script identity and settings, and replace any per-script Update URL or Download URL override with the new install link.

Enable update checks for each script and select your preferred userscript update interval in Tampermonkey's settings. A new version is detected on the next scheduled check, not immediately when a commit is pushed. You can also trigger a manual update check from the dashboard.

This repository is public, so updates do not require GitHub authentication. A successful manual update check is still needed to confirm this setup in your installed browser profile.

Use the stable public `raw.githubusercontent.com` links above. Do not add expiring token parameters or embed a GitHub access token in the scripts.

When publishing a change, increment `@version` in each changed script before pushing to `main`. Keep its `@name`, `@namespace`, and update URLs unchanged so existing installations retain their identity and update source. Pushing a change without increasing the script version does not trigger an update. See the [Tampermonkey metadata documentation](https://www.tampermonkey.net/documentation.php?locale=en&q=update_url).

## Syntax checks

With Node.js installed, run:

```sh
node --check filester-open-files-new-tab.user.js
node --check filester-download-all-files.user.js
```

The scripts depend on Filester's page markup and download-token service. Website changes may require updates.
