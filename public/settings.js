import { $, showNotice } from './shared.js';

const KEY = 'lt-provider';
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
    const saved = localStorage.getItem(KEY);
    pick.value = available.includes(saved) ? saved : (config.defaultProvider || available[0]);
    pick.disabled = false;
    $('settings-note').textContent = 'Lựa chọn được lưu ngay khi đổi.';
    pick.addEventListener('change', () => {
      localStorage.setItem(KEY, pick.value);
      $('settings-note').textContent = `Đã lưu: ${names[pick.value] || pick.value}. Áp dụng cho phiên tạo sau.`;
    });
  } catch (error) {
    $('settings-note').textContent = 'Không kết nối được. Tải lại trang để thử lại.';
    showNotice(error.message);
  }
}

load();
