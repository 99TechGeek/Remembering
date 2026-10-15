// Turns a raw spoken/typed note into a structured, filed note.
// Rule-based so it works offline with no account; js/ai.js can refine it.

import { parseDate, parseBirthday } from './dates.js';

export const TYPES = ['task', 'person', 'event', 'idea', 'note'];

export const TYPE_LABELS = {
  task: 'Task',
  person: 'Person',
  event: 'Event',
  idea: 'Idea',
  note: 'Note',
};

// Leading phrases that mark a to-do. Order matters: longest first.
const TASK_PREFIXES = [
  "i really need to", "i really have to", "don't forget to", "dont forget to", "do not forget to",
  "remember to", "remind me to", "make sure to", "make sure i", "i need to", "i have to", "i've got to",
  "i must", "i should", "i gotta", "need to", "have to", "got to", "gotta", "must",
  "todo", "to do", "to-do", "task",
];
const TASK_VERBS = [
  'call', 'email', 'mail', 'text', 'message', 'buy', 'pay', 'send', 'book', 'pick up', 'drop off',
  'finish', 'submit', 'schedule', 'order', 'fix', 'clean', 'renew', 'return', 'reply', 'write',
  'prepare', 'review', 'check', 'cancel', 'collect', 'get', 'go to', 'visit', 'ask', 'tell', 'follow up',
  'update', 'file', 'print', 'sign', 'water', 'wash', 'take',
];
const EVENT_WORDS = /\b(meeting|appointment|interview|call with|dinner with|lunch with|party|wedding|flight|conference|deadline|doctor|dentist|class|exam|concert|match|reservation)\b/;
const IDEA_WORDS = /\b(idea|what if|maybe i could|maybe we could|it would be cool|wouldn't it be|brainstorm|concept|thought:|i could build|app that)\b/;

// Phrases that introduce a person, the name follows.
const PERSON_INTRO = [
  /\b(?:i )?(?:just )?met (?:a (?:guy|girl|woman|man|person|lady) (?:named|called) )?(?:with )?/,
  /\b(?:his|her|their) name is /,
  /\b(?:named|called) /,
  /\bthis is /,
  /\bremember (?:that )?(?=[A-Z])/,
  /\bperson:? /,
  /\bcontact:? /,
];

const NOT_NAMES = new Set([
  'a', 'an', 'the', 'my', 'his', 'her', 'their', 'our', 'your', 'this', 'that', 'him', 'them', 'someone',
  'somebody', 'today', 'tomorrow', 'yesterday', 'at', 'in', 'on', 'for', 'and', 'with', 'who', 'is', 'was',
  'he', 'she', 'they', 'it', 'i', 'me', 'up', 'to', 'from', 'office', 'work', 'again', 'there', 'here',
  'really', 'very', 'so', 'just', 'about', 'some', 'new', 'guy', 'girl', 'man', 'woman', 'person', 'lady',
  'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday',
]);

// Spoken words that map to tags.
const TAG_KEYWORDS = {
  work: /\b(office|work|boss|client|meeting|project|manager|colleague|deadline|presentation|report|jira|standup)\b/,
  home: /\b(home|house|kitchen|laundry|rent|landlord|plumber|groceries)\b/,
  health: /\b(doctor|dentist|gym|medicine|pills|workout|run|health|hospital|therapy|vitamins)\b/,
  money: /\b(pay|bill|bank|tax|taxes|invoice|salary|loan|credit card|insurance|money|refund)\b/,
  shopping: /\b(buy|order|shop|shopping|amazon|store|groceries)\b/,
  family: /\b(mom|mum|dad|mother|father|sister|brother|wife|husband|son|daughter|kids|family|grandma|grandpa|aunt|uncle|cousin)\b/,
  birthday: /\b(birthday|b-?day)\b/,
};

const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);
const titleCase = (s) => s.split(/\s+/).map((w) => cap(w.toLowerCase())).join(' ');

/** Normalise the transcript: trim, collapse spaces, sentence-case. */
export function cleanText(text) {
  return cap(String(text || '').replace(/\s+/g, ' ').trim());
}

/** Find a person's name introduced in the text. */
export function extractPersonName(text) {
  for (const intro of PERSON_INTRO) {
    const flags = intro.source.includes('[A-Z]') ? '' : 'i';
    const re = new RegExp(intro.source + "([A-Za-z][\\w'’-]*(?: [A-Za-z][\\w'’-]*){0,2})", flags);
    const m = text.match(re);
    if (!m) continue;
    const words = m[1].split(' ');
    const name = [];
    for (const w of words) {
      const bare = w.replace(/['’]s$/, '');
      if (NOT_NAMES.has(bare.toLowerCase())) break;
      // After the first word, only continue with capitalised words (surnames).
      if (name.length && !/^[A-Z]/.test(w)) break;
      name.push(bare);
      if (bare !== w) break; // possessive ends the name: "Rahul's birthday"
    }
    if (name.length) return titleCase(name.join(' '));
  }
  // "Rahul's birthday is ..." with no intro phrase
  const poss = text.match(/\b([A-Z][a-z]+(?: [A-Z][a-z]+)?)['’]s (?:birthday|b-?day|wife|husband|phone|number|email|kid|son|daughter)\b/);
  if (poss && !NOT_NAMES.has(poss[1].toLowerCase())) return poss[1];
  return null;
}

/** Capitalised words that look like names of people the note mentions. */
export function extractMentions(text, knownPeople = []) {
  const found = new Set();
  const lower = text.toLowerCase();
  for (const p of knownPeople) {
    const first = p.toLowerCase().split(' ')[0];
    if (new RegExp(`\\b${escapeRe(p.toLowerCase())}\\b`).test(lower) ||
        (first.length > 2 && new RegExp(`\\b${escapeRe(first)}\\b`).test(lower))) {
      found.add(p);
    }
  }
  return [...found];
}

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function extractTags(text) {
  const tags = new Set();
  const lower = text.toLowerCase();
  for (const m of lower.matchAll(/#([\w-]+)/g)) tags.add(m[1]);
  for (const m of lower.matchAll(/\bhashtag ([\w-]+)/g)) tags.add(m[1]);
  for (const m of lower.matchAll(/\btag(?:ged)? (?:it |this )?(?:as |with )?([\w-]+)/g)) {
    if (!['as', 'with', 'it', 'this'].includes(m[1])) tags.add(m[1]);
  }
  for (const [tag, re] of Object.entries(TAG_KEYWORDS)) if (re.test(lower)) tags.add(tag);
  return [...tags];
}

function stripTaskPrefix(text) {
  let t = text.replace(/^(?:ok(?:ay)?|so|um+|uh+|hey|oh|note|reminder)[,.:]?\s+/i, '');
  const lower = t.toLowerCase();
  for (const p of TASK_PREFIXES) {
    if (lower.startsWith(p + ' ') || lower.startsWith(p + ':') || lower.startsWith(p + ',')) {
      t = t.slice(p.length).replace(/^[\s:,]+/, '');
      break;
    }
  }
  return t;
}

function isTask(lower) {
  const stripped = lower.replace(/^(?:ok(?:ay)?|so|um+|uh+|hey|oh|note|reminder)[,.:]?\s+/, '');
  if (TASK_PREFIXES.some((p) => new RegExp(`(^|\\b)${escapeRe(p)}\\b`).test(stripped.slice(0, 40)))) return true;
  return TASK_VERBS.some((v) => stripped.startsWith(v + ' '));
}

function makeTitle(text, type) {
  let t = type === 'task' ? stripTaskPrefix(text) : text;
  t = t.replace(/#[\w-]+/g, '').replace(/\bhashtag [\w-]+/gi, '').replace(/\s+/g, ' ').trim();
  // First sentence, max ~60 chars, cut on a word boundary.
  t = t.split(/(?<=[.!?])\s/)[0].replace(/[.!?,;:]+$/, '');
  if (t.length > 60) t = t.slice(0, 60).replace(/\s+\S*$/, '') + '…';
  return cap(t);
}

/**
 * Organise one note.
 * @param {string} rawText    the transcript
 * @param {object} opts       { now: Date, knownPeople: string[] }
 * @returns structured fields to merge into the stored note
 */
export function organize(rawText, { now = new Date(), knownPeople = [] } = {}) {
  const text = cleanText(rawText);
  const lower = text.toLowerCase();

  const birthday = parseBirthday(text);
  const personName = extractPersonName(text);
  const date = parseDate(text, now);

  let type = 'note';
  if (personName && (birthday || /\b(met|name is|named|called|this is|works (?:at|as|for)|lives in|married|phone|number|email)\b/i.test(text))) {
    type = 'person';
  } else if (isTask(lower)) {
    type = 'task';
  } else if (EVENT_WORDS.test(lower) && date) {
    type = 'event';
  } else if (IDEA_WORDS.test(lower)) {
    type = 'idea';
  } else if (date && /\b(remind|reminder|due|by)\b/.test(lower)) {
    type = 'task';
  }

  const people = new Set(extractMentions(text, knownPeople));
  if (personName) people.add(personName);

  const note = {
    text,
    type,
    title: makeTitle(text, type),
    tags: extractTags(text),
    people: [...people],
    due: null,
    time: null,
    person: null,
  };

  if (type === 'person') {
    note.person = { name: personName, birthday };
    note.title = personName;
  } else if (date && (type === 'task' || type === 'event' || type === 'note')) {
    note.due = date.date;
    note.time = date.time;
  }
  // A plain note that names a date ("dinner at mom's on Sunday") is an event.
  if (type === 'note' && note.due) note.type = 'event';
  // A non-person note can still teach us a known person's birthday.
  if (type !== 'person' && birthday && personName) note.person = { name: personName, birthday };
  return note;
}
