# Canvas Export

Keep your Canvas assignment deadlines in Google Calendar, with separate calendars for upcoming and completed work. Choose how you want the sync to run; Google Apps Script also adds a Google Tasks checklist.

## Choose your setup

| | Google Apps Script — recommended | Local Linux setup |
| --- | --- | --- |
| Best for | Most students; no coding experience needed | People comfortable with a Linux terminal |
| Runs on | Google's servers, even when your computer is off | Your Linux computer using a systemd timer |
| Syncs to | Google Calendar and Google Tasks | Google Calendar |
| Setup requires | A browser, Google account, and Canvas calendar feed | Python, Google Cloud credentials, and systemd |
| Get started | **[Set up Google Apps Script](apps-script/README.md)** | **[Set up locally](local/README.md)** |

Choose one option for your Google account. Both run daily by default.

## What to expect

Assignments appear in **Canvas Assignments** as short events ending at their due time, with a link back to Canvas when available. Finished work moves to **Canvas Completed**. Each guide explains how to mark work complete.

The sync follows your Canvas calendar feed: changes appear after the next run, and synced assignments that leave the feed are removed. It is a planning aid, not a permanent archive. Marking work complete here does not submit it or change its status in Canvas.

Your Canvas feed URL is private. Keep it and your Google credentials out of shared files and screenshots.

---

[Contributing and development](CONTRIBUTING.md) · [Updating an existing installation](docs/updating.md)
