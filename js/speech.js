// Thin wrapper around the browser's speech recognition (Chrome, Edge,
// Safari, Android). Speech is transcribed by the browser/OS; this app only
// stores the resulting text.

const Recognition = globalThis.SpeechRecognition || globalThis.webkitSpeechRecognition;

export const speechSupported = Boolean(Recognition);

/**
 * Start listening. Callbacks:
 *   onText(finalText, interimText) — live transcript
 *   onEnd(finalText)               — listening stopped (by you or by silence)
 *   onError(message)
 * Returns { stop() }.
 */
export function listen({ lang, onText, onEnd, onError }) {
  const rec = new Recognition();
  rec.lang = lang || 'en-US';
  rec.continuous = true;
  rec.interimResults = true;
  let finalText = '';
  let stopped = false;
  let restarts = 0;

  rec.onresult = (e) => {
    let interim = '';
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const r = e.results[i];
      if (r.isFinal) finalText += (finalText ? ' ' : '') + r[0].transcript.trim();
      else interim += r[0].transcript;
    }
    onText?.(finalText, interim.trim());
  };
  rec.onerror = (e) => {
    if (e.error === 'no-speech' || e.error === 'aborted') return;
    stopped = true;
    const msg = {
      'not-allowed': 'Microphone access is blocked. Allow it in your browser settings.',
      'service-not-allowed': 'Speech recognition is not allowed here. Try Chrome or Safari.',
      network: 'Speech recognition needs an internet connection in this browser.',
      'audio-capture': 'No microphone found.',
    }[e.error] || `Speech recognition error: ${e.error}`;
    onError?.(msg);
  };
  rec.onend = () => {
    // Some browsers stop after a pause even in continuous mode; keep going
    // until the user taps stop, but don't loop forever.
    if (!stopped && restarts < 20) {
      restarts++;
      try { rec.start(); return; } catch { /* fall through */ }
    }
    onEnd?.(finalText);
  };
  rec.start();
  return {
    stop() {
      stopped = true;
      rec.stop();
    },
  };
}
