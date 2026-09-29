/**
 * URL building must hold up under React Native's URL implementation
 * (Libraries/Blob/URL.js), which concatenates base+url instead of
 * WHATWG resolution — `new URL('api/rooms', 'https://h/mic.html#x')`
 * becomes 'https://h/mic.html#xapi/rooms' on device.
 */

const RNURL = require('react-native/Libraries/Blob/URL').URL;
const NodeURL = globalThis.URL;

import {
  parseMicLink,
  baseFromLink,
  normalizeBase,
  createSessionOnServer,
  lookupMicLink,
} from '../src/protocol';

const LINK = 'https://live.hapo.work/mic.html#room=ROOM123&token=TOK';

describe('protocol under the React Native URL shim', () => {
  beforeEach(() => { (globalThis as any).URL = RNURL; });
  afterEach(() => { (globalThis as any).URL = NodeURL; });

  test('parseMicLink derives /socket, not the mic page path', () => {
    const link = parseMicLink(LINK);
    expect(link.socketUrl).toBe('wss://live.hapo.work/socket');
    expect(link.origin).toBe('https://live.hapo.work');
    expect(link.room).toBe('ROOM123');
    expect(link.token).toBe('TOK');
  });

  test('parseMicLink keeps a deployment base path', () => {
    const link = parseMicLink('https://assistant.hapo.work/live-trans/mic.html#room=R&token=T');
    expect(link.socketUrl).toBe('wss://assistant.hapo.work/live-trans/socket');
  });

  test('baseFromLink returns the deployment base', () => {
    expect(baseFromLink(LINK)).toBe('https://live.hapo.work/');
  });

  test.each([
    ['https://live.hapo.work/mic.html#room=x&token=y', 'https://live.hapo.work/'],
    ['https://live.hapo.work/mic.html', 'https://live.hapo.work/'],
    ['https://live.hapo.work', 'https://live.hapo.work/'],
    ['https://live.hapo.work/', 'https://live.hapo.work/'],
    ['https://assistant.hapo.work/live-trans', 'https://assistant.hapo.work/live-trans/'],
    ['https://assistant.hapo.work/live-trans/mic.html#room=x', 'https://assistant.hapo.work/live-trans/'],
  ])('normalizeBase(%s) → %s', (input, expected) => {
    expect(normalizeBase(input)).toBe(expected);
  });

  test('createSessionOnServer posts to /api/rooms even with a mic link as host', async () => {
    const fetchMock = jest.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ code: '123456', micUrl: LINK }),
    } as any);
    await createSessionOnServer('https://live.hapo.work/mic.html#room=x&token=y');
    expect(fetchMock).toHaveBeenCalledWith(
      'https://live.hapo.work/api/rooms',
      expect.objectContaining({ method: 'POST' }),
    );
    fetchMock.mockRestore();
  });

  test('lookupMicLink fetches api/join under the base', async () => {
    const fetchMock = jest.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ url: LINK, room: 'ROOM123', token: 'TOK' }),
    } as any);
    await lookupMicLink('https://live.hapo.work/mic.html', '654321');
    expect(fetchMock).toHaveBeenCalledWith('https://live.hapo.work/api/join?code=654321');
    fetchMock.mockRestore();
  });
});
