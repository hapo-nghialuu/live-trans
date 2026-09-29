import { $, showNotice } from './shared.js';

const hash = new URLSearchParams(location.hash.slice(1));
let accessKey = hash.get('access') || '';
if (accessKey) history.replaceState(null, '', location.pathname);

const names = { gemini: 'Gemini', deepgram: 'Deepgram' };
let savedProvider = '';
let requiresAccess = false;

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
    savedProvider = pick.value;
    requiresAccess = Boolean(config.requiresAccess);
    $('settings-access-field').hidden = !requiresAccess || Boolean(accessKey);
    pick.disabled = false;
    $('settings-note').textContent = config.requiresAccess && !accessKey
      ? 'Nhập mã truy cập để lưu lựa chọn.'
      : 'Lựa chọn áp dụng trên máy chủ cho mọi phiên mới.';
    pick.addEventListener('change', save);
  } catch (error) {
    $('settings-note').textContent = 'Không kết nối được. Tải lại trang để thử lại.';
    showNotice(error.message);
  }
}

async function save() {
  const pick = $('provider-pick');
  const provider = pick.value;
  const key = $('settings-access').value || accessKey;
  if (requiresAccess && !key) {
    pick.value = savedProvider;
    $('settings-note').textContent = 'Nhập mã truy cập trước khi đổi nhà cung cấp.';
    $('settings-access').focus();
    return;
  }
  pick.disabled = true;
  $('settings-note').textContent = 'Đang lưu…';
  try {
    const response = await fetch('api/provider', { method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(key ? { 'x-access-key': key } : {}) },
      body: JSON.stringify({ provider }), signal: AbortSignal.timeout(15000) });
    const result = await response.json();
    if (!response.ok) {
      if (response.status === 401) {
        accessKey = '';
        $('settings-access-field').hidden = false;
      }
      throw new Error(result.error || 'Lưu thất bại.');
    }
    savedProvider = provider;
    accessKey = key;
    $('settings-access').value = '';
    $('settings-access-field').hidden = true;
    $('settings-note').textContent = `Đã lưu ${names[provider] || provider} — mọi phiên mới sẽ dùng nhà cung cấp này.`;
  } catch (error) {
    pick.value = savedProvider;
    $('settings-note').textContent = error.message;
  } finally {
    pick.disabled = false;
  }
}

load();
