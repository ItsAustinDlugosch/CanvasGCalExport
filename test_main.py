import os
import unittest
from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import MagicMock, call, patch

from icalendar import Calendar, Event

os.environ.setdefault("CANVAS_ICAL_URL", "https://canvas.example.invalid/feed.ics")
import main


class SyncTests(unittest.TestCase):
    def test_feed_keys_include_excluded_assignments(self):
        calendar = Calendar()
        for uid, summary in (
            ("event-assignment-1", "Homework 1 [CSCE-421:500]"),
            ("event-assignment-2", "Homework 2 [CSCE-221:500]"),
            ("event-assignment-3218702", "HW1 [CSCE 421 500:]"),
        ):
            event = Event()
            event.add("uid", uid)
            event.add("summary", summary)
            event.add("dtstart", datetime(2026, 9, 17, tzinfo=timezone.utc))
            calendar.add_component(event)

        response = SimpleNamespace(text=calendar.to_ical(), raise_for_status=MagicMock())
        with patch.object(main, "EXCLUDED_COURSES", {"CSCE-221"}), patch.object(
            main.requests, "get", return_value=response
        ):
            assignments, feed_keys = main.fetch_canvas_assignments("https://canvas.example.invalid/feed.ics")

        self.assertEqual(
            [item["title"] for item in assignments],
            ["CSCE-421 - Homework 1", "CSCE-421 - HW1"],
        )
        self.assertIn("uid:event-assignment-2", feed_keys)
        response.raise_for_status.assert_called_once_with()

    def test_removed_assignments_deleted_from_both_calendars(self):
        live = {
            "uid": "event-assignment-1",
            "title": "CSCE-421 - Homework 1",
            "due": datetime(2026, 9, 17, tzinfo=timezone.utc),
            "url": "",
        }
        active_events = [
            {"id": "live", "extendedProperties": {"private": {"CanvasUID": live["uid"]}}},
            {"id": "stale-active", "description": "Canvas UID: event-assignment-old"},
            {"id": "manual", "summary": "Personal event"},
        ]
        completed_events = [
            {"id": "stale-completed", "extendedProperties": {"private": {"CanvasKey": "uid:event-assignment-gone"}}},
            {"id": "excluded", "description": "Canvas UID: event-assignment-2"},
        ]
        service = MagicMock()
        service.events.return_value.list.return_value.execute.side_effect = [
            {"items": active_events, "nextPageToken": "next"},
            {"items": []},
            {"items": completed_events},
        ]
        with patch.object(main, "fetch_canvas_assignments", return_value=(
            [live], {"uid:event-assignment-1", "uid:event-assignment-2"}
        )), patch.object(main, "get_google_service", return_value=service), patch.object(
            main, "find_or_create_calendar_id", side_effect=["active-id", "completed-id"]
        ), patch.object(main, "upsert_assignment_event", return_value="skipped"):
            main.main()

        self.assertEqual(service.events.return_value.delete.call_args_list, [
            call(calendarId="active-id", eventId="stale-active"),
            call(calendarId="completed-id", eventId="stale-completed"),
        ])
        for listed in service.events.return_value.list.call_args_list:
            self.assertNotIn("timeMin", listed.kwargs)
            self.assertNotIn("timeMax", listed.kwargs)

    def test_http_error_stops_before_calendar_changes(self):
        response = MagicMock()
        response.raise_for_status.side_effect = RuntimeError("feed unavailable")
        with patch.object(main.requests, "get", return_value=response), patch.object(
            main, "get_google_service"
        ) as get_service:
            with self.assertRaisesRegex(RuntimeError, "feed unavailable"):
                main.main()
        get_service.assert_not_called()


if __name__ == "__main__":
    unittest.main()
