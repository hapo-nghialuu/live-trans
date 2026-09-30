import { $ } from './shared.js';

export class Captions {
  constructor() { this.items = []; this.interim = ''; }

  reset(items = [], interim = '') {
    this.items = items.slice(-30);
    this.interim = interim;
    this.render();
  }

  update(caption) {
    const existing = this.items.findIndex((item) => item.id === caption.id);
    if (existing >= 0) this.items[existing] = caption;
    else {
      this.items.push(caption);
      this.items = this.items.slice(-30);
    }
    this.render();
  }

  setInterim(text) { this.interim = text; this.render(); }

  renderOriginal() {
    $('caption-vi').textContent = this.interim || this.items.at(-1)?.vi || 'Bắt đầu nói trên điện thoại để thấy lời của bạn.';
  }

  render() {
    const latest = this.items.at(-1);
    const listening = Boolean(this.interim);
    for (const lang of ['en', 'ja']) {
      const node = $(`caption-${lang}`);
      // Keep the last available translation visible while the next sentence arrives.
      const translated = this.items.findLast(item => item[lang])?.[lang];
      const empty = lang === 'en' ? 'Waiting for the speaker…' : '開始までお待ちください…';
      const pending = lang === 'en' ? 'Preparing captions…' : '字幕を準備しています…';
      const error = lang === 'en' ? 'Translation temporarily unavailable.' : '翻訳は一時的に利用できません。';
      node.textContent = translated || (latest?.status === 'error' ? error : latest || listening ? pending : empty);
      node.classList.toggle('empty', !translated);
    }
    const failed = latest?.status === 'error';
    $('caption-progress').hidden = !failed && !listening && latest?.status !== 'translating';
    $('caption-progress').textContent = failed
      ? 'Translation temporarily unavailable · 翻訳は一時的に利用できません'
      : 'Updating captions… · 字幕を更新しています…';
    $('translation-status').textContent = listening ? 'Bản dịch sẽ hiện khi câu đang nói hoàn tất.' : latest?.status === 'error' ? 'Dịch chưa thành công. Lời gốc tiếng Việt vẫn được giữ lại.' : latest?.status === 'translating' ? 'Đang chuyển lời của bạn sang hai ngôn ngữ…' : '';
    this.renderOriginal();
    const recent = (listening ? this.items.slice(-3) : this.items.slice(-4, -1)).reverse();
    $('recent-section').hidden = !recent.length;
    $('recent-captions').replaceChildren(...recent.map((caption) => {
      const row = document.createElement('article');
      row.className = 'recent-item';
      for (const lang of ['en', 'ja', 'vi']) {
        const p = document.createElement('p');
        p.lang = lang;
        p.textContent = caption[lang] || (caption.status === 'error' ? 'Chưa dịch được.' : 'Đang dịch…');
        p.className = lang === 'vi' ? 'recent-vi' : !caption[lang] && caption.status === 'error' ? 'recent-error' : '';
        row.append(p);
      }
      return row;
    }));
  }
}
