// Thin wrapper around the browser's speech recognition (Chrome, Edge,
// Safari, Android). Speech is transcribed by the browser/OS; this app only
// stores the resulting text.

const Recognition = globalThis.SpeechRecognition || globalThis.webkitSpeechRecognition;

export const speechSupported = Boolean(Recognition);

// How long to wait for the browser to wrap up after stop() before giving up
// on it. iOS Safari sometimes never fires `end`, which used to leave the app
// stuck "recording".
const STOP_GRACE_MS = 1200;

/**
 * Start listening. Options:
 *   continuous  keep listening through pauses until stop() (notes); false
 *               for one sentence (search questions)
 *   silenceMs   stop by itself this long after the last word (0 = never)
 *   maxMs       stop by itself after this long in total (0 = never)
 * Callbacks:
 *   onText(text, interimText) — live transcript
 *   onEnd(text)               — called exactly once when listening stops
 *   onError(message)
 * Returns { stop() }. Throws if the browser refuses to start.
 */
export function listen({ lang, onText, onEnd, onError, continuous = true, silenceMs = 0, maxMs = 0 }) {
  const rec = new Recognition();
  rec.lang = lang || 'en-US';
  rec.continuous = continuous;
  rec.interimResults = true;

  let committed = ''; // text from earlier sessions, if the browser restarted
  let current = ''; // final text of the current session
  let interim = ''; // not-yet-final text of the current session
  let stopping = false;
  let finished = false;
  let restarts = 0;
  let sessionStart = Date.now();
  let killTimer = null;
  let silenceTimer = null;
  let maxTimer = null;
  let api = null;

  const join = (...parts) => parts.filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();

  const finish = () => {
    if (finished) return;
    finished = true;
    clearTimeout(killTimer);
    clearTimeout(silenceTimer);
    clearTimeout(maxTimer);
    rec.onresult = rec.onend = rec.onerror = null;
    // iOS often leaves results "interim" forever, so keep them.
    onEnd?.(join(committed, current, interim));
  };

  rec.onresult = (e) => {
    // Rebuild from the whole result list each time instead of appending;
    // Safari re-sends earlier results and would otherwise duplicate words.
    let fin = '';
    let int = '';
    for (let i = 0; i < e.results.length; i++) {
      const r = e.results[i];
      if (r.isFinal) fin += r[0].transcript + ' ';
      else int += r[0].transcript + ' ';
    }
    current = fin.trim();
    interim = int.trim();
    onText?.(join(committed, current), interim);
    if (silenceMs && (current || interim)) {
      clearTimeout(silenceTimer);
      silenceTimer = setTimeout(() => api.stop(), silenceMs);
    }
  };

  rec.onerror = (e) => {
    if (e.error === 'no-speech' || e.error === 'aborted') return;
    const msg = {
      'not-allowed': 'Microphone access is blocked. On iPhone: Settings → Safari → Microphone → Allow.',
      'service-not-allowed': 'Speech recognition is off. On iPhone: Settings → General → Keyboard → Enable Dictation.',
      network: 'Speech recognition needs an internet connection.',
      'audio-capture': 'No microphone found.',
    }[e.error] || `Speech recognition error: ${e.error}`;
    onError?.(msg);
    finish();
  };

  rec.onend = () => {
    // Some browsers stop after a pause even in continuous mode. Restart so a
    // pause mid-thought doesn't cut you off — but never after stop(), and not
    // if the session died instantly (that would loop).
    if (continuous && !stopping && restarts < 10 && Date.now() - sessionStart > 1000) {
      committed = join(committed, current, interim);
      current = interim = '';
      restarts++;
      sessionStart = Date.now();
      try { rec.start(); return; } catch { /* fall through and finish */ }
    }
    finish();
  };

  rec.start();
  if (maxMs) maxTimer = setTimeout(() => api.stop(), maxMs);

  api = {
    stop() {
      if (finished) return;
      if (stopping) { // second tap: stop waiting entirely
        try { rec.abort(); } catch { /* ignore */ }
        finish();
        return;
      }
      stopping = true;
      try { rec.stop(); } catch { /* ignore */ }
      killTimer = setTimeout(() => {
        try { rec.abort(); } catch { /* ignore */ }
        finish();
      }, STOP_GRACE_MS);
    },
  };
  return api;
}
