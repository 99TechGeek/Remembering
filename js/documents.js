// Builds the "documents" view of your notes: a people directory and
// Markdown files you can download or paste anywhere. Pure functions.

import { daysUntilBirthday, formatMonthDay } from './dates.js';

const key = (name) => name.trim().toLowerCase();

/**
 * Merge every note that is about, or mentions, a person into one profile.
 * Returns [{ name, birthday, notes: [...] }] sorted by name.
 */
export function buildPeople(notes) {
  const people = new Map();
  const ensure = (name) => {
    const k = key(name);
    if (!people.has(k)) people.set(k, { name, birthday: null, notes: [] });
    return people.get(k);
  };
  // Oldest first so later notes override earlier facts (e.g. corrected birthday).
  const sorted = [...notes].sort((a, b) => a.createdAt - b.createdAt);
  for (const n of sorted) {
    if (n.person?.name) {
      const p = ensure(n.person.name);
      if (n.person.birthday) p.birthday = n.person.birthday;
      p.notes.push(n);
    }
    for (const name of n.people || []) {
      const p = ensure(name);
      if (!p.notes.includes(n)) p.notes.push(n);
    }
  }
  for (const p of people.values()) p.notes.reverse(); // newest first for display
  return [...people.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export function upcomingBirthdays(people, now = new Date(), withinDays = 30) {
  return people
    .filter((p) => p.birthday)
    .map((p) => ({ ...p, inDays: daysUntilBirthday(p.birthday, now) }))
    .filter((p) => p.inDays <= withinDays)
    .sort((a, b) => a.inDays - b.inDays);
}

const fmtDate = (ts) => new Date(ts).toISOString().slice(0, 10);
const due = (n) => (n.due ? ` — due ${n.due}${n.time ? ' ' + n.time : ''}` : '');
const tags = (n) => (n.tags?.length ? ' ' + n.tags.map((t) => '#' + t).join(' ') : '');

export function tasksMarkdown(notes) {
  const tasks = notes.filter((n) => n.type === 'task');
  const open = tasks.filter((n) => !n.done).sort(byDue);
  const done = tasks.filter((n) => n.done);
  let md = `# Tasks\n\n## Open (${open.length})\n\n`;
  md += open.map((n) => `- [ ] ${n.title}${due(n)}${tags(n)}`).join('\n') || '_Nothing open._';
  md += `\n\n## Done (${done.length})\n\n`;
  md += done.map((n) => `- [x] ${n.title}${tags(n)}`).join('\n') || '_Nothing yet._';
  return md + '\n';
}

export function peopleMarkdown(notes) {
  const people = buildPeople(notes);
  let md = '# People\n\n';
  if (!people.length) return md + '_No people yet._\n';
  for (const p of people) {
    md += `## ${p.name}\n\n`;
    if (p.birthday) md += `- **Birthday:** ${formatMonthDay(p.birthday)}\n`;
    for (const n of p.notes) md += `- ${fmtDate(n.createdAt)}: ${n.text}\n`;
    md += '\n';
  }
  return md;
}

export function typeMarkdown(notes, type, heading) {
  const list = notes.filter((n) => n.type === type).sort((a, b) => b.createdAt - a.createdAt);
  let md = `# ${heading}\n\n`;
  if (!list.length) return md + '_Nothing yet._\n';
  for (const n of list) md += `- **${fmtDate(n.createdAt)}** ${n.text}${due(n)}${tags(n)}\n`;
  return md;
}

/** One Markdown "second brain" document with every section. */
export function fullMarkdown(notes, now = new Date()) {
  return [
    `# My Second Brain\n\n_Exported ${now.toLocaleString()} · ${notes.length} notes_\n`,
    tasksMarkdown(notes),
    typeMarkdown(notes, 'event', 'Events & Plans'),
    peopleMarkdown(notes),
    typeMarkdown(notes, 'idea', 'Ideas'),
    typeMarkdown(notes, 'note', 'Notes'),
  ].join('\n---\n\n');
}

function byDue(a, b) {
  if (a.due && b.due) return a.due.localeCompare(b.due) || (a.time || '').localeCompare(b.time || '');
  if (a.due) return -1;
  if (b.due) return 1;
  return b.createdAt - a.createdAt;
}
export { byDue };
