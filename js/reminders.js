// Reminder logic. Pure functions (no DOM), so they're unit-tested.
//
// A note can carry `remindAt` (ms timestamp) and `reminded` (already fired).
// Tasks and events with a date get a reminder automatically:
//   - task with a time    -> at that time
//   - event with a time   -> 30 minutes before
//   - date but no time    -> 9:00 that morning

import { fromISODate } from './dates.js';

export const DEFAULT_HOUR = 9;
export const EVENT_LEAD_MIN = 30;

/** The reminder time a note should get by default, or null. */
export function defaultRemindAt(note) {
  if (!note.due || (note.type !== 'task' && note.type !== 'event')) return null;
  const d = fromISODate(note.due);
  if (note.time) {
    const [h, m] = note.time.split(':').map(Number);
    d.setHours(h, m, 0, 0);
    if (note.type === 'event') d.setMinutes(d.getMinutes() - EVENT_LEAD_MIN);
  } else {
    d.setHours(DEFAULT_HOUR, 0, 0, 0);
  }
  return d.getTime();
}

/**
 * Keep a note's reminder in sync with its date, unless the user picked a
 * reminder time by hand. Returns true if anything changed.
 */
export function syncReminder(note) {
  if (note.remindManual) return false;
  const want = note.done ? null : defaultRemindAt(note);
  if (want === (note.remindAt ?? null)) return false;
  note.remindAt = want;
  note.reminded = false;
  return true;
}

/** Reminders that are due now and haven't fired yet. */
export function dueReminders(notes, now = Date.now()) {
  return notes
    .filter((n) => n.remindAt && !n.reminded && !n.done && n.remindAt <= now)
    .sort((a, b) => a.remindAt - b.remindAt);
}

/** The next reminder still to come, for scheduling a timer. */
export function nextReminder(notes, now = Date.now()) {
  let next = null;
  for (const n of notes) {
    if (n.remindAt && !n.reminded && !n.done && n.remindAt > now && (!next || n.remindAt < next.remindAt)) next = n;
  }
  return next;
}

/** Count for the home-screen icon badge: open tasks due today or earlier. */
export function badgeCount(notes, todayISO) {
  return notes.filter((n) => n.type === 'task' && !n.done && n.due && n.due <= todayISO).length;
}

const pad = (n) => String(n).padStart(2, '0');
const icsLocal = (d) =>
  `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}T${pad(d.getHours())}${pad(d.getMinutes())}00`;
const icsUTC = (d) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
const icsEscape = (s) => String(s).replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/([,;])/g, '\\$1');

/**
 * A calendar file with an alert. Adding it to the iPhone Calendar gives a
 * notification even when this app is closed.
 */
export function buildICS(note, { now = new Date(), appUrl = '' } = {}) {
  const at = new Date(note.remindAt || defaultRemindAt(note) || now);
  const start = note.due && note.time ? (() => {
    const d = fromISODate(note.due);
    const [h, m] = note.time.split(':').map(Number);
    d.setHours(h, m, 0, 0);
    return d;
  })() : at;
  const end = new Date(start.getTime() + 30 * 60000);
  const leadMin = Math.max(0, Math.round((start - at) / 60000));
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Remembering//EN',
    'CALSCALE:GREGORIAN',
    'BEGIN:VEVENT',
    `UID:${note.id}@remembering`,
    `DTSTAMP:${icsUTC(now)}`,
    `DTSTART:${icsLocal(start)}`,
    `DTEND:${icsLocal(end)}`,
    `SUMMARY:${icsEscape(note.title)}`,
    `DESCRIPTION:${icsEscape(note.text + (appUrl ? `\n\n${appUrl}` : ''))}`,
    'BEGIN:VALARM',
    'ACTION:DISPLAY',
    `DESCRIPTION:${icsEscape(note.title)}`,
    `TRIGGER:-PT${leadMin}M`,
    'END:VALARM',
    'END:VEVENT',
    'END:VCALENDAR',
  ];
  return lines.join('\r\n') + '\r\n';
}

/** "Today 18:00", "Tomorrow 09:00", "Mon 19 Oct 09:30" */
export function formatRemindAt(ts, now = new Date()) {
  const d = new Date(ts);
  const time = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  const day = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((day(d) - day(now)) / 86400000);
  if (diff === 0) return `Today ${time}`;
  if (diff === 1) return `Tomorrow ${time}`;
  return `${d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })} ${time}`;
}

/** ms timestamp <-> value of an <input type="datetime-local"> */
export const toDateTimeLocal = (ts) => {
  const d = new Date(ts);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
export const fromDateTimeLocal = (s) => (s ? new Date(s).getTime() : null);
