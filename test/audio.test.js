import test from 'node:test';
import assert from 'node:assert/strict';
import { createResampler, floatToPcm16 } from '../public/resampler.js';

for (const sampleRate of [16000, 44100, 48000]) {
  test(`PCM resampling ${sampleRate}Hz preserves duration and chunk continuity`, () => {
    const input = Float32Array.from({ length: sampleRate }, (_, i) => 0.5 * Math.sin(2 * Math.PI * 440 * i / sampleRate));
    const whole = createResampler(sampleRate).push(input);
    const chunked = createResampler(sampleRate), chunks = [];
    for (let offset = 0; offset < input.length; offset += 128) chunks.push(...chunked.push(input.subarray(offset, offset + 128)));
    assert.equal(whole.length, 16000);
    assert.deepEqual(Float32Array.from(chunks), whole);
    assert.ok(Math.max(...whole) > 0.49);
    assert.ok(Math.min(...whole) < -0.49);
  });
}
test('PCM16 conversion clamps and uses signed little-endian representation', () => {
  const buffer = floatToPcm16(Float32Array.from([-2, -1, 0, 1, 2]));
  assert.equal(buffer.byteLength, 10);
  const view = new DataView(buffer);
  assert.deepEqual(Array.from({ length: 5 }, (_, i) => view.getInt16(i * 2, true)), [-32768, -32768, 0, 32767, 32767]);
  assert.deepEqual(Array.from(new Uint8Array(buffer).slice(0, 2)), [0, 128]);
});

const { audioConstraints, openStream, deviceErrorMessage, isMissingDevice, createLevelReporter,
  FALLBACK_NOTICE, BUSY_DEVICE_MESSAGE } = await import('../public/audio-source.js');
const deviceError = (name) => Object.assign(new Error(name), { name });

test('audio source constraints follow mixer mode', () => {
  const mixer = audioConstraints({ mixer: true });
  assert.deepEqual([mixer.echoCancellation, mixer.noiseSuppression, mixer.autoGainControl], [false, false, false]);
  for (const options of [{ mixer: false }, {}, undefined]) {
    const phone = audioConstraints(options);
    assert.deepEqual([phone.echoCancellation, phone.noiseSuppression, phone.autoGainControl], [true, true, true]);
    assert.equal(phone.channelCount, 1);
  }
  assert.equal(mixer.channelCount, 1);
});
test('audio source constraints pin the chosen device', () => {
  assert.deepEqual(audioConstraints({ deviceId: 'abc' }).deviceId, { exact: 'abc' });
  assert.equal('deviceId' in audioConstraints({}), false);
  assert.equal('deviceId' in audioConstraints({ deviceId: '' }), false);
});
test('audio source falls back when the chosen device is gone', async () => {
  for (const name of ['OverconstrainedError', 'NotFoundError']) {
    const calls = [], notices = [];
    const stream = await openStream(async (c) => {
      calls.push(c.audio);
      if (calls.length === 1) throw deviceError(name);
      return 'default-stream';
    }, { deviceId: 'usb', mixer: true }, (m) => notices.push(m));
    assert.equal(stream, 'default-stream');
    assert.deepEqual(calls[0].deviceId, { exact: 'usb' });
    assert.equal('deviceId' in calls[1], false);
    assert.equal(calls[1].autoGainControl, false);
    assert.deepEqual(notices, [FALLBACK_NOTICE]);
  }
  // No usable microphone at all: the retry fails too, so no fallback notice may appear.
  const notices = [];
  await assert.rejects(openStream(async () => { throw deviceError('NotFoundError'); }, { deviceId: 'usb' }, (m) => notices.push(m)),
    { name: 'NotFoundError' });
  assert.deepEqual(notices, []);
  // Permission problems are not device problems and must not be retried.
  let attempts = 0;
  await assert.rejects(openStream(async () => { attempts++; throw deviceError('NotAllowedError'); }, { deviceId: 'usb' }),
    { name: 'NotAllowedError' });
  assert.equal(attempts, 1);
  assert.equal(isMissingDevice(deviceError('NotAllowedError')), false);
});
test('audio source reports a busy device in Vietnamese', () => {
  assert.equal(deviceErrorMessage(deviceError('NotReadableError')), BUSY_DEVICE_MESSAGE);
  assert.equal(deviceErrorMessage(deviceError('NotAllowedError')), null);
  assert.equal(deviceErrorMessage(undefined), null);
});
test('level reporter keeps the peak from every frame', () => {
  const reporter = createLevelReporter();
  const silent = new Float32Array(128);
  const spike = Float32Array.from({ length: 128 }, (_, i) => (i === 5 ? 0.99 : 0));
  const reports = Array.from({ length: 12 }, (_, i) => reporter.push(i === 2 ? spike : silent));
  assert.deepEqual(reports.slice(0, 11), Array(11).fill(null));
  assert.ok(Math.abs(reports[11].peak - 0.99) < 1e-6);
  assert.equal(reports[11].clipping, true);
  assert.ok(reports[11].rms > 0);
  const next = Array.from({ length: 12 }, () => reporter.push(silent)).at(-1);
  assert.deepEqual(next, { rms: 0, peak: 0, clipping: false });
  const below = createLevelReporter(1).push(Float32Array.from([0.5, -0.97]));
  assert.equal(below.clipping, false);
  assert.ok(Math.abs(below.peak - 0.97) < 1e-6);
});
