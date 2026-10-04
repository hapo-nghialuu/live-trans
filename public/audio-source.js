// Pure helpers shared by the capture page, the AudioWorklet and Node tests — no DOM access here.

export const FALLBACK_NOTICE = 'Không thấy thiết bị đã chọn, đang dùng micro mặc định.';
export const BUSY_DEVICE_MESSAGE = 'Thiết bị âm thanh đang bị ứng dụng khác dùng. Đóng ứng dụng đó rồi thử lại.';

/** getUserMedia audio constraints. Mixer mode turns off browser processing meant for phone mics. */
export function audioConstraints({ deviceId = '', mixer = false } = {}) {
  const processing = !mixer;
  const audio = { channelCount: 1, echoCancellation: processing, noiseSuppression: processing, autoGainControl: processing };
  if (deviceId) audio.deviceId = { exact: deviceId };
  return audio;
}

export function isMissingDevice(error) {
  return error?.name === 'OverconstrainedError' || error?.name === 'NotFoundError';
}

export function deviceErrorMessage(error) {
  return error?.name === 'NotReadableError' ? BUSY_DEVICE_MESSAGE : null;
}

/** Open the chosen device; if it is gone, fall back to the default one and only then tell the user. */
export async function openStream(getUserMedia, { deviceId = '', mixer = false } = {}, onNotice) {
  try {
    return await getUserMedia({ audio: audioConstraints({ deviceId, mixer }) });
  } catch (error) {
    if (!deviceId || !isMissingDevice(error)) throw error;
    const stream = await getUserMedia({ audio: audioConstraints({ mixer }) });
    onNotice?.(FALLBACK_NOTICE);
    return stream;
  }
}

/** Accumulates every frame so short peaks between reports are never missed. */
export function createLevelReporter(every = 12, threshold = 0.98) {
  let frames = 0, sum = 0, samples = 0, peak = 0;
  return {
    push(frame) {
      for (const value of frame) {
        sum += value * value;
        const magnitude = Math.abs(value);
        if (magnitude > peak) peak = magnitude;
      }
      samples += frame.length;
      if (++frames < every) return null;
      const report = { rms: samples ? Math.sqrt(sum / samples) : 0, peak, clipping: peak >= threshold };
      frames = 0; sum = 0; samples = 0; peak = 0;
      return report;
    },
  };
}
