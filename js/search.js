// Local full-text search over notes. Pure functions, no DOM.

const STOP = new Set([
  'a', 'an', 'the', 'is', 'are', 'was', 'were', 'of', 'to', 'in', 'on', 'for', 'and', 'or', 'at', 'by',
  'what', 'whats', "what's", 'when', 'whens', 'where', 'who', 'whos', 'how', 'did', 'do', 'does', 'i', 'my',
  'me', 'about', 'with', 'that', 'this', 'it', 'its', 'tell', 'show', 'find', 'any', 'all', 'have', 'has',
  'there', 'which', 'remember', 'notes', 'note',
]);

/** Very light stemmer: good enough for "calls"/"calling"/"called" -> "call". */
export function stem(w) {
  if (w.length > 5 && w.endsWith('ing')) return w.slice(0, -3);
  if (w.length > 4 && w.endsWith('ed')) return w.slice(0, -2);
  if (w.length > 4 && w.endsWith('ies')) return w.slice(0, -3) + 'y';
  if (w.length > 3 && w.endsWith('s') && !w.endsWith('ss')) return w.slice(0, -1);
  return w;
}

export function tokenize(text, { keepStop = false } = {}) {
  return String(text || '')
    .toLowerCase()
    .replace(/['’]s\b/g, '')
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w && (keepStop || !STOP.has(w)))
    .map(stem);
}

function fieldTokens(note) {
  return {
    title: tokenize(note.title),
    people: tokenize([...(note.people || []), note.person?.name].filter(Boolean).join(' ')),
    tags: tokenize([...(note.tags || []), note.type].join(' ')),
    text: tokenize(note.text),
  };
}

const WEIGHTS = { title: 3, people: 4, tags: 2, text: 1 };

/**
 * Rank notes against a free-text query.
 * Returns [{ note, score }] best first; notes with no match are dropped.
 */
export function search(notes, query, { limit = 50 } = {}) {
  const q = tokenize(query);
  if (!q.length) return [];
  const results = [];
  for (const note of notes) {
    const f = fieldTokens(note);
    let score = 0;
    let matchedTerms = 0;
    for (const term of q) {
      let best = 0;
      for (const [field, toks] of Object.entries(f)) {
        for (const tok of toks) {
          let s = 0;
          if (tok === term) s = 1;
          else if (term.length >= 3 && tok.startsWith(term)) s = 0.7;
          else if (term.length >= 4 && tok.includes(term)) s = 0.4;
          if (s) best = Math.max(best, s * WEIGHTS[field]);
        }
      }
      if (best) matchedTerms++;
      score += best;
    }
    if (!matchedTerms) continue;
    // Prefer notes matching every term; small boost for recency and open tasks.
    score *= matchedTerms / q.length;
    if (matchedTerms === q.length) score *= 1.5;
    if (note.type === 'task' && !note.done) score *= 1.05;
    results.push({ note, score });
  }
  results.sort((a, b) => b.score - a.score || (b.note.createdAt || 0) - (a.note.createdAt || 0));
  return results.slice(0, limit);
}

/** Wrap matching words in <mark>, escaping HTML. */
export function highlight(text, query) {
  const esc = escapeHtml(text);
  const terms = tokenize(query).filter((t) => t.length >= 2);
  if (!terms.length) return esc;
  const re = new RegExp(`\\b(${terms.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})[\\p{L}\\p{N}]*`, 'giu');
  return esc.replace(re, '<mark>$&</mark>');
}

export function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
