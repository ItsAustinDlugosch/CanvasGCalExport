// Standalone Apps Script entry points: previewCanvasFeed, syncCanvas, installDailyTrigger.
const DEFAULTS = {
  activeCalendarTitle: 'Canvas Assignments',
  completedCalendarTitle: 'Canvas Completed',
  taskListTitle: 'Canvas Assignments',
  timeZone: 'America/Chicago',
  durationMinutes: 15,
  excludedCourses: ['CSCE-221'],
};

function readConfig() {
  const props = PropertiesService.getScriptProperties();
  const icalUrl = props.getProperty('CANVAS_ICAL_URL');
  if (!icalUrl) throw new Error('Set CANVAS_ICAL_URL in Script Properties.');
  const excludedCourses = JSON.parse(props.getProperty('EXCLUDED_COURSES') || JSON.stringify(DEFAULTS.excludedCourses));
  if (!Array.isArray(excludedCourses)) throw new Error('EXCLUDED_COURSES must be a JSON array.');
  const durationMinutes = Number(props.getProperty('EVENT_DURATION_MINUTES') || DEFAULTS.durationMinutes);
  if (!Number.isFinite(durationMinutes) || durationMinutes <= 0) {
    throw new Error('EVENT_DURATION_MINUTES must be positive.');
  }
  return {
    icalUrl,
    excludedCourses: new Set(excludedCourses),
    activeCalendarTitle: props.getProperty('ACTIVE_CALENDAR_TITLE') || DEFAULTS.activeCalendarTitle,
    completedCalendarTitle: props.getProperty('COMPLETED_CALENDAR_TITLE') || DEFAULTS.completedCalendarTitle,
    taskListTitle: props.getProperty('TASK_LIST_TITLE') || DEFAULTS.taskListTitle,
    timeZone: props.getProperty('LOCAL_TIMEZONE') || DEFAULTS.timeZone,
    durationMinutes,
  };
}

function fetchIcs(url) {
  const response = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
  const status = response.getResponseCode();
  if (status < 200 || status >= 300) throw new Error(`Canvas feed returned HTTP ${status}.`);
  return response.getContentText();
}

function unescapeIcs(value) {
  return value.replace(/\\([nN,;\\])/g, (_, escaped) =>
    escaped === 'n' || escaped === 'N' ? '\n' : escaped);
}

function parseIcs(text) {
  const unfolded = text.replace(/\r\n[ \t]|\n[ \t]|\r[ \t]/g, '');
  if (!/^BEGIN:VCALENDAR\s*$/m.test(unfolded) || !/^END:VCALENDAR\s*$/m.test(unfolded)) {
    throw new Error('Canvas returned an invalid iCalendar document.');
  }
  const events = [];
  let event = null;
  for (const line of unfolded.split(/\r\n|\n|\r/)) {
    if (line === 'BEGIN:VEVENT') {
      event = {};
    } else if (line === 'END:VEVENT') {
      if (!event || !event.uid) throw new Error('Incomplete iCalendar event.');
      events.push(event);
      event = null;
    } else if (event) {
      const separator = line.indexOf(':');
      if (separator < 0) continue;
      const property = line.slice(0, separator);
      const name = property.split(';', 1)[0].toUpperCase();
      const value = line.slice(separator + 1);
      if (name === 'UID') event.uid = unescapeIcs(value);
      if (name === 'SUMMARY') event.summary = unescapeIcs(value).trim();
      if (name === 'URL') event.url = unescapeIcs(value);
      if (name === 'DTSTART') {
        const tzid = property.match(/(?:^|;)TZID=(?:"([^"]+)"|([^;]+))/i);
        event.dtstart = { value, timeZone: tzid ? (tzid[1] || tzid[2]) : null };
      }
    }
  }
  if (event) throw new Error('Unterminated iCalendar event.');
  return events;
}

function canvasKey(uid, url) {
  if (!url) return `uid:${uid}`;
  const domain = (url.match(/^https?:\/\/([^/]+)/i) || [null, ''])[1].toLowerCase();
  const fragment = (url.match(/#([^#]+)$/) || [null, ''])[1];
  return fragment ? `${domain}#${fragment}` : `${domain}|${url}`;
}

function directAssignmentUrl(url) {
  const parts = url.match(/^(https?:\/\/[^/]+)\/calendar\?[^#]*include_contexts=course_(\d+)[^#]*#assignment_(\d+)$/);
  return parts ? `${parts[1]}/courses/${parts[2]}/assignments/${parts[3]}` : '';
}

function assignmentTitle(summary) {
  const tag = summary.match(/\s*\[([^:\[\]]+):[^\]]*\]\s*$/);
  if (!tag) return summary.replace(/\s*\[[^\]]+\]\s*$/, '').trim();
  let course = tag[1].trim();
  const withSection = course.match(/^([A-Za-z]+)\s+(\d+[A-Za-z]?)\s+\d+$/);
  if (withSection) course = `${withSection[1].toUpperCase()}-${withSection[2]}`;
  return `${course} - ${summary.slice(0, tag.index).trim()}`;
}

function parseDue(dtstart, localTimeZone) {
  const value = dtstart.value;
  if (/^\d{8}$/.test(value)) {
    const end = Utilities.parseDate(`${value}235900`, localTimeZone, 'yyyyMMddHHmmss');
    return { end, day: `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`, dateOnly: true };
  }
  const match = value.match(/^(\d{8})T(\d{4})(\d{2})?(Z)?$/);
  if (!match) throw new Error(`Unsupported DTSTART format: ${value}`);
  const timeZone = match[4] ? 'UTC' : (dtstart.timeZone || localTimeZone);
  const end = Utilities.parseDate(`${match[1]}${match[2]}${match[3] || '00'}`, timeZone, 'yyyyMMddHHmmss');
  const day = Utilities.formatDate(end, localTimeZone, 'yyyy-MM-dd');
  return { end, day, dateOnly: false };
}

function readAssignments(ics, config) {
  const assignments = [];
  const feedKeys = new Set();
  const events = parseIcs(ics);
  if (!events.length) throw new Error('Canvas feed contains no calendar events; sync stopped.');
  for (const item of events) {
    if (!item.uid.startsWith('event-assignment-')) continue;
    const url = item.url || '';
    const key = canvasKey(item.uid, url);
    feedKeys.add(key);
    feedKeys.add(`uid:${item.uid}`);
    const tag = (item.summary || '').match(/\[([^:\[\]]+):/);
    if (tag && config.excludedCourses.has(tag[1])) continue;
    if (!item.dtstart) throw new Error(`Assignment ${item.uid} has no due date.`);
    const due = parseDue(item.dtstart, config.timeZone);
    assignments.push({ uid: item.uid, key, url, title: assignmentTitle(item.summary || ''), due });
  }
  return { assignments, feedKeys };
}

function keysFromDescription(description) {
  const keys = new Set();
  const key = (description || '').match(/^CanvasKey=(.+)$/m);
  const uid = (description || '').match(/^Canvas UID:\s*(.+)$/m);
  if (key) keys.add(key[1].trim());
  if (uid) keys.add(`uid:${uid[1].trim()}`);
  return keys;
}

function eventKeys(event) {
  const keys = keysFromDescription(event.description);
  const privateProps = (event.extendedProperties || {}).private || {};
  if (privateProps.CanvasKey) keys.add(privateProps.CanvasKey);
  if (privateProps.CanvasUID) keys.add(`uid:${privateProps.CanvasUID}`);
  return keys;
}

function findCalendar(title, timeZone, create = true) {
  let pageToken;
  do {
    const result = Calendar.CalendarList.list({ maxResults: 250, pageToken });
    const found = (result.items || []).find(item => item.summary === title);
    if (found) return found.id;
    pageToken = result.nextPageToken;
  } while (pageToken);
  return create ? Calendar.Calendars.insert({ summary: title, timeZone }).id : null;
}

function findTaskList(title, create = true) {
  let pageToken;
  do {
    const result = Tasks.Tasklists.list({ maxResults: 100, pageToken });
    const found = (result.items || []).find(item => item.title === title);
    if (found) return found.id;
    pageToken = result.nextPageToken;
  } while (pageToken);
  return create ? Tasks.Tasklists.insert({ title }).id : null;
}

function listCalendarEvents(calendarIds) {
  const managed = [];
  const byKey = new Map();
  for (const [status, calendarId] of Object.entries(calendarIds)) {
    if (!calendarId) continue;
    let pageToken;
    do {
      const result = Calendar.Events.list(calendarId, {
        maxResults: 2500, pageToken, showDeleted: false, singleEvents: false,
      });
      for (const event of result.items || []) {
        const keys = eventKeys(event);
        if (!keys.size) continue;
        const entry = { event, calendarId, status, keys };
        managed.push(entry);
        for (const key of keys) byKey.set(key, entry);
      }
      pageToken = result.nextPageToken;
    } while (pageToken);
  }
  return { managed, byKey };
}

function listTasks(taskListId) {
  const managed = [];
  const byKey = new Map();
  if (!taskListId) return { managed, byKey };
  let pageToken;
  do {
    const result = Tasks.Tasks.list(taskListId, {
      maxResults: 100, pageToken, showCompleted: true, showHidden: true, showDeleted: false,
    });
    for (const task of result.items || []) {
      const keys = keysFromDescription(task.notes);
      if (!keys.size) continue;
      const entry = { task, keys };
      managed.push(entry);
      for (const key of keys) byKey.set(key, entry);
    }
    pageToken = result.nextPageToken;
  } while (pageToken);
  return { managed, byKey };
}

function matchingEntry(byKey, assignment) {
  return byKey.get(assignment.key) || byKey.get(`uid:${assignment.uid}`);
}

function dueDescription(assignment, timeZone) {
  if (assignment.due.dateOnly) return `Canvas Due: ${assignment.due.day}`;
  return `Canvas Due: ${Utilities.formatDate(assignment.due.end, timeZone, 'yyyy-MM-dd hh:mm a z')}`;
}

function assignmentNotes(assignment, timeZone) {
  const lines = [
    `CanvasKey=${assignment.key}`,
    `Canvas UID: ${assignment.uid}`,
    dueDescription(assignment, timeZone),
  ];
  const link = directAssignmentUrl(assignment.url) || assignment.url;
  if (link) lines.push(`Canvas Link: ${link}`);
  return lines.join('\n');
}

function eventBody(assignment, config) {
  const end = assignment.due.end;
  const start = new Date(end.getTime() - config.durationMinutes * 60000);
  const link = directAssignmentUrl(assignment.url) || assignment.url;
  const body = {
    summary: assignment.title,
    description: assignmentNotes(assignment, config.timeZone),
    start: { dateTime: start.toISOString(), timeZone: config.timeZone },
    end: { dateTime: end.toISOString(), timeZone: config.timeZone },
    extendedProperties: { private: { CanvasKey: assignment.key, CanvasUID: assignment.uid } },
  };
  if (link) body.source = { title: 'Canvas', url: link };
  return body;
}

function eventMatches(event, desired) {
  const privateProps = (event.extendedProperties || {}).private || {};
  const desiredProps = desired.extendedProperties.private;
  return event.summary === desired.summary && event.description === desired.description &&
    Date.parse((event.start || {}).dateTime) === Date.parse(desired.start.dateTime) &&
    Date.parse((event.end || {}).dateTime) === Date.parse(desired.end.dateTime) &&
    (event.source || {}).url === (desired.source || {}).url &&
    privateProps.CanvasKey === desiredProps.CanvasKey &&
    privateProps.CanvasUID === desiredProps.CanvasUID;
}

function taskBody(assignment, config, completed) {
  const body = {
    title: assignment.title,
    notes: assignmentNotes(assignment, config.timeZone),
    due: `${assignment.due.day}T00:00:00.000Z`,
  };
  if (completed) {
    body.status = 'completed';
    body.completed = new Date().toISOString();
  }
  return body;
}

function taskWriter() {
  let lastAttempt = 0;
  return operation => {
    for (let attempt = 0; attempt < 5; attempt++) {
      const spacing = lastAttempt + 1000 - Date.now();
      if (spacing > 0) Utilities.sleep(spacing);
      lastAttempt = Date.now();
      try {
        return operation();
      } catch (error) {
        if (!/Quota Exceeded|Rate Limit Exceeded|Too Many Requests/i.test(String(error)) || attempt === 4) {
          throw error;
        }
        Utilities.sleep(1000 * 2 ** attempt + Math.floor(Math.random() * 1000));
      }
    }
  };
}

function installDailyTrigger() {
  const name = 'syncCanvas';
  if (ScriptApp.getProjectTriggers().some(trigger => trigger.getHandlerFunction() === name)) return;
  ScriptApp.newTrigger(name).timeBased().atHour(7).everyDays(1).create();
}

function previewCanvasFeed() {
  const config = readConfig();
  const result = readAssignments(fetchIcs(config.icalUrl), config);
  console.log(`${result.assignments.length} assignment entries pass course filtering.`);
  console.log(`Sample titles: ${result.assignments.slice(0, 5).map(item => item.title).join(' | ')}`);
}

function previewSync() {
  const config = readConfig();
  const { assignments, feedKeys } = readAssignments(fetchIcs(config.icalUrl), config);
  const calendarIds = {
    active: findCalendar(config.activeCalendarTitle, config.timeZone, false),
    completed: findCalendar(config.completedCalendarTitle, config.timeZone, false),
  };
  const taskListId = findTaskList(config.taskListTitle, false);
  const events = listCalendarEvents(calendarIds);
  const tasks = listTasks(taskListId);
  const preview = { assignments: assignments.length, createEvents: 0, moveEvents: 0,
    updateEvents: 0, createTasks: 0, updateTasks: 0, deleteEvents: 0, deleteTasks: 0 };
  for (const assignment of assignments) {
    const eventEntry = matchingEntry(events.byKey, assignment);
    const taskEntry = matchingEntry(tasks.byKey, assignment);
    if (!taskEntry) preview.createTasks++;
    else {
      const task = taskEntry.task;
      if (task.title !== assignment.title || (task.due || '').slice(0, 10) !== assignment.due.day) {
        preview.updateTasks++;
      }
    }
    const targetStatus = taskEntry ? (taskEntry.task.status === 'completed' ? 'completed' : 'active')
      : (eventEntry && eventEntry.status === 'completed' ? 'completed' : 'active');
    if (!eventEntry) preview.createEvents++;
    else {
      if (eventEntry.status !== targetStatus) preview.moveEvents++;
      if (!eventMatches(eventEntry.event, eventBody(assignment, config))) preview.updateEvents++;
    }
  }
  preview.deleteEvents = events.managed.filter(entry => [...entry.keys].every(key => !feedKeys.has(key))).length;
  preview.deleteTasks = tasks.managed.filter(entry => [...entry.keys].every(key => !feedKeys.has(key))).length;
  console.log(JSON.stringify({ calendarsFound: calendarIds, taskListFound: !!taskListId, ...preview }));
  return preview;
}

function syncCanvas() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(0)) return;
  try {
    const config = readConfig();
    // Read and validate the feed before making any Google changes.
    const { assignments, feedKeys } = readAssignments(fetchIcs(config.icalUrl), config);
    const calendarIds = {
      active: findCalendar(config.activeCalendarTitle, config.timeZone),
      completed: findCalendar(config.completedCalendarTitle, config.timeZone),
    };
    const taskListId = findTaskList(config.taskListTitle);
    const events = listCalendarEvents(calendarIds);
    const tasks = listTasks(taskListId);
    const writeTask = taskWriter();
    const counts = { createdEvents: 0, movedEvents: 0, updatedEvents: 0, createdTasks: 0,
      updatedTasks: 0, deletedEvents: 0, deletedTasks: 0 };

    for (const assignment of assignments) {
      let eventEntry = matchingEntry(events.byKey, assignment);
      let taskEntry = matchingEntry(tasks.byKey, assignment);
      if (!taskEntry) {
        const completed = !!eventEntry && eventEntry.status === 'completed';
        let task = writeTask(() => Tasks.Tasks.insert(taskBody(assignment, config, completed), taskListId));
        if (completed && task.status !== 'completed') {
          task = writeTask(() => Tasks.Tasks.patch({ status: 'completed', completed: new Date().toISOString() }, taskListId, task.id));
          if (task.status !== 'completed') throw new Error(`Could not preserve completed state for task ${task.id}.`);
        }
        taskEntry = { task };
        tasks.byKey.set(assignment.key, taskEntry);
        tasks.byKey.set(`uid:${assignment.uid}`, taskEntry);
        counts.createdTasks++;
      } else {
        const desiredTask = taskBody(assignment, config, false);
        const task = taskEntry.task;
        if (task.title !== desiredTask.title || (task.due || '').slice(0, 10) !== assignment.due.day) {
          writeTask(() => Tasks.Tasks.patch({ title: desiredTask.title, due: desiredTask.due }, taskListId, task.id));
          counts.updatedTasks++;
        }
      }

      const targetStatus = taskEntry.task.status === 'completed' ? 'completed' : 'active';
      const targetCalendarId = calendarIds[targetStatus];
      const desiredEvent = eventBody(assignment, config);
      if (!eventEntry) {
        const event = Calendar.Events.insert(desiredEvent, targetCalendarId);
        eventEntry = { event, calendarId: targetCalendarId, status: targetStatus };
        events.byKey.set(assignment.key, eventEntry);
        events.byKey.set(`uid:${assignment.uid}`, eventEntry);
        counts.createdEvents++;
      } else {
        let event = eventEntry.event;
        if (eventEntry.calendarId !== targetCalendarId) {
          event = Calendar.Events.move(eventEntry.calendarId, event.id, targetCalendarId);
          eventEntry.event = event;
          eventEntry.calendarId = targetCalendarId;
          eventEntry.status = targetStatus;
          counts.movedEvents++;
        }
        if (!eventMatches(event, desiredEvent)) {
          Calendar.Events.patch(desiredEvent, targetCalendarId, event.id);
          counts.updatedEvents++;
        }
      }
    }

    for (const entry of events.managed) {
      if ([...entry.keys].every(key => !feedKeys.has(key))) {
        Calendar.Events.remove(entry.calendarId, entry.event.id);
        counts.deletedEvents++;
      }
    }
    for (const entry of tasks.managed) {
      if ([...entry.keys].every(key => !feedKeys.has(key))) {
        writeTask(() => Tasks.Tasks.remove(taskListId, entry.task.id));
        counts.deletedTasks++;
      }
    }
    console.log(JSON.stringify(counts));
  } finally {
    lock.releaseLock();
  }
}
