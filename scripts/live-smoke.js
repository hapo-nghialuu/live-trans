import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';
import WebSocket from 'ws';

const base = new URL(process.env.LIVE_TRANS_URL || 'http://localhost:4317/');
const source = 'Ngày mai tôi có cuộc họp lúc chín giờ sáng. Tôi muốn đổi lịch sang thứ Sáu, không phải thứ Năm.';
const directory = mkdtempSync(join(tmpdir(), 'live-trans-smoke-'));
let viewer, mic;
const events = [];
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const start = Date.now();
async function until(predicate, timeout = 20000) {
  const began = Date.now();
  while (!predicate()) {
    const error = events.find(e => e.type === 'error');
    if (error) throw new Error(error.message);
    if (Date.now() - began > timeout) throw new Error('Timeout waiting for live event');
    await sleep(40);
  }
}
async function connect(room, token, role) {
  const url = new URL('socket', base); url.protocol = base.protocol === 'https:' ? 'wss:' : 'ws:';
  const ws = new WebSocket(url, { origin: base.origin });
  ws.on('message', raw => {
    const e = JSON.parse(raw.toString());
    events.push({ ...e, role, ms: Date.now() - start });
  });
  await new Promise((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject); });
  ws.send(JSON.stringify({ type: 'join', room, token, role }));
  await until(() => events.some(e => e.role === role && e.type === 'snapshot'));
  return ws;
}
try {
  let pcm;
  if (process.env.PCM_FILE) pcm = readFileSync(process.env.PCM_FILE);
  else {
    const aiff = join(directory, 'source.aiff'), wav = join(directory, 'source.wav');
    execFileSync('/usr/bin/say', ['-v', 'Linh', '-r', '165', '-o', aiff, source]);
    execFileSync('/usr/bin/afconvert', ['-f', 'WAVE', '-d', 'LEI16@16000', '-c', '1', aiff, wav]);
    const wave = readFileSync(wav);
    for (let offset = 12; offset + 8 <= wave.length;) {
      const size = wave.readUInt32LE(offset + 4);
      if (wave.toString('ascii', offset, offset + 4) === 'data') { pcm = wave.subarray(offset + 8, offset + 8 + size); break; }
      offset += 8 + size + (size % 2);
    }
  }
  assert.ok(pcm?.length > 3200, 'real PCM speech required');
  let room;
  if (process.env.LIVE_TRANS_VIEW_URL) {
    const auth = new URLSearchParams(new URL(process.env.LIVE_TRANS_VIEW_URL).hash.slice(1));
    room = { room: auth.get('room'), token: auth.get('token') };
  } else {
    const response = await fetch(new URL('api/rooms', base), { method: 'POST',
      headers: { Origin: base.origin, 'x-access-key': process.env.LIVE_TRANS_ACCESS_KEY || '' } });
    assert.equal(response.status, 201, `create room HTTP ${response.status}`);
    room = await response.json();
  }
  viewer = await connect(room.room, room.token, 'viewer');
  const micUrl = events.find(e => e.type === 'snapshot' && e.role === 'viewer').micUrl;
  const micToken = new URLSearchParams(new URL(micUrl).hash.slice(1)).get('token');
  mic = await connect(room.room, micToken, 'mic');
  mic.send(JSON.stringify({ type: 'start' }));
  await until(() => events.some(e => e.type === 'ready'));
  const audioStart = Date.now();
  for (let offset = 0; offset < pcm.length; offset += 3200) {
    mic.send(pcm.subarray(offset, offset + 3200));
    await sleep(100);
  }
  const audioEnd = Date.now();
  mic.send(JSON.stringify({ type: 'stop' }));
  await until(() => {
    const text = events.filter(e => e.role === 'viewer' && e.type === 'caption' && e.caption.status === 'done')
      .map(e => e.caption.en).join(' ');
    return /Friday/i.test(text) && /Thursday/i.test(text);
  }, 25000);
  const completed = events.filter(e => e.role === 'viewer' && e.type === 'caption' && e.caption.status === 'done');
  const english = completed.map(e => e.caption.en).join(' ');
  const japanese = completed.map(e => e.caption.ja).join(' ');
  assert.match(english, /Friday/i); assert.match(english, /not Thursday/i);
  assert.match(japanese, /金曜日/); assert.match(japanese, /木曜日/);
  await until(() => events.some(e => e.role === 'mic' && e.type === 'status' && e.status === 'paused'));
  console.log(JSON.stringify({ proof: 'real synthetic Vietnamese audio -> application WebSocket -> Gemini ASR -> translation -> second viewer',
    origin: base.origin, audio_ms: Math.round(pcm.length / 32), setup_ms: audioStart - start,
    first_interim_ms: events.find(e => e.role === 'viewer' && e.type === 'interim' && e.text)?.ms,
    final_caption_after_audio_ms: start + completed.at(-1).ms - audioEnd,
    captions: completed.map(e => e.caption), stopped: true }, null, 2));
} finally {
  if (viewer?.readyState === 1 && !process.env.KEEP_ROOM) { viewer.send(JSON.stringify({ type: 'end' })); await sleep(200); }
  viewer?.close(); mic?.close();
  rmSync(directory, { recursive: true, force: true });
}
