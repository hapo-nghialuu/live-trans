export class AudioCapture {
  constructor({ onAudio, onLevel, onError, onWake }) {
    Object.assign(this, { onAudio, onLevel, onError, onWake });
    this.version = 0;
    this.recording = false;
  }

  async open() {
    if (!isSecureContext || !navigator.mediaDevices?.getUserMedia) {
      throw new Error('Micro cần kết nối HTTPS. Hãy mở liên kết HTTPS trên điện thoại.');
    }
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) throw new Error('Trình duyệt chưa hỗ trợ thu âm. Hãy dùng Safari hoặc Chrome mới.');
    const version = ++this.version;
    const context = new AudioContextClass();
    this.context = context;
    // Resume from the user's click, before waiting for the permission prompt.
    await context.resume();
    if (version !== this.version) return false;
    const stream = await navigator.mediaDevices.getUserMedia({ audio: {
      channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true,
    } });
    if (version !== this.version) {
      stream.getTracks().forEach((track) => track.stop());
      return false;
    }
    this.stream = stream;
    if (!context.audioWorklet) throw new Error('Trình duyệt chưa hỗ trợ AudioWorklet. Hãy cập nhật Safari hoặc Chrome.');
    await context.audioWorklet.addModule(new URL('./audio-processor.js', import.meta.url));
    if (version !== this.version) return false;
    const node = new AudioWorkletNode(context, 'pcm-processor');
    this.processor = node;
    node.port.onmessage = ({ data }) => {
      if (data.type === 'chunk') this.onAudio(data.pcm);
      else if (data.type === 'level') this.onLevel(data.rms);
    };
    node.onprocessorerror = () => this.onError('Bộ thu âm bị gián đoạn. Nhấn bắt đầu để thử lại.');
    this.source = context.createMediaStreamSource(stream);
    this.silence = context.createGain();
    this.silence.gain.value = 0;
    this.source.connect(node).connect(this.silence).connect(context.destination);
    for (const track of stream.getTracks()) {
      track.onended = () => this.onError('Micro đã bị ngắt. Kiểm tra quyền micro rồi thử lại.');
    }
    context.onstatechange = () => {
      if (this.recording && context.state !== 'running') this.onError('Thu âm đã bị hệ thống tạm dừng. Nhấn bắt đầu để tiếp tục.');
    };
    this.requestWake(version);
    return true;
  }

  async requestWake(version) {
    try {
      if (!navigator.wakeLock) throw new Error('unavailable');
      const lock = await navigator.wakeLock.request('screen');
      if (version !== this.version) { await lock.release(); return; }
      this.wakeLock = lock;
      this.onWake('Đang giữ màn hình sáng khi thu âm.');
      lock.addEventListener('release', () => {
        if (this.wakeLock === lock) this.onWake('Hãy giữ màn hình sáng để micro tiếp tục hoạt động.');
      });
    } catch {
      if (version === this.version) this.onWake('Hãy giữ màn hình sáng; trình duyệt không bật được chế độ giữ sáng.');
    }
  }

  record() {
    this.recording = true;
    this.processor?.port.postMessage({ type: 'record', enabled: true });
  }

  async close(flush = false) {
    const version = ++this.version;
    this.recording = false;
    // Detach this run immediately: a pending permission/flush cannot own a new run.
    const { context, stream, processor, source, silence, wakeLock } = this;
    this.context = this.stream = this.processor = this.source = this.silence = this.wakeLock = null;
    if (context) context.onstatechange = null;
    stream?.getTracks().forEach((track) => { track.onended = null; track.stop(); });
    if (wakeLock) wakeLock.release().catch(() => {});
    if (flush && processor && context?.state === 'running') {
      await new Promise((resolve) => {
        const timer = setTimeout(resolve, 120);
        const onMessage = processor.port.onmessage;
        processor.port.onmessage = (event) => {
          if (event.data.type === 'flushed') { clearTimeout(timer); resolve(); }
          else onMessage?.(event);
        };
        processor.port.postMessage({ type: 'flush' });
      });
    }
    if (processor) { processor.port.onmessage = null; processor.onprocessorerror = null; }
    source?.disconnect();
    processor?.disconnect();
    silence?.disconnect();
    if (context && context.state !== 'closed') await context.close().catch(() => {});
    if (version === this.version) { this.onLevel(0); this.onWake(''); }
  }
}
