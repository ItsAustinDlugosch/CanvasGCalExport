# Apps Script migration

This standalone Google Apps Script replaces the Python/systemd sync after cutover. It reads the private Canvas calendar feed and maintains the existing `Canvas Assignments` and `Canvas Completed` Google Calendars plus a dedicated Google Tasks list. Task completion controls which calendar holds an assignment event. The script runs daily at about 7 AM in its configured timezone.

## What the cloud sync does

- Parses Canvas assignment events, including date-only and timed due dates and Canvas course tags.
- Keeps the existing Canvas UID/key markers so events already created by the Python sync are reused.
- Creates a Google Task for each included assignment. Events already in `Canvas Completed` seed completed Tasks on the first run.
- Moves events between calendars when their Task is completed or reopened. After the first run, the Task controls completion status.
- Deletes sync-owned Tasks and calendar events when their assignment disappears from the full Canvas feed. Excluded courses are still counted as present, so excluding a course does not cause its existing events to be deleted.
- Leaves unrelated calendar events and Tasks alone.

Google Tasks stores only the scheduled date through its API. The calendar event retains the exact Canvas due time. The Google Tasks list may also appear in Google Calendar; you can hide that Tasks calendar there if you do not want both the Task and event visible.

## Deploy

1. Enable **Google Apps Script API** at [Apps Script user settings](https://script.google.com/home/usersettings) for the Google account that owns the two calendars.
2. Install the local CLI and log in with that account:

   ```bash
   npm ci
   npm run clasp -- login --no-localhost
   ```

   The login prints a Google authorization URL and waits for a URL to be pasted into the terminal. Open the authorization URL in your browser and approve access. Google then redirects to `localhost:8888`; because `--no-localhost` does not run a local server, the browser will say it cannot connect. Copy the **entire URL from the browser address bar** (including `code` and `state` parameters) and paste it into the waiting terminal prompt. The CLI validates the URL and finishes login. Keep that URL private; it contains a temporary authorization code. No Canvas API token is required.
3. Create the standalone cloud project and push the code:

   ```bash
   ./scripts/deploy_apps_script.sh
   ```

   The script creates an Apps Script project on its first run. Later runs push code to the same project. Its local `.clasp.json` identifier and your clasp login file are ignored by Git. The deployment script prints the editor link when done.
4. In the Apps Script editor, open **Project Settings → Script properties** and set:

   | Property | Value |
   | --- | --- |
   | `CANVAS_ICAL_URL` | Your existing private Canvas calendar feed URL from `config.json` |
   | `EXCLUDED_COURSES` | JSON array, for example `["CSCE-221"]` |
   | `LOCAL_TIMEZONE` | `America/Chicago` |

   Optional properties: `ACTIVE_CALENDAR_TITLE`, `COMPLETED_CALENDAR_TITLE`, `TASK_LIST_TITLE`, and `EVENT_DURATION_MINUTES`. Their defaults match the current Python project. Keep the feed URL out of source files and logs.
5. Run `previewCanvasFeed` and then `previewSync` in the editor. They check the feed and report the expected event/Task changes without modifying Google data. Review the deletion counts before continuing.
6. Run `syncCanvas` once in the editor and approve the requested Calendar, Tasks, external request, and trigger permissions. Check that the existing events were reused and that the dedicated Tasks list was populated. The first run can take longer because it creates the Tasks.
7. Run `installDailyTrigger` once. It installs one daily trigger near 7 AM in the project's `America/Chicago` timezone. View it under **Triggers** in the Apps Script editor.
8. After the cloud run looks correct, turn off the local timer so both syncs do not run:

   ```bash
   systemctl --user disable --now canvas-sync.timer
   ```

## Development and checks

Run the local tests with `npm run test:apps-script`. `npm run clasp -- push --force` updates the linked cloud project after editing the script. Apps Script runs are limited to six minutes, so the code paginates Google results and skips events/tasks that are already current. Task completion is checked at the next daily run; Google Tasks has no direct completion trigger. A manually deleted Task will be recreated if its Canvas assignment still exists.

The Python implementation remains available until the cloud script is verified. Do not disable the local timer before the first cloud sync succeeds.
