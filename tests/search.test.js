import { test } from 'node:test';
import assert from 'node:assert/strict';
import { search, highlight } from '../js/search.js';
import { buildPeople, upcomingBirthdays, tasksMarkdown, fullMarkdown } from '../js/documents.js';
import { organize } from '../js/organizer.js';

const now = new Date(2026, 9, 15);
let t = 0;
const mk = (text, extra = {}) => ({ id: String(++t), createdAt: t, ...organize(text, { now }), ...extra });
const notes = [
  mk('I met Rahul Verma at the conference, his birthday is 20th October'),
  mk('Need to send Rahul the slides', { people: ['Rahul Verma'] }),
  mk('The spare key is under the blue flower pot'),
  mk('Call the dentist tomorrow'),
  mk('Paid the electricity bill', { type: 'task', done: true }),
];

test('search ranks matching notes and stems words', () => {
  const r = search(notes, 'calling dentist');
  assert.equal(r[0].note.text, 'Call the dentist tomorrow');
  assert.equal(search(notes, 'keys')[0].note.text, 'The spare key is under the blue flower pot');
  assert.equal(search(notes, 'where is the key')[0].note.text, 'The spare key is under the blue flower pot');
  assert.deepEqual(search(notes, 'zebra'), []);
});

test('search finds person notes by name', () => {
  const r = search(notes, 'rahul');
  assert.equal(r.length, 2);
});

test('highlight escapes html', () => {
  assert.equal(highlight('<b>call</b> mom', 'call'), '&lt;b&gt;<mark>call</mark>&lt;/b&gt; mom');
});

test('people are merged across notes', () => {
  const people = buildPeople(notes);
  assert.equal(people.length, 1);
  assert.equal(people[0].name, 'Rahul Verma');
  assert.equal(people[0].birthday, '10-20');
  assert.equal(people[0].notes.length, 2);
  assert.equal(upcomingBirthdays(people, now)[0].inDays, 5);
});

test('markdown documents', () => {
  const md = tasksMarkdown(notes);
  assert.match(md, /- \[ \] Call the dentist tomorrow — due 2026-10-16/);
  assert.match(md, /- \[x\] Paid the electricity bill/);
  const full = fullMarkdown(notes, now);
  assert.match(full, /## Rahul Verma\n\n- \*\*Birthday:\*\* October 20/);
});
