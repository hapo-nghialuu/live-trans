import { $, credentials, RoomSocket, showNotice, showStatus } from './shared.js';
import { AudioCapture } from './audio-capture.js';
import { MicrophonePreview } from './microphone-preview.js';

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
const active = () => ['acquiring', 'starting', 'recording'].includes(phase);

const capture = new AudioCapture({
  onAudio: (pcm) => {
    if (phase !== 'recording' && !flushing) return;
    if (!peer.open || peer.bufferedAmount + pcm.byteLength > 128 * 1024) {
      halt('Mạng không theo kịp âm thanh. Micro đã dừng; kiểm tra mạng trước khi bắt đầu lại.');
    } else if (!peer.send(pcm)) halt('Gửi âm thanh thất bại. Micro đã dừng để bạn kiểm tra kết nối.');
  },
  onLevel: (rms) => { $('audio-level').value = Math.min(1, rms * 5); },
  onError: (message) => halt(message),
  onWake: (message) => { $('wake-status').textContent = message; },
});

function render() {
  const blocked = !connected || ended || phase === 'finishing' || (phase === 'idle' && ['connecting', 'listening', 'finishing'].includes(serverStatus));
  $('mic-button').disabled = blocked;
  $('mic-button').setAttribute('aria-pressed', String(active()));
  $('mic-button-label').textContent = phase === 'recording' ? 'Dừng thu âm' : active() ? 'Hủy bắt đầu' : phase === 'finishing' ? 'Đang hoàn tất…' : 'Bắt đầu nói';
  $('mic-guidance').textContent = phase === 'recording' ? 'Micro đang mở. Nói tự nhiên, rõ ràng.' : phase === 'acquiring' ? 'Cho phép dùng micro khi trình duyệt hỏi.' : phase === 'starting' ? 'Đang kết nối dịch vụ nhận giọng nói…' : phase === 'finishing' ? 'Đợi hoàn tất câu cuối trước khi bắt đầu lượt mới.' : 'Nhấn để bắt đầu. Micro hiện đang tắt.';
  $('reconnect').hidden = connected || ended || $('connection-status').dataset.state === 'connecting';
}

async function halt(message = '', notify = true, flush = false) {
  const wasStarted = ['starting', 'recording'].includes(phase);
  const version = ++generation;
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
  const version = ++generation;
  phase = 'acquiring';
  connectionError = '';
  showNotice();
  render();
  try {
    const opened = await capture.open();
    if (!opened || version !== generation) return;
    if (!peer.open || document.hidden) throw new Error('Trang không còn kết nối hoặc đã bị ẩn. Nhấn bắt đầu để thử lại.');
    phase = 'starting';
    render();
    if (!peer.send({ type: 'start' })) throw new Error('Không gửi được yêu cầu thu âm. Hãy kết nối lại.');
    startupTimer = setTimeout(() => halt('Dịch vụ nhận giọng nói chưa sẵn sàng. Micro đã dừng; hãy thử lại.'), 25000);
  } catch (error) {
    if (version !== generation) return;
    const message = error.name === 'NotAllowedError' ? 'Chưa được phép dùng micro. Cho phép micro trong cài đặt trình duyệt rồi nhấn bắt đầu.' : error.name === 'NotFoundError' ? 'Không tìm thấy micro. Hãy kiểm tra thiết bị của bạn.' : error.message;
    await halt(message);
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
    capture.record();
    showStatus('listening');
    limitTimer = setTimeout(() => halt('Đã đủ 9 phút. Micro đã dừng; nhấn Bắt đầu nói để mở lượt thu tiếp theo.', true, true), 9 * 60 * 1000);
    render();
  } else if (event.type === 'interim' || (event.type === 'caption' && event.caption?.vi)) {
    preview.update(event);
  } else if (event.type === 'error') {
    connectionError = event.message || 'Có lỗi xảy ra. Micro đã dừng.';
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
$('reconnect').addEventListener('click', () => { connectionError = ''; showNotice(); peer.connect(); });
document.addEventListener('visibilitychange', () => {
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
