import { $, showNotice } from './shared.js';

const hash = new URLSearchParams(location.hash.slice(1));
const accessKey = hash.get('access') || '';
if (accessKey) history.replaceState(null, '', location.pathname);

const names = { gemini: 'Gemini', deepgram: 'Deepgram' };

async function load() {
  try {
    const response = await fetch('api/config', { signal: AbortSignal.timeout(15000) });
    if (!response.ok) throw new Error('Không kiểm tra được máy chủ. Tải lại trang để thử lại.');
    const config = await response.json();
    const available = Object.entries(config.providers || {}).filter(([, ok]) => ok).map(([name]) => name);
    const pick = $('provider-pick');
    if (!available.length) {
      $('settings-note').textContent = 'Máy chủ chưa cấu hình key nhận giọng nói nào.';
      return;
    }
    pick.innerHTML = available.map(name =>
      `<option value="${name}">${names[name] || name}</option>`).join('');
    if (available.includes(config.defaultProvider)) pick.value = config.defaultProvider;
    pick.disabled = false;
    $('settings-note').textContent = config.requiresAccess && !accessKey
      ? 'Máy chủ yêu cầu mã truy cập — mở trang với #access=…'
      : 'Lựa chọn áp dụng trên máy chủ cho mọi phiên mới.';
    pick.addEventListener('change', save);
  } catch (error) {
    $('settings-note').textContent = 'Không kết nối được. Tải lại trang để thử lại.';
    showNotice(error.message);
  }
}

async function save() {
  const provider = $('provider-pick').value;
  $('settings-note').textContent = 'Đang lưu…';
  try {
    const response = await fetch('api/provider', { method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(accessKey ? { 'x-access-key': accessKey } : {}) },
      body: JSON.stringify({ provider }), signal: AbortSignal.timeout(15000) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Lưu thất bại.');
    $('settings-note').textContent = `Đã lưu ${names[provider] || provider} — mọi phiên mới sẽ dùng nhà cung cấp này.`;
  } catch (error) {
    $('settings-note').textContent = error.message;
  }
}

load();
