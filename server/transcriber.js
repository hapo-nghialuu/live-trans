import WebSocket from 'ws';

export class Transcriber {
  constructor(config, callbacks) {
    this.callbacks = callbacks;
    this.closed = false;
    this.ready = false;
    this.stopping = false;
    this.ws = new WebSocket('wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent', {
      headers: { 'x-goog-api-key': String(config.apiKey) }, handshakeTimeout: 10000, maxPayload: 1024 * 1024 });
    this.timeout = setTimeout(() => this.fail('Không kết nối được dịch vụ nhận giọng nói.'), 12000);
    this.ws.on('open', () => this.send({ setup: { model: `models/${config.transcribeModel}`,
      generationConfig: { responseModalities: ['TEXT'] }, inputAudioTranscription: { languageCodes: ['vi-VN'] } } }));
    this.ws.on('message', data => {
      if (this.closed) return;
      try {
        const event = JSON.parse(data.toString());
        if (event.error) return this.fail('Dịch vụ nhận giọng nói đang không khả dụng.');
        if (event.setupComplete) {
          clearTimeout(this.timeout);
          this.ready = true;
          if (!this.stopping) callbacks.ready();
        }
        const content = event.serverContent;
        if (content?.interimInputTranscription?.text) callbacks.interim(content.interimInputTranscription.text);
        if (content?.inputTranscription?.text) callbacks.final(content.inputTranscription.text);
      } catch { this.fail('Không đọc được phản hồi nhận giọng nói.'); }
    });
    this.ws.on('error', () => this.fail('Mất kết nối tới dịch vụ nhận giọng nói.'));
    this.ws.on('close', () => {
      if (!this.closed && !this.stopping) this.fail('Phiên nhận giọng nói đã ngắt. Bấm bắt đầu để kết nối lại.');
      this.close();
    });
  }
  send(data) { if (this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(data)); }
  audio(buffer) {
    if (!this.ready || this.closed || this.stopping) return;
    if (this.ws.bufferedAmount > 128000) return this.fail('Kết nối chậm. Thu âm đã dừng để tránh mất lời nói.');
    this.send({ realtimeInput: { audio: { data: buffer.toString('base64'), mimeType: 'audio/pcm;rate=16000' } } });
  }
  stop() {
    if (this.closed || this.stopping) return;
    this.stopping = true;
    this.send({ realtimeInput: { audioStreamEnd: true } });
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
    clearTimeout(this.timeout); clearTimeout(this.drainTimer);
    if (this.ws.readyState === WebSocket.OPEN) this.ws.close();
    else if (this.ws.readyState === WebSocket.CONNECTING) this.ws.terminate();
    this.callbacks.closed();
  }
}
