import { $, credentials, RoomSocket, showNotice, showStatus } from './shared.js';
import { Captions } from './captions.js';

const captions = new Captions();
const hash = new URLSearchParams(location.hash.slice(1));
let accessKey = hash.get('access') || '';
if (hash.has('access')) {
  hash.delete('access');
  history.replaceState(null, '', `${location.pathname}${location.search}${hash.size ? `#${hash}` : ''}`);
}
let peer;
let micUrl = '';
let ended = false;
let connectionError = '';

function showPhone(event) {
  if (typeof event.micUrl === 'string') micUrl = event.micUrl;
  if (event.qr?.startsWith('data:image/')) {
    $('qr').src = event.qr;
    $('qr').hidden = false;
    $('qr-loading').hidden = true;
  }
  $('copy-link').disabled = !micUrl;
}

function updateStatus(event) {
  showStatus(event.status, event.message);
  $('mic-status').textContent = event.micConnected ? 'Điện thoại đã kết nối' : 'Chưa có điện thoại kết nối';
  $('mic-status').classList.toggle('connected', Boolean(event.micConnected));
  $('pause-mic').disabled = !['listening', 'connecting'].includes(event.status);
}

function onEvent(event) {
  if (event.type === 'snapshot') {
    connectionError = '';
    showNotice();
    $('reconnect').hidden = true;
    captions.reset(event.captions, event.interim);
    showPhone(event);
    updateStatus(event);
  } else if (event.type === 'status') updateStatus(event);
  else if (event.type === 'caption') captions.update(event.caption);
  else if (event.type === 'interim') captions.setInterim(event.text);
  else if (event.type === 'error') {
    connectionError = event.message || 'Có lỗi xảy ra. Vui lòng thử lại.';
    showNotice(connectionError);
  }
  else if (event.type === 'closed') {
    ended = true;
    peer.close();
    showStatus('closed', event.message);
    showNotice('Phiên đã kết thúc. Mở trang chủ để tạo phiên mới.');
    $('reconnect').hidden = true;
    $('end-session').disabled = true;
    $('pause-mic').disabled = true;
    $('copy-link').disabled = true;
    $('qr').hidden = true;
    $('qr-loading').textContent = 'Phiên đã kết thúc';
    $('qr-loading').hidden = false;
  }
}

function openRoom(auth) {
  $('welcome').hidden = true;
  $('session').hidden = false;
  peer = new RoomSocket('viewer', auth, onEvent, (state) => {
    if (ended) return;
    showStatus(state);
    $('reconnect').hidden = state !== 'disconnected';
    $('pause-mic').disabled = true;
    if (state === 'disconnected') showNotice(connectionError || 'Mất kết nối với máy chủ. Nhấn Kết nối lại để tiếp tục nhận phụ đề.');
  });
  peer.connect();
}

async function configure() {
  try {
    const response = await fetch('api/config', { signal: AbortSignal.timeout(15000) });
    if (!response.ok) throw new Error('Không kiểm tra được máy chủ. Tải lại trang để thử lại.');
    const config = await response.json();
    $('access-field').hidden = !config.requiresAccess || Boolean(accessKey);
    $('create-button').disabled = !config.ready;
    $('config-note').textContent = config.ready ? 'Một phiên mới. Một cuộc trò chuyện bắt đầu.' : 'Máy chủ chưa sẵn sàng. Vui lòng kiểm tra cấu hình dịch vụ.';
  } catch (error) {
    $('config-note').textContent = 'Không kết nối được. Tải lại trang để thử lại.';
    showNotice(error.message);
  }
}

$('create-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  $('create-button').disabled = true;
  $('create-button').textContent = 'Đang tạo phiên…';
  showNotice();
  accessKey = $('access-key').value || accessKey;
  try {
    const response = await fetch('api/rooms', {
      method: 'POST', headers: accessKey ? { 'x-access-key': accessKey } : {},
      signal: AbortSignal.timeout(15000),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Không tạo được phiên. Vui lòng thử lại.');
    if (!result.room || !result.token) throw new Error('Máy chủ trả về phiên không hợp lệ.');
    $('access-key').value = '';
    const roomHash = new URLSearchParams({ room: result.room, token: result.token });
    history.replaceState(null, '', `${location.pathname}${location.search}#${roomHash}`);
    showPhone(result);
    openRoom({ room: result.room, token: result.token });
  } catch (error) {
    showNotice(error.message);
    $('access-field').hidden = false;
    $('create-button').disabled = false;
    $('create-button').textContent = 'Tạo phiên mới ↗';
  }
});

$('copy-link').addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(micUrl);
    $('copy-feedback').textContent = 'Đã sao chép. Gửi liên kết này cho điện thoại của bạn.';
  } catch {
    $('link-fallback').hidden = false;
    $('link-fallback').value = micUrl;
    $('link-fallback').select();
    $('copy-feedback').textContent = 'Chọn và sao chép liên kết bên dưới.';
  }
});
$('reconnect').addEventListener('click', () => { connectionError = ''; peer?.connect(); });
$('pause-mic').addEventListener('click', () => {
  if (peer?.send({ type: 'stop' })) $('pause-mic').disabled = true;
});
$('end-session').addEventListener('click', () => {
  if (window.confirm('Kết thúc phiên và ngắt micro trên điện thoại?')) {
    if (!peer?.send({ type: 'end' })) showNotice('Chưa kết nối với máy chủ. Kết nối lại rồi kết thúc phiên.');
  }
});
$('fullscreen').addEventListener('click', async () => {
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await document.documentElement.requestFullscreen();
  } catch { showNotice('Trình duyệt này không hỗ trợ toàn màn hình. Bạn vẫn có thể xem phụ đề bình thường.'); }
});
document.addEventListener('fullscreenchange', () => {
  $('fullscreen').textContent = document.fullscreenElement ? 'Thoát toàn màn hình' : 'Toàn màn hình';
});
window.addEventListener('pagehide', () => peer?.close());
window.addEventListener('pageshow', (event) => { if (event.persisted && peer && !ended) peer.connect(); });

const auth = credentials();
if (auth.room && auth.token) openRoom(auth);
else configure();
