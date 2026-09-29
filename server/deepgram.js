import WebSocket from 'ws';

export class DeepgramTranscriber {
  constructor(config, callbacks) {
    this.callbacks = callbacks;
    this.closed = false;
    this.ready = false;
    this.stopping = false;
    this.pending = '';
    const url = new URL(config.deepgramUrl);
    url.search = new URLSearchParams({ model: config.deepgramModel, language: 'vi', encoding: 'linear16',
      sample_rate: '16000', channels: '1', interim_results: 'true', punctuate: 'true',
      smart_format: 'true', endpointing: '400', vad_events: 'true', utterance_end_ms: '1000' }).toString();
    this.ws = new WebSocket(url, { headers: { authorization: `Token ${config.deepgramKey}` },
      handshakeTimeout: 10000, maxPayload: 1024 * 1024 });
    this.ws.on('open', () => console.log('[deepgram] upstream open'));
    this.ws.on('unexpected-response', (req, res) => console.error(`[deepgram] http ${res.statusCode}`));
    // Deepgram đóng nếu ~12s không nhận data, nhưng frame đầu có thể mất ~13s —
    // đẩy silence PCM giữ kết nối trong lúc chờ (text KeepAlive sớm sẽ chặn frame đầu).
    this.warmup = setInterval(() => {
      if (this.ws.readyState === WebSocket.OPEN && !this.ready) this.ws.send(Buffer.alloc(3200));
    }, 1000).unref();
    this.timeout = setTimeout(() => this.fail('Không kết nối được dịch vụ nhận giọng nói.'), 20000);
    this.ws.on('message', (data, isBinary) => {
      if (this.closed || isBinary) return;
      try {
        const event = JSON.parse(data.toString());
        if (event.type === 'Error' || event.err_code) return this.fail('Dịch vụ nhận giọng nói đang không khả dụng.');
        // Frame đầu tiên có thể là Metadata hoặc Results — cả hai đều báo stream đã sẵn sàng.
        if (!this.ready) {
          clearTimeout(this.timeout); clearInterval(this.warmup);
          this.ready = true;
          this.keepalive = setInterval(() => this.send({ type: 'KeepAlive' }), 8000).unref();
          if (!this.stopping) callbacks.ready();
        }
        if (event.type === 'Results') {
          const text = String(event.channel?.alternatives?.[0]?.transcript || '').trim();
          if (!text) return;
          if (event.is_final) {
            this.pending = `${this.pending} ${text}`.trim();
            if (event.speech_final) this.flush();
          } else callbacks.interim(`${this.pending} ${text}`.trim());
        } else if (event.type === 'UtteranceEnd') this.flush();
      } catch { this.fail('Không đọc được phản hồi nhận giọng nói.'); }
    });
    this.ws.on('error', error => {
      console.error('[deepgram] error:', error.message);
      this.fail('Mất kết nối tới dịch vụ nhận giọng nói.');
    });
    this.ws.on('close', (code, reason) => {
      console.log(`[deepgram] closed code=${code} reason=${String(reason).slice(0, 200)} ready=${this.ready} stopping=${this.stopping}`);
      if (!this.closed && !this.stopping) this.fail('Phiên nhận giọng nói đã ngắt. Bấm bắt đầu để kết nối lại.');
      this.close();
    });
  }
  send(data) { if (this.ws.readyState === WebSocket.OPEN) this.ws.send(Buffer.isBuffer(data) ? data : JSON.stringify(data)); }
  audio(buffer) {
    if (!this.ready || this.closed || this.stopping) return;
    if (this.ws.bufferedAmount > 128000) return this.fail('Kết nối chậm. Thu âm đã dừng để tránh mất lời nói.');
    this.ws.send(buffer);
  }
  flush() {
    const text = this.pending;
    this.pending = '';
    if (text) this.callbacks.final(text);
  }
  stop() {
    if (this.closed || this.stopping) return;
    this.stopping = true;
    this.send({ type: 'CloseStream' });
    this.drainTimer = setTimeout(() => this.close(), 3500);
  }
  fail(message) {
    if (this.closed) return;
    this.callbacks.error(message);
    this.close();
  }
  close() {
    if (this.closed) return;
    this.closed = true;
    clearTimeout(this.timeout); clearTimeout(this.drainTimer); clearInterval(this.keepalive); clearInterval(this.warmup);
    if (this.ws.readyState === WebSocket.OPEN) this.ws.close();
    else if (this.ws.readyState === WebSocket.CONNECTING) this.ws.terminate();
    this.flush();
    this.callbacks.closed();
  }
}
