# Task 02 — Khối "Nguồn âm thanh" và kiểm tra tín hiệu trên trang mic

Status: done

## Outcome
Trên trang mic, người dùng chọn được thiết bị đầu vào, bật chế độ "Nguồn từ mixer", bấm "Kiểm tra tín hiệu" để xem mức âm cùng cảnh báo quá mức hoặc quá nhỏ mà không gửi gì lên server. Lựa chọn được nhớ sau khi tải lại trang. Đổi lựa chọn khi đang kiểm tra thì kiểm tra tự chạy lại. Kiểm tra luôn kết thúc sạch khi thu âm bắt đầu, khi trang bị ẩn hoặc khi có lỗi.

## Scope
- In: module thuần `public/source-panel-state.js` (không dùng DOM) gồm:
  - `loadSourcePrefs(storage)`: đọc khoá `live-trans.mic.deviceId`, `live-trans.mic.mixer`; lỗi thì trả `{ deviceId: '', mixer: false }`.
  - `saveSourcePrefs(storage, patch)`: gộp `patch` vào giá trị đang lưu rồi ghi; đổi `mixer` không làm mất `deviceId` và ngược lại; lỗi bị nuốt.
  - `deviceOptions(devices, savedId, activeId)`: danh sách option cho `<select>`; luôn có "Micro mặc định" (value `''`); có `savedId` mà không có thiết bị nhãn thật nào khớp thì thêm "Thiết bị đã chọn (cần cấp quyền)"; option được chọn là `activeId` nếu có, ngược lại là `savedId`.
  - `sourceControlsLocked(phase)`: true khi `phase` là `acquiring`, `starting`, `recording`, `finishing`.
  - `checkShouldEnd(event)`: true với `hidden`, `halt`, `finishing`, `error`.
  - `micErrorMessage(error)`: ưu tiên `deviceErrorMessage(error)` (import từ `public/audio-source.js`), sau đó là ánh xạ hiện có cho `NotAllowedError`/`NotFoundError` (`public/microphone.js:81`), cuối cùng là `error.message`.
  - `createSignalMonitor()`: `start(now)` xoá lịch sử đỉnh và mốc quá mức; `push(now, peak)`; `hints(now)` trả `clipping` khi `now - lastClipAt < 1500`, `low` khi lịch sử phủ đủ 3000 ms gần nhất và mọi đỉnh trong đó `< 0.05`.
- `public/mic.html`: `<p id="signal-hint" role="status">` ngay dưới thanh mức âm (ngoài khối, để cảnh báo quá mức vẫn thấy khi đang thu mà khối đóng — người dùng chốt 2026-10-04), và `<details id="source-panel">` "Nguồn âm thanh" gồm `<select id="audio-device">`, `<input type="checkbox" id="mixer-mode">` "Nguồn từ mixer (tắt xử lý âm thanh)", `<button id="signal-check">`.
- `public/microphone.js`:
  - cờ `checking`; kiểm tra dùng chung bộ đếm `generation` với `start()`/`halt()`.
  - hàm `sourceOptions()` lấy `{ deviceId, mixer }` từ `loadSourcePrefs`, dùng ở cả `start()` và kiểm tra.
  - bắt đầu kiểm tra: `const version = ++generation; checking = true; monitor.start(now)`, rồi `capture.open({ ...sourceOptions(), wake: false })`; không gọi `record()`, không gọi `peer.send`.
  - `catch` của kiểm tra: `if (version !== generation) return;` rồi reset `checking`, `capture.close()`, hiện thông báo theo cùng bảng lỗi với `start()`.
  - `start()` và kiểm tra đều lấy câu lỗi từ `micErrorMessage(error)`; ánh xạ inline ở `public/microphone.js:81` được thay bằng lời gọi này.
  - `start()`: `if (checking) { checking = false; void capture.close(); }` trước `await capture.open(...)`.
  - reset `checking` và đóng micro trong `halt()`, trong nhánh `visibilitychange` khi trang ẩn, và khi nhận `finishing`.
  - đổi `<select>` hoặc công tắc khi đang kiểm tra: `saveSourcePrefs` rồi khởi động lại kiểm tra như trên (generation mới, `void capture.close()`, `monitor.start`). Không kiểm tra thì chỉ lưu.
  - `onNotice` hiện qua `showNotice`; `onLevel(rms, peak)` giữ công thức thanh mức `Math.min(1, rms * 5)` hiện có, đẩy `peak` vào `monitor` và hiện `hints` vào `#signal-hint`.
  - sau khi mở micro: `enumerateDevices` và cập nhật `<select>` bằng `deviceOptions` với `activeId` từ `track.getSettings().deviceId`; nghe `devicechange`.
  - `render()` khoá ba điều khiển theo `sourceControlsLocked(phase)`; `<details>` tự mở khi `mixer` bật hoặc có `deviceId`.
- `public/styles.css`: kiểu cho khối mới, khớp `.audio-level` hiện có (`public/styles.css:132`).
- Out: thay đổi chữ hay luồng hiện có ngoài khối mới; app mobile.

## Coverage
- CP-02
- CP-03

## Ownership
- Create: `public/source-panel-state.js`, `test/source-panel.test.js`
- Modify: `public/mic.html`, `public/microphone.js`, `public/styles.css`
- Read: `public/audio-capture.js`, `public/audio-source.js`, `public/shared.js`

## Acceptance
- AC-05: nhánh kiểm tra trong `microphone.js` không gọi `capture.record()`, không gọi `peer.send`, và truyền `wake: false`.
- AC-06: lưu `{ deviceId: 'abc' }` rồi lưu `{ mixer: true }` thì `loadSourcePrefs` trả cả hai; storage ném lỗi ở cả đọc và ghi thì trả mặc định và không ném. `deviceOptions([{ deviceId: '', label: '' }], 'abc', '')` có option "Thiết bị đã chọn (cần cấp quyền)" đang được chọn; có thiết bị khớp nhãn thật thì dùng nhãn đó; `activeId` khác `savedId` thì `activeId` được chọn.
- AC-07: `sourceControlsLocked` đúng với bốn phase đã nêu, sai với `idle`.
- AC-09: `checkShouldEnd` đúng với `hidden`, `halt`, `finishing`, `error`; mỗi nhánh tương ứng trong `microphone.js` reset `checking` và đóng micro; `catch` của kiểm tra bỏ qua lỗi khi generation đã đổi.
- AC-10: `start()` đóng phiên kiểm tra theo thứ tự `void capture.close()` rồi `await capture.open(...)`.
- AC-11: `createSignalMonitor` trả `clipping` true lúc 1499 ms và false lúc 1500 ms sau lần quá mức; `low` true khi mọi đỉnh trong 3000 ms < 0.05, false khi có một đỉnh 0.06 hoặc khi dữ liệu chưa phủ đủ 3000 ms; sau `start()` mới thì lịch sử cũ không còn tính.
- AC-03 (phần giao diện): `micErrorMessage` trả câu thiết bị bận cho `NotReadableError`, câu quyền micro hiện có cho `NotAllowedError`, câu không tìm thấy micro cho `NotFoundError`, và `error.message` cho lỗi khác.
- AC-12: đổi thiết bị hoặc chế độ mixer khi đang kiểm tra thì lưu lựa chọn và kiểm tra chạy lại với lựa chọn mới.

## Dependencies
- task-01-capture-source-options.md

## Verification Plan
- Command: `npm run check && npm test`
- Named probe: `source prefs merge, survive reload and storage errors`, `device options keep the saved device before permission`, `source controls lock outside idle`, `signal check ends on hide, halt, finishing and error`, `signal monitor shows clipping and low level and resets per check`, `mic error messages prefer the busy-device text` trong `test/source-panel.test.js`; `scripts/check.js` kiểm tra cú pháp mọi file JS dưới `public/`.
- Reachability: `npm test` chạy `node --test test/*.test.js`, gồm file test mới; `mic.html` nạp `microphone.js` (`public/mic.html:12`); `microphone.js` là nơi duy nhất gọi `capture.open()` (`public/microphone.js:72`).
- Oracle: lệnh exit 0 và sáu test có tên pass. Test chỉ chứng minh logic thuần. Phần nối dây trong `microphone.js` **không** có test tự động: AC-05 → C3 #2; AC-09 các nhánh ẩn tab, `halt`, Bắt đầu nói, `finishing`, lỗi → C3 #4; AC-10 → C3 #4; AC-12 → C3 #5; thiết bị bận ở cả hai luồng → C3 #8; chặn `catch` theo generation → chỉ đọc code.
- Counterexample: mốc 1.5 giây dùng `<=`; `low` bật khi chưa đủ 3 giây dữ liệu; `start()` của monitor không xoá lịch sử; lưu `mixer` làm mất `deviceId`; `deviceOptions` bỏ option "cần cấp quyền"; `loadSourcePrefs` ném khi storage lỗi; `sourceControlsLocked('idle')` true — mỗi trường hợp làm ít nhất một test có tên ở trên fail.
- Artifacts: không có.

## Receipt

Verification: PASS
Command: npm run check && npm test
Exit: 0
Base: 0b46cdfb8e1a1cad71dba67d11c54a42bfe614ac
Head: 11019351b1e9d8a3dff3264309b3ed0215d6a755f6094fb98b19895772c43e5a
```text
$ npm run check && npm test
> live-trans@0.1.0 check
> node scripts/check.js
Syntax OK: 28 JavaScript files
> live-trans@0.1.0 test
> node --test test/*.test.js
ok 1 - PCM resampling 16000Hz preserves duration and chunk continuity
ok 2 - PCM resampling 44100Hz preserves duration and chunk continuity
ok 3 - PCM resampling 48000Hz preserves duration and chunk continuity
ok 4 - PCM16 conversion clamps and uses signed little-endian representation
ok 5 - audio source constraints follow mixer mode
ok 6 - audio source constraints pin the chosen device
ok 7 - audio source falls back when the chosen device is gone
ok 8 - audio source reports a busy device in Vietnamese
ok 9 - level reporter keeps the peak from every frame
ok 10 - constant-time secret comparison rejects non-ASCII and wrong values safely
ok 11 - room creation needs valid access key AND allowed origin; path cannot read secrets
ok 12 - tokens are scoped by room and role, expire, and revoke on end
ok 13 - simultaneous room creation cannot exceed room limit
ok 14 - WebSocket rejects invalid token and a second microphone
ok 15 - viewer cannot upload audio; cross-origin websocket is rejected
ok 16 - translation queue preserves order and reports bounded overload, close suppresses late work
ok 17 - malformed WebSocket URL returns 400 without crashing the HTTP server
ok 18 - late translation cannot resurrect an evicted caption
ok 19 - numeric session code resolves to mic link, wrong codes are rejected and rate-limited
ok 20 - custom session code is used when free, conflicts rejected
ok 21 - approved alias creates microphone link on that HTTPS hostname only
ok 22 - provider param validates configured keys and is stored per room
ok 23 - POST /api/provider switches the global default for new rooms
ok 24 - loadConfig reads persisted provider from settings file
ok 25 - deepgram transcriber maps metadata/results into ready/interim/final callbacks
ok 26 - translate falls back to the secondary model after a quota 429 and skips the exhausted model
ok 27 - upstream reconnects after unexpected close without pausing the room
ok 28 - asr rotation swaps upstream connections without re-announcing to the mic
ok 29 - deepgram transcriber is ready on open without waiting for an upstream frame
ok 30 - audience empty states use English and Japanese
ok 31 - previous translation remains readable during new speech and translation
ok 32 - failed translation retains earlier text and displays an audience error
ok 33 - history stays chronological and updates a sentence without duplication
ok 34 - source prefs merge, survive reload and storage errors
ok 35 - device options keep the saved device before permission
ok 36 - source controls lock outside idle
ok 37 - signal check ends on hide, halt, finishing and error
ok 38 - signal monitor shows clipping and low level and resets per check
ok 39 - mic error messages prefer the busy-device text
# tests 39
# suites 0
# pass 39
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms 2122.818667
```
