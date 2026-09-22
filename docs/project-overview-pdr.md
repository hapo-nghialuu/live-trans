# Tổng quan Live Trans

Prototype cá nhân: điện thoại thu tiếng Việt, màn hình web hiển thị tiếng Việt
đang nói và phụ đề tiếng Anh/tiếng Nhật khi câu hoàn tất. Ưu tiên độ trễ thấp,
giao diện đơn giản và xử lý trên dịch vụ AI, không cần GPU tại máy người dùng.

## Phạm vi hiện tại

- Desktop nhập mã truy cập, tạo phòng rồi hiện QR ghép điện thoại.
- Điện thoại xin quyền mic sau khi người dùng bấm bắt đầu; có nút dừng rõ ràng.
- Hai bản dịch xuất hiện cùng câu nguồn, kèm trạng thái chờ hoặc lỗi dịch.
- Mỗi phòng có một mic, tối đa năm màn hình xem; tối đa ba phòng trên server.
- Không có tài khoản, cơ sở dữ liệu, lưu âm thanh hay xuất lịch sử.

## Vận hành và dữ liệu

Node.js 24 chạy trên `hapo_gateway_stg`, sau Caddy HTTPS. URL chính:
`https://live.hapo.work/`; URL ban đầu `https://assistant.hapo.work/live-trans/`
vẫn được hỗ trợ. Hướng dẫn cấu hình và khởi động nằm trong [README](../README.md).

Âm thanh gửi tới Google để nhận dạng; văn bản gửi tới Google để dịch.
Ứng dụng chỉ giữ tối đa 30 câu/phòng trong RAM; kết thúc phòng, hết hạn hoặc
restart xóa dữ liệu này. Gemini key chỉ ở server. Mã truy cập tạo phòng và liên
kết QR là thông tin riêng, không đưa lên Git.

## Giới hạn kiểm chứng

Repo có kiểm tra cú pháp, test HTTP/WebSocket và bộ resample. Script
`npm run test:live` gửi giọng Việt tổng hợp thật qua hai client tới Gemini.
Các kiểm tra này không thay thế thử mic trên điện thoại vật lý, đổi mạng hay
phiên thu kéo dài. Phiên thu tự dừng sau chín phút; cần bấm bắt đầu để tiếp tục.
Mức trễ thực tế phụ thuộc mạng, cách ngắt câu và dịch vụ AI.

Kiến trúc: [system-architecture.md](system-architecture.md).
`.sync_hash` ghi revision mã nguồn được đối chiếu khi lập tài liệu nền.
