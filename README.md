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
2. Open either `.user.js` file in this repository and copy its entire contents.
3. In the Tampermonkey dashboard, create a new script, replace the editor contents with the copied script, and save.
4. Repeat for the other script, then reload the Filester folder page.
5. Use the panel's **Download all files** button to start a bulk download.

To update an existing installation, replace the entire script contents, including the metadata header, and save. Allow Tampermonkey's download permissions and any browser download prompts when requested.

## Syntax checks

With Node.js installed, run:

```sh
node --check filester-open-files-new-tab.user.js
node --check filester-download-all-files.user.js
```

The scripts depend on Filester's page markup and download-token service. Website changes may require updates.
