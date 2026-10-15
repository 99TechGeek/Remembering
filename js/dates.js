// Natural-language date helpers. Pure functions: everything takes `now`
// so the same code runs in the browser and under `node --test`.

export const MONTHS = [
  'january', 'february', 'march', 'april', 'may', 'june',
  'july', 'august', 'september', 'october', 'november', 'december',
];
const MONTH_RE = '(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)';
const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const WEEKDAY_RE = '(sun(?:day)?|mon(?:day)?|tue(?:s(?:day)?)?|wed(?:nesday)?|thu(?:r(?:s(?:day)?)?)?|fri(?:day)?|sat(?:urday)?)';
const NUM_WORDS = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };

const pad = (n) => String(n).padStart(2, '0');

export function toISODate(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function fromISODate(s) {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function addDays(d, n) {
  const r = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  r.setDate(r.getDate() + n);
  return r;
}

export function monthIndex(word) {
  const w = word.toLowerCase().slice(0, 3);
  return MONTHS.findIndex((m) => m.startsWith(w));
}

function weekdayIndex(word) {
  const w = word.toLowerCase().slice(0, 3);
  return WEEKDAYS.findIndex((d) => d.startsWith(w));
}

// Next occurrence of month/day on or after today.
function nextMonthDay(now, month, day) {
  const today = addDays(now, 0);
  let d = new Date(now.getFullYear(), month, day);
  if (d < today) d = new Date(now.getFullYear() + 1, month, day);
  return d;
}

/**
 * Find the first date mentioned in `text`.
 * Returns { date: 'YYYY-MM-DD', time: 'HH:MM' | null, match: string } or null.
 */
export function parseDate(text, now = new Date()) {
  const t = text.toLowerCase();
  let found = null;
  const take = (date, match) => {
    if (!found) found = { date: toISODate(date), match };
  };

  let m;
  if ((m = t.match(/\b(\d{4})-(\d{2})-(\d{2})\b/))) {
    take(new Date(+m[1], +m[2] - 1, +m[3]), m[0]);
  }
  if (!found && (m = t.match(/\bday after tomorrow\b/))) take(addDays(now, 2), m[0]);
  if (!found && (m = t.match(/\btomorrow\b/))) take(addDays(now, 1), m[0]);
  if (!found && (m = t.match(/\b(today|tonight|this (?:morning|afternoon|evening))\b/))) take(addDays(now, 0), m[0]);
  if (!found && (m = t.match(/\bin (\d+|a|an|one|two|three|four|five|six|seven|eight|nine|ten) (day|week|month)s?\b/))) {
    const n = NUM_WORDS[m[1]] ?? Number(m[1]);
    if (m[2] === 'day') take(addDays(now, n), m[0]);
    else if (m[2] === 'week') take(addDays(now, 7 * n), m[0]);
    else take(new Date(now.getFullYear(), now.getMonth() + n, now.getDate()), m[0]);
  }
  if (!found && (m = t.match(/\bnext week\b/))) take(addDays(now, 7), m[0]);
  if (!found && (m = t.match(/\bnext month\b/))) take(new Date(now.getFullYear(), now.getMonth() + 1, 1), m[0]);
  if (!found && (m = t.match(new RegExp(`\\b${MONTH_RE}\\.? (\\d{1,2})(?:st|nd|rd|th)?(?:,? (\\d{4}))?\\b`)))) {
    const month = monthIndex(m[1]);
    const day = +m[2];
    if (day >= 1 && day <= 31) take(m[3] ? new Date(+m[3], month, day) : nextMonthDay(now, month, day), m[0]);
  }
  if (!found && (m = t.match(new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)? (?:of )?${MONTH_RE}\\b(?:,? (\\d{4}))?`)))) {
    const month = monthIndex(m[2]);
    const day = +m[1];
    if (day >= 1 && day <= 31) take(m[3] ? new Date(+m[3], month, day) : nextMonthDay(now, month, day), m[0]);
  }
  if (!found && (m = t.match(new RegExp(`\\b(?:(next|this|on|by|coming) )?${WEEKDAY_RE}\\b`)))) {
    const target = weekdayIndex(m[2]);
    let diff = (target - now.getDay() + 7) % 7;
    if (diff === 0) diff = 7; // "Monday" said on a Monday means next Monday
    // "next friday" said on a tuesday usually means the friday of next week
    if (m[1] === 'next' && target > now.getDay()) diff += 7;
    take(addDays(now, diff), m[0]);
  }
  if (!found) return null;

  found.time = parseTime(t);
  return found;
}

/** "at 5", "at 5pm", "at 5:30 pm", "17:30", "noon" -> "HH:MM" or null */
export function parseTime(text) {
  const t = text.toLowerCase();
  if (/\bnoon\b/.test(t)) return '12:00';
  if (/\bmidnight\b/.test(t)) return '00:00';
  let m = t.match(/\b(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)/);
  if (!m) m = t.match(/\bat (\d{1,2})(?::(\d{2}))?\b(?!\s*(?:st|nd|rd|th|days?|weeks?|%))/);
  if (!m) m = t.match(/\b(\d{1,2}):(\d{2})\b/);
  if (!m) return null;
  let h = +m[1];
  const min = m[2] ? +m[2] : 0;
  const ampm = m[3] ? m[3][0] : null;
  if (ampm === 'p' && h < 12) h += 12;
  if (ampm === 'a' && h === 12) h = 0;
  if (!ampm && h >= 1 && h <= 7 && !m[2]) h += 12; // "at 5" almost always means 5pm
  if (h > 23 || min > 59) return null;
  return `${pad(h)}:${pad(min)}`;
}

/**
 * Birthday as 'MM-DD' (year-less, it repeats). Looks for a date near the
 * words birthday / bday / born.
 */
export function parseBirthday(text) {
  const t = text.toLowerCase();
  const idx = t.search(/\b(birthday|b-?day|born)\b/);
  if (idx === -1) return null;
  const tail = t.slice(idx, idx + 60);
  let m = tail.match(new RegExp(`${MONTH_RE}\\.? (\\d{1,2})(?:st|nd|rd|th)?`));
  if (m) return `${pad(monthIndex(m[1]) + 1)}-${pad(+m[2])}`;
  m = tail.match(new RegExp(`(\\d{1,2})(?:st|nd|rd|th)? (?:of )?${MONTH_RE}`));
  if (m) return `${pad(monthIndex(m[2]) + 1)}-${pad(+m[1])}`;
  return null;
}

/** Days until the next occurrence of an 'MM-DD' birthday (0 = today). */
export function daysUntilBirthday(mmdd, now = new Date()) {
  const [mm, dd] = mmdd.split('-').map(Number);
  const today = addDays(now, 0);
  const next = nextMonthDay(now, mm - 1, dd);
  return Math.round((next - today) / 86400000);
}

export function formatMonthDay(mmdd) {
  const [mm, dd] = mmdd.split('-').map(Number);
  const name = MONTHS[mm - 1];
  return `${name[0].toUpperCase()}${name.slice(1)} ${dd}`;
}

/** Human label for a due date: Today, Tomorrow, Overdue, Fri 18 Oct... */
export function relativeLabel(iso, now = new Date()) {
  const diff = Math.round((fromISODate(iso) - addDays(now, 0)) / 86400000);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Tomorrow';
  if (diff === -1) return 'Yesterday';
  if (diff < 0) return `${-diff} days ago`;
  const d = fromISODate(iso);
  const opts = { weekday: 'short', day: 'numeric', month: 'short' };
  if (d.getFullYear() !== now.getFullYear()) opts.year = 'numeric';
  return d.toLocaleDateString(undefined, opts);
}
