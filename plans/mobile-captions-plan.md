# Mobile Captions — kế hoạch prototype

Mục tiêu: bro dùng điện thoại thu tiếng Việt; desktop nhận VI trực tiếp và phụ đề EN/JA.
Phạm vi được giao: prototype chạy trên Node.js 24, không GPU local, DB, tài khoản hay lưu âm thanh.
Bối cảnh: repo khởi đầu chưa có README.md; kế hoạch này không phải packet Specs.

## Luồng và kiến trúc

- Triển khai qua SSH `hapo_gateway_stg`; Caddy tại `assistant.hapo.work/live-trans/` proxy Node ở `127.0.0.1:4317`, giữ nguyên mọi site/route hiện có.
- Desktop dùng `APP_ACCESS_KEY` qua liên kết riêng `#access` hoặc ô mật khẩu để tạo phòng/QR; giá trị chỉ giữ trong bộ nhớ trình duyệt, server kiểm tra quyền tạo phòng.
- Điện thoại mở liên kết HTTPS, bấm bắt đầu/dừng và gửi âm thanh qua WebSocket.
- Server chuyển âm thanh tới Gemini 3.5 Transcribe Live, phát VI interim/final về desktop.
- Câu VI hoàn chỉnh vào hàng đợi giới hạn; Gemini 3.5 Flash-Lite dịch EN/JA và trả theo thứ tự.
- Stack: native HTTP + `ws` + `qrcode`; HTML/CSS/ES modules; kiểm thử `node:test`.

## TODO triển khai

- [x] Xác minh model ID, endpoint, quyền truy cập, định dạng âm thanh, transcript events và giới hạn phiên bằng nguồn chính thức; ghi rõ mục nào chưa có live proof.
- [x] Tạo package scripts, cấu hình server và README; `GOOGLE_API_KEY` cùng `APP_ACCESS_KEY` ngẫu nhiên ở `/etc/live-trans/runtime.env`, root sở hữu, mode `600`, chỉ server nhận credential.
- [x] Tạo systemd service chạy bằng `ubuntu`, dùng `/home/ubuntu/.nvm/versions/node/v24.15.0/bin/node`; cấu hình riêng `/live-trans/` trên Caddy hiện có, không lưu audio hoặc nội dung lời nói trong application logs.
- [x] Bảo vệ route tạo phòng bằng `APP_ACCESS_KEY`, kiểm tra Origin phía server; mọi URL HTTP/WebSocket/asset hoạt động dưới prefix `/live-trans/`.
- [x] Tạo phòng trong bộ nhớ với token ngẫu nhiên đủ mạnh, quyền desktop/mic riêng, token trong URL fragment, thời hạn và thu hồi khi đóng phòng; tránh log token/credential.
- [x] Xây desktop: tạo phòng, QR/liên kết, trạng thái kết nối, VI interim và phụ đề EN/JA dễ đọc.
- [x] Xây mobile: xin quyền mic sau thao tác người dùng, capture/resample đúng định dạng, start/stop rõ ràng và hiển thị lỗi HTTPS/quyền mic/mất mạng.
- [x] Nối Gemini Live; chỉ một mic đang hoạt động mỗi phòng, reject mic thứ hai và chặn frame sai định dạng/quá kích thước.
- [x] Gom câu final, dịch hai ngôn ngữ với request timeout, queue bound, sequence/session IDs và quy tắc báo quá tải rõ ràng.
- [x] Stop ngừng capture và stream đầu vào, drain transcript/translation trong thời hạn rồi đóng kết nối; không để callback phiên cũ ghi vào phiên mới.
- [x] Cảnh báo và dừng trước mốc 10 phút đã yêu cầu; người dùng bấm khởi động lại rõ ràng, không tự âm thầm mở phiên mic mới.
- [x] Dọn room, timers, sockets và tài nguyên âm thanh khi hết hạn, disconnect, lỗi upstream hoặc server shutdown.
- [x] Viết hướng dẫn chạy, deploy/restart service và HTTPS qua Caddy; credential, token và audio không đi vào log/git/localStorage.

## TODO kiểm chứng

- [x] Chạy syntax/compile check phù hợp cho toàn bộ JS; chạy `node:test` và lưu số test/exit thực tế.
- [ ] Kiểm tra route tạo phòng từ chối access key thiếu/sai, Origin lạ và Host/forwarded headers giả; xác nhận routes/sites Caddy cũ vẫn hoạt động.
- [ ] Kiểm tra token thiếu/sai/hết hạn/nhầm vai trò, mic thứ hai, oversized frame, room cleanup và reconnect sau mic disconnect.
- [ ] Kiểm tra câu trùng, final đến chậm, phản hồi dịch sai schema/sai thứ tự, queue đầy, timeout/rate-limit và lỗi upstream; UI báo trạng thái thật.
- [ ] Kiểm tra start-stop liên tiếp, stop khi còn pending translations, hết thời hạn drain và chặn kết quả phiên cũ.
- [ ] Kiểm tra desktop với mobile viewport và HTTPS: QR mở đúng room, mic bị từ chối, socket mất kết nối, caption wrap/scroll và trạng thái nút.
- [x] Khi credential/model sẵn sàng, gửi audio tiếng Việt tổng hợp thật qua hai client tới service đã deploy; xác nhận transcript VI và bản dịch EN/JA thực từ provider.
- [ ] Kiểm tra mic/QR trên điện thoại vật lý do người dùng thực hiện; phân biệt giới hạn này với smoke UI, automated tests và live provider proof bằng audio tổng hợp.
- [x] Review mã sau kiểm thử, xử lý lỗi correctness/security trong phạm vi; cập nhật README theo hành vi thực tế.

## Điều kiện hoàn tất

- Có prototype dùng được và hướng dẫn tái chạy; mọi lỗi quan trọng hiển thị được, không giả transcript hay translation khi provider lỗi.
- Báo chính xác kiểm chứng đã chạy; nếu thiếu credential/quyền model/điện thoại thật, nêu giới hạn đó thay vì xác nhận end-to-end PASS.

## Câu hỏi chưa chốt

- Chưa kiểm tra mic trên điện thoại vật lý, phiên kéo dài 9 phút và các tình huống đổi mạng trên iOS/Android.
- DNS `live-trans.hapo.work` cần người dùng tạo record A tới `52.221.187.225`.

## Bằng chứng đã chạy (22/09/2026)

- Local và Ubuntu: `npm run check && npm test`, exit 0; 19 JS files, 14 tests pass, 0 fail/skip.
- Hai client qua HTTPS deployed: 6,719 ms giọng Việt tổng hợp thật, Gemini trả VI/EN/JA, bản dịch đầy đủ khoảng 1,43–1,51 giây sau audio; stop được xác nhận.
- Browser Orca hiển thị đúng cả ba chuỗi nhận từ provider, không có lỗi trên trang; viewport 375 px không tràn ngang.
- Caddy validate PASS; service active; app và site gốc HTTP 200; tạo phòng không có mã HTTP 401.
- Backend được review độc lập; lỗi malformed Upgrade URL và caption cũ đã có regression tests. Lỗi UI ghép câu interim với bản dịch cũ đã sửa.
- Các ô kiểm chứng chưa đánh dấu là phạm vi chưa có bằng chứng đầy đủ; không suy ra PASS từ code review hoặc smoke test.
