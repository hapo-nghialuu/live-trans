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

export type ConnState = 'connecting' | 'open' | 'closed';

/** One WebSocket to /socket: joins the room as mic, relays server events. */
export class RoomSocket {
  private ws?: WebSocket;
  private disposed = false;

  constructor(
    private link: MicLink,
    private onEvent: (event: any) => void,
    private onState: (state: ConnState) => void,
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
    ws.onopen = () => {
      this.onState('open');
      ws.send(JSON.stringify({ type: 'join', room: this.link.room, role: 'mic', token: this.link.token }));
    };
    ws.onmessage = event => {
      try {
        this.onEvent(JSON.parse(String(event.data)));
      } catch {
        this.onEvent({ type: 'error', message: 'Dữ liệu không hợp lệ.' });
      }
    };
    ws.onerror = () => {};
    ws.onclose = () => {
      if (!this.disposed) this.onState('closed');
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
