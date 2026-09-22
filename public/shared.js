export const $ = (id) => document.getElementById(id);

export function showNotice(message = '') {
  $('notice').textContent = message;
  $('notice').hidden = !message;
}

export const statusLabels = {
  connecting: 'Đang kết nối…', listening: 'Đang nghe tiếng Việt',
  finishing: 'Đang hoàn tất phụ đề…', paused: 'Đã dừng · Sẵn sàng khi bạn muốn',
  idle: 'Sẵn sàng · Chờ bạn bắt đầu', ready: 'Sẵn sàng · Chờ bạn bắt đầu',
  waiting: 'Chờ điện thoại kết nối',
  closed: 'Phiên đã kết thúc', error: 'Có lỗi cần kiểm tra',
  disconnected: 'Mất kết nối',
};

export function showStatus(status, message) {
  $('connection-status').textContent = message || statusLabels[status] || 'Đã kết nối';
  $('connection-status').dataset.state = status;
}

export function credentials() {
  const hash = new URLSearchParams(location.hash.slice(1));
  return { room: hash.get('room'), token: hash.get('token') };
}

export class RoomSocket {
  constructor(role, auth, onEvent, onConnection) {
    Object.assign(this, { role, auth, onEvent, onConnection });
    this.socket = null;
  }

  connect() {
    this.close();
    const url = new URL('socket', location.href);
    url.protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const socket = new WebSocket(url);
    this.socket = socket;
    this.onConnection('connecting');
    socket.onopen = () => {
      if (this.socket !== socket) return;
      this.send({ type: 'join', ...this.auth, role: this.role });
    };
    socket.onmessage = ({ data }) => {
      if (this.socket !== socket || typeof data !== 'string') return;
      try { this.onEvent(JSON.parse(data)); }
      catch { this.onEvent({ type: 'error', message: 'Không đọc được dữ liệu từ máy chủ.' }); }
    };
    socket.onerror = () => {
      if (this.socket === socket) {
        this.close();
        this.onConnection('disconnected');
      }
    };
    socket.onclose = () => {
      if (this.socket !== socket) return;
      this.socket = null;
      this.onConnection('disconnected');
    };
  }

  get open() { return this.socket?.readyState === WebSocket.OPEN; }
  get bufferedAmount() { return this.socket?.bufferedAmount ?? 0; }

  send(message) {
    if (!this.open) return false;
    try {
      this.socket.send(message instanceof ArrayBuffer ? message : JSON.stringify(message));
      return true;
    } catch { return false; }
  }

  close() {
    const previous = this.socket;
    this.socket = null;
    if (previous) previous.close();
  }
}
