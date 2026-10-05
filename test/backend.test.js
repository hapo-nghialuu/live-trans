import test from 'node:test';
import assert from 'node:assert/strict';
import WebSocket, { WebSocketServer } from 'ws';
import { createConnection } from 'node:net';
import { createApp } from '../server/app.js';
import { equalSecret } from '../server/rooms.js';
import { TranslationQueue } from '../server/translation.js';
import { DeepgramTranscriber } from '../server/deepgram.js';

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
  const font = await fetch(origin + '/fonts/be-vietnam-pro-400-vietnamese.woff2');
  assert.equal(font.status, 200);
  assert.equal(font.headers.get('content-type'), 'font/woff2');
  const publicConfig = await (await fetch(origin + '/api/config')).json();
  assert.deepEqual(publicConfig, { ready: true, requiresAccess: true,
    providers: { gemini: true, deepgram: false } });
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
test('numeric session code resolves to mic link, wrong codes are rejected and rate-limited', async t => {
  const { origin, rooms } = await setup(t);
  const created = await rooms.create();
  assert.match(created.code, /^\d{6}$/);
  const join = await fetch(`${origin}/api/join?code=${created.code}`);
  assert.equal(join.status, 200);
  const { url } = await join.json();
  assert.ok(url.includes(`room=${created.room}`));
  assert.ok(url.includes('token='));
  const viewerJoin = await fetch(`${origin}/api/join?code=${created.code}&role=viewer`);
  assert.equal(viewerJoin.status, 200);
  const vj = await viewerJoin.json();
  assert.equal(vj.room, created.room);
  assert.equal(vj.token, rooms.rooms.get(created.room).viewerToken);
  assert.ok(vj.url.includes(`room=${created.room}`));
  assert.equal((await fetch(`${origin}/api/join?code=000000`)).status === 404, true);
  for (let i = 0; i < 29; i++) await fetch(`${origin}/api/join?code=${100000 + i}`);
  assert.equal((await fetch(`${origin}/api/join?code=${created.code}`)).status, 429);
});
test('custom session code is used when free, conflicts rejected', async t => {
  const { origin, config } = await setup(t);
  const create = code => fetch(`${origin}/api/rooms${code ? `?code=${code}` : ''}`, { method: 'POST',
    headers: { Origin: origin, 'x-access-key': config.accessKey } });
  const first = await create('424242');
  assert.equal(first.status, 201);
  assert.equal((await first.json()).code, '424242');
  assert.equal((await create('424242')).status, 409);
  assert.equal((await create('12345')).status, 409);
  assert.equal((await create('777777')).status, 201);
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
test('provider param validates configured keys and is stored per room', async t => {
  const { origin, rooms, config } = await setup(t);
  const post = qs => fetch(`${origin}/api/rooms${qs}`, { method: 'POST',
    headers: { Origin: origin, 'x-access-key': config.accessKey } });
  assert.equal((await post('?provider=deepgram')).status, 409);
  assert.equal((await post('?provider=bogus')).status, 409);
  config.deepgramKey = 'dg-test';
  const ok = await post('?provider=deepgram');
  assert.equal(ok.status, 201);
  const created = await ok.json();
  assert.equal(rooms.rooms.get(created.room).provider, 'deepgram');
  const fallback = await post('');
  assert.equal(fallback.status, 201);
  assert.equal(rooms.rooms.get((await fallback.json()).room).provider, 'gemini');
});
test('POST /api/provider switches the global default for new rooms', async t => {
  const { origin, rooms, config } = await setup(t);
  config.deepgramKey = 'dg-test';
  const post = (body, headers = {}) => fetch(`${origin}/api/provider`, { method: 'POST',
    headers: { Origin: origin, 'Content-Type': 'application/json', 'x-access-key': config.accessKey, ...headers },
    body: JSON.stringify(body) });
  assert.equal((await post({ provider: 'deepgram' }, { 'x-access-key': 'wrong' })).status, 401);
  assert.equal((await post({ provider: 'bogus' })).status, 400);
  const ok = await post({ provider: 'deepgram' });
  assert.equal(ok.status, 200);
  assert.equal((await (await fetch(`${origin}/api/config`)).json()).defaultProvider, 'deepgram');
  const created = await rooms.create();
  assert.equal(rooms.rooms.get(created.room).provider, 'deepgram');
  assert.equal((await post({ provider: 'gemini' })).status, 200);
});
test('loadConfig reads persisted provider from settings file', async t => {
  const { loadConfig } = await import('../server/config.js');
  const { writeFileSync, mkdtempSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const dir = mkdtempSync(join(tmpdir(), 'lt-'));
  const file = join(dir, 'settings.json');
  writeFileSync(file, JSON.stringify({ provider: 'deepgram' }));
  const env = { PUBLIC_URL: 'https://t.example/', GOOGLE_API_KEY: 'AIza' + 'x'.repeat(35),
    DEEPGRAM_API_KEY: 'dg-test', SETTINGS_FILE: file };
  assert.equal(loadConfig(env).provider, 'deepgram');
  writeFileSync(file, JSON.stringify({ provider: 'gemini' }));
  assert.equal(loadConfig({ ...env, GOOGLE_API_KEY: '' }).provider, 'deepgram');
});
test('deepgram transcriber maps metadata/results into ready/interim/final callbacks', async () => {
  const wss = new WebSocketServer({ port: 0, host: '127.0.0.1' });
  await new Promise(resolve => wss.once('listening', resolve));
  let auth = '';
  const events = [];
  wss.on('connection', (ws, req) => {
    auth = req.headers.authorization;
    ws.send(JSON.stringify({ type: 'Metadata' }));
    ws.send(JSON.stringify({ type: 'Results', is_final: false, channel: { alternatives: [{ transcript: 'xin chào' }] } }));
    ws.send(JSON.stringify({ type: 'Results', is_final: true, speech_final: false, channel: { alternatives: [{ transcript: 'xin chào' }] } }));
    ws.send(JSON.stringify({ type: 'Results', is_final: true, speech_final: true, channel: { alternatives: [{ transcript: 'mọi người' }] } }));
  });
  const asr = new DeepgramTranscriber({ deepgramUrl: `ws://127.0.0.1:${wss.address().port}/v1/listen`,
    deepgramKey: 'dg-test', deepgramModel: 'nova-3' }, {
    ready: () => events.push('ready'),
    interim: text => events.push(`i:${text}`),
    final: text => events.push(`f:${text}`),
    error: message => events.push(`e:${message}`),
    closed: () => events.push('closed'),
  });
  await new Promise(resolve => setTimeout(resolve, 300));
  assert.equal(auth, 'Token dg-test');
  assert.deepEqual(events, ['ready', 'i:xin chào', 'f:xin chào mọi người']);
  asr.close(); wss.close();
});
test('translate falls back to the secondary model after a quota 429 and skips the exhausted model', async t => {
  const { translate } = await import('../server/translation.js');
  const calls = [];
  const original = globalThis.fetch;
  t.after(() => { globalThis.fetch = original; });
  globalThis.fetch = async url => {
    calls.push(String(url));
    if (String(url).includes('quota-dead-model')) {
      return new Response(JSON.stringify({ error: { code: 429,
        details: [{ '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay: '120s' }] } }), { status: 429 });
    }
    return new Response(JSON.stringify({ candidates: [{ finishReason: 'STOP',
      content: { parts: [{ text: '{"en":"hi","ja":"やあ"}' }] } }] }), { status: 200 });
  };
  const config = { apiKey: 'k', translateModel: 'quota-dead-model', translateFallbackModel: 'backup-model' };
  const run = () => translate(config, 'xin chào', '', new AbortController().signal);
  assert.deepEqual(await run(), { en: 'hi', ja: 'やあ' });
  assert.equal(calls.length, 2);
  await run();
  assert.equal(calls.length, 3);                    // model hết quota bị bỏ qua, không thử lại
  assert.ok(calls.every(u => !u.includes('quota-dead-model') || u === calls[0]));
});
async function until(fn, ms = 3000) {
  const began = Date.now();
  while (!fn() && Date.now() - began < ms) await new Promise(r => setTimeout(r, 15));
  assert.ok(fn(), 'timed out waiting for condition');
}
async function fakeDeepgramRoom(t, options = {}) {
  const upstream = new WebSocketServer({ port: 0, host: '127.0.0.1' });
  t.after(() => upstream.close());
  const conns = [];
  upstream.on('connection', ws => { ws.received = []; ws.on('message', d => ws.received.push(d)); conns.push(ws); });
  const { origin, rooms, config } = await setup(t);
  config.deepgramKey = 'dg-test';
  config.deepgramUrl = `ws://127.0.0.1:${upstream.address().port}/v1/listen`;
  const created = await rooms.create(undefined, '', 'deepgram');
  const room = rooms.rooms.get(created.room);
  const micToken = new URLSearchParams(new URL(created.micUrl).hash.slice(1)).get('token');
  const viewer = await socket(origin, { type: 'join', room: created.room, role: 'viewer', token: created.token });
  const mic = await socket(origin, { type: 'join', room: created.room, role: 'mic', token: micToken });
  mic.ws.send(JSON.stringify({ type: 'start' }));
  await until(() => room.status === 'listening' && conns.length === 1);
  return { conns, room, mic, viewer, rooms };
}
test('upstream reconnects after unexpected close without pausing the room', async t => {
  const { conns, room, mic } = await fakeDeepgramRoom(t);
  // The server marks the room listening before the ready message reaches the mic socket.
  await until(() => mic.events.some(e => e.type === 'ready' && e.maxMinutes === 0));
  conns[0].terminate();
  await until(() => conns.length === 2);   // retry ~800ms
  // failures resets in the ready callback, which fires on the client's open event — wait for it.
  await until(() => room.session?.asr?.ready && !room.session.asr.closed);
  assert.equal(room.session.failures, 0);  // reset sau ready
  assert.equal(room.status, 'listening');
  assert.ok(!mic.events.some(e => e.status === 'paused'));
  mic.ws.send(Buffer.alloc(320, 1));
  await until(() => conns[1].received.some(d => Buffer.isBuffer(d) && d.length === 320));
});
test('long speech is captioned sentence by sentence before the turn closes', async t => {
  const { conns, room, viewer } = await fakeDeepgramRoom(t);
  room.queue.run = async () => ({ en: 'en', ja: 'ja' });   // no network in tests
  const results = (transcript, isFinal = false) => conns[0].send(JSON.stringify({ type: 'Results', is_final: isFinal,
    speech_final: isFinal, channel: { alternatives: [{ transcript }] } }));
  results('Kính thưa quý vị. Mười năm trước chúng tôi');
  await until(() => room.captions.length === 1);
  assert.equal(room.captions[0].vi, 'Kính thưa quý vị.');   // committed while the speaker is still talking
  await until(() => viewer.events.some(e => e.type === 'interim' && e.text === 'Mười năm trước chúng tôi'));
  results('Kính thưa quý vị. Mười năm trước chúng tôi bắt đầu.', true);
  await until(() => room.captions.length === 2);
  assert.deepEqual(room.captions.map(c => c.vi), ['Kính thưa quý vị.', 'Mười năm trước chúng tôi bắt đầu.']);
});
test('asr rotation swaps upstream connections without re-announcing to the mic', async t => {
  const { conns, room, mic, rooms } = await fakeDeepgramRoom(t);
  const first = room.session.asr;
  rooms.connectAsr(room, room.session);    // giả lập timer xoay 8.5 phút
  await until(() => conns.length === 2 && room.session.asr !== first);
  assert.equal(room.session.pending, null);
  assert.equal(room.session.chain, 1);
  assert.equal(first.closed, true);        // session cũ được đóng sau khi swap
  assert.equal(mic.events.filter(e => e.type === 'ready').length, 1);
  mic.ws.send(Buffer.alloc(320, 2));
  await until(() => conns[1].received.some(d => Buffer.isBuffer(d) && d.length === 320));
  assert.ok(!conns[0].received.some(d => Buffer.isBuffer(d)));
});
test('deepgram transcriber is ready on open without waiting for an upstream frame', async () => {
  // Deepgram thật không gửi gì khi chưa có audio, còn mic chỉ thu sau khi nhận ready.
  const wss = new WebSocketServer({ port: 0, host: '127.0.0.1' });
  await new Promise(resolve => wss.once('listening', resolve));
  const received = [];
  wss.on('connection', ws => ws.on('message', data => received.push(data)));
  const events = [];
  const asr = new DeepgramTranscriber({ deepgramUrl: `ws://127.0.0.1:${wss.address().port}/v1/listen`,
    deepgramKey: 'dg-test', deepgramModel: 'nova-3' }, {
    ready: () => events.push('ready'), interim: () => {}, final: () => {},
    error: message => events.push(`e:${message}`), closed: () => events.push('closed'),
  });
  await new Promise(resolve => setTimeout(resolve, 300));
  assert.deepEqual(events, ['ready']);
  asr.audio(Buffer.alloc(320, 1));
  await new Promise(resolve => setTimeout(resolve, 100));
  assert.equal(received.length, 1);
  assert.equal(received[0].length, 320);
  asr.close(); wss.close();
});
