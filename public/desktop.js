import { $, credentials, RoomSocket, showNotice, showStatus } from './shared.js';
import { Captions } from './captions.js';
import { setupPresentation, configureDisplays } from './presentation.js';

const captions = new Captions();
const presentation = setupPresentation();
const hash = new URLSearchParams(location.hash.slice(1));
let accessKey = hash.get('access') || '';
if (hash.has('access')) {
  hash.delete('access');
  history.replaceState(null, '', `${location.pathname}${location.search}${hash.size ? `#${hash}` : ''}`);
}
let peer;
let micUrl = '';
let ended = false;
let joined = false;
let connectionError = '';

function showPhone(event) {
  if (typeof event.micUrl === 'string') micUrl = event.micUrl;
  if (event.qr?.startsWith('data:image/')) {
    $('qr').src = event.qr;
    $('qr').hidden = false;
    $('qr-loading').hidden = true;
  }
  if (event.code) $('session-code').textContent = `${event.code.slice(0, 3)} ${event.code.slice(3)}`;
  $('copy-link').disabled = !micUrl;
}

function updateStatus(event) {
  showStatus(event.status, event.message);
  presentation.status(event.status);
  presentation.connection(event.micConnected);
  if (event.provider) {
    $('provider-badge').hidden = false;
    $('provider-badge').textContent = event.provider === 'deepgram' ? 'Deepgram' : 'Gemini';
  }
  $('mic-status').textContent = event.micConnected ? 'Điện thoại đã kết nối' : 'Chưa có điện thoại kết nối';
  $('mic-status').classList.toggle('connected', Boolean(event.micConnected));
  $('phone-panel').classList.toggle('is-connected', Boolean(event.micConnected));
  $('phone-instruction').textContent = event.micConnected
    ? 'Điện thoại đã kết nối. Bắt đầu nói trên điện thoại để hiện phụ đề.'
    : 'Quét QR trong app Live Trans hoặc nhập mã phiên bên dưới.';
  $('pause-mic').disabled = !['listening', 'connecting'].includes(event.status);
}

function backToWelcome(message) {
  presentation.reset();
  document.body.classList.remove('has-session');
  ended = true;
  peer?.close();
  history.replaceState(null, '', `${location.pathname}${location.search}`);
  $('session').hidden = true;
  $('welcome').hidden = false;
  $('join-code').value = '';
  micUrl = '';
  $('qr').hidden = true;
  $('qr-loading').hidden = false;
  $('session-code').textContent = '··· ···';
  $('copy-feedback').textContent = '';
  $('link-fallback').hidden = true;
  showNotice(message);
  $('create-button').focus();
  configure();
}

function onEvent(event) {
  if (event.type === 'snapshot') {
    joined = true;
    connectionError = '';
    showNotice();
    $('reconnect').hidden = true;
    $('end-session').disabled = false;
    captions.reset(event.captions, event.interim);
    showPhone(event);
    updateStatus(event);
  } else if (event.type === 'status') updateStatus(event);
  else if (event.type === 'caption') captions.update(event.caption);
  else if (event.type === 'interim') captions.setInterim(event.text);
  else if (event.type === 'error') {
    presentation.status('error');
    connectionError = event.message || 'Có lỗi xảy ra. Vui lòng thử lại.';
    if (!joined) return backToWelcome(connectionError);
    showNotice(connectionError);
    $('controls-error').textContent = connectionError;
    $('controls-error').hidden = false;
  }
  else if (event.type === 'closed') {
    backToWelcome(event.message || 'Phiên đã kết thúc.');
  }
}

function openRoom(auth) {
  ended = false;
  joined = false;
  presentation.connection(false);
  $('controls-error').hidden = true;
  $('end-session').disabled = false;
  document.body.classList.add('has-session');
  $('welcome').hidden = true;
  $('session').hidden = false;
  peer = new RoomSocket('viewer', auth, onEvent, (state) => {
    if (ended) return;
    showStatus(state);
    presentation.status(state);
    $('reconnect').hidden = state !== 'disconnected';
    $('pause-mic').disabled = true;
    if (state === 'disconnected') showNotice(connectionError || 'Mất kết nối với máy chủ. Nhấn Kết nối lại để tiếp tục nhận phụ đề.');
  });
  configureDisplays(auth);
  peer.connect();
}

async function configure() {
  try {
    const response = await fetch('api/config', { signal: AbortSignal.timeout(15000) });
    if (!response.ok) throw new Error('Không kiểm tra được máy chủ. Tải lại trang để thử lại.');
    const config = await response.json();
    $('access-field').hidden = !config.requiresAccess || Boolean(accessKey);
    $('create-button').disabled = !config.ready;
    $('config-note').textContent = config.ready ? '' : 'Máy chủ chưa sẵn sàng. Vui lòng kiểm tra cấu hình dịch vụ.';
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
  const wanted = $('session-code-pick').value.replace(/\D/g, '');
  if (wanted && wanted.length !== 6) {
    $('create-button').disabled = false;
    $('create-button').textContent = 'Tạo phiên mới';
    return showNotice('Mã phiên tự chọn cần đúng 6 chữ số, hoặc để trống để tự sinh.');
  }
  try {
    const params = new URLSearchParams();
    if (wanted) params.set('code', wanted);
    const response = await fetch(`api/rooms${params.size ? `?${params}` : ''}`, {
      method: 'POST', headers: accessKey ? { 'x-access-key': accessKey } : {},
      signal: AbortSignal.timeout(15000),
    });
    const result = await response.json();
    if (!response.ok) {
      if (response.status === 401) $('access-field').hidden = false;
      throw new Error(result.error || 'Không tạo được phiên. Vui lòng thử lại.');
    }
    if (!result.room || !result.token) throw new Error('Máy chủ trả về phiên không hợp lệ.');
    $('access-key').value = '';
    const roomHash = new URLSearchParams({ room: result.room, token: result.token });
    history.replaceState(null, '', `${location.pathname}${location.search}#${roomHash}`);
    showPhone(result);
    openRoom({ room: result.room, token: result.token });
  } catch (error) {
    showNotice(error.message);
    $('create-button').disabled = false;
    $('create-button').textContent = 'Tạo phiên mới';
  }
});

$('join-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const code = $('join-code').value.replace(/\D/g, '');
  if (code.length !== 6) return showNotice('Mã phiên gồm đúng 6 chữ số.');
  $('join-button').disabled = true;
  showNotice();
  try {
    const response = await fetch(`api/join?code=${code}&role=viewer`, { signal: AbortSignal.timeout(15000) });
    const result = await response.json();
    if (!response.ok || !result.room || !result.token) throw new Error(result.error || 'Không tìm thấy phiên với mã này.');
    const roomHash = new URLSearchParams({ room: result.room, token: result.token });
    history.replaceState(null, '', `${location.pathname}${location.search}#${roomHash}`);
    openRoom({ room: result.room, token: result.token });
  } catch (error) {
    showNotice(error.message);
  } finally {
    $('join-button').disabled = false;
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
$('leave-session').addEventListener('click', () => backToWelcome());
$('end-session').addEventListener('click', () => {
  if (!window.confirm('Kết thúc phiên cho mọi người? Micro sẽ ngắt và lịch sử phụ đề sẽ bị xóa.')) return;
  if (peer?.send({ type: 'end' })) $('end-session').disabled = true;
  else {
    $('controls-error').textContent = 'Chưa kết nối với máy chủ. Đóng bảng điều khiển và kết nối lại để kết thúc phiên.';
    $('controls-error').hidden = false;
  }
});
window.addEventListener('pagehide', () => peer?.close());
window.addEventListener('pageshow', (event) => { if (event.persisted && peer && !ended) peer.connect(); });

const auth = credentials();
if (auth.room && auth.token) openRoom(auth);
else configure();
