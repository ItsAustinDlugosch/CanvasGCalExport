# Set up with Google Apps Script

[← Back to Canvas Export](../README.md)

This option runs in Google's cloud and syncs assignments to Google Calendar and Google Tasks. You only need a computer with a browser, your Google account, and access to Canvas. You do not need to install anything on your computer.

## 1. Copy your Canvas calendar feed

In Canvas, open **Calendar**, select **Calendar Feed**, and copy the URL. Keep it private: anyone with the link may be able to read your calendar. If you cannot find it, see [Canvas's calendar guide](https://community.instructure.com/en/kb/articles/662787-how-do-i-use-the-calendar).

## 2. Create your script

1. Open [Google Apps Script](https://script.google.com/) and sign in with the Google account where you want your assignments.
2. Click **New project** and name it **Canvas Export**.
3. Open this project's [Code.js](Code.js) file in another tab. On GitHub, use **Copy raw file** (or open **Raw** and copy all the text).
4. Return to Apps Script. Replace everything in the existing **Code.gs** file with that text, then save. Keep the name `Code.gs`.
5. Next to **Files**, click **+ → HTML**, name the file `WebApp`, and replace its contents with this project's [WebApp.html](WebApp.html). Save it. This file provides the optional browser button described below.

## 3. Add the project settings

1. In Apps Script, open **Project Settings** (the gear icon).
2. Turn on **Show "appsscript.json" manifest file in editor**.
3. Return to **Editor** and open **appsscript.json**.
4. Replace its contents with the full contents of this project's [appsscript.json](appsscript.json), then save. This enables the Calendar and Tasks services the script uses.
5. Return to **Project Settings** and set **Time zone** to your local time zone. Do this after copying the settings file, which starts with `America/Chicago`.
6. Under **Script Properties**, choose **Add script property**. Set the property name to `CANVAS_ICAL_URL` and its value to your private Canvas feed URL. Click **Save script properties**.

The included settings work with the default Google Cloud project that Apps Script creates for you. See [Google's advanced services guide](https://developers.google.com/apps-script/guides/services/advanced) if you already use a custom Cloud project.

## 4. Preview your assignments

Return to **Editor**, select **previewSync** in the function dropdown above the code, and click **Run**. This checks your feed and reports planned changes without changing your calendars or Tasks.

On the first run, Google asks you to authorize the script. Choose the same account and review the requested access to Calendar, Tasks, external services (to read Canvas), and scheduled triggers. If you see an unverified-app notice for the project you just created, **Advanced → Go to Canvas Export (unsafe)** may let you continue. Only continue for your own project with code you trust. School or work accounts may require administrator approval.

Open the **Execution log** at the bottom. Look for an `assignments` count and the numbers of events and Tasks to create. A new installation should show zero deletions. If the count is unexpected, run **previewCanvasFeed** to see sample titles; resolve any unexpected deletions before continuing.

## 5. Run your first sync

Select **syncCanvas** and click **Run**. Wait for execution to finish, then open [Google Calendar](https://calendar.google.com/) and [Google Tasks](https://tasks.google.com/).

You should see:

- **Canvas Assignments** and **Canvas Completed** in Google Calendar. Make sure the calendars are checked so their events are visible.
- A **Canvas Assignments** list in Google Tasks, with your assignments.

Check one assignment's title and due time against Canvas. Calendar events end at the due time; Tasks show the due date. Assignments with only a date appear near the end of that day.

## 6. Turn on daily updates

Select **installDailyTrigger** and click **Run** once. Open **Triggers** (the clock icon) and check that **syncCanvas** has a time-based trigger.

The sync runs each morning between roughly 7 and 8 AM in the project's time zone. Google chooses the exact time within that hour; see [Google's trigger guide](https://developers.google.com/apps-script/guides/triggers/installable). You can close the browser and turn off your computer.

## Using it day to day

Check off an assignment in **Google Tasks** when you finish it. At the next sync, its calendar event moves to **Canvas Completed**. Reopen the Task to move it back. Use Tasks to mark completion; moving a calendar event alone can be undone by the next sync.

To sync sooner, run **syncCanvas** in the editor or set up the browser button below. To stop automatic updates, delete its trigger on the **Triggers** page; your existing calendars and Tasks remain.

Assignments removed from the Canvas feed are also removed from the synced calendars and Tasks list, including completed work. Canvas controls which assignments are included in the feed.

## Add a “Run sync now” browser button

Apps Script can publish a private web page with a **Run sync now** button. The page uses your Google sign-in, calls the same `syncCanvas` function, and displays the resulting event and Task counts. Your Canvas feed URL stays in Script Properties and is never sent to a browser extension.

1. In the Apps Script editor, select **Deploy → New deployment**.
2. Next to **Select type**, click the gear and choose **Web app**.
3. Enter `Manual Canvas sync` as the description.
4. Set **Execute as** to **Me**.
5. Set **Who has access** to **Only myself**. If a managed school account does not offer that choice, use the narrowest option that includes your account.
6. Click **Deploy**, approve access if asked, and copy the web app URL ending in `/exec`.
7. Open that URL while signed into the same Google account. Bookmark it and optionally pin the bookmark to your browser toolbar.

Open the bookmark and press **Run sync now** whenever you want an immediate update. Keep the page open until it shows **Sync complete**. The daily trigger remains active as a fallback.

A browser extension is possible, but for this design it would only open the same bookmarked URL. Installing an unpacked extension requires browser developer mode and a per-user URL setting, so the bookmark gives the same secure workflow with fewer steps and no extension permissions.

When `Code.js` or `WebApp.html` changes later, upload both files, then open **Deploy → Manage deployments**, edit the web app, select **New version**, and deploy. Its `/exec` URL remains the same.

## If something goes wrong

| Problem | What to do |
| --- | --- |
| “Set CANVAS_ICAL_URL in Script Properties” | Check the property name and save your feed URL in step 3. |
| `Calendar` or `Tasks` is not defined | Copy and save the complete settings file from step 3. Under **Services**, confirm Calendar API and Tasks API are enabled. |
| No assignments, wrong assignments, or a feed error | Copy a fresh feed URL from Canvas and run **previewCanvasFeed**. The feed may cover only a limited date range. |
| Times are wrong | Check **Project Settings → Time zone**, then run **syncCanvas** again. |
| Quota exceeded or execution timed out during import | Wait a few minutes and run **syncCanvas** again. It recognizes items already created. Check **Executions** for the result; persistent failures may require waiting for Google's quota to reset. |
| Daily updates stopped | Check **Executions** for errors and **Triggers** for the schedule. Run **syncCanvas** manually to see whether authorization is needed. |
| Your school blocks authorization | Ask your Google account administrator whether Apps Script and these services are allowed. |

For later changes, see [updating your installation](../docs/updating.md). Optional course filters and command-line deployment are covered in the [contributor guide](../CONTRIBUTING.md).
