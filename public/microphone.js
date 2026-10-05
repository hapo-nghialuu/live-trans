import { $, credentials, RoomSocket, showNotice, showStatus } from './shared.js';
import { AudioCapture } from './audio-capture.js';
import { MicrophonePreview } from './microphone-preview.js';
import { loadSourcePrefs, saveSourcePrefs, deviceOptions, sourceControlsLocked, checkShouldEnd, micErrorMessage,
  createSignalMonitor } from './source-panel-state.js';

const auth = credentials();
const preview = new MicrophonePreview();
let connected = false;
let ended = false;
let phase = 'idle';
let serverStatus = 'idle';
let generation = 0;
let limitTimer;
let startupTimer;
let finishTimer;
let flushing = false;
let connectionError = '';
let checking = false;
const monitor = createSignalMonitor();
const active = () => ['acquiring', 'starting', 'recording'].includes(phase);
const storage = () => { try { return window.localStorage; } catch { return null; } };
const sourceOptions = () => loadSourcePrefs(storage());
const SIGNAL_HINTS = {
  clipping: 'Tín hiệu quá mức — giảm mức AUX trên mixer.',
  low: 'Tín hiệu quá nhỏ hoặc không có — kiểm tra kênh/AUX trên mixer và card.',
};

const capture = new AudioCapture({
  onAudio: (pcm) => {
    if (phase !== 'recording' && !flushing) return;
    if (!peer.open || peer.bufferedAmount + pcm.byteLength > 128 * 1024) {
      halt('Mạng không theo kịp âm thanh. Micro đã dừng; kiểm tra mạng trước khi bắt đầu lại.');
    } else if (!peer.send(pcm)) halt('Gửi âm thanh thất bại. Micro đã dừng để bạn kiểm tra kết nối.');
  },
  onLevel: (rms, peak = 0) => {
    $('audio-level').value = Math.min(1, rms * 5);
    const now = Date.now();
    monitor.push(now, peak);
    // Hints only while the mic is live; the final onLevel(0, 0) from close() must clear them, not freeze them.
    const live = checking || phase === 'recording';
    const hints = monitor.hints(now);
    $('signal-hint').textContent = !live ? '' : hints.clipping ? SIGNAL_HINTS.clipping : checking && hints.low ? SIGNAL_HINTS.low : '';
  },
  onError: (message) => halt(message),
  onWake: (message) => { $('wake-status').textContent = message; },
  onNotice: (message) => showNotice(message),
});

async function refreshDevices() {
  if (!navigator.mediaDevices?.enumerateDevices) return;
  try {
    const devices = (await navigator.mediaDevices.enumerateDevices()).filter((device) => device.kind === 'audioinput');
    const activeId = capture.stream?.getAudioTracks()[0]?.getSettings?.().deviceId || '';
    const select = $('audio-device');
    select.replaceChildren(...deviceOptions(devices, sourceOptions().deviceId, activeId).map(({ value, label, selected }) => {
      const option = new Option(label, value);
      option.selected = selected;
      return option;
    }));
  } catch {}
}

// A check opens the mic only to show its level: no record(), no 'start', no wake lock.
async function startCheck() {
  const version = ++generation;
  // A pending stop-flush belongs to the finished recording; its last chunk must not end this check.
  flushing = false;
  checking = true;
  monitor.start(Date.now());
  showNotice();
  render();
  try {
    const opened = await capture.open({ ...sourceOptions(), wake: false });
    if (version !== generation) return;
    if (!opened) return endCheck('error');
    await refreshDevices();
  } catch (error) {
    // A late failure from a check that was already replaced must not touch the newer run.
    if (version !== generation) return;
    endCheck('error');
    showNotice(micErrorMessage(error));
  }
}

function endCheck(reason) {
  if (!checking || !checkShouldEnd(reason)) return;
  checking = false;
  ++generation;
  void capture.close();
  $('signal-hint').textContent = '';
  render();
}

function changeSource(patch) {
  saveSourcePrefs(storage(), patch);
  if (checking) void startCheck();
}

function render() {
  const blocked = !connected || ended || phase === 'finishing' || (phase === 'idle' && ['connecting', 'listening', 'finishing'].includes(serverStatus));
  $('mic-button').disabled = blocked;
  $('mic-button').setAttribute('aria-pressed', String(active()));
  $('mic-button-label').textContent = phase === 'recording' ? 'Dừng thu âm' : active() ? 'Hủy bắt đầu' : phase === 'finishing' ? 'Đang hoàn tất…' : 'Bắt đầu nói';
  $('mic-guidance').textContent = phase === 'recording' ? 'Micro đang mở. Nói tự nhiên, rõ ràng.' : phase === 'acquiring' ? 'Cho phép dùng micro khi trình duyệt hỏi.' : phase === 'starting' ? 'Đang kết nối dịch vụ nhận giọng nói…' : phase === 'finishing' ? 'Đợi hoàn tất câu cuối trước khi bắt đầu lượt mới.' : 'Nhấn để bắt đầu. Micro hiện đang tắt.';
  $('reconnect').hidden = connected || ended || $('connection-status').dataset.state === 'connecting';
  const locked = sourceControlsLocked(phase);
  $('audio-device').disabled = $('mixer-mode').disabled = $('signal-check').disabled = locked;
  $('signal-check').textContent = checking ? 'Dừng kiểm tra' : 'Kiểm tra tín hiệu';
  $('signal-check').setAttribute('aria-pressed', String(checking));
}

async function halt(message = '', notify = true, flush = false) {
  const wasStarted = ['starting', 'recording'].includes(phase);
  const version = ++generation;
  checking = false;
  clearTimeout(limitTimer);
  clearTimeout(startupTimer);
  flushing = flush && phase === 'recording';
  phase = notify && wasStarted && peer.open ? 'finishing' : 'idle';
  if (message) showNotice(message);
  render();
  await capture.close(flushing);
  if (version !== generation) return;
  flushing = false;
  if (notify && wasStarted && peer.open) {
    peer.send({ type: 'stop' });
    clearTimeout(finishTimer);
    finishTimer = setTimeout(() => {
      if (phase === 'finishing') {
        peer.close();
        onConnection('disconnected');
        showNotice('Chưa nhận được xác nhận dừng. Kết nối lại trước khi bắt đầu lượt mới.');
      }
    }, 20000);
  }
}

async function start() {
  if (checking) {
    checking = false;
    $('signal-hint').textContent = '';
    void capture.close();
  }
  const version = ++generation;
  monitor.start(Date.now());
  phase = 'acquiring';
  connectionError = '';
  showNotice();
  render();
  try {
    const opened = await capture.open(sourceOptions());
    if (!opened || version !== generation) return;
    void refreshDevices();
    if (!peer.open || document.hidden) throw new Error('Trang không còn kết nối hoặc đã bị ẩn. Nhấn bắt đầu để thử lại.');
    phase = 'starting';
    render();
    if (!peer.send({ type: 'start' })) throw new Error('Không gửi được yêu cầu thu âm. Hãy kết nối lại.');
    startupTimer = setTimeout(() => halt('Dịch vụ nhận giọng nói chưa sẵn sàng. Micro đã dừng; hãy thử lại.'), 25000);
  } catch (error) {
    if (version !== generation) return;
    await halt(micErrorMessage(error));
  }
}

function onEvent(event) {
  if (event.type === 'snapshot' || event.type === 'status') {
    if (event.type === 'snapshot') {
      connected = true;
      preview.snapshot(event);
    }
    serverStatus = event.status;
    showStatus(event.status, event.message);
    if (event.status === 'finishing') {
      endCheck('finishing');
      if (active()) void halt('Micro đã dừng. Đang hoàn tất phụ đề.', false);
      phase = 'finishing';
    } else if (['paused', 'idle', 'ready', 'error'].includes(event.status)) {
      clearTimeout(finishTimer);
      if (phase !== 'acquiring' && active()) void halt('', false);
      if (phase === 'finishing') phase = 'idle';
    }
    render();
  } else if (event.type === 'ready' && phase === 'starting') {
    clearTimeout(startupTimer);
    phase = 'recording';
    $('source-panel').open = false;
    capture.record();
    showStatus('listening');
    if (event.maxMinutes) limitTimer = setTimeout(() => halt(`Đã đủ ${event.maxMinutes} phút. Micro đã dừng; nhấn Bắt đầu nói để mở lượt thu tiếp theo.`, true, true), event.maxMinutes * 60000);
    render();
  } else if (event.type === 'interim' || (event.type === 'caption' && event.caption?.vi)) {
    preview.update(event);
  } else if (event.type === 'error') {
    connectionError = event.message || 'Có lỗi xảy ra. Micro đã dừng.';
    if (!connected) {
      ended = true;
      void halt('', false);
      peer.close();
      showStatus('closed', 'Phiên không hợp lệ');
      showNotice(`${connectionError} Hãy quét lại mã QR của phiên mới.`);
      render();
      return;
    }
    void halt(connectionError, ['connecting', 'listening'].includes(serverStatus));
  } else if (event.type === 'closed') {
    ended = true;
    connected = false;
    clearTimeout(finishTimer);
    void halt(event.message || 'Phiên đã kết thúc. Quét mã QR của một phiên mới.', false);
    peer.close();
    showStatus('closed');
  }
}

function onConnection(state) {
  connected = false;
  if (ended) return;
  showStatus(state);
  clearTimeout(finishTimer);
  if (state === 'disconnected') void halt(connectionError || 'Đã mất kết nối. Micro đã tắt. Kết nối lại rồi nhấn bắt đầu khi bạn sẵn sàng.', false);
  render();
}

const peer = new RoomSocket('mic', auth, onEvent, onConnection);
$('mic-button').addEventListener('click', () => active() ? halt('', true, true) : start());
$('signal-check').addEventListener('click', () => (checking ? endCheck('halt') : void startCheck()));
$('audio-device').addEventListener('change', (event) => changeSource({ deviceId: event.target.value }));
$('mixer-mode').addEventListener('change', (event) => changeSource({ mixer: event.target.checked }));
navigator.mediaDevices?.addEventListener?.('devicechange', () => void refreshDevices());
{
  const prefs = sourceOptions();
  $('mixer-mode').checked = prefs.mixer;
  if (prefs.mixer || prefs.deviceId) $('source-panel').open = true;
  render();
  void refreshDevices();
}
$('reconnect').addEventListener('click', () => { connectionError = ''; showNotice(); peer.connect(); });
document.addEventListener('visibilitychange', () => {
  if (document.hidden) endCheck('hidden');
  if (document.hidden && active()) void halt('Đã dừng micro khi rời trang. Nhấn bắt đầu khi bạn quay lại.');
});
window.addEventListener('pagehide', () => {
  if (active()) peer.send({ type: 'stop' });
  void halt('', false);
  peer.close();
});
window.addEventListener('pageshow', (event) => {
  if (event.persisted && !ended && auth.room && auth.token) peer.connect();
});
if (!auth.room || !auth.token) {
  ended = true;
  showStatus('error', 'Chưa có phiên kết nối');
  showNotice('Mở live trans trên màn hình lớn, tạo phiên rồi quét mã QR bằng điện thoại.');
  render();
} else peer.connect();
