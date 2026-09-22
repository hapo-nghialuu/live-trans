import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve, extname, sep } from 'node:path';
import { Rooms, equalSecret } from './rooms.js';
import { attachSockets } from './sockets.js';

const root = fileURLToPath(new URL('../public/', import.meta.url));
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };
const headers = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer', 'Permissions-Policy': 'microphone=(self), camera=()',
  'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'" };

export function createApp(config) {
  const rooms = new Rooms(config);
  const base = new URL(config.publicUrl).pathname;
  let attempts = 0, reset = Date.now();
  const server = createServer(async (req, res) => {
    const json = (status, value) => {
      res.writeHead(status, { ...headers, 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(value));
    };
    try {
      let path = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
      if (base !== '/' && path.startsWith(base)) path = `/${path.slice(base.length)}`;
      if (path === '/api/health' && req.method === 'GET') return json(200, { ok: true });
      if (path === '/api/config' && req.method === 'GET') return json(200, { ready: Boolean(config.apiKey), requiresAccess: Boolean(config.accessKey) });
      if (path === '/api/rooms' && req.method === 'POST') {
        req.resume();
        if (!config.origins.has(req.headers.origin)) return json(403, { error: 'Nguồn yêu cầu không hợp lệ.' });
        if (Date.now() - reset > 60000) { reset = Date.now(); attempts = 0; }
        if (++attempts > 20) return json(429, { error: 'Quá nhiều lần thử. Vui lòng đợi một phút.' });
        if (config.accessKey && !equalSecret(req.headers['x-access-key'], config.accessKey)) {
          return json(401, { error: 'Mã truy cập chưa đúng.' });
        }
        if (!config.apiKey) return json(503, { error: 'Máy chủ chưa được cấu hình Gemini key.' });
        const publicUrl = config.publicAliases?.find(u => new URL(u).origin === req.headers.origin) || config.publicUrl;
        try { return json(201, await rooms.create(publicUrl)); }
        catch (error) { return json(409, { error: error.message }); }
      }
      if (path.startsWith('/api/')) return json(404, { error: 'Không tìm thấy chức năng.' });
      if (!['GET', 'HEAD'].includes(req.method)) return json(405, { error: 'Thao tác không được hỗ trợ.' });
      const file = resolve(root, `.${path === '/' ? '/index.html' : path}`);
      if (!file.startsWith(root.endsWith(sep) ? root : root + sep) || !mime[extname(file)]) {
        return json(404, { error: 'Không tìm thấy trang.' });
      }
      const body = await readFile(file);
      res.writeHead(200, { ...headers, 'Content-Type': mime[extname(file)], 'Content-Length': body.length });
      res.end(req.method === 'HEAD' ? undefined : body);
    } catch (error) {
      json(error.code === 'ENOENT' ? 404 : 400, { error: 'Không đọc được trang hoặc yêu cầu không hợp lệ.' });
    }
  });
  server.requestTimeout = 15000;
  server.headersTimeout = 10000;
  const closeSockets = attachSockets(server, rooms, config);
  return { server, rooms, close: () => {
    rooms.close(); closeSockets(); server.closeAllConnections();
    return new Promise(resolve => server.close(resolve));
  } };
}
