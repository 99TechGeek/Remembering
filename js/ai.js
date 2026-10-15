import { toISODate } from './dates.js';

// Optional AI layer using the Claude API. Off until you paste an API key in
// Settings. The key stays in this browser's storage and is sent only to
// api.anthropic.com. Without a key the app uses the on-device rules in
// organizer.js and search.js.

// Official SDK, bundled into this repo (js/vendor) so no code is loaded from a
// third-party CDN. Only fetched once you add an API key.
const SDK_URL = './vendor/anthropic-sdk.mjs';
let clientPromise = null;
let clientKey = null;

async function getClient(apiKey) {
  if (!clientPromise || clientKey !== apiKey) {
    clientKey = apiKey;
    clientPromise = import(SDK_URL).then(({ default: Anthropic }) =>
      new Anthropic({ apiKey, dangerouslyAllowBrowser: true }));
  }
  return clientPromise;
}

const ORGANIZE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['type', 'title', 'tags', 'people', 'due', 'time', 'person_name', 'birthday'],
  properties: {
    type: { type: 'string', enum: ['task', 'person', 'event', 'idea', 'note'] },
    title: { type: 'string', description: 'Short title, max ~8 words. For tasks, an imperative ("Call mom about the trip").' },
    tags: { type: 'array', items: { type: 'string' }, description: '1-4 lowercase single-word topic tags' },
    people: { type: 'array', items: { type: 'string' }, description: 'Full names of people mentioned, title case' },
    due: { type: ['string', 'null'], description: 'YYYY-MM-DD if a date is mentioned, else null' },
    time: { type: ['string', 'null'], description: 'HH:MM 24h if a time is mentioned, else null' },
    person_name: { type: ['string', 'null'], description: 'If the note is mainly about remembering a person, their name' },
    birthday: { type: ['string', 'null'], description: "MM-DD if the note states someone's birthday, else null" },
  },
};

const ASK_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['answer', 'note_ids'],
  properties: {
    answer: { type: 'string', description: 'Direct, short answer in plain sentences. Say plainly if the notes do not contain it.' },
    note_ids: { type: 'array', items: { type: 'string' }, description: 'ids of the notes the answer relies on' },
  },
};

const ORGANIZE_SYSTEM = `You file quick voice notes for a personal "second brain" app. The notes are dictated on the go, so expect speech-to-text errors, filler words and run-on sentences.
Classify each note:
- task: something the user has to do
- person: mainly about remembering someone (who they are, where they met, birthday, family, job)
- event: something happening at a specific time (meeting, appointment, party)
- idea: an idea, plan or thought to explore later
- note: anything else worth remembering (facts, where things are, passwords hints, recommendations)
Resolve relative dates ("tomorrow", "next Friday") against the current date given in the request. Keep names as the user said them, fixing only obvious capitalisation.`;

async function call(settings, { system, content, schema, maxTokens }) {
  const client = await getClient(settings.apiKey);
  const res = await client.beta.messages.create({
    model: settings.model || 'claude-opus-5-5',
    max_tokens: maxTokens,
    system,
    messages: [{ role: 'user', content }],
    output_config: { effort: 'low', format: { type: 'json_schema', schema } },
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
  });
  if (res.stop_reason === 'refusal') throw new Error('Claude declined to process this note.');
  if (res.stop_reason === 'max_tokens') throw new Error('Claude ran out of room answering.');
  const text = res.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
  return JSON.parse(text);
}

const today = (now) =>
  `${toISODate(now)} (${now.toLocaleDateString('en-US', { weekday: 'long' })})`;

/** Ask Claude to organise one note. Returns fields shaped like organizer.organize(). */
export async function aiOrganize(settings, text, knownPeople = [], now = new Date()) {
  const out = await call(settings, {
    system: ORGANIZE_SYSTEM,
    maxTokens: 2000,
    schema: ORGANIZE_SCHEMA,
    content: `Current date: ${today(now)}
People already in the user's notes: ${knownPeople.slice(0, 200).join(', ') || '(none yet)'}

<note>
${text}
</note>`,
  });
  return {
    type: out.type,
    title: out.title,
    tags: out.tags.map((t) => t.toLowerCase().replace(/^#/, '')),
    people: out.people,
    due: out.due,
    time: out.time,
    person: out.person_name ? { name: out.person_name, birthday: out.birthday } : null,
  };
}

/**
 * Answer a question from the user's notes. `notes` should already be the
 * most relevant ones (from local search) or all notes if there are few.
 */
export async function aiAsk(settings, question, notes, now = new Date()) {
  const doc = notes.map((n) => {
    const meta = [n.type, n.due && `due ${n.due}${n.time ? ' ' + n.time : ''}`, n.done && 'done',
      n.person?.birthday && `birthday ${n.person.birthday}`].filter(Boolean).join(', ');
    return `<note id="${n.id}" saved="${new Date(n.createdAt).toISOString().slice(0, 10)}" ${meta ? `meta="${meta}"` : ''}>\n${n.text}\n</note>`;
  }).join('\n');
  return call(settings, {
    system: "You are the user's memory. Answer their question using only the notes they saved, quoting names, dates and details exactly. If the notes don't say, answer that you don't have it noted. Be brief.",
    maxTokens: 4000,
    schema: ASK_SCHEMA,
    content: `Current date: ${today(now)}\n\n<notes>\n${doc}\n</notes>\n\nQuestion: ${question}`,
  });
}
