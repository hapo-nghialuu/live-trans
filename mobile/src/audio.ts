import { PermissionsAndroid, Platform } from 'react-native';
import { toByteArray } from 'base64-js';

type LiveAudioStreamModule = {
  init(options: Record<string, unknown>): void;
  start(): void;
  stop(): void;
  on(event: 'data', callback: (base64: string) => void): { remove(): void };
};

// Lazy requires: native modules are absent under Jest.
let stream: LiveAudioStreamModule | undefined;
function liveAudioStream(): LiveAudioStreamModule {
  if (!stream) stream = require('react-native-live-audio-stream').default;
  return stream!;
}

let keepAwakeModule: { activate(): void; deactivate(): void } | undefined;
function keepAwake() {
  if (!keepAwakeModule) keepAwakeModule = require('react-native-keep-awake').default;
  return keepAwakeModule!;
}

export interface AudioStreamer {
  start(): Promise<void>;
  stop(): void;
  dispose(): void;
}

/** Capture mic as PCM16 mono 16 kHz chunks (~100 ms) and hand each chunk to onChunk. */
export function createAudioStreamer(onChunk: (bytes: ArrayBuffer) => void): AudioStreamer {
  const audio = liveAudioStream();
  audio.init({ sampleRate: 16000, channels: 1, bitsPerSample: 16, audioSource: 6, bufferSize: 3200 });
  const sub = audio.on('data', base64 => {
    const bytes = toByteArray(base64);
    const copy = new Uint8Array(bytes.byteLength);
    copy.set(bytes);
    onChunk(copy.buffer);
  });
  let active = false;
  return {
    async start() {
      if (Platform.OS === 'android') {
        const granted = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.RECORD_AUDIO);
        if (granted !== PermissionsAndroid.RESULTS.GRANTED) throw new Error('Chưa được phép dùng micro.');
      }
      audio.start();
      active = true;
      keepAwake().activate();
    },
    stop() {
      if (!active) return;
      active = false;
      audio.stop();
      keepAwake().deactivate();
    },
    dispose() {
      this.stop();
      sub.remove();
    },
  };
}
