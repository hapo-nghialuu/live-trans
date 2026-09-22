import { WebSocketServer } from 'ws';
import { send } from './rooms.js';

export function attachSockets(server, rooms, config) {
  const wss = new WebSocketServer({ noServer: true, maxPayload: 16000, perMessageDeflate: false });
  server.on('upgrade', (req, socket, head) => {
    let pathname;
    try { pathname = new URL(req.url, 'http://localhost').pathname; }
    catch { socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n'); return; }
    const base = new URL(config.publicUrl).pathname;
    if (![`${base}socket`, '/socket'].includes(pathname) || !config.origins.has(req.headers.origin)) {
      socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n'); return;
    }
    wss.handleUpgrade(req, socket, head, ws => wss.emit('connection', ws));
  });
  wss.on('connection', ws => {
    let room, role, count = 0, windowStart = Date.now();
    const authTimeout = setTimeout(() => ws.close(1008, 'Join required'), 5000).unref();
    ws.isAlive = true;
    ws.on('pong', () => { ws.isAlive = true; });
    ws.on('error', () => {});
    ws.on('message', (data, binary) => {
      try {
        if (binary) {
          if (!room || role !== 'mic') throw new Error('Không có quyền gửi âm thanh.');
          rooms.audio(room, data); return;
        }
        if (Date.now() - windowStart > 1000) { count = 0; windowStart = Date.now(); }
        if (++count > 12 || data.length > 2048) throw new Error('Quá nhiều yêu cầu.');
        const message = JSON.parse(data.toString());
        if (!room) {
          if (message.type !== 'join') throw new Error('Cần kết nối vào phiên trước.');
          const candidate = rooms.authenticate(message.room, message.role, message.token);
          if (!candidate) throw new Error('Liên kết không đúng hoặc phiên đã hết hạn.');
          if (!rooms.attach(candidate, message.role, ws)) throw new Error('Phiên đã có điện thoại khác hoặc quá nhiều màn hình.');
          room = candidate; role = message.role; clearTimeout(authTimeout); return;
        }
        if (message.type === 'start' && role === 'mic') rooms.start(room);
        else if (message.type === 'stop') rooms.stop(room);
        else if (message.type === 'end' && role === 'viewer') rooms.end(room);
        else throw new Error('Thao tác không hợp lệ.');
      } catch (error) {
        send(ws, { type: 'error', message: error instanceof SyntaxError ? 'Dữ liệu không hợp lệ.' : error.message });
        ws.close(1008, 'Invalid request');
      }
    });
    ws.on('close', () => { clearTimeout(authTimeout); if (room) rooms.detach(room, role, ws); });
  });
  const heartbeat = setInterval(() => {
    for (const ws of wss.clients) {
      if (!ws.isAlive) ws.terminate();
      else { ws.isAlive = false; ws.ping(); }
    }
  }, 20000).unref();
  return () => { clearInterval(heartbeat); for (const ws of wss.clients) ws.terminate(); wss.close(); };
}
