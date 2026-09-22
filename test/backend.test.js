import test from 'node:test';
import assert from 'node:assert/strict';
import WebSocket from 'ws';
import { createConnection } from 'node:net';
import { createApp } from '../server/app.js';
import { equalSecret } from '../server/rooms.js';
import { TranslationQueue } from '../server/translation.js';

async function setup(t) {
  const config = { publicUrl: 'https://test.example/live-trans/', accessKey: 'private-test-access',
    apiKey: 'test-placeholder-never-sent', origins: new Set(['https://test.example']) };
  const app = createApp(config);
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${app.server.address().port}`;
  config.origins.add(origin);
  t.after(() => app.close());
  return { ...app, origin, config };
}
async function socket(origin, payload) {
  const ws = new WebSocket(origin.replace('http:', 'ws:') + '/socket', { origin });
  const events = [];
  ws.on('message', d => events.push(JSON.parse(d)));
  await new Promise((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject); });
  ws.send(JSON.stringify(payload));
  const began = Date.now();
  while (!events.length && Date.now() - began < 1000) await new Promise(r => setTimeout(r, 10));
  return { ws, events };
}
test('constant-time secret comparison rejects non-ASCII and wrong values safely', () => {
  assert.equal(equalSecret('a', 'a'), true);
  for (const value of ['é', 'b', '', null, ['a']]) assert.equal(equalSecret(value, 'a'), false);
});
test('room creation needs valid access key AND allowed origin; path cannot read secrets', async t => {
  const { origin } = await setup(t);
  const post = headers => fetch(origin + '/api/rooms', { method: 'POST', headers });
  assert.equal((await post({ Origin: origin })).status, 401);
  assert.equal((await post({ Origin: 'https://evil.example', 'x-access-key': 'private-test-access' })).status, 403);
  const ok = await post({ Origin: origin, 'x-access-key': 'private-test-access' });
  assert.equal(ok.status, 201);
  const room = await ok.json();
  assert.ok(room.qr.startsWith('data:image/png;base64,'));
  assert.ok(room.micUrl.startsWith('https://test.example/live-trans/mic.html#'));
  assert.equal((await fetch(origin + '/%2e%2e%2f.env')).status, 404);
  const publicConfig = await (await fetch(origin + '/api/config')).json();
  assert.deepEqual(publicConfig, { ready: true, requiresAccess: true });
});
test('tokens are scoped by room and role, expire, and revoke on end', async t => {
  const { rooms } = await setup(t);
  const a = await rooms.create(), b = await rooms.create();
  assert.ok(rooms.authenticate(a.room, 'viewer', a.token));
  assert.equal(rooms.authenticate(a.room, 'mic', a.token), null);
  assert.equal(rooms.authenticate(b.room, 'viewer', a.token), null);
  rooms.rooms.get(a.room).expires = Date.now() - 1;
  assert.equal(rooms.authenticate(a.room, 'viewer', a.token), null);
  rooms.end(rooms.rooms.get(b.room));
  assert.equal(rooms.authenticate(b.room, 'viewer', b.token), null);
});
test('simultaneous room creation cannot exceed room limit', async t => {
  const { rooms } = await setup(t);
  const results = await Promise.allSettled(Array.from({ length: 5 }, () => rooms.create()));
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 3);
  assert.equal(rooms.rooms.size, 3);
});
test('WebSocket rejects invalid token and a second microphone', async t => {
  const { origin, rooms } = await setup(t);
  const created = await rooms.create();
  const invalid = await socket(origin, { type: 'join', room: created.room, role: 'viewer', token: 'bad' });
  assert.equal(invalid.events[0].type, 'error'); invalid.ws.close();
  const token = new URLSearchParams(new URL(created.micUrl).hash.slice(1)).get('token');
  const join = { type: 'join', room: created.room, role: 'mic', token };
  const first = await socket(origin, join), second = await socket(origin, join);
  assert.ok(first.events.some(e => e.type === 'snapshot'));
  assert.equal(second.events[0].type, 'error');
  assert.equal(rooms.rooms.get(created.room).mic !== null, true);
  first.ws.close(); second.ws.close();
});
test('viewer cannot upload audio; cross-origin websocket is rejected', async t => {
  const { origin, rooms } = await setup(t);
  const room = await rooms.create();
  const viewer = await socket(origin, { type: 'join', room: room.room, role: 'viewer', token: room.token });
  viewer.ws.send(Buffer.alloc(3200));
  await new Promise(resolve => viewer.ws.once('close', resolve));
  assert.ok(viewer.events.some(e => e.type === 'error'));
  const denied = new WebSocket(origin.replace('http:', 'ws:') + '/socket', { origin: 'https://evil.example' });
  const error = await new Promise(resolve => denied.once('error', resolve));
  assert.match(error.message, /403/);
});
test('translation queue preserves order and reports bounded overload, close suppresses late work', async () => {
  const updates = [], releases = [];
  const queue = new TranslationQueue(() => new Promise(resolve => releases.push(resolve)), c => updates.push(c));
  for (let id = 1; id <= 8; id++) queue.push({ id, vi: `câu ${id}` }, '');
  assert.equal(updates[0].id, 8); assert.equal(updates[0].status, 'error');
  releases.shift()({ en: 'one', ja: '一' });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(updates[1].id, 1);
  queue.close(); releases.shift()({ en: 'two', ja: '二' });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(updates.length, 2);
});
test('malformed WebSocket URL returns 400 without crashing the HTTP server', async t => {
  const { origin } = await setup(t);
  const url = new URL(origin);
  const result = await new Promise((resolve, reject) => {
    const socket = createConnection({ host: '127.0.0.1', port: Number(url.port) });
    let data = '';
    socket.on('connect', () => socket.write('GET //[ HTTP/1.1\r\nHost: localhost\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n'));
    socket.on('data', chunk => { data += chunk; });
    socket.on('end', () => resolve(data)); socket.on('error', reject);
    socket.setTimeout(1000, () => { socket.destroy(); reject(new Error('socket timeout')); });
  });
  assert.match(result, /^HTTP\/1.1 400/);
  assert.equal((await fetch(origin + '/api/health')).status, 200);
});
test('late translation cannot resurrect an evicted caption', async t => {
  const { rooms } = await setup(t);
  const created = await rooms.create(), room = rooms.rooms.get(created.room);
  room.sequence = 31;
  room.captions = Array.from({ length: 30 }, (_, i) => ({ id: i + 2, vi: 'đã nhận', status: 'done' }));
  rooms.updateCaption(room, { id: 1, vi: 'câu cũ', status: 'done', en: 'old', ja: '古い' });
  assert.equal(room.captions.length, 30);
  assert.equal(room.captions.at(-1).id, 31);
  assert.equal(room.captions[0].id, 2);
});
test('approved alias creates microphone link on that HTTPS hostname only', async t => {
  const { origin, config } = await setup(t);
  config.publicAliases = ['https://live.example/'];
  config.origins.add('https://live.example');
  const response = await fetch(origin + '/api/rooms', { method: 'POST',
    headers: { Origin: 'https://live.example', 'x-access-key': config.accessKey } });
  assert.equal(response.status, 201);
  assert.ok((await response.json()).micUrl.startsWith('https://live.example/mic.html#'));
});
