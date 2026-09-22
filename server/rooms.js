import { randomBytes, timingSafeEqual } from 'node:crypto';
import QRCode from 'qrcode';
import { Transcriber } from './transcriber.js';
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
      for (const room of this.rooms.values()) if (room.expires < Date.now()) this.end(room, 'Phiên đã hết hạn.');
    }, 30000).unref();
  }
  async create(publicUrl = this.config.publicUrl) {
    if (this.rooms.size >= 3) throw new Error('Đang có 3 phiên. Hãy kết thúc một phiên trước.');
    const room = { id: randomBytes(9).toString('base64url'), viewerToken: token(), micToken: token(),
      viewers: new Set(), mic: null, status: 'waiting', message: 'Quét QR bằng điện thoại để kết nối.',
      captions: [], interim: '', sequence: 0, expires: Date.now() + 2 * 60 * 60 * 1000 };
    const url = new URL('mic.html', publicUrl);
    url.hash = new URLSearchParams({ room: room.id, token: room.micToken }).toString();
    room.micUrl = url.href;
    room.queue = new TranslationQueue((text, context, signal) => translate(this.config, text, context, signal),
      caption => this.updateCaption(room, caption));
    this.rooms.set(room.id, room);
    try { room.qr = await QRCode.toDataURL(url.href, { width: 264, margin: 2, errorCorrectionLevel: 'M' }); }
    catch { this.rooms.delete(room.id); room.queue.close(); throw new Error('Không tạo được mã QR.'); }
    return { room: room.id, token: room.viewerToken, micUrl: room.micUrl, qr: room.qr };
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
    return { type: 'snapshot', room: room.id, status: room.status, message: room.message,
      micConnected: Boolean(room.mic), interim: room.interim, captions: room.captions,
      ...(role === 'viewer' ? { micUrl: room.micUrl, qr: room.qr } : {}) };
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
      if (!room.viewers.size) room.noViewerTimer = setTimeout(() => this.stop(room), 10000).unref();
    }
  }
  start(room) {
    if (room.session || !room.mic) return;
    if (!room.viewers.size) return send(room.mic, { type: 'error', message: 'Hãy mở màn hình phụ đề trước khi thu âm.' });
    const identity = {};
    room.session = identity; room.interim = '';
    room.audioBytes = 0; room.audioWindow = Date.now();
    this.status(room, 'connecting', 'Đang kết nối nhận giọng nói…');
    const current = () => room.session === identity && this.rooms.has(room.id);
    identity.asr = new Transcriber(this.config, {
      ready: () => {
        if (!current()) return;
        this.status(room, 'listening', 'Đang nghe tiếng Việt');
        send(room.mic, { type: 'ready' });
      },
      interim: text => {
        if (!current()) return;
        room.interim = text.slice(0, 4000);
        this.broadcast(room, { type: 'interim', text: room.interim });
      },
      final: text => { if (current()) this.final(room, text); },
      error: message => { if (current()) this.broadcast(room, { type: 'error', message }); },
      closed: () => {
        if (!current()) return;
        clearTimeout(identity.limit); room.session = null; room.interim = '';
        this.broadcast(room, { type: 'interim', text: '' });
        this.status(room, 'paused', 'Đã dừng thu âm. Có thể bấm bắt đầu để tiếp tục.');
      }
    });
    identity.limit = setTimeout(() => {
      if (!current()) return;
      this.broadcast(room, { type: 'error', message: 'Đã thu 9 phút. Bấm bắt đầu để mở lượt thu mới.' });
      this.stop(room);
    }, 9 * 60 * 1000).unref();
  }
  audio(room, data) {
    if (!room.session) return;
    if (data.length < 2 || data.length > 16000 || data.length % 2) throw new Error('Định dạng âm thanh không hợp lệ.');
    if (Date.now() - room.audioWindow >= 1000) { room.audioWindow = Date.now(); room.audioBytes = 0; }
    room.audioBytes += data.length;
    if (room.audioBytes > 96000) throw new Error('Âm thanh gửi quá nhanh. Hãy kết nối lại.');
    room.session.asr.audio(data);
  }
  stop(room) {
    if (!room.session || room.session.asr.stopping) return;
    this.status(room, 'finishing', 'Đã tắt mic. Đang hoàn tất câu cuối…');
    room.session.asr.stop();
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
    clearTimeout(room.noViewerTimer); clearTimeout(room.session?.limit);
    room.queue.close(); room.session?.asr.close();
    this.broadcast(room, { type: 'closed', message });
    for (const ws of [...room.viewers, room.mic].filter(Boolean)) ws.close(1000, 'Room closed');
  }
  close() { clearInterval(this.sweep); for (const room of this.rooms.values()) this.end(room); }
}
