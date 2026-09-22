import { loadConfig } from './config.js';
import { createApp } from './app.js';

try {
  const config = loadConfig();
  const app = createApp(config);
  app.server.listen(config.port, '127.0.0.1', () => {
    console.log(`Live Trans listening on 127.0.0.1:${config.port}`);
    console.log(`Public URL: ${config.publicUrl}`);
    console.log(`Gemini: ${config.apiKey ? 'configured' : 'not configured'}`);
  });
  app.server.on('error', error => {
    console.error(error.code === 'EADDRINUSE' ? 'Port đang được sử dụng.' : 'Không khởi động được server.');
    process.exit(1);
  });
  let stopping = false;
  const stop = async () => {
    if (stopping) return;
    stopping = true;
    const timeout = setTimeout(() => process.exit(1), 5000).unref();
    await app.close(); clearTimeout(timeout); process.exit(0);
  };
  process.on('SIGINT', stop); process.on('SIGTERM', stop);
} catch (error) {
  console.error(error.code === 'ENOENT' ? 'Không tìm thấy file cấu hình key.' : error.message);
  process.exit(1);
}
