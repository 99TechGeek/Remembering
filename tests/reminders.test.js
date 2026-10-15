import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defaultRemindAt, syncReminder, dueReminders, nextReminder, badgeCount, buildICS, formatRemindAt } from '../js/reminders.js';

const at = (y, mo, d, h = 0, mi = 0) => new Date(y, mo - 1, d, h, mi).getTime();

test('default reminder times', () => {
  assert.equal(defaultRemindAt({ type: 'task', due: '2026-10-16', time: '18:00' }), at(2026, 10, 16, 18));
  assert.equal(defaultRemindAt({ type: 'task', due: '2026-10-16', time: null }), at(2026, 10, 16, 9));
  assert.equal(defaultRemindAt({ type: 'event', due: '2026-10-19', time: '10:00' }), at(2026, 10, 19, 9, 30));
  assert.equal(defaultRemindAt({ type: 'note', due: '2026-10-16' }), null);
  assert.equal(defaultRemindAt({ type: 'task', due: null }), null);
});

test('sync follows the date unless set by hand', () => {
  const n = { type: 'task', due: '2026-10-16', time: '18:00' };
  assert.equal(syncReminder(n), true);
  assert.equal(n.remindAt, at(2026, 10, 16, 18));
  n.time = '07:00';
  syncReminder(n);
  assert.equal(n.remindAt, at(2026, 10, 16, 7));
  n.remindManual = true;
  n.time = '20:00';
  assert.equal(syncReminder(n), false);
  assert.equal(n.remindAt, at(2026, 10, 16, 7));
});

test('due and next reminders skip done and already-fired ones', () => {
  const now = at(2026, 10, 16, 12);
  const notes = [
    { id: 'a', remindAt: at(2026, 10, 16, 9) },
    { id: 'b', remindAt: at(2026, 10, 16, 10), done: true },
    { id: 'c', remindAt: at(2026, 10, 16, 11), reminded: true },
    { id: 'd', remindAt: at(2026, 10, 16, 15) },
    { id: 'e', remindAt: at(2026, 10, 16, 13) },
  ];
  assert.deepEqual(dueReminders(notes, now).map((n) => n.id), ['a']);
  assert.equal(nextReminder(notes, now).id, 'e');
});

test('badge counts open tasks due today or earlier', () => {
  const notes = [
    { type: 'task', due: '2026-10-15' }, { type: 'task', due: '2026-10-16' },
    { type: 'task', due: '2026-10-17' }, { type: 'task', due: '2026-10-14', done: true }, { type: 'event', due: '2026-10-16' },
  ];
  assert.equal(badgeCount(notes, '2026-10-16'), 2);
});

test('calendar file has the event and an alert', () => {
  const ics = buildICS({ id: 'x1', type: 'event', title: 'Dentist, Dr. Lee', text: 'Dentist appointment', due: '2026-10-19', time: '10:00', remindAt: at(2026, 10, 19, 9, 30) },
    { now: new Date(Date.UTC(2026, 9, 15)) });
  assert.match(ics, /DTSTART:20261019T100000\r\n/);
  assert.match(ics, /SUMMARY:Dentist\\, Dr. Lee\r\n/);
  assert.match(ics, /BEGIN:VALARM\r\nACTION:DISPLAY\r\nDESCRIPTION:[^\r]*\r\nTRIGGER:-PT30M\r\n/);
});

test('reminder labels', () => {
  const now = new Date(2026, 9, 15, 8);
  assert.equal(formatRemindAt(at(2026, 10, 15, 18), now), 'Today 18:00');
  assert.equal(formatRemindAt(at(2026, 10, 16, 9), now), 'Tomorrow 09:00');
});
