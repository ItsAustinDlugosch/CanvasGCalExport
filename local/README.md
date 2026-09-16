# Set up locally on Linux

[← Back to Canvas Export](../README.md)

This option syncs Canvas assignments to Google Calendar using Python and a daily systemd user timer. It runs on your own computer and does not create Google Tasks. For a browser-only setup that runs while your computer is off, use [Google Apps Script](../apps-script/README.md).

## Before you start

You need Linux with Python 3.11 or newer, Python's `venv` module, Git, `flock` (usually provided by `util-linux`), and a working systemd user session. Complete the first Google sign-in from an interactive terminal with a browser on the same computer.

In Canvas, open **Calendar → Calendar Feed** and copy your private feed URL. Keep it out of shared files and screenshots.

Already using an older checkout? Follow [the upgrade steps](../docs/updating.md#local-installations-from-the-old-layout) before running the commands below.

## 1. Download the project

```bash
git clone https://github.com/ItsAustinDlugosch/CanvasGCalExport.git
cd CanvasGCalExport/local
```

Run the remaining setup commands from this `local` directory.

## 2. Set up Google access

1. Open [Google Cloud Console](https://console.cloud.google.com/) and create or select a project.
2. Enable the **Google Calendar API** in **APIs & Services → Library**.
3. Open **Google Auth Platform** and configure the app's branding and audience. For a personal Google account, use **External** and add your own Google account as a test user while the app is in testing.
4. Under **Clients**, create an OAuth client with application type **Desktop app**.
5. Download its JSON file and save it as **credentials.json** inside this project's **local** directory.

Google's [Calendar Python quickstart](https://developers.google.com/workspace/calendar/api/quickstart/python) walks through the Cloud Console screens. Use this project's setup commands below after creating the credentials.

External apps left in **Testing** normally need reauthorization after seven days for these permissions. For ongoing personal use, review the app's publishing status in Google Auth Platform; Google's [OAuth documentation](https://developers.google.com/identity/protocols/oauth2#expiration) explains token expiration.

## 3. Configure and try the sync

```bash
python3 setup.py --no-install-systemd
.venv/bin/python3 main.py
```

The setup asks for your Canvas feed URL and preferences. Press Enter to accept a default, but check that the time zone matches yours (for example, `America/Chicago` or `Europe/London`). It saves your settings in `config.json` and installs Python dependencies in `.venv`.

The first sync opens a Google sign-in page, or prints a URL to open in your browser. Sign in with the account you want to use and approve Calendar access. Return to the terminal and wait for the sync to finish.

Open [Google Calendar](https://calendar.google.com/). Check that **Canvas Assignments** and **Canvas Completed** appear, and enable them in the calendar list. Compare an assignment's due time with Canvas: its event should end at that time. Date-only assignments end at 11:59 PM in your configured time zone.

## 4. Schedule daily updates

After the first sync works, run:

```bash
python3 setup.py --skip-deps --install-systemd
systemctl --user status canvas-sync.timer
```

This keeps your existing configuration and installs a timer for 7 AM in your computer's time zone. The installer fills in the correct path for your checkout; keep that folder in place afterward.

The computer must be running with a user systemd manager available. The persistent timer catches a missed scheduled run when the timer becomes active again. It does not wake or power on your computer.

To run now or check recent activity:

```bash
systemctl --user start canvas-sync.service
journalctl --user -u canvas-sync.service -n 50
```

## Using it day to day

To mark an assignment complete, open its event in Google Calendar, edit it, change its calendar from **Canvas Assignments** to **Canvas Completed**, and save. Move it back to reopen it. Future syncs preserve that choice.

Changes to Canvas deadlines appear after the next sync. Assignments that disappear from the Canvas feed are removed from both calendars, including completed work.

To stop automatic updates:

```bash
systemctl --user disable --now canvas-sync.timer
```

## If something goes wrong

| Problem | What to do |
| --- | --- |
| `venv` is unavailable | Install your distribution's Python venv package, then rerun setup. On Debian/Ubuntu it is usually `python3-venv`. |
| `credentials.json` is missing | Save the downloaded Desktop app credentials in `local/credentials.json`. |
| Google asks for authorization again | Run `.venv/bin/python3 main.py` interactively and approve access. Check the testing-status note in step 2 if this happens weekly. |
| Old permissions keep being reused | Remove `local/token.json` and run the sync interactively again to sign in. |
| Canvas fetch fails | Check `canvas_ical_url` in `local/config.json` against a freshly copied Canvas feed URL. |
| Time zone or calendar preferences are wrong | Edit `local/config.json` and run the sync again. Calendar titles identify the calendars; changing them can create new ones. |
| Timer fails after moving the project | Recreate the virtual environment at the new location and rerun step 4. |
| `systemctl --user` cannot connect | Run from your normal Linux user session with systemd available. This setup does not use a system-wide service or `sudo`. |

From the `local` directory, inspect application and scheduler logs with:

```bash
tail -n 40 canvasExport.log
tail -n 20 cron.log
```

Keep `config.json`, `credentials.json`, `token.json`, and logs private; they are ignored by Git. For updates, see [updating your installation](../docs/updating.md).
