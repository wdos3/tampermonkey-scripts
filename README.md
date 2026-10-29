# Tampermonkey scripts

All four userscripts in one public repository. Each script is standalone; development dependencies are only needed to run tests.

| Script | Version | Install | Documentation |
| --- | --- | --- | --- |
| DankScape Assistant | 1.12.3 | [Install](https://raw.githubusercontent.com/wdos3/tampermonkey-scripts/main/dankscape-automation/dankscape-gather.user.js) | [Guide](dankscape-automation/README.md) |
| Filester: Open Files in New Tabs | 1.1.3 | [Install](https://raw.githubusercontent.com/wdos3/tampermonkey-scripts/main/filester-userscripts/filester-open-files-new-tab.user.js) | [Guide](filester-userscripts/README.md) |
| Filester: Download All Files | 1.1.3 | [Install](https://raw.githubusercontent.com/wdos3/tampermonkey-scripts/main/filester-userscripts/filester-download-all-files.user.js) | [Guide](filester-userscripts/README.md) |
| Bunkr: Download All Files | 1.1.3 | [Install](https://raw.githubusercontent.com/wdos3/tampermonkey-scripts/main/bunkr-userscripts/bunkr-download-all-files.user.js) | [Guide](bunkr-userscripts/README.md) |

## Install or migrate

Install Tampermonkey, then open the desired **Install** link. If source text appears, paste the complete file into Tampermonkey's editor and save.

Existing installations need one reinstall from these links because the old `filester-userscripts` and `dankscape-automation` repositories are retired. Accept the update of the existing script. Names and namespaces are unchanged to preserve settings and saved progress. Replace any per-script Update URL and Download URL overrides with the corresponding install link.

Enable Tampermonkey's update checks. Future higher versions are available from this public repository without GitHub sign-in. Reload the relevant website after updating. Automatic updates in an installed browser profile remain unverified.

## Development

DankScape and Bunkr retain their test suites and package lockfiles. In either project directory, run `npm ci`, `npm run check`, and `npm test`. Filester has no npm dependencies; run `node --check` on each `.user.js` file. The original DankScape and Filester commit histories are preserved in this repository.
