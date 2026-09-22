# Kiến trúc hệ thống

## Luồng dữ liệu

1. `public/desktop.js` tạo phòng qua `POST /api/rooms` với mã truy cập.
2. `server/rooms.js` tạo token riêng cho màn hình và mic; QR chứa URL mic có
   token trong fragment. URL theo origin được cho phép của trang đang mở.
3. `public/audio-capture.js` và AudioWorklet lấy âm thanh, resample thành PCM16
   mono 16 kHz và gửi qua WebSocket theo frame khoảng 100 ms.
4. `server/transcriber.js` truyền PCM tới Gemini Live, model cấu hình trong
   `server/config.js`: `gemini-3.5-transcribe-live`. VI interim phát ngay về client.
5. Câu VI hoàn chỉnh vào `TranslationQueue`; `server/translation.js` gọi
   `gemini-3.5-flash-lite` với JSON gồm EN/JA và tối đa ba câu nguồn làm ngữ cảnh.
6. Kết quả phát về các client bằng WebSocket. `public/captions.js` cập nhật
   phụ đề, lịch sử và trạng thái câu đang được nhận dạng/dịch.

## Ranh giới module

| Module | Trách nhiệm |
|---|---|
| `server/config.js` | Đọc cấu hình, kiểm tra mã truy cập production, danh sách origin |
| `server/app.js` | Static files, health/config API, quyền tạo phòng, chọn URL QR |
| `server/sockets.js` | Upgrade, xác thực token/vai trò, giới hạn frame và heartbeat |
| `server/rooms.js` | Phòng, kết nối, trạng thái thu, lịch sử và dọn tài nguyên |
| `server/transcriber.js` | Kết nối Google Live, transcript, stop/drain |
| `server/translation.js` | Dịch có timeout, kiểm tra schema và hàng đợi hữu hạn |
| `public/` | Trang desktop/mobile và xử lý âm thanh trong trình duyệt |

## Giới hạn và vòng đời

Phòng hết hạn sau hai giờ; tối đa ba phòng, một mic và năm viewer/phòng.
Lịch sử giữ 30 câu. Hàng đợi dịch giữ tối đa sáu câu chờ ngoài câu đang xử lý;
quá tải trả lỗi rõ ràng. Request dịch timeout sau 12 giây.

Mỗi lượt thu dừng sau chín phút. Stop kết thúc audio đầu vào, cho ASR tối đa
3,5 giây hoàn tất trước khi đóng; bản dịch đã xếp hàng có thể hoàn tất sau đó.
Mất toàn bộ viewer trong mười giây sẽ dừng thu. Kết thúc phòng hủy hàng đợi,
đóng ASR và WebSocket. Restart service xóa mọi phòng trong RAM.

## Triển khai và bảo vệ

Caddy nhận HTTPS ở `live.hapo.work` và route `/live-trans/` của
`assistant.hapo.work`, proxy tới Node tại `127.0.0.1:4317`.
`live-trans.service` chạy dưới user `ubuntu`; `current` trỏ tới release trong
`/home/ubuntu/live-trans/releases/`. Cấu hình bí mật đặt riêng tại
`/etc/live-trans/runtime.env`, root sở hữu, quyền `600`.

Origin được kiểm tra khi tạo phòng và nâng cấp WebSocket; role/token được
kiểm tra khi join. Mã truy cập chỉ cho phép tạo phòng, token phòng cấp quyền
theo vai trò. Gemini key không xuống trình duyệt; ứng dụng không lưu audio,
transcript hay credential vào log/file/DB. Google vẫn nhận dữ liệu để xử lý.

`PUBLIC_URL` giữ URL có base path ban đầu; `PUBLIC_ALIASES` chứa
`https://live.hapo.work/`. Cách này cho phép dùng cả hai địa chỉ và tạo QR đúng
tên miền đang mở. Mẫu triển khai: [deploy/](../deploy/).
