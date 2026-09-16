# Set up Canvas Assignment Sync with Google Apps Script

This guide starts with a new computer and a Google account. The sync runs in Google's cloud once each day, creates Google Calendar events and Google Tasks from your Canvas assignment feed, and moves events between `Canvas Assignments` and `Canvas Completed` when you complete or reopen a Task. You do not need Python, a Google Cloud project, or a Canvas API token.

## 1. Install the two local tools

Install [Git](https://git-scm.com/downloads) and a current [Node.js LTS release](https://nodejs.org/en/download) (version 20 or newer). Node.js includes `npm`. Use **PowerShell** on Windows or **Terminal** on macOS/Linux for the commands below. Close and reopen the terminal after installing.

Check that the tools work:

```text
git --version
node --version
npm --version
```

Each command should print a version. If one says the command was not found, finish its installation and reopen the terminal before continuing.

## 2. Download this project

In your terminal, run:

```text
git clone --branch apps-script-migration https://github.com/ItsAustinDlugosch/CanvasGCalExport.git
cd CanvasGCalExport
```

If the repository is private, your GitHub account needs access to it. Keep this folder: it contains the local link to your cloud script for future updates.

## 3. Copy your Canvas calendar feed URL

In Canvas, open **Calendar → Calendar Feed** and copy the URL shown there. [Canvas's guide](https://community.instructure.com/en/kb/articles/662804-unknown) shows where to find it. Keep the URL private because it gives access to your Canvas calendar feed. You will paste it into Google Apps Script in step 6; do not put it in a source file, Git commit, or chat message.

## 4. Allow the Apps Script command-line tool

Sign in to the Google account that should own the calendars and Tasks, then open [Apps Script user settings](https://script.google.com/home/usersettings) and turn **Google Apps Script API** on. This setting lets the local tool create and upload your script.

Back in the project folder, install its dependencies and sign in to `clasp`:

```text
npm ci
npm run clasp -- login --no-localhost
```

The terminal prints a Google authorization URL. Open it, sign in with the same Google account, and approve access. Your browser will then say it cannot connect to `localhost:8888`. **That message is expected.** Copy the *entire URL in the browser address bar* (including `code` and `state`) and paste it into the waiting terminal prompt. Do not share that redirect URL; it contains a temporary authorization code.

## 5. Create the cloud script

Run:

```text
npm run deploy:apps-script
```

This creates the Apps Script project and uploads the code. It prints an **Apps Script editor** link; open it. It also prints the time zone detected from your computer. If that time zone is wrong, edit the `timeZone` value in the local `.apps-script-settings.json` file and run `npm run deploy:apps-script` again before scheduling the trigger. Use a name such as `America/Chicago` or `America/New_York`.

The first upload creates a local `.clasp.json` file that connects this folder to your cloud project. Keep it private and keep it in this folder. Later uploads to the same project use the same command. Neither `.clasp.json` nor `.apps-script-settings.json` is committed to Git.

## 6. Add your private Canvas URL

In the Apps Script editor, click **Project Settings** (gear icon) on the left. Under **Script Properties**, click **Add script property** and enter:

| Property | Value |
| --- | --- |
| `CANVAS_ICAL_URL` | The private Canvas calendar feed URL copied in step 3 |

Save the property. This is the only required value to enter in the editor. If you want to omit courses, add an optional `EXCLUDED_COURSES` property containing a JSON array of course codes, such as `["CSCE-221"]`. By default, no courses are excluded. The script uses the time zone printed in step 5 unless you set an optional `LOCAL_TIMEZONE` property.

## 7. Check before changing calendars

At the top of the Apps Script editor, select `previewCanvasFeed` from the function dropdown and click **Run**. Google may ask you to authorize the script. Select the account that owns the project and approve the requested Calendar, Tasks, and external-request access. Open the **Execution log** to see how many assignments were found and a few sample titles.

Next, select `previewSync` and click **Run**. It reports counts without changing calendars or Tasks. For a new user, it should usually show assignment entries, events and Tasks to create, and **zero deletions**. If it reports deletions you did not expect, stop and inspect the existing calendars before running the sync.

## 8. Run the first sync

Select `syncCanvas` and click **Run**. This creates the `Canvas Assignments` and `Canvas Completed` calendars and a `Canvas Assignments` Google Tasks list if they do not already exist. Its final log shows the number of events and Tasks created, moved, updated, and deleted. Check those items in [Google Calendar](https://calendar.google.com/) and [Google Tasks](https://tasks.google.com/).

If Google Tasks reports **Quota Exceeded** during the first import, wait a few minutes, run `previewSync` to see the remaining count, then run `syncCanvas` again. The script recognizes Tasks created by the previous attempt and does not create them twice.

## 9. Schedule the daily cloud sync

After the first sync succeeds, select `installDailyTrigger` and click **Run** once. In the editor's **Triggers** page, verify that `syncCanvas` has a daily time-based trigger near 7 AM in your project's time zone. Google chooses an approximate time within that hour.

If you previously ran the Python version with its local timer, turn it off only after the cloud sync and trigger work:

```text
systemctl --user disable --now canvas-sync.timer
```

New users can skip that command. Completing or reopening a Google Task changes the event's calendar at the next daily sync. An assignment removed from the Canvas feed is removed from the synced calendars and Tasks list at that sync.

## Updating later

In the same project folder, run:

```text
git pull
npm ci
npm run deploy:apps-script
```

The daily trigger and Script Properties remain in the cloud project. The local `.clasp.json` keeps updates pointed at that project. If you clone into a different folder or computer, copy your private `.clasp.json` and `.apps-script-settings.json` into the new folder before deploying; otherwise the command creates a second cloud project.

## Common setup problems

- **`npm` or `git` is not recognized:** Install Node.js or Git, then reopen the terminal.
- **Browser cannot connect to `localhost:8888`:** Copy the full failed redirect URL into the waiting `clasp` terminal prompt, as described in step 4.
- **“User has not enabled the Apps Script API”:** Turn it on in [Apps Script user settings](https://script.google.com/home/usersettings). It can take a few minutes to take effect, then retry deployment.
- **`clasp` says “Not logged in”:** Run `npm run clasp -- login --no-localhost` again.
- **“Set CANVAS_ICAL_URL in Script Properties”:** Add and save the property from step 6.
- **No assignments found or Canvas fetch fails:** Verify the feed URL in Canvas and the Script Property. The feed may include only a limited range of past and future events.

For developers: run `npm run test:apps-script` for the local tests. `npm run deploy:apps-script` pushes changes to the linked cloud project.
