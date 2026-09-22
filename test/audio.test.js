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
