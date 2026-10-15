import { test } from 'node:test';
import assert from 'node:assert/strict';
import { organize, extractPersonName, extractTags } from '../js/organizer.js';

const now = new Date(2026, 9, 15); // Thursday 15 Oct 2026

test('tasks are detected and titled without the lead-in', () => {
  const n = organize('I have to call mom tomorrow at 6', { now });
  assert.equal(n.type, 'task');
  assert.equal(n.title, 'Call mom tomorrow at 6');
  assert.equal(n.due, '2026-10-16');
  assert.equal(n.time, '18:00');
  assert.ok(n.tags.includes('family'));
});

test('remind me / don\'t forget phrasing', () => {
  assert.equal(organize("Don't forget to pay the electricity bill by Friday", { now }).type, 'task');
  assert.equal(organize('Remind me to renew my passport', { now }).title, 'Renew my passport');
  assert.equal(organize('Buy milk and eggs', { now }).type, 'task');
});

test('meeting a person with a birthday becomes a person note', () => {
  const n = organize('I met Rahul Verma at the conference, he works at Google, his birthday is 5th March', { now });
  assert.equal(n.type, 'person');
  assert.deepEqual(n.person, { name: 'Rahul Verma', birthday: '03-05' });
  assert.equal(n.title, 'Rahul Verma');
  assert.ok(n.people.includes('Rahul Verma'));
});

test('person names from various phrasings', () => {
  assert.equal(extractPersonName('met a guy named john at the gym'), 'John');
  assert.equal(extractPersonName("Priya's birthday is June 12"), 'Priya');
  assert.equal(extractPersonName('Her name is Ana Lucia and she is a designer'), 'Ana Lucia');
  assert.equal(extractPersonName('I met with the team today'), null);
});

test('birthday statement without "met" is still a person', () => {
  const n = organize("Sarah's birthday is on December 2nd", { now });
  assert.equal(n.type, 'person');
  assert.equal(n.person.birthday, '12-02');
});

test('events need a date', () => {
  const n = organize('Dentist appointment on Monday at 10am', { now });
  assert.equal(n.type, 'event');
  assert.equal(n.due, '2026-10-19');
  assert.equal(n.time, '10:00');
  assert.ok(n.tags.includes('health'));
});

test('ideas', () => {
  assert.equal(organize('Idea: an app that reminds me to water the plants', { now }).type, 'idea');
  assert.equal(organize('What if we did the team offsite in Goa', { now }).type, 'idea');
});

test('plain notes', () => {
  const n = organize('The spare house key is under the blue flower pot', { now });
  assert.equal(n.type, 'note');
  assert.equal(n.due, null);
});

test('spoken and written hashtags', () => {
  assert.deepEqual(extractTags('book flights #travel hashtag goa').filter((t) => ['travel', 'goa'].includes(t)).sort(), ['goa', 'travel']);
});

test('known people are linked when mentioned', () => {
  const n = organize('Need to send Rahul the slides', { now, knownPeople: ['Rahul Verma'] });
  assert.equal(n.type, 'task');
  assert.deepEqual(n.people, ['Rahul Verma']);
});

test('sanitizeNote rejects or cleans anything malformed', async () => {
  const { sanitizeNote } = await import('../js/organizer.js');
  assert.equal(sanitizeNote({ id: 'x" onclick="evil()', text: 'hi' }), null);
  assert.equal(sanitizeNote({ id: 'a1', text: '' }), null);
  const n = sanitizeNote({
    id: 'a1', text: 'Note', type: 'task"><script>', due: '2026-13-40', time: '25:00',
    tags: ['#Work', '<b>', 5], person: { name: 'Bob', birthday: 'soon' }, extra: 'dropped',
  });
  assert.equal(n.type, 'note');
  assert.equal(n.due, null);
  assert.equal(n.time, null);
  assert.deepEqual(n.tags, ['work', 'b']);
  assert.deepEqual(n.person, { name: 'Bob', birthday: null });
  assert.equal('extra' in n, false);
  assert.equal(sanitizeNote({ text: 'no id' }, { makeId: () => 'new-id' }).id, 'new-id');
});
