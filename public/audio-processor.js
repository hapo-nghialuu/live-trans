import { createResampler, floatToPcm16 } from './resampler.js';
import { createLevelReporter } from './audio-source.js';

class PcmProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.enabled = false;
    this.resampler = createResampler(sampleRate);
    this.chunk = new Float32Array(1600);
    this.count = 0;
    this.level = createLevelReporter();
    this.port.onmessage = ({ data }) => {
      if (data.type === 'record') {
        this.enabled = data.enabled;
        this.resampler = createResampler(sampleRate);
        this.count = 0;
      } else if (data.type === 'flush') {
        this.emitChunk();
        this.enabled = false;
        this.port.postMessage({ type: 'flushed' });
      }
    };
  }

  emitChunk() {
    if (!this.count) return;
    const pcm = floatToPcm16(this.chunk.subarray(0, this.count));
    this.port.postMessage({ type: 'chunk', pcm }, [pcm]);
    this.count = 0;
  }

  process(inputs) {
    const input = inputs[0]?.[0];
    if (!input) return true;
    const level = this.level.push(input);
    if (level) this.port.postMessage({ type: 'level', rms: level.rms, peak: level.peak });
    if (this.enabled) {
      for (const value of this.resampler.push(input)) {
        this.chunk[this.count++] = value;
        if (this.count === this.chunk.length) this.emitChunk();
      }
    }
    return true;
  }
}

registerProcessor('pcm-processor', PcmProcessor);
