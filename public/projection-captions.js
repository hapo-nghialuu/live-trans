import { $ } from './shared.js';

// Follow each language independently; interim speech must not move the history.
export function setupProjectionCaptions() {
  const lanes = ['en', 'ja'].map(lang => $(`caption-${lang}`));
  let frame;
  const followLatest = () => {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => {
      for (const lane of lanes) lane.scrollTop = lane.scrollHeight;
    });
  };
  for (const lane of lanes) {
    new MutationObserver(followLatest).observe(lane, { childList: true, characterData: true, subtree: true });
  }
  new MutationObserver(followLatest).observe(document.body, { attributes: true, attributeFilter: ['class'] });
  new ResizeObserver(followLatest).observe(document.querySelector('.translation-grid'));
}
