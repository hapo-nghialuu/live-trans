import { $ } from './shared.js';
import { setupProjectionCaptions } from './projection-captions.js';

// The controller follows the microphone; each audience window owns its fullscreen.
export function setupPresentation() {
  setupProjectionCaptions();
  const displays = new Map();
  for (const id of ['open-english', 'open-japanese']) {
    $(id).addEventListener('click', event => {
      event.preventDefault();
      const link = event.currentTarget;
      const existing = displays.get(link.target);
      const display = existing && !existing.closed ? existing
        : window.open(link.href, link.target, 'popup,width=600,height=1000');
      if (display) { displays.set(link.target, display); display.opener = null; display.focus(); }
      $('display-feedback').textContent = display
        ? 'Đã mở cửa sổ. Kéo sang màn hình tương ứng và chọn Toàn màn hình trong cửa sổ đó.'
        : 'Trình duyệt đã chặn cửa sổ mới. Cho phép cửa sổ bật lên hoặc nhấn chuột phải vào nút để mở liên kết trong tab mới.';
    });
  }

  const controls = $('session-controls');
  let connected = false;
  let opener;
  const close = () => { if (controls.open) controls.close(); };
  const open = event => {
    opener = event.currentTarget;
    $('controls-error').hidden = true;
    controls.showModal();
  };
  $('session-menu').addEventListener('click', open);
  $('close-controls').addEventListener('click', close);
  controls.addEventListener('close', () => {
    const target = opener?.checkVisibility() ? opener : $('session-menu');
    if (document.body.classList.contains('has-session')) target.focus();
  });
  return {
    reset() {
      close();
      connected = false;
      document.body.classList.remove('has-mic', 'is-waiting');
    },
    connection(enabled) {
      connected = Boolean(enabled);
      document.body.classList.toggle('has-mic', connected);
      document.body.classList.toggle('is-waiting', !connected);
      $('session-tools').hidden = connected;
      document.querySelector('.caption-area').hidden = !connected;
      $('session-title').textContent = connected ? 'Màn hình trình chiếu' : 'Kết nối điện thoại';
      // Keep keyboard focus on a visible control when the waiting screen disappears.
      if (!controls.open && !document.activeElement?.checkVisibility()) {
        (connected ? $('open-english') : $('session-menu')).focus();
      }
    },
    status() {
      $('controls-status').textContent = $('connection-status').textContent;
    },
  };
}

export function configureDisplays(auth) {
  $('display-feedback').textContent = 'Cả hai cửa sổ cùng theo dõi phiên này và tự cuộn đến bản dịch mới nhất.';
  for (const [id, lang] of [['open-english', 'en'], ['open-japanese', 'ja']]) {
    const url = new URL('display.html', location.href);
    url.searchParams.set('lang', lang);
    url.hash = new URLSearchParams(auth).toString();
    $(id).href = url.href;
    $(id).target = `live-trans-${auth.room}-${lang}`;
  }
}
