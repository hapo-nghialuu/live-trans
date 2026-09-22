/** Streaming area resampler. Carries fractional sample weights across chunks. */
export function createResampler(inputRate, outputRate = 16000) {
  if (!Number.isFinite(inputRate) || !Number.isFinite(outputRate) || inputRate <= 0 || outputRate <= 0) {
    throw new RangeError('Sample rates must be positive finite numbers');
  }
  const ratio = inputRate / outputRate;
  let sum = 0;
  let weight = 0;
  return {
    push(samples) {
      const output = [];
      for (const sample of samples) {
        let remaining = 1;
        while (remaining > 1e-10) {
          const portion = Math.min(remaining, ratio - weight);
          sum += sample * portion;
          weight += portion;
          remaining -= portion;
          if (weight >= ratio - 1e-10) {
            output.push(sum / ratio);
            sum = 0;
            weight = 0;
          }
        }
      }
      return Float32Array.from(output);
    },
  };
}

export function floatToPcm16(samples) {
  const buffer = new ArrayBuffer(samples.length * 2);
  const view = new DataView(buffer);
  for (let i = 0; i < samples.length; i++) {
    const value = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(i * 2, Math.round(value * (value < 0 ? 32768 : 32767)), true);
  }
  return buffer;
}
