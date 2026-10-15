import { organize, TYPE_LABELS } from './organizer.js';
import { search, highlight, escapeHtml, tokenize } from './search.js';
import { buildPeople, upcomingBirthdays, fullMarkdown, tasksMarkdown, peopleMarkdown, byDue } from './documents.js';
import { relativeLabel, toISODate, formatMonthDay } from './dates.js';
import { allNotes, putNote, deleteNote, newId, persistStorage, loadSettings, saveSettings } from './db.js';
import { speechSupported, listen } from './speech.js';
import { aiOrganize, aiAsk } from './ai.js';
import {
  syncReminder, dueReminders, nextReminder, badgeCount, buildICS, formatRemindAt, toDateTimeLocal, fromDateTimeLocal,
} from './reminders.js';

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const state = {
  notes: [],
  settings: loadSettings(),
  view: 'home',
  taskFilter: 'open',
  notesFilter: 'all',
  tagFilter: null,
  person: null, // name of the person being viewed
  recording: null,
  editing: null,
};

const aiOn = () => Boolean(state.settings.apiKey);
const today = () => toISODate(new Date());
const knownPeople = () => buildPeople(state.notes).map((p) => p.name);

// ---------- Saving & organising ----------

async function saveNote(rawText, source = 'voice') {
  const text = rawText.trim();
  if (!text) return;
  const now = Date.now();
  const note = {
    id: newId(),
    createdAt: now,
    updatedAt: now,
    source,
    done: false,
    aiOrganized: false,
    ...organize(text, { knownPeople: knownPeople() }),
  };
  syncReminder(note);
  state.notes.push(note);
  await putNote(note);
  render();
  const when = note.remindAt ? ` · ⏰ ${formatRemindAt(note.remindAt)}` : '';
  const actions = [['Edit', () => openEdit(note.id)], ['Undo', () => removeNote(note.id)]];
  if (note.remindAt && notificationState() === 'ask') actions.unshift(['Turn on reminders', enableNotifications]);
  toast(`Saved as ${TYPE_LABELS[note.type]}: “${note.title}”${when}`, actions);
  if (aiOn()) refineWithAI(note);
}

async function refineWithAI(note, { quiet = false } = {}) {
  try {
    const fields = await aiOrganize(state.settings, note.text, knownPeople().filter((p) => !note.people.includes(p)));
    const current = state.notes.find((n) => n.id === note.id);
    if (!current || current.updatedAt !== note.updatedAt) return; // edited or deleted meanwhile
    const before = current.type;
    Object.assign(current, fields, { aiOrganized: true, updatedAt: Date.now() });
    syncReminder(current);
    await putNote(current);
    render();
    if (!quiet && before !== current.type) toast(`Claude re-filed it as ${TYPE_LABELS[current.type]}`);
  } catch (err) {
    console.warn('AI organise failed', err);
    if (!quiet) toast(`Claude couldn't organise that one (${shortError(err)}). Kept the on-device filing.`);
  }
}

function shortError(err) {
  const s = String(err?.message || err);
  if (/401|authentication|api.key/i.test(s)) return 'check your API key';
  if (/Failed to fetch|NetworkError|load failed/i.test(s)) return 'offline?';
  return s.slice(0, 60);
}

async function removeNote(id) {
  state.notes = state.notes.filter((n) => n.id !== id);
  await deleteNote(id);
  render();
}

async function toggleDone(id) {
  const n = state.notes.find((x) => x.id === id);
  if (!n) return;
  n.done = !n.done;
  n.doneAt = n.done ? Date.now() : null;
  n.updatedAt = Date.now();
  if (n.done) n.reminded = true; // no reminder for finished tasks
  else if (n.remindAt && n.remindAt > Date.now()) n.reminded = false;
  await putNote(n);
  render();
  if (n.done) toast('Done ✓', [['Undo', () => toggleDone(id)]]);
}

// ---------- Voice ----------

function setMicUI(mode, target = 'note') {
  const mic = $('#mic');
  mic.classList.toggle('recording', mode === 'recording');
  mic.classList.toggle('busy', mode === 'saving');
  mic.setAttribute('aria-label', mode === 'recording' ? 'Stop recording' : 'Start recording a note');
  $('#search-mic').classList.toggle('active', mode === 'recording' && target === 'search');
  const showLive = mode !== 'idle' && target === 'note';
  $('#live').hidden = !showLive;
  $('#capture-hint').hidden = showLive;
}

function startRecording(target = 'note') {
  if (!speechSupported) {
    toast('Voice input isn’t supported here. Tap the text box and use the keyboard’s mic instead.');
    $('#type-input').focus();
    return;
  }
  if (state.recording) return stopRecording();
  if (target === 'note' && state.view !== 'home') show('home');
  $('#live-final').textContent = '';
  $('#live-interim').textContent = 'Listening…';
  setMicUI('recording', target);

  try {
    state.recording = listen({
      lang: state.settings.lang,
      onText(text, interim) {
        if (target === 'search') {
          $('#search-input').value = `${text} ${interim}`.trim();
          runLocalSearch();
        } else {
          $('#live-final').textContent = text;
          $('#live-interim').textContent = interim;
        }
      },
      onEnd(text) {
        state.recording = null;
        setMicUI('idle');
        if (target === 'search') {
          if (text) { $('#search-input').value = text; runSearch(true); }
        } else if (text) {
          saveNote(text, 'voice');
        } else {
          toast('Didn’t catch anything. Try again, or type it instead.');
        }
      },
      onError(msg) { toast(msg); },
    });
  } catch (err) {
    state.recording = null;
    setMicUI('idle');
    toast(`Couldn’t start the microphone (${shortError(err)}). Tap the text box and use the keyboard’s mic instead.`);
  }
}

function stopRecording() {
  if (!state.recording) return;
  // Show it stopped straight away; the transcript is saved a moment later.
  setMicUI('saving');
  $('#live-interim').textContent = 'Saving…';
  state.recording.stop();
}

// ---------- Rendering ----------

const CHECK = '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M9 16.2 4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4L9 16.2Z"/></svg>';

function dueHtml(n) {
  if (!n.due) return '';
  const overdue = n.type === 'task' && !n.done && n.due < today();
  return `<span class="due${overdue ? ' overdue' : ''}">📅 ${escapeHtml(relativeLabel(n.due))}${n.time ? ' · ' + n.time : ''}</span>`;
}

function noteItem(n, { query = '', showType = true } = {}) {
  const isTask = n.type === 'task';
  const title = query ? highlight(n.title, query) : escapeHtml(n.title);
  const showText = n.text !== n.title && n.text.replace(/[.!?]$/, '') !== n.title;
  const text = showText ? (query ? highlight(n.text, query) : escapeHtml(n.text)) : '';
  const tags = (n.tags || []).map((t) => `<span class="tag">#${escapeHtml(t)}</span>`).join(' ');
  const people = (n.people || []).filter((p) => p !== n.person?.name || n.type !== 'person')
    .map((p) => `<span>👤 ${escapeHtml(p)}</span>`).join(' ');
  const bday = n.person?.birthday ? `<span>🎂 ${formatMonthDay(n.person.birthday)}</span>` : '';
  const remind = n.remindAt && !n.done && !n.reminded ? `<span>⏰ ${escapeHtml(formatRemindAt(n.remindAt))}</span>` : '';
  return `
    <div class="item${n.done ? ' done' : ''}" data-open="${n.id}" role="button" tabindex="0">
      ${isTask ? `<button class="check${n.done ? ' on' : ''}" data-check="${n.id}" aria-label="${n.done ? 'Mark not done' : 'Mark done'}">${n.done ? CHECK : ''}</button>` : ''}
      <div class="body">
        <div class="title">${title}</div>
        ${text ? `<div class="text">${text}</div>` : ''}
        <div class="meta">
          ${showType ? `<span class="badge ${n.type}">${TYPE_LABELS[n.type]}</span>` : ''}
          ${dueHtml(n)} ${remind} ${bday} ${people} ${tags}
          <span>${new Date(n.createdAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}${n.source === 'voice' ? ' 🎙' : ''}</span>
        </div>
      </div>
    </div>`;
}

const listHtml = (notes, opts) =>
  notes.length ? `<div class="list">${notes.map((n) => noteItem(n, opts)).join('')}</div>` : '';
const empty = (msg) => `<div class="empty">${msg}</div>`;
const newestFirst = (a, b) => b.createdAt - a.createdAt;

function renderHome() {
  const t = today();
  const open = state.notes.filter((n) => n.type === 'task' && !n.done);
  const dueNow = open.filter((n) => n.due && n.due <= t).sort(byDue);
  const undated = open.filter((n) => !n.due).sort(newestFirst).slice(0, 5);
  const in7 = toISODate(new Date(Date.now() + 7 * 86400000));
  const events = state.notes.filter((n) => n.type === 'event' && n.due && n.due >= t && n.due <= in7).sort(byDue);
  const bdays = upcomingBirthdays(buildPeople(state.notes), new Date(), 30);
  const shown = new Set([...dueNow, ...events, ...undated].map((n) => n.id));
  const recent = [...state.notes].sort(newestFirst).filter((n) => !shown.has(n.id)).slice(0, 6);

  let html = '';
  if (dueNow.length) html += `<h2 class="section">Due today & overdue</h2>${listHtml(dueNow)}`;
  if (events.length) html += `<h2 class="section">Coming up this week</h2>${listHtml(events)}`;
  if (bdays.length) {
    html += `<h2 class="section">Birthdays soon</h2><div class="list">${bdays.map((p) => `
      <div class="item person-card" data-person="${escapeHtml(p.name)}" role="button" tabindex="0">
        <div class="avatar">🎂</div>
        <div class="body"><div class="title">${escapeHtml(p.name)}</div>
        <div class="text">${formatMonthDay(p.birthday)} · ${p.inDays === 0 ? '<strong>today!</strong>' : p.inDays === 1 ? 'tomorrow' : `in ${p.inDays} days`}</div></div>
      </div>`).join('')}</div>`;
  }
  if (undated.length) html += `<h2 class="section">To do <button class="btn" data-goto="tasks">All tasks</button></h2>${listHtml(undated)}`;
  if (recent.length) html += `<h2 class="section">Recently captured</h2>${listHtml(recent)}`;
  else if (!state.notes.length) html += empty(`Nothing yet. Tap the mic and try:<br><br>
    “Remind me to call the dentist tomorrow at 10”<br>
    “I met Priya Sharma at the design meetup, she works at Figma, her birthday is 12th June”<br>
    “Idea: an app that waters my plants”`);
  $('#home-sections').innerHTML = html;
}

function renderTasks() {
  const t = today();
  let tasks = state.notes.filter((n) => n.type === 'task');
  const f = state.taskFilter;
  if (f === 'open') tasks = tasks.filter((n) => !n.done).sort(byDue);
  if (f === 'today') tasks = tasks.filter((n) => !n.done && n.due && n.due <= t).sort(byDue);
  if (f === 'upcoming') tasks = tasks.filter((n) => !n.done && n.due && n.due > t).sort(byDue);
  if (f === 'done') tasks = tasks.filter((n) => n.done).sort((a, b) => (b.doneAt || 0) - (a.doneAt || 0));
  $('#tasks-list').innerHTML = listHtml(tasks, { showType: false }) ||
    empty(f === 'done' ? 'Nothing finished yet.' : 'No tasks here. Say “I need to…” to add one.');
}

function renderPeople() {
  const people = buildPeople(state.notes);
  const el = $('#people-list');
  if (state.person) {
    const p = people.find((x) => x.name === state.person);
    if (p) {
      el.innerHTML = `
        <button class="btn" data-back-people style="margin-bottom:12px">← All people</button>
        <div class="person-detail">
          <h3>${escapeHtml(p.name)}</h3>
          ${p.birthday ? `<div>🎂 Birthday: <strong>${formatMonthDay(p.birthday)}</strong></div>` : '<div class="small">No birthday noted yet. Say “Birthday of ' + escapeHtml(p.name.split(' ')[0]) + ' is …”</div>'}
        </div>
        <h2 class="section">Everything about ${escapeHtml(p.name.split(' ')[0])}</h2>
        ${listHtml(p.notes)}`;
      return;
    }
    state.person = null;
  }
  el.innerHTML = people.length
    ? `<div class="list">${people.map((p) => `
        <div class="item person-card" data-person="${escapeHtml(p.name)}" role="button" tabindex="0">
          <div class="avatar">${escapeHtml(initials(p.name))}</div>
          <div class="body"><div class="title">${escapeHtml(p.name)}</div>
            <div class="text">${escapeHtml(p.notes[0]?.text || '')}</div>
            <div class="meta">${p.birthday ? `<span>🎂 ${formatMonthDay(p.birthday)}</span>` : ''}<span>${p.notes.length} note${p.notes.length === 1 ? '' : 's'}</span></div>
          </div>
        </div>`).join('')}</div>`
    : empty('No one yet. Try: “I met Alex Chen at the gym, he’s a nurse, birthday 3rd March.”');
}

const initials = (name) => name.split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase();

function renderNotes() {
  let notes = state.notes.filter((n) => n.type !== 'task' && n.type !== 'person');
  if (state.notesFilter !== 'all') notes = notes.filter((n) => n.type === state.notesFilter);
  const tagCounts = {};
  for (const n of notes) for (const t of n.tags || []) tagCounts[t] = (tagCounts[t] || 0) + 1;
  if (state.tagFilter && !tagCounts[state.tagFilter]) state.tagFilter = null;
  $('#tag-chips').innerHTML = Object.entries(tagCounts).sort((a, b) => b[1] - a[1])
    .map(([t, c]) => `<button class="chip${state.tagFilter === t ? ' active' : ''}" data-tag="${escapeHtml(t)}">#${escapeHtml(t)} · ${c}</button>`).join('');
  if (state.tagFilter) notes = notes.filter((n) => n.tags?.includes(state.tagFilter));
  $('#notes-list').innerHTML = listHtml(notes.sort(newestFirst)) || empty('Nothing here yet.');
}

function render() {
  updateBadge();
  scheduleReminders();
  renderHome();
  renderTasks();
  renderPeople();
  renderNotes();
  if (state.view === 'search') runLocalSearch();
}

function show(view) {
  state.view = view;
  for (const v of $$('.view')) v.hidden = v.id !== `view-${view}`;
  for (const b of $$('.tabbar button')) b.classList.toggle('active', b.dataset.view === view);
  $('#search-tab').classList.toggle('active', view === 'search');
  $('#view-title').textContent = $(`#view-${view}`).dataset.title;
  if (view === 'search') setTimeout(() => $('#search-input').focus(), 50);
  window.scrollTo({ top: 0 });
}

// ---------- Search & Ask ----------

function runLocalSearch() {
  const q = $('#search-input').value;
  const results = search(state.notes, q);
  $('#search-results').innerHTML = q.trim()
    ? (listHtml(results.map((r) => r.note), { query: q }) || empty('No notes match that.'))
    : empty(state.notes.length ? 'Search anything you’ve said: a name, “passport”, “birthday”, “dentist”…' : 'Nothing saved yet.');
  return results;
}

const looksLikeQuestion = (q) => /\?|^(what|when|where|who|whom|which|how|did|do|does|is|are|was|have|has|should|can|tell|remind)\b/i.test(q.trim());

/** Answer common questions without AI: birthdays and "about <person>". */
function localAnswer(q) {
  const people = buildPeople(state.notes);
  const qTokens = tokenize(q);
  const person = people.find((p) => tokenize(p.name).some((t) => qTokens.includes(t)));
  if (!person) return null;
  if (/birthday|b-?day|born/i.test(q)) {
    return person.birthday
      ? `${person.name}'s birthday is ${formatMonthDay(person.birthday)}.`
      : `I don't have ${person.name}'s birthday noted.`;
  }
  if (/\b(who is|who's|about)\b/i.test(q) && person.notes.length) return person.notes.map((n) => n.text).join(' ');
  return null;
}

async function runSearch(fromSubmit = false) {
  const q = $('#search-input').value.trim();
  const results = runLocalSearch();
  if (!q || !fromSubmit) return;
  const box = $('#answer');
  const local = localAnswer(q);
  if (!aiOn() || !looksLikeQuestion(q)) {
    if (local) { box.hidden = false; box.innerHTML = `<div class="label">Answer</div>${escapeHtml(local)}`; }
    return;
  }
  box.hidden = false;
  box.innerHTML = '<div class="label">Thinking…</div>Looking through your notes';
  // Send everything if it's small; otherwise the best local matches plus recent notes.
  let context = state.notes;
  if (state.notes.length > 200) {
    const ids = new Set(results.slice(0, 80).map((r) => r.note.id));
    [...state.notes].sort(newestFirst).slice(0, 40).forEach((n) => ids.add(n.id));
    context = state.notes.filter((n) => ids.has(n.id));
  }
  try {
    const { answer, note_ids: ids } = await aiAsk(state.settings, q, context);
    if ($('#search-input').value.trim() !== q) return;
    box.innerHTML = `<div class="label">Answer</div>${escapeHtml(answer)}`;
    const cited = ids.map((id) => state.notes.find((n) => n.id === id)).filter(Boolean);
    if (cited.length) {
      const rest = results.map((r) => r.note).filter((n) => !ids.includes(n.id));
      $('#search-results').innerHTML = `<h2 class="section">From these notes</h2>${listHtml(cited)}` +
        (rest.length ? `<h2 class="section">Other matches</h2>${listHtml(rest, { query: q })}` : '');
    }
  } catch (err) {
    box.innerHTML = local
      ? `<div class="label">Answer</div>${escapeHtml(local)}`
      : `<div class="label">Couldn't ask Claude</div>${escapeHtml(shortError(err))}. Showing search matches instead.`;
  }
}

// ---------- Edit dialog ----------

function openEdit(id) {
  const n = state.notes.find((x) => x.id === id);
  if (!n) return;
  state.editing = n;
  const f = $('#edit-form');
  f.text.value = n.text;
  f.title.value = n.title;
  f.type.value = n.type;
  f.due.value = n.due || '';
  f.time.value = n.time || '';
  f.personName.value = n.person?.name || '';
  f.birthday.value = n.person?.birthday || '';
  f.tags.value = (n.tags || []).join(', ');
  f.people.value = (n.people || []).join(', ');
  f.remindAt.value = n.remindAt ? toDateTimeLocal(n.remindAt) : '';
  f.remindAt.dataset.touched = '';
  $('.person-fields').hidden = n.type !== 'person' && !n.person;
  $('#edit-dialog').showModal();
}

$('#edit-dialog').addEventListener('close', async () => {
  const n = state.editing;
  state.editing = null;
  if (!n || $('#edit-dialog').returnValue !== 'save') return;
  const f = $('#edit-form');
  const list = (s) => s.split(',').map((x) => x.trim()).filter(Boolean);
  const textChanged = f.text.value.trim() !== n.text;
  Object.assign(n, {
    text: f.text.value.trim(),
    title: f.title.value.trim() || f.text.value.trim().slice(0, 60),
    type: f.type.value,
    due: f.due.value || null,
    time: f.time.value || null,
    tags: list(f.tags.value.toLowerCase()),
    people: list(f.people.value),
    person: f.personName.value.trim() ? { name: f.personName.value.trim(), birthday: f.birthday.value.trim() || null } : null,
    updatedAt: Date.now(),
    editedByUser: true,
  });
  if (f.remindAt.dataset.touched) {
    n.remindManual = true;
    n.remindAt = fromDateTimeLocal(f.remindAt.value);
    n.reminded = false;
  } else {
    syncReminder(n);
  }
  await putNote(n);
  render();
  if (textChanged && aiOn()) refineWithAI(n);
});

$('#edit-form').remindAt.addEventListener('input', (e) => { e.target.dataset.touched = '1'; });
$('#edit-remind-clear').addEventListener('click', () => {
  const input = $('#edit-form').remindAt;
  input.value = '';
  input.dataset.touched = '1';
});
$('#edit-calendar').addEventListener('click', () => {
  const n = state.editing;
  if (!n) return;
  const f = $('#edit-form');
  // Use what's in the form, even if not saved yet.
  const draft = {
    ...n,
    title: f.title.value.trim() || n.title,
    text: f.text.value.trim() || n.text,
    due: f.due.value || null,
    time: f.time.value || null,
    remindAt: fromDateTimeLocal(f.remindAt.value) || n.remindAt,
  };
  if (!draft.remindAt && !draft.due) { toast('Pick a date or reminder time first.'); return; }
  const name = `${draft.title.replace(/[^\w\s-]/g, '').trim().slice(0, 40) || 'reminder'}.ics`;
  download(name, buildICS(draft, { appUrl: location.origin + location.pathname }), 'text/calendar');
});

$('#edit-delete').addEventListener('click', async () => {
  const n = state.editing;
  $('#edit-dialog').close('cancel');
  if (!n) return;
  await removeNote(n.id);
  toast('Deleted', [['Undo', async () => { state.notes.push(n); await putNote(n); render(); }]]);
});

$('#edit-form').type.addEventListener('change', (e) => {
  $('.person-fields').hidden = e.target.value !== 'person' && !$('#edit-form').personName.value;
});

// ---------- Settings, export, import ----------

function openSettings() {
  const f = $('#settings-form');
  f.lang.value = state.settings.lang;
  f.apiKey.value = state.settings.apiKey;
  f.model.value = state.settings.model;
  const voice = state.notes.filter((n) => n.source === 'voice').length;
  $('#storage-info').textContent = `${state.notes.length} notes on this device (${voice} by voice). Notes are stored only in this browser, so download a backup now and then.`;
  renderReminderSettings();
  $('#settings-dialog').showModal();
}
$('#notif-enable').addEventListener('click', enableNotifications);
$('#notif-test').addEventListener('click', () => notify({ id: 'test', title: 'Test reminder', text: 'This is what a reminder looks like.' }));

$('#settings-dialog').addEventListener('close', () => {
  if ($('#settings-dialog').returnValue !== 'save') return;
  const f = $('#settings-form');
  state.settings = { lang: f.lang.value.trim() || 'en-US', apiKey: f.apiKey.value.trim(), model: f.model.value };
  saveSettings(state.settings);
  toast(aiOn() ? 'Saved. Claude will organise new notes.' : 'Saved.');
});

function download(name, content, type = 'text/markdown') {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

$$('[data-export]').forEach((b) => b.addEventListener('click', () => {
  const stamp = today();
  const kind = b.dataset.export;
  if (kind === 'all') download(`second-brain-${stamp}.md`, fullMarkdown(state.notes));
  if (kind === 'tasks') download(`tasks-${stamp}.md`, tasksMarkdown(state.notes));
  if (kind === 'people') download(`people-${stamp}.md`, peopleMarkdown(state.notes));
  if (kind === 'json') download(`remembering-backup-${stamp}.json`, JSON.stringify({ version: 1, notes: state.notes }, null, 2), 'application/json');
}));

$('#import-file').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    const incoming = (Array.isArray(data) ? data : data.notes || []).filter((n) => n && n.id && n.text);
    const byId = new Map(state.notes.map((n) => [n.id, n]));
    let added = 0;
    for (const n of incoming) {
      if (!byId.has(n.id) || (n.updatedAt || 0) > (byId.get(n.id).updatedAt || 0)) {
        byId.set(n.id, n);
        await putNote(n);
        added++;
      }
    }
    state.notes = [...byId.values()];
    render();
    toast(`Restored ${added} note${added === 1 ? '' : 's'}.`);
  } catch {
    toast('That file isn’t a Remembering backup.');
  }
});

$('#reorganize').addEventListener('click', async () => {
  const btn = $('#reorganize');
  btn.disabled = true;
  const people = knownPeople();
  for (const n of state.notes) {
    if (n.editedByUser) continue;
    const { done } = n;
    Object.assign(n, organize(n.text, { now: new Date(n.createdAt), knownPeople: people }), { done });
    syncReminder(n);
    await putNote(n);
  }
  render();
  if (aiOn()) {
    let i = 0;
    for (const n of state.notes) {
      btn.textContent = `Claude: ${++i}/${state.notes.length}…`;
      await refineWithAI(n, { quiet: true });
    }
  }
  btn.disabled = false;
  btn.textContent = 'Re-organise all notes';
  toast('All notes re-organised.');
});

// ---------- Reminders & notifications ----------

const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const isStandalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;

/** 'on' | 'ask' | 'blocked' | 'install' (iPhone: only home-screen apps can notify) | 'unsupported' */
function notificationState() {
  if (!('Notification' in window)) return isIOS && !isStandalone() ? 'install' : 'unsupported';
  if (Notification.permission === 'granted') return 'on';
  if (Notification.permission === 'denied') return 'blocked';
  return 'ask';
}

async function enableNotifications() {
  const st = notificationState();
  if (st === 'install') { toast('First add this app to your Home Screen (Share → Add to Home Screen), then open it from the icon.'); return; }
  if (st === 'unsupported') { toast('This browser can’t show notifications. Use “Add to Calendar” on a task instead.'); return; }
  if (st === 'blocked') { toast('Notifications are blocked. On iPhone: Settings → Notifications → Remembering → Allow.'); return; }
  const result = await Notification.requestPermission();
  renderReminderSettings();
  if (result === 'granted') {
    toast('Reminders are on.');
    notify({ id: 'test', title: 'Reminders are on', text: 'You’ll get a nudge like this when something is due.' });
  }
}

async function notify(n) {
  if (notificationState() !== 'on') return false;
  const title = `⏰ ${n.title}`;
  const opts = {
    body: n.due ? `${relativeLabel(n.due)}${n.time ? ' at ' + n.time : ''}` : (n.text || ''),
    tag: n.id,
    data: { id: n.id },
    icon: 'icons/icon-192.png',
    badge: 'icons/icon-192.png',
  };
  try {
    const reg = await navigator.serviceWorker?.ready;
    if (reg?.showNotification) { await reg.showNotification(title, opts); return true; }
    new Notification(title, opts);
    return true;
  } catch (err) {
    console.warn('notification failed', err);
    return false;
  }
}

let reminderTimer = null;
let checking = false;

async function checkReminders() {
  if (checking) return;
  checking = true;
  try {
    const due = dueReminders(state.notes);
    for (const n of due) {
      n.reminded = true;
      await putNote(n);
      await notify(n);
    }
    if (due.length && document.visibilityState === 'visible') {
      const n = due[due.length - 1];
      const more = due.length > 1 ? ` (+${due.length - 1} more)` : '';
      toast(`⏰ ${n.title}${more}`, [
        ...(n.type === 'task' ? [['Done', () => toggleDone(n.id)]] : []),
        ['In 10 min', () => snooze(n.id, 10)],
        ['Open', () => openEdit(n.id)],
      ]);
    }
    if (due.length) render();
  } finally {
    checking = false;
  }
}

async function snooze(id, minutes) {
  const n = state.notes.find((x) => x.id === id);
  if (!n) return;
  Object.assign(n, { remindAt: Date.now() + minutes * 60000, remindManual: true, reminded: false, updatedAt: Date.now() });
  await putNote(n);
  render();
  toast(`I’ll remind you again in ${minutes} minutes.`);
}

function scheduleReminders() {
  clearTimeout(reminderTimer);
  if (dueReminders(state.notes).length) { setTimeout(checkReminders, 0); return; }
  const next = nextReminder(state.notes);
  if (!next) return;
  // Re-check at least every minute: timers drift or pause in the background.
  const wait = Math.min(Math.max(next.remindAt - Date.now(), 0) + 500, 60000);
  reminderTimer = setTimeout(() => { checkReminders(); scheduleReminders(); }, wait);
}

function updateBadge() {
  const count = badgeCount(state.notes, today());
  try {
    if (count) navigator.setAppBadge?.(count)?.catch?.(() => {});
    else navigator.clearAppBadge?.()?.catch?.(() => {});
  } catch { /* not supported */ }
}

function renderReminderSettings() {
  const st = notificationState();
  const text = {
    on: '✅ Reminders are on. You’ll get a notification when a task is due.',
    ask: 'Get a notification when a task or event is due.',
    blocked: 'Notifications are blocked. On iPhone: Settings → Notifications → Remembering → Allow Notifications.',
    install: 'On iPhone, reminders work in the Home Screen app: tap Share → Add to Home Screen, then open Remembering from the icon.',
    unsupported: 'This browser can’t show notifications. Use “Add to Calendar” on a task instead.',
  }[st];
  $('#notif-status').textContent = text;
  $('#notif-enable').hidden = st !== 'ask';
  $('#notif-test').hidden = st !== 'on';
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') { checkReminders(); scheduleReminders(); updateBadge(); }
});

navigator.serviceWorker?.addEventListener('message', (e) => {
  if (e.data?.type === 'open-note' && e.data.id) openEdit(e.data.id);
});

// ---------- Toast ----------

let toastTimer;
function toast(msg, actions = []) {
  const el = $('#toast');
  el.innerHTML = `<span>${escapeHtml(msg)}</span>`;
  for (const [label, fn] of actions) {
    const b = document.createElement('button');
    b.textContent = label;
    b.onclick = () => { el.hidden = true; fn(); };
    el.append(b);
  }
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, actions.length ? 8000 : 3500);
}

// ---------- Events ----------

$('#mic').addEventListener('click', () => startRecording('note'));
$('#search-mic').addEventListener('click', () => (state.recording ? stopRecording() : startRecording('search')));
$('#settings-btn').addEventListener('click', openSettings);
$('#search-tab').addEventListener('click', () => show('search'));
$$('.tabbar button').forEach((b) => b.addEventListener('click', () => {
  if (b.dataset.view === 'people') state.person = null;
  show(b.dataset.view);
  render();
}));

$('#type-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const input = $('#type-input');
  saveNote(input.value, 'text');
  input.value = '';
});
$('#type-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); $('#type-form').requestSubmit(); }
});

let searchTimer;
$('#search-input').addEventListener('input', () => {
  clearTimeout(searchTimer);
  $('#answer').hidden = true;
  searchTimer = setTimeout(() => runLocalSearch(), 120);
});
$('#search-form').addEventListener('submit', (e) => {
  e.preventDefault();
  clearTimeout(searchTimer);
  runSearch(true);
});

function bindFilter(container, key, rerender) {
  $(container).addEventListener('click', (e) => {
    const chip = e.target.closest('.chip');
    if (!chip) return;
    state[key] = chip.dataset.filter;
    $$('.chip', $(container)).forEach((c) => c.classList.toggle('active', c === chip));
    rerender();
  });
}
bindFilter('#task-filter', 'taskFilter', renderTasks);
bindFilter('#notes-filter', 'notesFilter', renderNotes);
$('#tag-chips').addEventListener('click', (e) => {
  const chip = e.target.closest('.chip');
  if (!chip) return;
  state.tagFilter = state.tagFilter === chip.dataset.tag ? null : chip.dataset.tag;
  renderNotes();
});

$('#main').addEventListener('click', (e) => {
  const check = e.target.closest('[data-check]');
  if (check) { e.stopPropagation(); toggleDone(check.dataset.check); return; }
  const person = e.target.closest('[data-person]');
  if (person) { state.person = person.dataset.person; show('people'); renderPeople(); return; }
  if (e.target.closest('[data-back-people]')) { state.person = null; renderPeople(); return; }
  const go = e.target.closest('[data-goto]');
  if (go) { show(go.dataset.goto); return; }
  const open = e.target.closest('[data-open]');
  if (open) openEdit(open.dataset.open);
});
$('#main').addEventListener('keydown', (e) => {
  if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('[role="button"]')) { e.preventDefault(); e.target.click(); }
});

// ---------- Boot ----------

async function boot() {
  state.notes = await allNotes();
  persistStorage();
  if (!speechSupported) $('#capture-hint').textContent = 'Voice input isn’t available in this browser, but you can type notes below. For voice, open this in Chrome, Edge or Safari.';
  render();
  const params = new URLSearchParams(location.search);
  const view = params.get('view');
  if (view && $(`#view-${view}`)) show(view);
  const openId = params.get('open');
  if (openId && state.notes.some((n) => n.id === openId)) openEdit(openId);
  if (params.has('open') || params.has('capture') || params.has('view')) history.replaceState(null, '', location.pathname);
  checkReminders();
  if (params.has('capture')) {
    // Launched from the home-screen "Quick note" shortcut. Some browsers need
    // a tap before the mic can start, so fail quietly.
    try { startRecording('note'); } catch { /* user taps the mic instead */ }
  }
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}

boot();
