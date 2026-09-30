import { randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import QRCode from 'qrcode';
import { Transcriber } from './transcriber.js';
import { DeepgramTranscriber } from './deepgram.js';
import { translate, TranslationQueue } from './translation.js';

const token = () => randomBytes(24).toString('base64url');
export function equalSecret(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const left = Buffer.from(a), right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}
export function send(ws, event) {
  if (ws.readyState !== 1) return;
  if (ws.bufferedAmount > 128000) { ws.close(1013, 'Slow connection'); return; }
  ws.send(JSON.stringify(event));
}

export class Rooms {
  constructor(config) {
    this.config = config;
    this.rooms = new Map();
    this.sweep = setInterval(() => {
      const now = Date.now();
      for (const room of this.rooms.values()) {
        if (room.expires < now) this.end(room, 'Phiên đã hết hạn.');
        else if (!room.mic && !room.session && room.created + 15 * 60 * 1000 < now) this.end(room, 'Phiên chờ quá lâu không có điện thoại.');
      }
    }, 30000).unref();
  }
  async create(publicUrl = this.config.publicUrl, code = '', provider = '') {
    provider = provider || this.config.provider || 'gemini';
    if (!['gemini', 'deepgram'].includes(provider)) throw new Error('Nhà cung cấp nhận giọng nói không hợp lệ.');
    if (provider === 'deepgram' && !this.config.deepgramKey) throw new Error('Deepgram chưa được cấu hình API key.');
    if (provider === 'gemini' && !this.config.apiKey) throw new Error('Máy chủ chưa được cấu hình Gemini key.');
    if (this.rooms.size >= 3) throw new Error('Đang có 3 phiên. Hãy kết thúc một phiên trước.');
    const room = { id: randomBytes(9).toString('base64url'), viewerToken: token(), micToken: token(), provider,
      viewers: new Set(), mic: null, status: 'waiting', message: 'Quét QR bằng điện thoại để kết nối.',
      captions: [], interim: '', sequence: 0, created: Date.now(), expires: Date.now() + 2 * 60 * 60 * 1000 };
    if (code) {
      if (!/^\d{6}$/.test(code)) throw new Error('Mã phiên cần đúng 6 chữ số.');
      if ([...this.rooms.values()].some(r => r.code === code)) {
        const error = new Error('Mã phiên đang được dùng. Chọn số khác.'); error.conflict = true; throw error;
      }
      room.code = code;
    } else do room.code = String(randomInt(0, 1000000)).padStart(6, '0');
      while ([...this.rooms.values()].some(r => r.code === room.code));
    const url = new URL('mic.html', publicUrl);
    url.hash = new URLSearchParams({ room: room.id, token: room.micToken }).toString();
    room.micUrl = url.href;
    room.queue = new TranslationQueue((text, context, signal) => translate(this.config, text, context, signal),
      caption => this.updateCaption(room, caption));
    this.rooms.set(room.id, room);
    try { room.qr = await QRCode.toDataURL(url.href, { width: 264, margin: 2, errorCorrectionLevel: 'M' }); }
    catch { this.rooms.delete(room.id); room.queue.close(); throw new Error('Không tạo được mã QR.'); }
    return { room: room.id, token: room.viewerToken, micUrl: room.micUrl, qr: room.qr, code: room.code };
  }
  byCode(code) {
    for (const room of this.rooms.values()) if (room.code === code && room.expires > Date.now()) return room;
    return null;
  }
  authenticate(id, role, value) {
    const room = this.rooms.get(id);
    if (!room || room.expires < Date.now() || !['viewer', 'mic'].includes(role)) return null;
    return equalSecret(value, role === 'viewer' ? room.viewerToken : room.micToken) ? room : null;
  }
  broadcast(room, event) { for (const ws of [...room.viewers, room.mic].filter(Boolean)) send(ws, event); }
  status(room, status, message) {
    room.status = status; room.message = message;
    this.broadcast(room, { type: 'status', status, message, micConnected: Boolean(room.mic) });
  }
  snapshot(room, role) {
    return { type: 'snapshot', room: room.id, status: room.status, message: room.message, provider: room.provider,
      micConnected: Boolean(room.mic), interim: room.interim, captions: room.captions,
      ...(role === 'viewer' ? { micUrl: room.micUrl, qr: room.qr, code: room.code } : {}) };
  }
  attach(room, role, ws) {
    if (role === 'mic') {
      if (room.mic) return false;
      room.mic = ws;
      if (!room.session) this.status(room, 'ready', 'Điện thoại đã kết nối. Bấm bắt đầu trên điện thoại.');
    } else {
      if (room.viewers.size >= 5) return false;
      clearTimeout(room.noViewerTimer); room.viewers.add(ws);
    }
    send(ws, this.snapshot(room, role));
    return true;
  }
  detach(room, role, ws) {
    if (!this.rooms.has(room.id)) return;
    if (role === 'mic' && room.mic === ws) {
      room.mic = null; this.stop(room);
      if (!room.session) this.status(room, 'waiting', 'Điện thoại đã ngắt kết nối.');
    } else if (role === 'viewer') {
      room.viewers.delete(ws);
      if (!room.viewers.size) room.noViewerTimer = setTimeout(() => {
        console.log(`[room ${room.code}] stop: no viewers left`);
        this.stop(room);
      }, 10000).unref();
    }
  }
  start(room) {
    if (room.session || !room.mic) return;
    if (!room.viewers.size) return send(room.mic, { type: 'error', message: 'Hãy mở màn hình phụ đề trước khi thu âm.' });
    const identity = { chain: 0, announced: false, failures: 0, stopping: false };
    room.session = identity; room.interim = '';
    room.audioBytes = 0; room.audioWindow = Date.now();
    this.status(room, 'connecting', 'Đang kết nối nhận giọng nói…');
    console.log(`[room ${room.code}] start asr=${room.provider} viewers=${room.viewers.size}`);
    this.connectAsr(room, identity);
  }
  // Mở một upstream ASR mới. Nếu session cũ còn sống (xoay Gemini trước giới hạn 10 phút),
  // cái mới đi vào `pending` và chỉ nhận quyền khi ready — audio chảy liên tục, không mất lời.
  connectAsr(room, identity) {
    const current = () => room.session === identity && this.rooms.has(room.id);
    const retry = delay => {
      clearTimeout(identity.retryTimer);
      identity.retryTimer = setTimeout(() => { if (current() && !identity.stopping) this.connectAsr(room, identity); }, delay).unref();
    };
    const ASR = room.provider === 'deepgram' ? DeepgramTranscriber : Transcriber;
    const asr = new ASR(this.config, {
      ready: () => {
        if (!current()) return asr.close();
        if (identity.pending === asr) {
          const prev = identity.asr;
          identity.asr = asr; identity.pending = null;
          prev?.close();
          console.log(`[room ${room.code}] asr chained #${++identity.chain}`);
        }
        identity.failures = 0;
        if (!identity.announced) {
          identity.announced = true;
          this.status(room, 'listening', 'Đang nghe tiếng Việt');
          send(room.mic, { type: 'ready', provider: room.provider, maxMinutes: 0 });
        }
        if (room.provider === 'gemini') {
          clearTimeout(identity.rotate);
          identity.rotate = setTimeout(() => this.connectAsr(room, identity), 8.5 * 60 * 1000).unref();
        }
      },
      interim: text => {
        if (!current() || identity.asr !== asr) return;
        room.interim = text.slice(0, 4000);
        this.broadcast(room, { type: 'interim', text: room.interim });
      },
      final: text => { if (current() && identity.asr === asr) this.final(room, text); },
      error: message => { identity.lastError = message; },
      closed: () => {
        if (!current()) return;
        if (identity.pending === asr) {
          identity.pending = null;
          if (identity.asr && !identity.stopping && ++identity.failures <= 3) retry(3000);
          return;
        }
        if (identity.asr !== asr) return;
        identity.asr = null;
        clearTimeout(identity.rotate);
        const pause = message => {
          room.session = null; room.interim = '';
          this.broadcast(room, { type: 'interim', text: '' });
          this.status(room, 'paused', message);
        };
        if (identity.stopping) return pause('Đã dừng thu âm. Có thể bấm bắt đầu để tiếp tục.');
        console.log(`[room ${room.code}] asr closed unexpectedly, reconnecting (${identity.failures + 1})`);
        if (++identity.failures > 3) return pause(identity.lastError || 'Kết nối nhận giọng nói bị gián đoạn. Bấm bắt đầu để thử lại.');
        retry(800);
      }
    });
    if (identity.asr) identity.pending = asr; else identity.asr = asr;
  }
  audio(room, data) {
    if (!room.session) return;
    if (data.length < 2 || data.length > 16000 || data.length % 2) throw new Error('Định dạng âm thanh không hợp lệ.');
    if (Date.now() - room.audioWindow >= 1000) { room.audioWindow = Date.now(); room.audioBytes = 0; }
    room.audioBytes += data.length;
    if (room.audioBytes > 96000) throw new Error('Âm thanh gửi quá nhanh. Hãy kết nối lại.');
    room.session.asr?.audio(data);
  }
  stop(room) {
    const s = room.session;
    if (!s || s.stopping || s.asr?.stopping) return;
    s.stopping = true;
    clearTimeout(s.rotate); clearTimeout(s.retryTimer);
    this.status(room, 'finishing', 'Đã tắt mic. Đang hoàn tất câu cuối…');
    s.pending?.close();
    if (s.asr) s.asr.stop();
    else { room.session = null; this.status(room, 'paused', 'Đã dừng thu âm. Có thể bấm bắt đầu để tiếp tục.'); }
  }
  final(room, text) {
    const vi = text.trim();
    if (!vi) return;
    const context = room.captions.slice(-3).map(c => c.vi).join('\n').slice(-3000);
    const caption = { id: ++room.sequence, vi: vi.slice(0, 4000), en: '', ja: '', status: 'translating' };
    room.interim = '';
    this.updateCaption(room, caption);
    this.broadcast(room, { type: 'interim', text: '' });
    room.queue.push(caption, context);
  }
  updateCaption(room, caption) {
    if (!this.rooms.has(room.id)) return;
    const index = room.captions.findIndex(c => c.id === caption.id);
    // Phản hồi đến muộn không được đưa câu đã rời lịch sử trở lại cuối danh sách.
    if (index === -1 && caption.id < room.sequence) return;
    if (index === -1) room.captions.push(caption); else room.captions[index] = caption;
    room.captions = room.captions.slice(-30);
    this.broadcast(room, { type: 'caption', caption });
  }
  end(room, message = 'Phiên dịch đã kết thúc.') {
    if (!this.rooms.delete(room.id)) return;
    clearTimeout(room.noViewerTimer);
    const s = room.session;
    if (s) { clearTimeout(s.rotate); clearTimeout(s.retryTimer); s.stopping = true; }
    room.queue.close(); s?.pending?.close(); s?.asr?.close();
    this.broadcast(room, { type: 'closed', message });
    for (const ws of [...room.viewers, room.mic].filter(Boolean)) ws.close(1000, 'Room closed');
  }
  close() { clearInterval(this.sweep); for (const room of this.rooms.values()) this.end(room); }
}
