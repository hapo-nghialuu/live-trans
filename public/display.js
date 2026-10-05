import { $, credentials, RoomSocket } from './shared.js';

const requested = new URLSearchParams(location.search).get('lang');
const lang = requested === 'ja' ? 'ja' : 'en';
const labels = {
  en: {
    title: 'English', captions: 'English captions', empty: 'Waiting for the speaker…',
    updating: 'Updating captions…', translationError: 'Translation temporarily unavailable.',
    connecting: 'Connecting…', listening: 'Listening to the speaker', finishing: 'Finishing captions…',
    paused: 'Paused · Waiting for the speaker', idle: 'Waiting for the speaker',
    ready: 'Waiting for the speaker', waiting: 'Waiting for the microphone',
    closed: 'This session has ended.', error: 'Unable to connect. Please try again.',
    disconnected: 'Connection lost. Please reconnect.', invalid: 'Invalid display link or expired session.',
    controls: 'Controls', full: 'Full screen', exit: 'Exit full screen', reconnect: 'Reconnect',
    fullscreenError: 'Full screen is unavailable. You can keep using this window.',
  },
  ja: {
    title: '日本語', captions: 'リアルタイム字幕', empty: '開始までお待ちください…',
    updating: '字幕を更新しています…', translationError: '翻訳は一時的に利用できません。',
    connecting: '接続中…', listening: '話者の音声を受信中', finishing: '字幕を仕上げています…',
    paused: '一時停止中 · 再開をお待ちください', idle: '開始までお待ちください',
    ready: '開始までお待ちください', waiting: 'マイクの接続をお待ちください',
    closed: 'このセッションは終了しました。', error: '接続できません。もう一度お試しください。',
    disconnected: '接続が切れました。再接続してください。', invalid: 'リンクが無効か、セッションの有効期限が切れています。',
    controls: '操作', full: '全画面表示', exit: '全画面表示を終了', reconnect: '再接続',
    fullscreenError: '全画面表示を利用できません。このウィンドウで引き続きご覧いただけます。',
  },
}[lang];
document.documentElement.lang = lang;
document.title = `${labels.title} · Haposoft 10 năm`;
$('language-title').textContent = labels.title;
$('caption-scroll').setAttribute('aria-label', labels.captions);
// Fade the top edge only once older lines scroll out, so the first line is never dimmed.
$('caption-scroll').addEventListener('scroll', () => {
  $('caption-scroll').classList.toggle('is-scrolled', $('caption-scroll').scrollTop > 4);
}, { passive: true });
$('reconnect').textContent = labels.reconnect;
$('fullscreen').textContent = labels.full;
$('controls-label').textContent = labels.controls;

const auth = credentials();
const validLink = ['en', 'ja'].includes(requested) && /^[\w-]{12}$/.test(auth.room || '')
  && /^[\w-]{32}$/.test(auth.token || '');
let items = [], interim = false, ended = false;
let peer;

function status(state) {
  $('connection-status').textContent = labels[state] || labels.waiting;
  $('connection-status').dataset.state = state;
  document.body.classList.toggle('connection-problem', ['error', 'invalid', 'disconnected', 'closed'].includes(state));
  $('reconnect').hidden = !validLink || ended || !['error', 'invalid', 'disconnected'].includes(state);
}

function normalize(captions) {
  const byId = new Map();
  for (const caption of captions) {
    if (!caption || !Number.isSafeInteger(caption.id) || caption.id < 1) continue;
    byId.set(caption.id, { id: caption.id, text: typeof caption[lang] === 'string' ? caption[lang] : '', status: caption.status });
  }
  return [...byId.values()].sort((a, b) => a.id - b.id).slice(-30);
}

function render() {
  const translations = items.filter(item => item.text).map(item => item.text).join('\n\n');
  const node = $('captions');
  const previous = node.classList.contains('empty') ? '' : node.textContent;
  const content = translations || labels.empty;
  if (node.textContent !== content) node.textContent = content;
  node.classList.toggle('empty', !translations);
  const latest = items.at(-1);
  const failed = latest?.status === 'error';
  $('caption-progress').hidden = ended || (!failed && !interim && latest?.status !== 'translating');
  $('caption-progress').dataset.state = failed ? 'error' : 'updating';
  $('caption-progress').textContent = failed ? labels.translationError : labels.updating;
  // Chỉ bản dịch thay đổi mới đưa màn hình tới câu mới nhất.
  if (translations && translations !== previous) $('caption-scroll').scrollTop = $('caption-scroll').scrollHeight;
}

function onEvent(event) {
  if (ended) return;
  if (event.type === 'snapshot') {
    items = normalize(Array.isArray(event.captions) ? event.captions : []);
    interim = Boolean(event.interim);
    status(event.status);
    render();
  } else if (event.type === 'status') status(event.status);
  else if (event.type === 'caption') {
    const next = normalize([event.caption])[0];
    if (!next) return;
    const index = items.findIndex(item => item.id === next.id);
    if (index >= 0) items[index] = next;
    else if (!items.length || next.id > items.at(-1).id) items.push(next);
    items = items.slice(-30);
    render();
  } else if (event.type === 'interim') {
    interim = Boolean(event.text);
    render();
  } else if (event.type === 'closed') {
    ended = true;
    items = []; interim = false;
    peer.close();
    status('closed');
    render();
  } else if (event.type === 'error') {
    peer.close();
    status(event.message === 'Liên kết không đúng hoặc phiên đã hết hạn.' ? 'invalid' : 'error');
  }
}

function connect() {
  if (!validLink || ended) return;
  try { peer.connect(); }
  catch { peer.close(); status('disconnected'); }
}
peer = new RoomSocket('viewer', auth, onEvent, state => { if (!ended) status(state); });
$('reconnect').addEventListener('click', connect);
window.addEventListener('pagehide', () => peer.close());
window.addEventListener('pageshow', event => { if (event.persisted) connect(); });

function fullscreenState() {
  const active = Boolean(document.fullscreenElement);
  $('fullscreen').textContent = active ? labels.exit : labels.full;
  $('fullscreen').setAttribute('aria-pressed', String(active));
}
$('fullscreen').addEventListener('click', async () => {
  $('fullscreen-error').hidden = true;
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await document.documentElement.requestFullscreen();
  } catch {
    $('fullscreen-error').textContent = labels.fullscreenError;
    $('fullscreen-error').hidden = false;
  }
  fullscreenState();
  if ($('fullscreen-error').hidden) $('display-controls').open = false;
});
document.addEventListener('fullscreenchange', fullscreenState);
render();
if (validLink) connect();
else status('invalid');

// Reserve the actual controls/error height so the newest lines stay readable.
new ResizeObserver(([entry]) => {
  const scroll = $('caption-scroll');
  const atBottom = scroll.scrollHeight - scroll.scrollTop - scroll.clientHeight < 2;
  document.documentElement.style.setProperty('--controls-space', `${Math.ceil(entry.target.getBoundingClientRect().height)}px`);
  if (atBottom) scroll.scrollTop = scroll.scrollHeight;
}).observe(document.querySelector('.display-footer'));
