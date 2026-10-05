// Turns a cumulative speech transcript into captions sentence by sentence, so a long
// uninterrupted speech is translated while the speaker keeps talking instead of only
// after the ASR closes the whole turn.
//
// interim(text) receives the full transcript of the current turn so far; final(text) the
// ASR's closing transcript of that turn. Committed text is tracked by word count, which
// survives the small spelling revisions ASRs make, then snapped to a sentence boundary.

const STOPS = '.?!…';
const CLOSERS = '"\'”’)]';
const words = (text) => text.trim().split(/\s+/).filter(Boolean);

/** ASRs sometimes omit the space after a full stop ("bạn.Chào"); word counting needs it. */
export function normalize(text) {
  let out = '';
  for (let i = 0; i < text.length; i++) {
    const ch = text[i], next = text[i + 1];
    out += ch;
    const isNumber = /\d/.test(text[i - 1] || '') && /\d/.test(next || '');
    if (STOPS.includes(ch) && next && !/\s/.test(next) && !STOPS.includes(next) && !CLOSERS.includes(next) && !isNumber) out += ' ';
  }
  return out;
}

/** Splits text into sentences ending in . ? ! … (not inside numbers like 1.000) plus an unfinished tail. */
export function splitSentences(text) {
  const sentences = [];
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    if (!STOPS.includes(text[i])) continue;
    if (/\d/.test(text[i - 1] || '') && /\d/.test(text[i + 1] || '')) continue;
    let end = i + 1;
    while (end < text.length && (STOPS.includes(text[end]) || CLOSERS.includes(text[end]))) end++;
    const piece = text.slice(start, end).trim();
    if (piece) sentences.push(piece);
    start = end;
    i = end - 1;
  }
  return { sentences, tail: text.slice(start).trim() };
}

/** Drops the first `count` words of `text`. */
function afterWords(text, count) {
  return words(text).slice(Math.max(0, count)).join(' ');
}

export function createSentenceCommitter({ stableMs = 700, maxChars = 220, keepWords = 3 } = {}) {
  let committedWords = 0;
  let lastText = '';
  let lastChange = 0;

  const take = (pieces) => { for (const piece of pieces) committedWords += words(piece).length; return pieces; };
  const pendingOf = (text) => afterWords(text, committedWords);

  const collect = (text, settled) => {
    const { sentences, tail } = splitSentences(pendingOf(text));
    // A sentence followed by more speech is safe to commit now. The last sentence of the
    // transcript is held until the transcript has stopped changing (settled).
    const ready = tail || settled ? sentences : sentences.slice(0, -1);
    const out = take(ready);
    // A long stretch without punctuation is cut at its last comma (or word), keeping a few
    // trailing words the ASR may still revise.
    const rest = pendingOf(text);
    if (rest.length > maxChars) {
      const ws = words(rest);
      const head = ws.slice(0, Math.max(1, ws.length - keepWords)).join(' ');
      const comma = head.lastIndexOf(',');
      out.push(...take([comma > maxChars / 3 ? head.slice(0, comma + 1) : head]));
    }
    return out;
  };

  return {
    /** Text of the current turn that is not a caption yet, for the live preview. */
    pending() { return pendingOf(lastText); },
    interim(raw, now = Date.now()) {
      const text = normalize(raw);
      if (text !== lastText) { lastText = text; lastChange = now; }
      return collect(text, false);
    },
    /** Called on a timer: commits the trailing sentence once the transcript stops changing. */
    settle(now = Date.now()) {
      if (!lastText || now - lastChange < stableMs) return [];
      return collect(lastText, true);
    },
    /** Ends a turn that will never get a final transcript, returning its uncommitted text. */
    flush() {
      const rest = pendingOf(lastText);
      committedWords = 0; lastText = ''; lastChange = 0;
      return rest ? [rest] : [];
    },
    /** Closes the turn: returns whatever the final transcript adds beyond the commits. */
    final(raw) {
      const text = normalize(raw);
      const rest = committedWords ? snapRest(text, committedWords) : text.trim();
      committedWords = 0; lastText = ''; lastChange = 0;
      return rest ? [rest] : [];
    },
  };
}

// The final transcript may revise words slightly; start the remainder at the sentence
// boundary closest to the committed word count, so nothing is repeated or dropped.
function snapRest(text, committed) {
  const { sentences, tail } = splitSentences(text);
  let count = 0, best = { distance: Infinity, index: 0 };
  for (let i = 0; i <= sentences.length; i++) {
    const distance = Math.abs(count - committed);
    if (distance < best.distance) best = { distance, index: i };
    if (i < sentences.length) count += words(sentences[i]).length;
  }
  if (best.distance <= 3) return [...sentences.slice(best.index), tail].filter(Boolean).join(' ');
  return afterWords(text, committed);
}
