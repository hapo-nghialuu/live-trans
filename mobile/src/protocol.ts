export interface MicLink {
  socketUrl: string;
  origin: string;
  room: string;
  token: string;
}

/** Parse the mic link encoded in the desktop QR: https://host/base/mic.html#room=..&token=.. */
export function parseMicLink(input: string): MicLink {
  const url = new URL(input.trim());
  if (!['https:', 'http:'].includes(url.protocol)) throw new Error('Liên kết phải là http/https.');
  const params = new URLSearchParams(url.hash.replace(/^#/, ''));
  const room = params.get('room') || '';
  const token = params.get('token') || '';
  if (!room || !token) {
    if (params.get('access')) throw new Error('Đây là liên kết truy cập màn hình chính. Hãy dán liên kết mic dưới mã QR (…/mic.html#room=…&token=…).');
    throw new Error('Liên kết thiếu room hoặc token. Hãy quét/dán đúng liên kết mic.');
  }
  const socket = new URL('socket', url);
  const scheme = url.protocol === 'https:' ? 'wss' : 'ws';
  return { socketUrl: `${scheme}://${socket.host}${socket.pathname}`, origin: url.origin, room, token };
}

/** Base URL of the server that issued a mic link (the …/base/ prefix before mic.html). */
export function baseFromLink(input: string): string {
  return new URL('.', new URL(input.trim())).href;
}

/** Normalize a user-entered server address: bare host, base path, or a pasted mic link all work. */
export function normalizeBase(input: string): string {
  const url = new URL(input.trim().replace(/[?#].*$/, ''));
  const last = url.pathname.split('/').pop() || '';
  if (!last || last.includes('.')) return new URL('.', url).href;
  return `${url.href}/`;
}

export interface JoinResult {
  url: string;
  room: string;
  token: string;
}

/** Resolve a 6-digit session code to a join link via the issuing server. */
export async function lookupMicLink(baseUrl: string, code: string): Promise<JoinResult> {
  const base = normalizeBase(baseUrl);
  const response = await fetch(new URL(`api/join?code=${encodeURIComponent(code)}`, base).href);
  const data: any = await response.json().catch(() => ({}));
  if (!response.ok || typeof data.url !== 'string') {
    throw new Error(data.error || 'Không tìm thấy phiên với mã này.');
  }
  return { url: data.url, room: data.room, token: data.token };
}

/** Create a new session on the server (same as the web "Tạo phiên" button). */
export async function createSessionOnServer(baseUrl: string, accessKey = '', code = ''): Promise<{ code: string; micUrl: string }> {
  const base = normalizeBase(baseUrl);
  const target = new URL('api/rooms', base);
  if (code) target.searchParams.set('code', code);
  const headers: Record<string, string> = { Origin: new URL(base).origin };
  if (accessKey) headers['x-access-key'] = accessKey;
  const response = await fetch(target.href, { method: 'POST', headers });
  const data: any = await response.json().catch(() => ({}));
  if (!response.ok || typeof data.micUrl !== 'string') {
    const error = new Error(data.error || 'Không tạo được phiên.') as Error & { status?: number };
    error.status = response.status;
    throw error;
  }
  return { code: data.code, micUrl: data.micUrl };
}

export type ConnState = 'connecting' | 'open' | 'closed';
export interface CloseInfo { code?: number; reason?: string }

/** One WebSocket to /socket: joins the room as mic, relays server events. */
export class RoomSocket {
  private ws?: WebSocket;
  private disposed = false;
  private lastError = '';

  constructor(
    private link: MicLink,
    private onEvent: (event: any) => void,
    private onState: (state: ConnState, info?: CloseInfo) => void,
  ) {}

  get open() {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  get bufferedAmount() {
    return (this.ws as any)?.bufferedAmount ?? 0;
  }

  connect() {
    this.disposeSocket();
    this.disposed = false;
    const ws = new WebSocket(this.link.socketUrl, null, { headers: { Origin: this.link.origin } });
    this.ws = ws;
    this.onState('connecting');
    // iOS can swallow onclose after a failed handshake — force failure state
    // so the UI never sits on "Đang kết nối…" forever.
    const handshake = setTimeout(() => {
      if (ws.readyState !== WebSocket.OPEN && this.ws === ws) {
        this.disposed = true;
        try { ws.close(); } catch {}
        this.onEvent({ type: 'error', message: 'Không kết nối được tới máy chủ. Kiểm tra mạng và địa chỉ máy chủ.' });
        this.onState('closed');
      }
    }, 12000);
    ws.onopen = () => {
      clearTimeout(handshake);
      this.onState('open');
      try {
        ws.send(JSON.stringify({ type: 'join', room: this.link.room, role: 'mic', token: this.link.token }));
      } catch (error: any) {
        this.onEvent({ type: 'error', message: `Không gửi được yêu cầu tham gia phiên: ${error?.message || error}` });
      }
    };
    ws.onmessage = event => {
      try {
        this.onEvent(JSON.parse(String(event.data)));
      } catch {
        this.onEvent({ type: 'error', message: 'Dữ liệu không hợp lệ.' });
      }
    };
    ws.onerror = (event: any) => {
      if (!this.disposed) this.lastError = event?.message || '';
    };
    ws.onclose = (event: any) => {
      clearTimeout(handshake);
      if (!this.disposed) this.onState('closed', {
        code: event?.code, reason: event?.reason || this.lastError,
      });
    };
  }

  /** Returns false when the socket is not open. */
  send(data: string | ArrayBuffer | object): boolean {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return false;
    this.ws.send(typeof data === 'object' && !(data instanceof ArrayBuffer) ? JSON.stringify(data) : (data as any));
    return true;
  }

  close() {
    this.disposed = true;
    this.disposeSocket();
  }

  private disposeSocket() {
    const ws = this.ws;
    this.ws = undefined;
    if (ws) {
      ws.onopen = ws.onmessage = ws.onerror = ws.onclose = null;
      try { ws.close(); } catch {}
    }
  }
}
