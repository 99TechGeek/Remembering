import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseDate, parseTime, parseBirthday, daysUntilBirthday } from '../js/dates.js';

const now = new Date(2026, 9, 15); // Thursday 15 Oct 2026
const d = (text) => parseDate(text, now)?.date ?? null;

test('relative days', () => {
  assert.equal(d('do it today'), '2026-10-15');
  assert.equal(d('tomorrow morning'), '2026-10-16');
  assert.equal(d('the day after tomorrow'), '2026-10-17');
  assert.equal(d('in 3 days'), '2026-10-18');
  assert.equal(d('in two weeks'), '2026-10-29');
});

test('weekdays', () => {
  assert.equal(d('on monday'), '2026-10-19');
  assert.equal(d('by friday'), '2026-10-16');
  assert.equal(d('next friday'), '2026-10-23');
  assert.equal(d('thursday'), '2026-10-22'); // same weekday -> next week
});

test('month names, both orders, roll into next year', () => {
  assert.equal(d('on March 5th'), '2027-03-05');
  assert.equal(d('the 20th of October'), '2026-10-20');
  assert.equal(d('Dec 1, 2027'), '2027-12-01');
  assert.equal(d('2026-11-02'), '2026-11-02');
});

test('no date', () => {
  assert.equal(d('the key is under the pot'), null);
  assert.equal(d('I may go'), null);
});

test('times', () => {
  assert.equal(parseTime('at 5'), '17:00');
  assert.equal(parseTime('at 9am'), '09:00');
  assert.equal(parseTime('5:30 pm'), '17:30');
  assert.equal(parseTime('at noon'), '12:00');
  assert.equal(parseTime('12 am'), '00:00');
  assert.equal(parseTime('in 3 days'), null);
});

test('birthdays', () => {
  assert.equal(parseBirthday('his birthday is 5th March'), '03-05');
  assert.equal(parseBirthday('born on july 4'), '07-04');
  assert.equal(parseBirthday('no dates here'), null);
  assert.equal(daysUntilBirthday('10-15', now), 0);
  assert.equal(daysUntilBirthday('10-20', now), 5);
  assert.equal(daysUntilBirthday('10-14', now), 364);
});
