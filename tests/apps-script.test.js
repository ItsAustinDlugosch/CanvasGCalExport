const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');

const source = fs.readFileSync(path.join(__dirname, '../apps-script/Code.js'), 'utf8');

function contextWith(overrides = {}) {
  const context = vm.createContext({
    Date,
    Set,
    Map,
    console: { log() {} },
    Utilities: {
      sleep() {},
      parseDate(value, zone) {
        const match = value.match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/);
        const [, year, month, day, hour, minute, second] = match.map(Number);
        const offset = zone === 'America/Chicago' ? (Number(month) >= 3 && Number(month) <= 10 ? 5 : 6) : 0;
        return new Date(Date.UTC(year, month - 1, day, hour + offset, minute, second));
      },
      formatDate(date, zone, format) {
        if (format === 'yyyy-MM-dd') {
          const offset = zone === 'America/Chicago' ? 5 : 0;
          return new Date(date.getTime() - offset * 3600000).toISOString().slice(0, 10);
        }
        return '2026-09-16 11:59 PM CDT';
      },
    },
    ...overrides,
  });
  vm.runInContext(source, context);
  return context;
}

const fixture = [
  'BEGIN:VCALENDAR',
  'VERSION:2.0',
  'BEGIN:VEVENT',
  'UID:event-assignment-3218702',
  'SUMMARY:HW1 [CSCE 421 500:]',
  'DTSTART;VALUE=DATE:20260916',
  'URL:https://canvas.tamu.edu/calendar?include_contexts=course_475192&month=09&year=2026#assignment_3218702',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'UID:event-assignment-2',
  'SUMMARY:Long home',
  ' work [CSCE-331:500\\,501]',
  'DTSTART:20260917T040000Z',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'UID:event-assignment-3',
  'SUMMARY:Excluded [CSCE-221:500]',
  'DTSTART:20260917T040000Z',
  'END:VEVENT',
  'END:VCALENDAR',
].join('\r\n');

test('parses Canvas titles, folded ICS lines, dates, and excluded course keys', () => {
  const app = contextWith();
  const config = { excludedCourses: new Set(['CSCE-221']), timeZone: 'America/Chicago' };
  const result = app.readAssignments(fixture, config);
  assert.deepEqual(Array.from(result.assignments, item => item.title), ['CSCE-421 - HW1', 'CSCE-331 - Long homework']);
  assert.equal(result.assignments[0].due.day, '2026-09-16');
  assert.equal(result.assignments[0].due.end.toISOString(), '2026-09-17T04:59:00.000Z');
  assert.equal(result.assignments[1].due.day, '2026-09-16');
  assert.equal(result.feedKeys.has('uid:event-assignment-3'), true);
  assert.equal(app.directAssignmentUrl(result.assignments[0].url),
    'https://canvas.tamu.edu/courses/475192/assignments/3218702');
});

test('rejects malformed and empty feeds before sync', () => {
  const app = contextWith();
  const config = { excludedCourses: new Set(), timeZone: 'America/Chicago' };
  assert.throws(() => app.readAssignments('<html>login</html>', config), /invalid iCalendar/);
  assert.throws(() => app.readAssignments('BEGIN:VCALENDAR\nEND:VCALENDAR', config), /no calendar events/);
});

test('a failed Canvas fetch stops before any Google changes', () => {
  let calendarCalled = false;
  const app = contextWith({
    PropertiesService: { getScriptProperties: () => ({ getProperty: key =>
      key === 'CANVAS_ICAL_URL' ? 'https://example.invalid/feed.ics' : null }) },
    UrlFetchApp: { fetch: () => ({ getResponseCode: () => 503 }) },
    LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock() {} }) },
    Calendar: { CalendarList: { list: () => { calendarCalled = true; } } },
  });
  assert.throws(() => app.syncCanvas(), /HTTP 503/);
  assert.equal(calendarCalled, false);
});

test('preview reports changes without creating calendars or Tasks', () => {
  const app = contextWith({
    PropertiesService: { getScriptProperties: () => ({ getProperty: key =>
      key === 'CANVAS_ICAL_URL' ? 'https://example.invalid/feed.ics' : null }) },
    UrlFetchApp: { fetch: () => ({ getResponseCode: () => 200, getContentText: () => fixture }) },
    Calendar: {
      CalendarList: { list: () => ({ items: [] }) },
      Calendars: { insert: () => { throw new Error('preview wrote a calendar'); } },
      Events: { insert: () => { throw new Error('preview wrote an event'); } },
    },
    Tasks: {
      Tasklists: {
        list: () => ({ items: [] }),
        insert: () => { throw new Error('preview wrote a task list'); },
      },
      Tasks: { insert: () => { throw new Error('preview wrote a task'); } },
    },
  });
  const report = app.previewSync();
  assert.equal(report.assignments, 2);
  assert.equal(report.createEvents, 2);
  assert.equal(report.createTasks, 2);
});

test('first sync preserves completed events and creates matching completed Tasks', () => {
  const existingEvent = {
    id: 'google-event-1',
    summary: 'Old title',
    description: 'CanvasKey=canvas.tamu.edu#assignment_3218702\nCanvas UID: event-assignment-3218702',
  };
  const operations = [];
  const app = contextWith({
    PropertiesService: { getScriptProperties: () => ({ getProperty: key =>
      key === 'CANVAS_ICAL_URL' ? 'https://example.invalid/feed.ics' : null }) },
    UrlFetchApp: { fetch: () => ({ getResponseCode: () => 200, getContentText: () => fixture }) },
    LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock() {} }) },
    Calendar: {
      CalendarList: { list: () => ({ items: [
        { summary: 'Canvas Assignments', id: 'active' },
        { summary: 'Canvas Completed', id: 'completed' },
      ] }) },
      Events: {
        list: id => ({ items: id === 'completed' ? [existingEvent] : [] }),
        insert: (body, id) => { operations.push(['event.insert', id, body.summary]); return { id: 'new-event' }; },
        patch: (body, id, eventId) => { operations.push(['event.patch', id, eventId]); return body; },
        move: (id, eventId, destination) => { operations.push(['event.move', id, eventId, destination]); return existingEvent; },
        remove: (id, eventId) => operations.push(['event.remove', id, eventId]),
      },
    },
    Tasks: {
      Tasklists: { list: () => ({ items: [{ title: 'Canvas Assignments', id: 'tasks' }] }) },
      Tasks: {
        list: () => ({ items: [] }),
        insert: (body, id) => { operations.push(['task.insert', id, body.title, body.status]); return { id: 'new-task', status: 'needsAction' }; },
        patch: (body, id, taskId) => { operations.push(['task.patch', id, taskId, body.status]); return { id: taskId, status: body.status }; },
        remove: (id, taskId) => operations.push(['task.remove', id, taskId]),
      },
    },
  });
  app.syncCanvas();
  assert.ok(operations.some(op => op[0] === 'task.insert' && op[2] === 'CSCE-421 - HW1' && op[3] === 'completed'));
  assert.ok(operations.some(op => op[0] === 'task.patch' && op[3] === 'completed'));
  assert.ok(operations.some(op => op[0] === 'event.patch' && op[1] === 'completed'));
  assert.ok(!operations.some(op => op[0] === 'event.move'));
});

test('completed Tasks move events and deleted assignments clean up both surfaces', () => {
  const liveKey = 'canvas.tamu.edu#assignment_3218702';
  const activeEvent = { id: 'active-event', description: `CanvasKey=${liveKey}` };
  const staleEvent = { id: 'stale-event', description: 'CanvasKey=uid:event-assignment-gone' };
  const completedTask = { id: 'completed-task', status: 'completed', title: 'CSCE-421 - HW1',
    due: '2026-09-16T00:00:00.000Z', notes: `CanvasKey=${liveKey}` };
  const staleTask = { id: 'stale-task', status: 'needsAction', notes: 'CanvasKey=uid:event-assignment-gone' };
  const operations = [];
  const app = contextWith({
    PropertiesService: { getScriptProperties: () => ({ getProperty: key =>
      key === 'CANVAS_ICAL_URL' ? 'https://example.invalid/feed.ics' : null }) },
    UrlFetchApp: { fetch: () => ({ getResponseCode: () => 200, getContentText: () => fixture }) },
    LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock() {} }) },
    Calendar: {
      CalendarList: { list: () => ({ items: [
        { summary: 'Canvas Assignments', id: 'active' },
        { summary: 'Canvas Completed', id: 'completed' },
      ] }) },
      Events: {
        list: id => ({ items: id === 'active' ? [activeEvent, staleEvent] : [] }),
        insert: (body, id) => { operations.push(['event.insert', id, body.summary]); return { id: 'new-event' }; },
        patch: (body, id, eventId) => { operations.push(['event.patch', id, eventId]); return body; },
        move: (id, eventId, destination) => { operations.push(['event.move', id, eventId, destination]); return activeEvent; },
        remove: (id, eventId) => operations.push(['event.remove', id, eventId]),
      },
    },
    Tasks: {
      Tasklists: { list: () => ({ items: [{ title: 'Canvas Assignments', id: 'tasks' }] }) },
      Tasks: {
        list: () => ({ items: [completedTask, staleTask] }),
        insert: (body, id) => { operations.push(['task.insert', id, body.title]); return { id: 'new-task', status: 'needsAction' }; },
        patch: (body, id, taskId) => operations.push(['task.patch', id, taskId]),
        remove: (id, taskId) => operations.push(['task.remove', id, taskId]),
      },
    },
  });
  app.syncCanvas();
  assert.ok(operations.some(op => op.join('|') === 'event.move|active|active-event|completed'));
  assert.ok(operations.some(op => op.join('|') === 'event.remove|active|stale-event'));
  assert.ok(operations.some(op => op.join('|') === 'task.remove|tasks|stale-task'));
  assert.ok(!operations.some(op => op.join('|') === 'task.remove|tasks|completed-task'));
});

test('Task writes retry quota errors but stop on unrelated failures', () => {
  const delays = [];
  const app = contextWith({ Utilities: { sleep: delay => delays.push(delay) } });
  const writeTask = app.taskWriter();
  let attempts = 0;
  const result = writeTask(() => {
    attempts++;
    if (attempts < 3) throw new Error('GoogleJsonResponseException: Quota Exceeded');
    return 'created';
  });
  assert.equal(result, 'created');
  assert.equal(attempts, 3);
  assert.ok(delays.some(delay => delay >= 1000));

  assert.throws(() => writeTask(() => { throw new Error('Bad request'); }), /Bad request/);
});
