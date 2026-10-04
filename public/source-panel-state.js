// Pure state for the "Nguồn âm thanh" panel on the mic page — no DOM access, tested in Node.
import { deviceErrorMessage } from './audio-source.js';

const DEVICE_KEY = 'live-trans.mic.deviceId';
const MIXER_KEY = 'live-trans.mic.mixer';
const DEFAULT_PREFS = Object.freeze({ deviceId: '', mixer: false });
export const PENDING_DEVICE_LABEL = 'Thiết bị đã chọn (cần cấp quyền)';
export const DEFAULT_DEVICE_LABEL = 'Micro mặc định';

/** Storage is the source of truth; private windows or blocked storage fall back to defaults. */
export function loadSourcePrefs(storage) {
  try {
    return { deviceId: storage.getItem(DEVICE_KEY) || '', mixer: storage.getItem(MIXER_KEY) === '1' };
  } catch {
    return { ...DEFAULT_PREFS };
  }
}

/** Merge so that toggling mixer mode never forgets the chosen device, and vice versa. */
export function saveSourcePrefs(storage, patch) {
  const next = { ...loadSourcePrefs(storage), ...patch };
  try {
    storage.setItem(DEVICE_KEY, next.deviceId);
    storage.setItem(MIXER_KEY, next.mixer ? '1' : '0');
  } catch {}
  return next;
}

/** Options for the device <select>; keeps the saved device visible before the browser reveals labels. */
export function deviceOptions(devices, savedId = '', activeId = '') {
  const options = [{ value: '', label: DEFAULT_DEVICE_LABEL }];
  let index = 0;
  for (const device of devices || []) {
    if (!device?.deviceId || options.some((option) => option.value === device.deviceId)) continue;
    index++;
    const pending = device.deviceId === savedId && !device.label;
    options.push({ value: device.deviceId, label: pending ? PENDING_DEVICE_LABEL : device.label || `Micro ${index}` });
  }
  if (savedId && !options.some((option) => option.value === savedId)) options.push({ value: savedId, label: PENDING_DEVICE_LABEL });
  const has = (id) => id && options.some((option) => option.value === id);
  const selected = has(activeId) ? activeId : has(savedId) ? savedId : '';
  return options.map((option) => ({ ...option, selected: option.value === selected }));
}

export function sourceControlsLocked(phase) {
  return ['acquiring', 'starting', 'recording', 'finishing'].includes(phase);
}

/** Events that must end a running signal check. */
export function checkShouldEnd(event) {
  return ['hidden', 'halt', 'finishing', 'error'].includes(event);
}

export function micErrorMessage(error) {
  const device = deviceErrorMessage(error);
  if (device) return device;
  if (error?.name === 'NotAllowedError') return 'Chưa được phép dùng micro. Cho phép micro trong cài đặt trình duyệt rồi nhấn bắt đầu.';
  if (error?.name === 'NotFoundError') return 'Không tìm thấy micro. Hãy kiểm tra thiết bị của bạn.';
  return error?.message || String(error);
}

/** Clipping is held for clipHold ms; "too quiet" needs a full lowWindow of data from the current check. */
export function createSignalMonitor({ clipHold = 1500, lowWindow = 3000, lowPeak = 0.05, clipPeak = 0.98 } = {}) {
  let startedAt = 0, lastClipAt = -Infinity, peaks = [];
  const recent = (now) => peaks.filter((sample) => now - sample.at <= lowWindow);
  return {
    start(now) { startedAt = now; lastClipAt = -Infinity; peaks = []; },
    push(now, peak) {
      if (peak >= clipPeak) lastClipAt = now;
      peaks = recent(now);
      peaks.push({ at: now, peak });
    },
    hints(now) {
      const window = recent(now);
      return {
        clipping: now - lastClipAt < clipHold,
        low: now - startedAt >= lowWindow && window.length > 0 && window.every((sample) => sample.peak < lowPeak),
      };
    },
  };
}
