import test from 'node:test';
import assert from 'node:assert/strict';
import { loadSourcePrefs, saveSourcePrefs, deviceOptions, sourceControlsLocked, checkShouldEnd, micErrorMessage,
  createSignalMonitor, PENDING_DEVICE_LABEL, DEFAULT_DEVICE_LABEL } from '../public/source-panel-state.js';
import { BUSY_DEVICE_MESSAGE } from '../public/audio-source.js';

function memoryStorage() {
  const data = new Map();
  return { getItem: (key) => (data.has(key) ? data.get(key) : null), setItem: (key, value) => data.set(key, String(value)) };
}
const brokenStorage = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } };
const named = (name) => Object.assign(new Error(`raw ${name}`), { name });

test('source prefs merge, survive reload and storage errors', () => {
  const storage = memoryStorage();
  assert.deepEqual(loadSourcePrefs(storage), { deviceId: '', mixer: false });
  saveSourcePrefs(storage, { deviceId: 'abc' });
  saveSourcePrefs(storage, { mixer: true });
  assert.deepEqual(loadSourcePrefs(storage), { deviceId: 'abc', mixer: true });
  saveSourcePrefs(storage, { deviceId: '' });
  assert.deepEqual(loadSourcePrefs(storage), { deviceId: '', mixer: true });
  assert.deepEqual(loadSourcePrefs(brokenStorage), { deviceId: '', mixer: false });
  assert.deepEqual(saveSourcePrefs(brokenStorage, { mixer: true }), { deviceId: '', mixer: true });
  assert.deepEqual(loadSourcePrefs(null), { deviceId: '', mixer: false });
});

test('device options keep the saved device before permission', () => {
  const before = deviceOptions([{ deviceId: '', label: '' }], 'abc', '');
  assert.deepEqual(before.map((o) => o.label), [DEFAULT_DEVICE_LABEL, PENDING_DEVICE_LABEL]);
  assert.equal(before.find((o) => o.selected).value, 'abc');
  const granted = deviceOptions([{ deviceId: 'abc', label: 'USB Audio CODEC' }, { deviceId: 'mac', label: 'MacBook Mic' }], 'abc', '');
  assert.deepEqual(granted.map((o) => o.label), [DEFAULT_DEVICE_LABEL, 'USB Audio CODEC', 'MacBook Mic']);
  assert.equal(granted.find((o) => o.selected).value, 'abc');
  // After a fallback the select shows what is really in use, while the saved id stays listed.
  const fallback = deviceOptions([{ deviceId: 'mac', label: 'MacBook Mic' }], 'abc', 'mac');
  assert.equal(fallback.find((o) => o.selected).value, 'mac');
  assert.ok(fallback.some((o) => o.value === 'abc' && o.label === PENDING_DEVICE_LABEL));
  assert.equal(deviceOptions([], '', '').find((o) => o.selected).value, '');
});

test('source controls lock outside idle', () => {
  for (const phase of ['acquiring', 'starting', 'recording', 'finishing']) assert.equal(sourceControlsLocked(phase), true);
  assert.equal(sourceControlsLocked('idle'), false);
});

test('signal check ends on hide, halt, finishing and error', () => {
  for (const event of ['hidden', 'halt', 'finishing', 'error']) assert.equal(checkShouldEnd(event), true);
  for (const event of ['listening', 'ready', 'interim']) assert.equal(checkShouldEnd(event), false);
});

test('signal monitor shows clipping and low level and resets per check', () => {
  const monitor = createSignalMonitor();
  monitor.start(0);
  monitor.push(100, 0.99);
  assert.equal(monitor.hints(1599).clipping, true);
  assert.equal(monitor.hints(1600).clipping, false);
  const quiet = createSignalMonitor();
  quiet.start(0);
  for (let t = 0; t <= 2900; t += 100) quiet.push(t, 0.01);
  assert.equal(quiet.hints(2999).low, false, 'not enough data yet');
  quiet.push(3000, 0.01);
  assert.equal(quiet.hints(3000).low, true);
  quiet.push(3100, 0.06);
  assert.equal(quiet.hints(3100).low, false);
  // A new check forgets the previous one's history.
  quiet.start(5000);
  quiet.push(5100, 0.01);
  assert.equal(quiet.hints(5100).low, false);
  assert.equal(quiet.hints(5100).clipping, false);
  // Clipping seen in the previous check must not leak into the next one.
  const restarted = createSignalMonitor();
  restarted.start(0);
  restarted.push(100, 0.99);
  restarted.start(200);
  assert.equal(restarted.hints(300).clipping, false);
});

test('mic error messages prefer the busy-device text', () => {
  assert.equal(micErrorMessage(named('NotReadableError')), BUSY_DEVICE_MESSAGE);
  assert.match(micErrorMessage(named('NotAllowedError')), /Chưa được phép dùng micro/);
  assert.match(micErrorMessage(named('NotFoundError')), /Không tìm thấy micro/);
  assert.equal(micErrorMessage(named('AbortError')), 'raw AbortError');
});
