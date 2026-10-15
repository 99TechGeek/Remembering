// Notes live on this device in IndexedDB. Nothing leaves the device unless
// you turn on AI organising in Settings.

const DB_NAME = 'remembering';
const STORE = 'notes';
let dbPromise;

function open() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        const store = req.result.createObjectStore(STORE, { keyPath: 'id' });
        store.createIndex('createdAt', 'createdAt');
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbPromise;
}

async function tx(mode, fn) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const result = fn(t.objectStore(STORE));
    t.oncomplete = () => resolve(result?.result ?? result);
    t.onerror = () => reject(t.error);
  });
}

export const allNotes = () => tx('readonly', (s) => s.getAll());
export const putNote = (note) => tx('readwrite', (s) => s.put(note));
export const deleteNote = (id) => tx('readwrite', (s) => s.delete(id));
export const clearNotes = () => tx('readwrite', (s) => s.clear());

export function newId() {
  return (crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`);
}

// Ask the browser not to evict our data when storage is low.
export async function persistStorage() {
  try {
    if (navigator.storage?.persist && !(await navigator.storage.persisted())) await navigator.storage.persist();
  } catch { /* best effort */ }
}

const SETTINGS_KEY = 'remembering.settings';
export function loadSettings() {
  try {
    return { lang: navigator.language || 'en-US', apiKey: '', model: 'claude-opus-5-5', ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}') };
  } catch {
    return { lang: 'en-US', apiKey: '', model: 'claude-opus-5-5' };
  }
}
export function saveSettings(s) {
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)); } catch { /* private mode */ }
}
