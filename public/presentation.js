import { $ } from './shared.js';
import { setupProjectionCaptions } from './projection-captions.js';

// Presentation stays available when the browser cannot enter native fullscreen.
export function setupPresentation() {
  setupProjectionCaptions();
  let requestedFullscreen = false;
  const setMode = enabled => {
    document.body.classList.toggle('is-presenting', enabled);
    $('exit-presentation').hidden = !enabled;
    $('fullscreen').setAttribute('aria-pressed', String(enabled));
    $('fullscreen').textContent = enabled ? 'Thoát trình chiếu' : 'Trình chiếu';
  };
  const exit = () => {
    setMode(false);
    requestedFullscreen = false;
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    $('fullscreen').focus();
  };
  $('fullscreen').addEventListener('click', async () => {
    if (document.body.classList.contains('is-presenting')) return exit();
    setMode(true);
    $('exit-presentation').focus();
    try {
      await document.documentElement.requestFullscreen();
      requestedFullscreen = true;
      if (!document.body.classList.contains('is-presenting')) exit();
    } catch { /* The clean projection layout still works without fullscreen. */ }
  });
  $('exit-presentation').addEventListener('click', exit);
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && document.body.classList.contains('is-presenting')) exit();
  });
  document.addEventListener('fullscreenchange', () => {
    if (requestedFullscreen && !document.fullscreenElement) exit();
  });
  $('toggle-setup').addEventListener('click', () => {
    const open = $('session-tools').hidden;
    $('session-tools').hidden = !open;
    $('toggle-setup').setAttribute('aria-expanded', String(open));
  });
  return {
    reset() { exit(); $('session-tools').hidden = false; $('toggle-setup').setAttribute('aria-expanded', 'true'); },
    status(state) {
      const labels = {
        listening: ['', ''],
        finishing: ['Updating captions…', '字幕を更新しています…'],
        paused: ['Captions paused', '字幕は一時停止中です'],
        disconnected: ['Connection interrupted', '接続が途切れました'],
        error: ['Captions temporarily unavailable', '字幕は一時的に利用できません'],
      };
      const [en, ja] = labels[state] || ['Waiting for the speaker', '開始までお待ちください'];
      $('audience-status').querySelector('[lang="en"]').textContent = en;
      $('audience-status').querySelector('[lang="ja"]').textContent = ja;
      $('audience-status').dataset.state = state;
      $('audience-status').hidden = state === 'listening';
    },
    connected() { $('session-tools').hidden = true; $('toggle-setup').setAttribute('aria-expanded', 'false'); },
  };
}
