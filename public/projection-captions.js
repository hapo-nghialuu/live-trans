import { $ } from './shared.js';

// Paginate unusually long captions so both languages stay on the screen.
export function setupProjectionCaptions() {
  const lanes = ['en', 'ja'].map(lang => {
    const source = $(`caption-${lang}`);
    const text = document.createElement('p');
    text.className = 'projection-text';
    text.lang = lang;
    const counter = document.createElement('span');
    counter.className = 'projection-page';
    source.after(text, counter);
    return { source, text, counter, timer: null };
  });
  let frame;
  const active = () => document.body.classList.contains('is-presenting');
  const render = lane => {
    const signature = active() ? `${innerWidth}:${innerHeight}:${lane.source.textContent}` : null;
    if (signature === lane.signature) return;
    lane.signature = signature;
    clearTimeout(lane.timer);
    if (!active()) return;
    const { source, text, counter } = lane;
    counter.textContent = '';
    const chars = Array.from(source.textContent);
    const fits = () => text.scrollHeight <= text.clientHeight && text.scrollWidth <= text.clientWidth;
    const preferred = Math.min(76, Math.max(36, innerWidth * .039));
    text.textContent = chars.join('');
    let size = preferred;
    text.style.fontSize = `${size}px`;
    while (!fits() && size > 28) {
      size = Math.max(28, size - 2);
      text.style.fontSize = `${size}px`;
    }
    const pages = [];
    let offset = 0;
    while (offset < chars.length) {
      let low = 1, high = chars.length - offset, count = 1;
      while (low <= high) {
        const mid = Math.floor((low + high) / 2);
        text.textContent = chars.slice(offset, offset + mid).join('');
        if (fits()) { count = mid; low = mid + 1; }
        else high = mid - 1;
      }
      // Prefer word boundaries for English; Japanese can wrap between characters.
      if (source.lang === 'en' && offset + count < chars.length) {
        const boundary = chars.slice(offset, offset + count).lastIndexOf(' ');
        if (boundary > count / 2) count = boundary + 1;
      }
      pages.push(chars.slice(offset, offset + count).join('').trim());
      offset += count;
    }
    let page = 0;
    const show = () => {
      if (!active()) return;
      text.textContent = pages[page] || '';
      counter.textContent = pages.length > 1 ? `${page + 1} / ${pages.length}` : '';
      if (pages.length > 1) {
        const delay = Math.max(8000, Math.min(30000, Array.from(text.textContent).length / 12 * 1000));
        page = (page + 1) % pages.length;
        lane.timer = setTimeout(show, delay);
      }
    };
    show();
  };
  const refresh = () => {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => lanes.forEach(render));
  };
  for (const lane of lanes) {
    new MutationObserver(refresh).observe(lane.source, { childList: true, characterData: true, subtree: true });
  }
  new MutationObserver(refresh).observe(document.body, { attributes: true, attributeFilter: ['class'] });
  new ResizeObserver(refresh).observe(document.querySelector('.translation-grid'));
}
