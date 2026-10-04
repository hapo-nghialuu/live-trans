# Nguồn âm thanh từ mixer cho trang mic web
Specs-Contract: process-first-ready-v1

## Scope decision (C1 — 2026-10-04)
- Existing: `getUserMedia` duy nhất ở `public/audio-capture.js:20-22`, đang bật cứng `echoCancellation`, `noiseSuppression`, `autoGainControl` và dùng thiết bị mặc định. `open()` mở micro nhưng chỉ gửi audio sau `record()` (`public/audio-capture.js:67-70`). Thanh mức âm có sẵn ở `public/mic.html:29` và `public/microphone.js:26`, worklet tính RMS mỗi 12 frame (`public/audio-processor.js:33-38`). Test thuần cho audio ở `test/audio.test.js`. `AudioCapture` chỉ có một nơi dùng: `public/microphone.js:19-29`.
- Minimum change: chọn thiết bị đầu vào, chế độ "Nguồn từ mixer" tắt ba bộ xử lý của trình duyệt, nút "Kiểm tra tín hiệu" hiện mức âm và cảnh báo quá mức hoặc quá nhỏ mà không gửi gì lên server.
- Expansion signals: không có. 9 file, 2 module thuần mới, 1 subsystem (trang mic web).
- User decision: KEEP — làm đủ ba việc trên, chỉ trên trang mic web.

## Out of scope
- App mobile (`mobile/`), server, ASR, dịch.
- Chọn kênh trái/phải của card stereo (chỉ phát hiện và gợi ý, xem AC-11); ghi âm hoặc lưu file.
- Thay đổi hành vi mặc định khi người dùng không mở khối "Nguồn âm thanh".

## Coverage profile
| ID | Outcome | Change kinds | Material surfaces | Ambiguity/action | Risk/evidence | Required proof |
|---|---|---|---|---|---|---|
| CP-01 | Thu âm dùng đúng thiết bị và chế độ xử lý; thiết bị đã chọn mất hoặc bận thì xử lý rõ ràng | modify, add | Interaction/UI, Integration/proof | none | elevated — API thiết bị của trình duyệt (`public/audio-capture.js:20`) | source (`npm test`); live thủ công tại C3 |
| CP-02 | Mức âm phản ánh mọi mẫu; cảnh báo quá mức và quá nhỏ hiển thị đúng lúc | modify, add | Interaction/UI | none | routine — worklet đã có RMS (`public/audio-processor.js:33-38`) | source (`npm test`); live thủ công tại C3 |
| CP-03 | Người dùng chọn thiết bị, bật chế độ mixer, kiểm tra tín hiệu; lựa chọn được nhớ; kiểm tra tín hiệu không lệch vòng đời thu âm | add, modify | Interaction/UI, Async/state | none | elevated — tương tác với `start()`/`halt()`/`visibilitychange` (`public/microphone.js:40-84, 146-152`) | source (`npm test`); live thủ công tại C3 |

## Quyết định thiết kế (đã chốt)
- Mặc định: chế độ mixer **tắt**, thiết bị **mặc định**. Không mở khối thì hành vi giữ nguyên như hiện tại.
- Chế độ mixer bật thì `echoCancellation`, `noiseSuppression`, `autoGainControl` đều `false`. Tắt thì cả ba `true`.
- Đỉnh tín hiệu: helper `createLevelReporter` giữ bộ đếm frame, cộng dồn `max |x|` qua **mọi** lần `process()`, trả RMS và đỉnh mỗi 12 frame rồi reset; worklet không có bộ đếm riêng. Đỉnh ≥ 0.98 là quá mức. Cảnh báo quá mức giữ 1.5 giây kể từ lần quá mức gần nhất. Thanh mức giữ công thức `Math.min(1, rms * 5)` hiện có.
- Tín hiệu quá nhỏ: khi đang kiểm tra, nếu mọi đỉnh trong 3 giây gần nhất đều < 0.05 thì hiện "Tín hiệu quá nhỏ hoặc không có — kiểm tra kênh/AUX trên mixer và card". Mỗi lần kiểm tra mới (kể cả tự chạy lại) xoá lịch sử đỉnh.
- Lưu lựa chọn: `localStorage` là nguồn sự thật, khoá `live-trans.mic.deviceId` và `live-trans.mic.mixer`. Đọc/ghi lỗi thì dùng mặc định, không báo lỗi. Ô chọn chỉ để hiển thị. Lưu theo kiểu gộp: đổi chế độ mixer giữ nguyên `deviceId` đã lưu, đổi thiết bị giữ nguyên `mixer`.
- Chưa có quyền micro mà có id đã lưu: ô chọn có option "Thiết bị đã chọn (cần cấp quyền)" đang được chọn. Có quyền rồi thì hiện tên thật từ `enumerateDevices`.
- Thiết bị đã chọn không còn: mở micro mặc định, **không xoá** id đã lưu, ô chọn hiện thiết bị đang dùng thật (lấy từ `track.getSettings().deviceId`). Chỉ báo "Không thấy thiết bị đã chọn, đang dùng micro mặc định." khi lần thử lại thành công.
- Thiết bị bận (`NotReadableError`): báo "Thiết bị âm thanh đang bị ứng dụng khác dùng. Đóng ứng dụng đó rồi thử lại." `start()` và kiểm tra dùng chung một bảng lỗi, ưu tiên câu này.
- Kiểm tra tín hiệu có cờ `checking` riêng, không đổi `phase`. Kiểm tra dùng chung bộ đếm `generation` với `start()`/`halt()`. Cờ được reset khi `halt()`, khi trang bị ẩn, khi server gửi `finishing`, và khi kiểm tra gặp lỗi (kèm `capture.close()`); `catch` của kiểm tra bỏ qua lỗi nếu generation đã đổi. Kiểm tra không xin wake lock.
- Đổi thiết bị hoặc chế độ mixer khi đang kiểm tra (C2 vòng 2, 2026-10-04): lưu lựa chọn rồi tự chạy lại kiểm tra với lựa chọn mới.
- Chuyển từ kiểm tra sang thu: `void capture.close(); await capture.open(opts)` để giữ thao tác click cho AudioContext. `open()` tự đóng phần còn sót của lần mở trước.
- Dòng cảnh báo tín hiệu nằm ngay dưới thanh mức âm, ngoài khối "Nguồn âm thanh", để thấy được cả khi đang thu mà khối đóng (người dùng chốt khi review task 02, 2026-10-04).
- Khối "Nguồn âm thanh" là `<details>` đóng sẵn, tự mở khi chế độ mixer bật hoặc có id đã lưu. Khi đang bắt đầu, đang thu hoặc đang hoàn tất thì khoá ô chọn, công tắc mixer và nút kiểm tra.

## Acceptance criteria
| ID | EARS criterion | Proof |
|---|---|---|
| AC-01 | Where chế độ mixer bật, the trang mic shall gọi `getUserMedia` với ba bộ xử lý đều `false`; khi tắt, cả ba `true`. | `npm test` — `audio source constraints follow mixer mode` |
| AC-02 | When có thiết bị đã chọn, the trang mic shall yêu cầu đúng `deviceId` đó (`exact`). | `npm test` — `audio source constraints pin the chosen device` |
| AC-03 | If thiết bị đã chọn không còn, the trang mic shall mở micro mặc định và chỉ báo fallback khi lần thử lại thành công; if thiết bị bận, the trang mic shall báo bằng câu tiếng Việt đã chốt. | `npm test` — `audio source falls back when the chosen device is gone`, `audio source reports a busy device in Vietnamese`, `mic error messages prefer the busy-device text`; C3 #6, #8 |
| AC-04 | The worklet shall báo RMS và đỉnh cộng dồn qua mọi frame trong mỗi chu kỳ 12 frame; đỉnh ≥ 0.98 là quá mức. | `npm test` — `level reporter keeps the peak from every frame`; nối dây worklet: review + C3 |
| AC-05 | While đang kiểm tra tín hiệu, the trang mic shall hiện mức âm, không gửi `start` hay audio lên server, và không xin wake lock. | Đọc code tại review; C3: log server không có `start asr`, không hiện câu giữ màn hình sáng |
| AC-06 | When người dùng đổi thiết bị hoặc chế độ mixer, the trang mic shall lưu lựa chọn và dùng nó ở lần mở micro tiếp theo, kể cả sau khi tải lại trang và khi chưa có quyền micro. | `npm test` — `source prefs merge, survive reload and storage errors`, `device options keep the saved device before permission` |
| AC-07 | While đang bắt đầu, đang thu hoặc đang hoàn tất, the trang mic shall khoá ô chọn thiết bị, công tắc mixer và nút kiểm tra. | `npm test` — `source controls lock outside idle` |
| AC-08 | The bộ thu shall gọi `getUserMedia` qua một hàm bọc giữ ngữ cảnh `navigator.mediaDevices`. | Đọc code tại review; live thủ công tại C3 |
| AC-09 | If trang bị ẩn, `halt()` chạy, server gửi `finishing`, hoặc kiểm tra gặp lỗi khi đang kiểm tra tín hiệu, the trang mic shall đóng micro và đưa nút kiểm tra về trạng thái chưa kiểm tra. | `npm test` — `signal check ends on hide, halt, finishing and error` (bảng tra); nối dây từng nhánh: review + C3 |
| AC-10 | When chuyển từ kiểm tra sang thu, the trang mic shall đóng phiên kiểm tra trước khi mở micro thu mà không có hai luồng âm thanh cùng chạy. | Đọc code tại review; live thủ công tại C3 |
| AC-11 | While đang kiểm tra, if mọi đỉnh trong 3 giây gần nhất < 0.05, the trang mic shall hiện gợi ý tín hiệu quá nhỏ; cảnh báo quá mức giữ 1.5 giây. | `npm test` — `signal monitor shows clipping and low level and resets per check` |
| AC-12 | While đang kiểm tra tín hiệu, when người dùng đổi thiết bị hoặc chế độ mixer, the trang mic shall lưu lựa chọn và chạy lại kiểm tra với lựa chọn mới. | Đọc code tại review; C3 |

## Tasks
| # | Task | Criteria | Primary ownership | Dependencies | Status |
|---|---|---|---|---|---|
| 01 | Bộ thu nhận thiết bị, chế độ mixer, xử lý lỗi thiết bị và đo đỉnh trên mọi frame | AC-01, AC-02, AC-03, AC-04, AC-08 | `public/audio-source.js`, `public/audio-capture.js`, `public/audio-processor.js`, `test/audio.test.js` | - | done |
| 02 | Khối "Nguồn âm thanh" và kiểm tra tín hiệu trên trang mic | AC-03, AC-05, AC-06, AC-07, AC-09, AC-10, AC-11, AC-12 | `public/source-panel-state.js`, `test/source-panel.test.js`, `public/mic.html`, `public/microphone.js`, `public/styles.css` | task-01-capture-source-options.md | done |

## Giới hạn kiểm chứng
- Không có công cụ test trình duyệt trong repo (`package.json` chỉ có `qrcode`, `ws`). Test tự động chỉ chứng minh logic thuần và cấu hình. Phần nối dây trong `microphone.js` và worklet được kiểm bằng đọc code; checklist dưới đây chỉ phủ những phần ghi rõ số mục, phần còn lại là **chỉ đọc code**.
- Checklist thủ công tại C3 (Chrome, micro thường và card USB nếu có):
  1. Micro mở được khi chọn thiết bị cụ thể và khi để mặc định (AC-08, AC-02).
  2. Kiểm tra tín hiệu: thanh mức chạy; log server không có dòng `start asr`; không hiện câu "Đang giữ màn hình sáng khi thu âm." (AC-05).
  3. Vỗ tay ngắn hoặc nói sát micro bật cảnh báo quá mức; rút dây hoặc tắt AUX 3 giây hiện gợi ý quá nhỏ (AC-04, AC-11).
  4. Đang kiểm tra thì: (a) ẩn tab; (b) ngắt mạng để `halt()` chạy; (c) bấm Bắt đầu nói; (d) server gửi `finishing` (bấm Dừng thu ở một tab mic khác cùng phiên hoặc kết thúc phiên trên màn hình chính); (e) kiểm tra gặp lỗi (chặn quyền micro của trang rồi bấm Kiểm tra). Mọi trường hợp: nút về "Kiểm tra tín hiệu", micro tắt, không còn hai luồng âm thanh (AC-09, AC-10).
  5. Đang kiểm tra, đổi thiết bị và bật/tắt mixer: kiểm tra chạy lại, lựa chọn còn sau khi tải lại trang (AC-12, AC-06).
  6. Rút card USB đã chọn rồi mở micro: hiện câu fallback, ô chọn hiện micro đang dùng, tải lại trang thì lựa chọn cũ vẫn còn (AC-03, AC-06).
  7. Đọc `track.getSettings().channelCount` với card stereo (giới hạn F7).
  8. Thiết bị bận: trên Windows, mở card USB ở chế độ độc quyền trong một ứng dụng khác, rồi bấm cả Kiểm tra tín hiệu và Bắt đầu nói. Cả hai hiện câu tiếng Việt về thiết bị bận (AC-03). [UNVERIFIED] macOS cho nhiều ứng dụng dùng chung card nên có thể không tái hiện được; khi đó bảng lỗi dùng chung được chứng minh bằng test `mic error messages prefer the busy-device text`.
- Chỉ đọc code (không tái hiện được bằng tay một cách đáng tin): `catch` của kiểm tra bỏ qua lỗi khi generation đã đổi (AC-09, vấn đề N1).
- Khi để "Micro mặc định", sau khi mở micro ô chọn có thể hiện tên thiết bị thật đang được dùng (Chrome có thể có thêm mục "default"), vì ô chọn hiển thị thiết bị thực tế từ `track.getSettings()`. Chỉ ảnh hưởng hiển thị; lựa chọn đã lưu không đổi. Đối chiếu ở C3 #1 và #6.
- [UNVERIFIED] Safari/iOS: nhớ quyền micro, `deviceId` ổn định, tắt được AGC/echoCancellation, resume AudioContext. Chỉ xác nhận được trên thiết bị thật.
- Máy local chạy Node 22 trong khi `engines` yêu cầu ≥24. Lệnh vẫn chạy, chỉ cảnh báo.

## Review log
- Round 1: 2 reviewer (Fact Checker; Failure-mode + Assumption destroyer). 8 finding sau khi gộp: F1 đỉnh chỉ đo 1/12 frame; F2 `getUserMedia` không bind; F3 kiểm tra nằm ngoài vòng đời `phase`; F4 thứ tự `close`/`open`; F5 nguồn sự thật thiết bị đã lưu; F6 `NotReadableError` và dọn lỗi kiểm tra; F7 kênh stereo/tín hiệu nhỏ; F8 AC-05..07 thiếu bằng chứng tự động. C2 (2026-10-04): người dùng chấp nhận cả 8.
- Sửa: F1 → AC-04 + quyết định "Đỉnh tín hiệu"; F2 → AC-08; F3 → AC-05, AC-09 + quyết định "Kiểm tra tín hiệu"; F4 → AC-10 + quyết định "Chuyển từ kiểm tra sang thu"; F5 → AC-06 + hai quyết định về lưu và thiết bị mất; F6 → AC-03 + quyết định "Thiết bị bận"; F7 → AC-11 + quyết định "Tín hiệu quá nhỏ"; F8 → module thuần `public/source-panel-state.js` + `test/source-panel.test.js` trong task 02.
- Closure vòng 1 (reviewer mới): F2, F4, F5, F7 PASS; F1, F3, F6, F8 (phần AC-05) FAIL vì test chỉ kiểm hàm thuần, không bắt lỗi nối dây; thêm 3 vấn đề: catch kiểm tra đóng nhầm phiên thu, đổi mixer ghi đè `deviceId`, chưa chốt reset lịch sử đỉnh và việc đổi lựa chọn khi đang kiểm tra.
- Round 2 (2026-10-04): F1 → bộ đếm frame chuyển vào `createLevelReporter`; F3, F6, AC-05 → ghi trung thực phần nối dây là review + C3, thêm checklist 7 mục, bỏ test vô nghĩa `checkMayRecord`, bảng lỗi dùng chung; vấn đề 1 → chặn catch theo generation; vấn đề 2 → lưu kiểu gộp; vấn đề 3 → monitor reset mỗi lần kiểm tra, giữ công thức thanh mức; người dùng chọn tự chạy lại kiểm tra khi đổi lựa chọn → AC-12.
- Closure vòng 2 (reviewer mới): F1, F8/AC-05, N2, N3 PASS; F3, F6, N1 FAIL vì thiếu bằng chứng (thiết kế đã đúng). Sửa: C3 #4 thêm `finishing` và lỗi kiểm tra; C3 #8 cho thiết bị bận; helper `micErrorMessage` có test cho bảng lỗi dùng chung; N1 ghi rõ là chỉ đọc code. Hết hai vòng giấy; không chạy thêm vòng closure trên giấy.
- Quyết định người dùng (2026-10-04): chấp nhận đóng F3, F6, N1 bằng bản sửa vòng 2; bằng chứng còn lại thuộc test khi triển khai và checklist C3. Hai task chuyển sang `pending`.
- Sweep: 3 file đọc lại / 8 delta / tham chiếu cũ đã sửa: tiêu chí AC-05..07 chỉ thủ công, quyết định "một khối 12 frame", số file 7 → 9 / mâu thuẫn còn lại: 0.
