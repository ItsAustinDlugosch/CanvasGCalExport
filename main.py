#!/home/glitc/Projects/canvasExport/.venv/bin/python3

import re
import json
import requests
from icalendar import Calendar

from googleapiclient.discovery import build
from google_auth_oauthlib.flow import InstalledAppFlow
from google.auth.transport.requests import Request
from google.auth.exceptions import RefreshError
from google.oauth2.credentials import Credentials
import os
from datetime import datetime, date, time, timedelta, timezone
from zoneinfo import ZoneInfo
from pathlib import Path
from urllib.parse import parse_qs, urlparse
import logging

# --------------------------
# CONFIG
# --------------------------
BASE_DIR = Path(__file__).resolve().parent
CONFIG_FILE = BASE_DIR / "config.json"
DEFAULT_CONFIG = {
    "canvas_ical_url": "",
    "excluded_courses": [],
    "active_calendar_title": "Canvas Assignments",
    "completed_calendar_title": "Canvas Completed",
    "local_timezone": "America/Chicago",
    "event_duration_minutes": 15,
}


def load_config() -> dict:
    config = DEFAULT_CONFIG.copy()
    if CONFIG_FILE.exists():
        with open(CONFIG_FILE, "r", encoding="utf-8") as f:
            config.update(json.load(f))

    if os.environ.get("CANVAS_ICAL_URL"):
        config["canvas_ical_url"] = os.environ["CANVAS_ICAL_URL"]

    if not config["canvas_ical_url"]:
        raise RuntimeError(
            f"Canvas feed URL is not configured. Create {CONFIG_FILE} or set CANVAS_ICAL_URL."
        )

    return config


CONFIG = load_config()
ICAL_URL = CONFIG["canvas_ical_url"]

# Exclude any assignment whose SUMMARY contains "[<COURSE>:"  (e.g. "[CSCE-221:506\,507]")
EXCLUDED_COURSES = set(CONFIG["excluded_courses"])

ACTIVE_CALENDAR_TITLE = CONFIG["active_calendar_title"]
COMPLETED_CALENDAR_TITLE = CONFIG["completed_calendar_title"]
LOCAL_TIMEZONE = ZoneInfo(CONFIG["local_timezone"])
EVENT_DURATION_MINUTES = int(CONFIG["event_duration_minutes"])

# Google API scopes
CALENDAR_SCOPES = [
    "https://www.googleapis.com/auth/calendar.app.created",
    "https://www.googleapis.com/auth/calendar.calendarlist.readonly",
]

# OAuth client secrets downloaded from Google Cloud console:
# APIs & Services -> Credentials -> OAuth client ID (Desktop) -> download JSON
CLIENT_SECRET_FILE = str(BASE_DIR / "credentials.json")

# token cache
CALENDAR_TOKEN_FILE = str(BASE_DIR / "token.json")

LOG_FILE = BASE_DIR / "canvasExport.log"

logging.basicConfig(
    filename=LOG_FILE,
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
)
# --------------------------
# CANVAS: fetch + parse + filter
# --------------------------
def fetch_canvas_assignments(ical_url: str):
    raw = requests.get(ical_url, timeout=30).text
    cal = Calendar.from_ical(raw)

    assignments = []
    exclude_pattern = re.compile(r"\[(?:%s):" % "|".join(map(re.escape, EXCLUDED_COURSES))) if EXCLUDED_COURSES else None

    for component in cal.walk("VEVENT"):
        uid = str(component.get("uid", ""))

        # Keep ONLY assignment-type UIDs
        if not uid.startswith("event-assignment-"):
            continue

        summary = str(component.get("summary", "")).strip()

        # Exclude course(s) by bracket tag like "[CSCE-221:..."
        if exclude_pattern and exclude_pattern.search(summary):
            continue

        dtstart = component.get("dtstart").dt  # due time for assignment items
        url = str(component.get("url", "")) if component.get("url") else ""

        # Optional: strip the trailing bracketed course tag from the task title
        # e.g., "Homework 1 [CSCE-312:500]" -> "Homework 1"
        title_clean = re.sub(r"\s*\[[^\]]+\]\s*$", "", summary).strip()

        assignments.append({
            "uid": uid,
            "title": title_clean,
            "due": dtstart,
            "url": url,
        })

    return assignments


# --------------------------
# GOOGLE CALENDAR: auth + calendars + events
# --------------------------
def get_google_service(api_name: str, api_version: str, scopes: list[str], token_file: str, json_token: bool = False):
    creds = None
    if os.path.exists(token_file):
        if json_token:
            creds = Credentials.from_authorized_user_file(token_file)

    if creds and not creds.has_scopes(scopes):
        logging.warning(
            "Cached Google token is missing required scope(s); reauthorization is required."
        )
        creds = None

    if not creds or not creds.valid:
        if creds and creds.expired and creds.refresh_token:
            try:
                creds.refresh(Request())
            except RefreshError:
                creds = None

        if not creds:
            if not os.isatty(0):
                raise RuntimeError(
                    "Google Calendar reauthorization is required. Run "
                    f"{BASE_DIR / '.venv' / 'bin' / 'python3'} {BASE_DIR / 'main.py'} "
                    "from an interactive terminal, approve the requested scopes, then retry the scheduled sync."
                )
            flow = InstalledAppFlow.from_client_secrets_file(CLIENT_SECRET_FILE, scopes)
            open_browser = bool(os.environ.get("DISPLAY") or os.environ.get("WAYLAND_DISPLAY"))
            creds = flow.run_local_server(port=0, open_browser=open_browser)

        with open(token_file, "w") as f:
            f.write(creds.to_json())

    return build(api_name, api_version, credentials=creds)

def get_calendar_service():
    return get_google_service("calendar", "v3", CALENDAR_SCOPES, CALENDAR_TOKEN_FILE, json_token=True)

def canvas_due_note_line(dt) -> str:
    if isinstance(dt, date) and not isinstance(dt, datetime):
        return f"Canvas Due: {dt.isoformat()}"

    if isinstance(dt, datetime):
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=LOCAL_TIMEZONE)
        local_dt = dt.astimezone(LOCAL_TIMEZONE)
        return f"Canvas Due: {local_dt.strftime('%Y-%m-%d %I:%M %p %Z')}"

    raise TypeError(f"Unsupported due type: {type(dt)}")

def assignment_event_window(dt) -> tuple[datetime, datetime]:
    if isinstance(dt, date) and not isinstance(dt, datetime):
        end = datetime.combine(dt, time(23, 59), tzinfo=LOCAL_TIMEZONE)
    elif isinstance(dt, datetime):
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=LOCAL_TIMEZONE)
        end = dt.astimezone(LOCAL_TIMEZONE)
    else:
        raise TypeError(f"Unsupported due type: {type(dt)}")

    start = end - timedelta(minutes=EVENT_DURATION_MINUTES)
    return start, end

def calendar_datetime(dt: datetime) -> dict:
    return {
        "dateTime": dt.isoformat(),
        "timeZone": str(LOCAL_TIMEZONE),
    }

def assignment_description(assignment: dict) -> str:
    key = canvas_key(assignment["uid"], assignment["url"])
    task_url = direct_canvas_assignment_url(assignment["url"]) or assignment["url"]
    lines = [
        f"CanvasKey={key}",
        f"Canvas UID: {assignment['uid']}",
        canvas_due_note_line(assignment["due"]),
    ]
    if task_url:
        lines.append(f"Canvas Link: {task_url}")
    return "\n".join(lines)

def assignment_event_body(assignment: dict) -> dict:
    key = canvas_key(assignment["uid"], assignment["url"])
    start, end = assignment_event_window(assignment["due"])
    task_url = direct_canvas_assignment_url(assignment["url"]) or assignment["url"]
    body = {
        "summary": assignment["title"],
        "description": assignment_description(assignment),
        "start": calendar_datetime(start),
        "end": calendar_datetime(end),
        "extendedProperties": {
            "private": {
                "CanvasKey": key,
                "CanvasUID": assignment["uid"],
            }
        },
    }
    if task_url:
        body["source"] = {"title": "Canvas", "url": task_url}
    return body

def calendar_event_matches(event: dict, desired: dict) -> bool:
    return (
        event.get("summary") == desired.get("summary")
        and event.get("description") == desired.get("description")
        and event.get("start") == desired.get("start")
        and event.get("end") == desired.get("end")
        and event.get("source") == desired.get("source")
        and event.get("extendedProperties", {}).get("private", {}) == desired.get("extendedProperties", {}).get("private", {})
    )

def canvas_key(uid: str, url: str | None) -> str:
    """
    Build a stable dedupe key.
    Prefer calendar fragment like #assignment_12345 (or #event_..., #calendar_event_...).
    Include domain to avoid collisions across Canvas instances.
    """
    if url:
        p = urlparse(url)
        domain = p.netloc.lower()

        # fragment example: "assignment_7491747"
        frag = p.fragment or ""
        if frag:
            return f"{domain}#{frag}"

        # fallback: sometimes appears in URL path/query
        m = re.search(r"#(assignment_\d+)", url)
        if m:
            return f"{domain}#{m.group(1)}"

        return f"{domain}|{url}"

    return f"uid:{uid}"

def direct_canvas_assignment_url(url: str | None) -> str:
    """
    Convert Canvas calendar URLs to direct assignment URLs.
    Example:
    /calendar?include_contexts=course_481845#assignment_3113547
    -> /courses/481845/assignments/3113547
    """
    if not url:
        return ""

    p = urlparse(url)
    query = parse_qs(p.query)
    contexts = query.get("include_contexts", [])
    course_id = ""
    for context in contexts:
        m = re.fullmatch(r"course_(\d+)", context)
        if m:
            course_id = m.group(1)
            break

    assignment_match = re.fullmatch(r"assignment_(\d+)", p.fragment or "")
    if not course_id or not assignment_match:
        return ""

    return f"{p.scheme}://{p.netloc}/courses/{course_id}/assignments/{assignment_match.group(1)}"

def find_or_create_calendar_id(service, title: str) -> str:
    page_token = None
    while True:
        resp = service.calendarList().list(maxResults=250, pageToken=page_token).execute()
        for calendar in resp.get("items", []):
            if calendar.get("summary") == title:
                return calendar["id"]
        page_token = resp.get("nextPageToken")
        if not page_token:
            break

    created = service.calendars().insert(body={"summary": title, "timeZone": str(LOCAL_TIMEZONE)}).execute()
    logging.info("Created Google Calendar: title=%r id=%s", title, created["id"])
    return created["id"]

def get_existing_calendar_events(service, calendar_ids: dict[str, str], assignments: list[dict]) -> dict[str, dict]:
    if assignments:
        starts = []
        ends = []
        for assignment in assignments:
            start, end = assignment_event_window(assignment["due"])
            starts.append(start)
            ends.append(end)
        time_min = (min(starts) - timedelta(days=1)).astimezone(timezone.utc).isoformat().replace("+00:00", "Z")
        time_max = (max(ends) + timedelta(days=1)).astimezone(timezone.utc).isoformat().replace("+00:00", "Z")
    else:
        now = datetime.now(tz=timezone.utc)
        time_min = (now - timedelta(days=365)).isoformat().replace("+00:00", "Z")
        time_max = (now + timedelta(days=365)).isoformat().replace("+00:00", "Z")

    existing = {}
    for status, calendar_id in calendar_ids.items():
        page_token = None
        while True:
            resp = service.events().list(
                calendarId=calendar_id,
                maxResults=2500,
                pageToken=page_token,
                singleEvents=True,
                showDeleted=False,
                timeMin=time_min,
                timeMax=time_max,
            ).execute()
            for event in resp.get("items", []):
                private = event.get("extendedProperties", {}).get("private", {})
                keys = [private.get("CanvasKey")]
                uid = private.get("CanvasUID")
                if uid:
                    keys.append(f"uid:{uid}")

                description = event.get("description", "") or ""
                key_match = re.search(r"^CanvasKey=(.+)$", description, re.MULTILINE)
                if key_match:
                    keys.append(key_match.group(1).strip())
                uid_match = re.search(r"^Canvas UID:\s*(.+)$", description, re.MULTILINE)
                if uid_match:
                    keys.append(f"uid:{uid_match.group(1).strip()}")

                for key in filter(None, keys):
                    existing[key] = {
                        "calendar_id": calendar_id,
                        "status": status,
                        "event": event,
                    }
            page_token = resp.get("nextPageToken")
            if not page_token:
                break
    return existing

def upsert_assignment_event(service, calendar_id: str, existing_event: dict | None, assignment: dict) -> str:
    desired = assignment_event_body(assignment)
    if not existing_event:
        service.events().insert(calendarId=calendar_id, body=desired).execute()
        return "created"

    if calendar_event_matches(existing_event, desired):
        return "skipped"

    service.events().patch(
        calendarId=calendar_id,
        eventId=existing_event["id"],
        body=desired,
    ).execute()
    return "updated"

def main():
    assignments = fetch_canvas_assignments(ICAL_URL)
    logging.info(
        "Canvas assignment events after filtering: %d",
        len(assignments),
    )

    service = get_calendar_service()
    calendar_ids = {
        "active": find_or_create_calendar_id(service, ACTIVE_CALENDAR_TITLE),
        "completed": find_or_create_calendar_id(service, COMPLETED_CALENDAR_TITLE),
    }
    existing_events = get_existing_calendar_events(service, calendar_ids, assignments)
    existing_event_count = len({entry["event"]["id"] for entry in existing_events.values()})
    logging.info("Sample existing Canvas calendar identifier(s): %s", list(existing_events)[:5])
    logging.info("Sample new UID(s): %s", [a["uid"] for a in assignments[:5]])
    logging.info("Sample new URL(s): %s", [a["url"] for a in assignments[:5]])


    logging.info(
        "Existing Canvas events already in Google Calendars '%s'/'%s': %d",
        ACTIVE_CALENDAR_TITLE,
        COMPLETED_CALENDAR_TITLE,
        existing_event_count,
    )

    created = 0
    updated = 0
    completed_updated = 0
    skipped = 0

    for a in assignments:
        key = canvas_key(a["uid"], a["url"])
        existing_entry = existing_events.get(key) or existing_events.get(f"uid:{a['uid']}")
        target_calendar_id = calendar_ids["active"]
        existing_event = None
        existing_status = "active"

        if existing_entry:
            target_calendar_id = existing_entry["calendar_id"]
            existing_event = existing_entry["event"]
            existing_status = existing_entry["status"]

        result = upsert_assignment_event(service, target_calendar_id, existing_event, a)
        if result == "created":
            created += 1
        elif result == "updated" and existing_status == "completed":
            completed_updated += 1
        elif result == "updated":
            updated += 1
        else:
            skipped += 1

    logging.info(
        "Created %d calendar events, updated %d active events, updated %d completed events, skipped %d already-current.",
        created,
        updated,
        completed_updated,
        skipped,
    )


if __name__ == "__main__":
    try:
        main()
    except Exception:
        logging.exception("Fatal error during Canvas → Google Calendar sync")
        raise
