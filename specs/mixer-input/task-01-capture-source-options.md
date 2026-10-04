# Task 01 — Bộ thu nhận thiết bị, chế độ mixer, xử lý lỗi thiết bị và đo đỉnh trên mọi frame

Status: done

## Outcome
`AudioCapture.open({ deviceId, mixer, wake })` mở đúng thiết bị và chế độ xử lý, tự quay về micro mặc định khi thiết bị đã chọn không còn, cung cấp câu báo tiếng Việt cho thiết bị bận, và `onLevel(rms, peak)` nhận đỉnh cộng dồn qua mọi frame.

## Scope
- In: module thuần `public/audio-source.js` (không dùng DOM/`navigator`) gồm:
  - `audioConstraints({ deviceId, mixer })`: luôn `channelCount: 1`; ba bộ xử lý `= !mixer`; có `deviceId: { exact }` chỉ khi có id.
  - `isMissingDevice(error)`: đúng với `OverconstrainedError`, `NotFoundError`.
  - `deviceErrorMessage(error)`: `NotReadableError` → "Thiết bị âm thanh đang bị ứng dụng khác dùng. Đóng ứng dụng đó rồi thử lại."; các lỗi khác trả `null`.
  - `openStream(getUserMedia, { deviceId, mixer }, onNotice)`: thử với `deviceId`; nếu `isMissingDevice` và có `deviceId` thì thử lại không kèm id; chỉ gọi `onNotice("Không thấy thiết bị đã chọn, đang dùng micro mặc định.")` khi lần thử lại thành công; lỗi khác ném ra nguyên vẹn.
  - `createLevelReporter(every = 12, threshold = 0.98)`: `push(frame)` cộng dồn tổng bình phương, số mẫu và `max |x|` qua **mọi** lần gọi; lần gọi thứ `every` trả `{ rms, peak, clipping }` rồi reset, các lần khác trả `null`. Bộ đếm frame nằm trong helper này.
- `public/audio-capture.js`: `open(options = {})` gọi `this.close()` không await nếu còn tài nguyên của lần trước; gọi `openStream((c) => navigator.mediaDevices.getUserMedia(c), options, this.onNotice)` (AC-08); chỉ `requestWake` khi `options.wake !== false`; constructor nhận thêm `onNotice`; message `'level'` gọi `this.onLevel(data.rms, data.peak)`; `close()` giữ điều kiện version hiện có (`public/audio-capture.js:97`) và gọi `this.onLevel(0, 0)`.
- `public/audio-processor.js`: bỏ bộ đếm `levelFrames` riêng; gọi `reporter.push(input)` ở **mọi** lần `process()` và gửi `{ type: 'level', rms, peak }` khi kết quả khác `null`.
- Out: giao diện, lưu lựa chọn, danh sách thiết bị, kiểm tra tín hiệu (task 02).

## Coverage
- CP-01
- CP-02

## Ownership
- Create: `public/audio-source.js`
- Modify: `public/audio-capture.js`, `public/audio-processor.js`, `test/audio.test.js`
- Read: `public/microphone.js`, `public/resampler.js`

## Acceptance
- AC-01: `audioConstraints({ mixer: true })` cho ba bộ xử lý `false`; `{ mixer: false }` và `{}` cho `true`; luôn có `channelCount: 1`.
- AC-02: `audioConstraints({ deviceId: 'abc' })` có `deviceId: { exact: 'abc' }`; không có id thì không có khoá `deviceId`.
- AC-03: với `getUserMedia` giả ném `OverconstrainedError` lần đầu và trả stream lần hai, `openStream` trả stream, lần gọi hai không có `deviceId`, `onNotice` được gọi đúng một lần. Nếu lần hai cũng ném thì `onNotice` không được gọi và lỗi được ném ra. `NotAllowedError` không thử lại. `deviceErrorMessage` trả đúng câu cho `NotReadableError` và `null` cho lỗi khác.
- AC-04: với 12 lần `push` trong đó chỉ frame thứ 3 có mẫu 0.99, 11 lần đầu trả `null`, lần thứ 12 trả `peak` 0.99 và `clipping` true; 12 frame im lặng tiếp theo trả `peak` 0. `audio-processor.js` không còn bộ đếm frame riêng.
- AC-08: `audio-capture.js` truyền hàm bọc `(c) => navigator.mediaDevices.getUserMedia(c)`, không truyền tham chiếu phương thức trần.

## Dependencies
- none

## Verification Plan
- Command: `npm test`
- Named probe: `audio source constraints follow mixer mode`, `audio source constraints pin the chosen device`, `audio source falls back when the chosen device is gone`, `audio source reports a busy device in Vietnamese`, `level reporter keeps the peak from every frame` trong `test/audio.test.js`
- Reachability: `npm test` chạy `node --test test/*.test.js` (`package.json`); `public/audio-source.js` không dùng DOM nên import được trong Node, giống `public/resampler.js` ở `test/audio.test.js:3`. Worklet đã import module ES (`public/audio-processor.js:1`).
- Oracle: năm test trên pass; các test cũ trong `test/audio.test.js` vẫn pass.
- Counterexample: giữ cứng `echoCancellation: true` khi `mixer: true`; bỏ `exact`; không thử lại khi `OverconstrainedError`; gọi `onNotice` trước khi lần thử lại thành công; helper chỉ tính đỉnh ở lần push thứ 12 — mỗi trường hợp làm ít nhất một test có tên ở trên fail. Phần nối dây không chạy được trong Node (worklet gọi `push` ở mọi frame, AC-08 hàm bọc) được kiểm bằng đọc code tại review và mục C3 #3 và #1 trong `plan.md`.
- Artifacts: không có, output lệnh là đủ.

## Receipt

Verification: PASS
Command: npm test
Exit: 0
Base: 0b46cdfb8e1a1cad71dba67d11c54a42bfe614ac
Head: 11019351b1e9d8a3dff3264309b3ed0215d6a755f6094fb98b19895772c43e5a
```text
$ npm test
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
# duration_ms 2273.3505
```
