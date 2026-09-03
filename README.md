# Canvas Export

Sync Canvas assignment deadlines into Google Calendar as timed events.

Canvas Export reads your private Canvas calendar feed and mirrors assignment deadlines into two Google Calendars:

- `Canvas Assignments` for active assignments
- `Canvas Completed` for assignments you have finished

Each assignment becomes a short event whose end time is the Canvas due time. Date-only Canvas assignments are shown near the end of the local day.

## Features

- Creates timed Google Calendar events from Canvas assignment feed entries
- Preserves Canvas due times using your configured local timezone
- Converts Canvas calendar links into direct assignment links when possible
- Tracks synced events with Canvas UID/key metadata to avoid duplicates
- Lets you mark assignments complete by moving events to `Canvas Completed`
- Keeps completed events in the completed calendar during future syncs
- Supports laptop-friendly scheduling with a `systemd` user timer

## Requirements

- Linux with Python 3.11+
- A Canvas calendar feed URL
- A Google Cloud project with Google Calendar API enabled
- A Google OAuth Desktop client saved as `credentials.json`
- Optional but recommended: `systemd --user` for automatic scheduled syncs

## Google Setup

1. Open Google Cloud Console.
2. Create or select a project.
3. Enable the Google Calendar API.
4. Create an OAuth client ID.
5. Choose `Desktop app` as the application type.
6. Download the client JSON.
7. Save it in this repository as `credentials.json`.

The app requests these Calendar scopes:

```text
https://www.googleapis.com/auth/calendar.app.created
https://www.googleapis.com/auth/calendar.calendarlist.readonly
```

These scopes allow the app to create secondary calendars, manage events on calendars it created, and find the Canvas calendars in your calendar list.

## Canvas Setup

In Canvas, find your calendar feed URL. It usually appears in the Canvas Calendar area under a calendar feed or subscription option.

Treat this URL as private. Anyone with the URL may be able to read your Canvas calendar feed.

## Project Setup

Run:

```bash
python3 setup.py
```

The setup script will:

- Create `config.json`
- Create `.venv` if needed
- Install dependencies from `requirements.txt`
- Lock down local config, credential, token, and log file permissions
- Optionally install and enable the user `systemd` timer

Then run the sync once:

```bash
.venv/bin/python3 main.py
```

The first run opens a Google OAuth approval flow. Approve access in the browser, then return to the terminal.

## Configuration

Local configuration lives in `config.json`, which is ignored by git.

Example:

```json
{
  "canvas_ical_url": "https://canvas.example.edu/feeds/calendars/user_your_private_feed.ics",
  "excluded_courses": [],
  "active_calendar_title": "Canvas Assignments",
  "completed_calendar_title": "Canvas Completed",
  "local_timezone": "America/Chicago",
  "event_duration_minutes": 15
}
```

`canvas_ical_url` can also be provided with the `CANVAS_ICAL_URL` environment variable.

### Event Timing

Timed Canvas assignments:

- Event end = Canvas due datetime in `local_timezone`
- Event start = end minus `event_duration_minutes`

Date-only Canvas assignments:

- Event end = 11:59 PM in `local_timezone`
- Event start = end minus `event_duration_minutes`

With the default 15-minute duration, a date-only assignment appears from 11:44 PM to 11:59 PM.

## Completing Assignments

To mark an assignment complete, move its event from `Canvas Assignments` to `Canvas Completed`.

The sync scans both calendars. If it finds a matching event in `Canvas Completed`, it updates that event in place and leaves it completed.

## Scheduling

The scheduler entrypoint is:

```bash
/path/to/canvasExport/run_canvas_sync.sh
```

It:

- Changes into the project directory before running
- Appends timestamped start/end lines to `cron.log`
- Uses `flock` to prevent overlapping syncs

For laptops, use the included `systemd` user timer instead of cron. The timer has `Persistent=true`, so if the laptop is asleep at the scheduled time, the missed sync should run after wake once your user systemd manager is available.

Useful commands:

```bash
systemctl --user list-timers --all
systemctl --user status canvas-sync.timer
systemctl --user status canvas-sync.service
systemctl --user start canvas-sync.service
```

## Logs

Wrapper log:

```bash
tail -n 20 cron.log
```

Application log:

```bash
tail -n 40 canvasExport.log
```

Systemd journal:

```bash
journalctl --user -u canvas-sync.service -n 50
```

## Security Notes

Do not commit these files:

- `credentials.json`
- `config.json`
- `token.json`
- `*.log`
- `canvas.ics`

The Canvas feed URL is private. Treat it like a token.

The Google token file contains OAuth access/refresh tokens. If it is exposed, revoke access in your Google Account security settings and delete `token.json` before re-authorizing.

## Troubleshooting

Check whether configuration exists:

```bash
test -f config.json && echo configured
```

Run the sync directly:

```bash
.venv/bin/python3 main.py
```

Check timer status:

```bash
systemctl --user list-timers --all
```

Common issues:

- `credentials.json` missing: download a Desktop OAuth client JSON from Google Cloud Console.
- OAuth opens a browser or prints an approval URL: approve access and return to the terminal.
- Laptop asleep at run time: use the `systemd` timer, not cron.
- Calendar permissions error: re-run `main.py` from an interactive terminal to re-authorize. If Google still reuses the old grant, delete `token.json` and run `main.py` again.
- Canvas fetch fails: confirm the Canvas feed URL in `config.json`.
