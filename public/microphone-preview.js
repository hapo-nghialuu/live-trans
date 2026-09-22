import { $ } from './shared.js';

export class MicrophonePreview {
  constructor() { this.items = []; this.interim = ''; }

  snapshot(event) {
    this.items = (event.captions || []).slice(-30);
    this.interim = event.interim || '';
    this.render();
  }

  update(event) {
    if (event.type === 'interim') this.interim = event.text;
    else {
      const caption = event.caption;
      const existing = this.items.findIndex((item) => item.id === caption.id);
      if (existing >= 0) this.items[existing] = caption;
      else {
        this.items.push(caption);
        this.items = this.items.slice(-30);
        this.interim = '';
      }
    }
    this.render();
  }

  render() {
    $('caption-vi').textContent = this.interim || this.items.at(-1)?.vi || 'Lời nói sẽ hiện ở đây khi bạn bắt đầu.';
  }
}
