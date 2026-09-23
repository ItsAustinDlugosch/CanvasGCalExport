# Contributing

Canvas Export has two independent implementations. Start with the [main README](README.md) for user setup; this guide covers development and optional configuration.

## Repository layout

```text
apps-script/
  README.md               Browser setup guide
  Code.js                 Cloud sync and trigger entry points
  WebApp.html             Manual browser-sync page
  appsscript.json          Google services and permissions
  tools/                  Optional command-line upload helpers
local/
  README.md               Linux and systemd setup guide
  main.py                 Python calendar sync
  setup.py                Configuration and timer installer
  config.example.json     Example local settings
  requirements.txt        Python dependencies
  run_canvas_sync.sh      Scheduled entry point with locking and logs
  systemd/                Service template and daily timer
tests/                   Offline regression tests
docs/updating.md         Updates and migration for existing users
```

Root-level npm files support cloud development. Private `.clasp.json` and `.apps-script-settings.json` files stay at the repository root so existing command-line installations keep their project link.

## Run checks

From the repository root, using Node.js 22 and Python 3.11 or newer:

```bash
npm run test:apps-script
python3 -m venv local/.venv
local/.venv/bin/python3 -m pip install -r local/requirements.txt
local/.venv/bin/python3 -m unittest discover -s tests -p 'test_*.py'
bash -n local/run_canvas_sync.sh apps-script/tools/deploy_apps_script.sh
git diff --check
```

The JavaScript tests use Node's built-in test runner and need no npm dependencies. Tests use mocked Google/Canvas services and do not require credentials. GitHub Actions runs both suites on pull requests.

Keep setup guides focused on actions a user needs to take. Update links, commands, tests, and deployment paths when moving files. Include the relevant checks and any manual validation in your pull request.

## Optional configuration

For Apps Script, add optional values in **Project Settings → Script Properties**. For Python, edit `local/config.json`; the [example](local/config.example.json) contains the available settings.

| Preference | Apps Script property | Python setting | Default |
| --- | --- | --- | --- |
| Canvas feed | `CANVAS_ICAL_URL` | `canvas_ical_url` | Required |
| Excluded courses | `EXCLUDED_COURSES` | `excluded_courses` | `[]` |
| Active calendar title | `ACTIVE_CALENDAR_TITLE` | `active_calendar_title` | `Canvas Assignments` |
| Completed calendar title | `COMPLETED_CALENDAR_TITLE` | `completed_calendar_title` | `Canvas Completed` |
| Tasks list title | `TASK_LIST_TITLE` | — | `Canvas Assignments` |
| Event duration | `EVENT_DURATION_MINUTES` | `event_duration_minutes` | `15` minutes |
| Event time zone | `LOCAL_TIMEZONE` | `local_timezone` | Script time zone / `America/Chicago` |

Python also accepts the `CANVAS_ICAL_URL` environment variable, which overrides the JSON value. Apps Script properties are text: enter excluded courses as a JSON array such as `["CSCE-221"]`. Match the course tag before the colon in the feed's assignment title. Excluding a course stops its assignments from being updated or created; previously synced items are retained while still present in the feed.

Calendar and Tasks list names are used to find existing destinations. Changing them can create new destinations. Event time-zone overrides do not change the scheduler's time zone. If you change the Apps Script project's time zone after scheduling, delete the existing `syncCanvas` trigger and run `installDailyTrigger` again.

## Optional command-line cloud setup

The [browser guide](apps-script/README.md) is the default for users. For repeatable uploads during development, install Git and Node.js 22, clone the repository, and run these commands from its root:

```bash
npm ci
npm run clasp -- login --no-localhost
```

First enable **Google Apps Script API** in [Apps Script user settings](https://script.google.com/home/usersettings). During login, open the authorization URL and approve access with the Google account that will own the project. If the browser ends at an unreachable `localhost:8888` page, paste the entire redirect URL into the waiting terminal prompt. It contains a temporary authorization code; do not share it.

For a **new** cloud project:

```bash
npm run deploy:apps-script
```

This creates the project if `.clasp.json` is absent, then uploads the source and manifest. It prints the editor link and time zone. Follow the [browser guide from the Script Properties step](apps-script/README.md#3-add-the-project-settings) to add your feed, preview, run, and schedule the sync. Do not replace the uploaded manifest again.

To link a project you already created in the browser, copy its **Script ID** from **Project Settings** and create `.clasp.json` at the repository root before uploading:

```json
{
  "scriptId": "YOUR_SCRIPT_ID",
  "rootDir": "apps-script"
}
```

Also create `.apps-script-settings.json` at the root with your project's time zone, for example:

```json
{
  "timeZone": "America/Chicago"
}
```

Uploads overwrite the linked project's code, so keep any intentional editor changes in your local source first. `.claspignore` limits uploads to `Code.js`, `WebApp.html`, and `appsscript.json`. The helper temporarily applies your local time-zone setting and restores the tracked files afterward. Keep both private settings files when moving to another computer; without the project link, the helper creates a second cloud project.

## Implementation notes

Both implementations match assignments using Canvas identifiers and preserve completed work until it leaves the feed. The cloud version takes completion status from Google Tasks; the local version takes it from the event's calendar. Run one scheduler per account to avoid conflicting updates.

Python requests `calendar.app.created` and `calendar.calendarlist.readonly`. Apps Script declares its Calendar, Tasks, external-request, and trigger scopes in [the manifest](apps-script/appsscript.json). Keep real feeds, credentials, tokens, generated calendars, and logs out of commits and test fixtures.
