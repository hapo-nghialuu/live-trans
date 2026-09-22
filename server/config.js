import { readFileSync } from 'node:fs';

export function loadConfig(env = process.env) {
  let apiKey = String(env.GOOGLE_API_KEY || '').trim();
  if (!apiKey && env.GOOGLE_API_KEY_FILE) {
    const matches = readFileSync(env.GOOGLE_API_KEY_FILE, 'utf8').match(/AIza[A-Za-z0-9_-]{30,50}/g);
    if (!matches || new Set(matches).size !== 1) throw new Error('File phải chứa đúng một Gemini key.');
    apiKey = matches.at(0);
  }
  const port = Number(env.PORT || 4317);
  const publicUrl = new URL(env.PUBLIC_URL || `http://localhost:${port}/`);
  if (!publicUrl.pathname.endsWith('/')) publicUrl.pathname += '/';
  if (!['http:', 'https:'].includes(publicUrl.protocol)) throw new Error('PUBLIC_URL không hợp lệ.');
  const publicAliases = (env.PUBLIC_ALIASES || '').split(',').filter(Boolean).map(value => {
    const alias = new URL(value.trim());
    if (alias.protocol !== 'https:' || alias.pathname !== '/') throw new Error('PUBLIC_ALIASES cần HTTPS ở gốc tên miền.');
    return alias.href;
  });
  const accessKey = env.APP_ACCESS_KEY || '';
  if (env.NODE_ENV === 'production' && accessKey.length < 24) {
    throw new Error('Production yêu cầu APP_ACCESS_KEY ít nhất 24 ký tự.');
  }
  return { port, apiKey, accessKey, publicUrl: publicUrl.href, publicAliases,
    origins: new Set([publicUrl.origin, ...publicAliases.map(u => new URL(u).origin), `http://localhost:${port}`, `http://127.0.0.1:${port}`]),
    transcribeModel: 'gemini-3.5-transcribe-live', translateModel: 'gemini-3.5-flash-lite' };
}
