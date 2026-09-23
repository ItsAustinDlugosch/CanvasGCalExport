# Updating an existing installation

[← Back to Canvas Export](../README.md)

Use the instructions for the setup you already have. You do not need to switch between local and cloud syncing to update.

## Google Apps Script installed in the browser

Open your existing project from [Apps Script](https://script.google.com/). Replace **Code.gs** with the latest [Code.js](../apps-script/Code.js), replace **WebApp.html** with the latest [web page](../apps-script/WebApp.html) if you use manual browser sync, and replace **appsscript.json** with the latest [manifest](../apps-script/appsscript.json), then save. Restore your local time zone in **Project Settings** after replacing the manifest.

Your Script Properties and trigger stay in the project. Run **previewSync**, review its counts, and then run **syncCanvas**. Approve any newly required permissions. If the project time zone changed, delete the existing sync trigger and run **installDailyTrigger** again.

## Google Apps Script installed with the command line

From your existing repository folder:

```bash
git pull
npm ci
npm run deploy:apps-script
```

Keep `.clasp.json` and `.apps-script-settings.json` at the repository root. The upload command is unchanged by this reorganization. Existing Script Properties and triggers stay in the cloud. Open the printed editor link and run **previewSync** followed by **syncCanvas** to check the update. If you deployed the manual-sync web app and its page changed, update that deployment to a **New version** under **Deploy → Manage deployments**; its URL remains the same.

If your checkout still follows a development branch that has been merged, switch to `main` before pulling. A fresh clone needs your existing private project-link and time-zone files before uploading, as explained in the [contributor guide](../CONTRIBUTING.md#optional-command-line-cloud-setup).

## Local installations from the old layout

Python files now live under `local/`. Existing root-level configuration and credentials are not moved automatically. Your old timer must be reinstalled so it uses the new path.

1. Stop the old timer and wait for any active sync to finish:

   ```bash
   systemctl --user disable --now canvas-sync.timer
   systemctl --user status canvas-sync.service
   ```

2. From the repository root, update your checkout. Then copy your existing private settings into the new directory without overwriting files already there:

   ```bash
   git pull
   cp -n config.json credentials.json local/
   if [ -f token.json ]; then cp -n token.json local/; fi
   ```

   If you supply the feed through an environment variable, `config.json` may not exist; copy only the files you use. Old logs can stay where they are. The retired `token.pickle` file is not used.

3. Recreate the environment in its new location and test the sync. Keep your previous root `.venv` until the new setup works; virtual environments should not be moved between directories.

   ```bash
   cd local
   python3 setup.py --no-install-systemd
   .venv/bin/python3 main.py
   ```

4. Install the updated service and timer:

   ```bash
   python3 setup.py --skip-deps --install-systemd
   systemctl --user status canvas-sync.timer
   ```

The timer still uses the name `canvas-sync.timer`. Reinstallation replaces its service definition with the new executable path. New logs and token updates are written under `local/`.

## Future local updates

From the repository root:

```bash
git pull
local/.venv/bin/python3 -m pip install -r local/requirements.txt
local/.venv/bin/python3 local/main.py
```

If an update changes the timer or service template, rerun `python3 local/setup.py --skip-deps --install-systemd`.

## Switching from local to Google Apps Script

Use the same Google account and calendar titles if you want the cloud version to reuse existing synced events. Pause the local timer before the first cloud sync so both versions do not update the same calendars concurrently:

```bash
systemctl --user disable --now canvas-sync.timer
systemctl --user status canvas-sync.service
```

Wait for any running local sync to finish, then follow the [Apps Script guide](../apps-script/README.md). Review **previewSync** before running **syncCanvas**. With matching calendars, completed events are used to create completed Tasks. Once the first sync and cloud trigger work, leave the local timer disabled.

If you decide to stay local before enabling the cloud trigger, you can turn the timer back on with `systemctl --user enable --now canvas-sync.timer`. Otherwise remove the cloud trigger before re-enabling local scheduling.
