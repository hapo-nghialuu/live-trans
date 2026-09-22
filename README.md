# Live Trans

Điện thoại thu tiếng Việt; màn hình web hiển thị phụ đề Anh và Nhật.
Giao diện HTML/CSS/JavaScript thuần, backend Node.js 24. Không cần GPU.

## Sử dụng

1. Trên máy tính, mở app, nhập mã truy cập rồi chọn **Tạo phiên dịch**.
2. Quét QR bằng điện thoại. Chọn **Bắt đầu**, cho phép dùng micro.
3. Giữ màn hình điện thoại mở và nói tiếng Việt, ngắt ngắn giữa các câu.
4. Web hiện tiếng Việt trong lúc nói; câu đã nhận xong được dịch đồng thời ra Anh/Nhật.
5. **Dừng** tắt mic và hoàn tất câu cuối. **Kết thúc phiên** thu hồi liên kết phòng.

Điện thoại cần HTTPS, trình duyệt có AudioWorklet và quyền micro. Safari/Chrome
di động hiện đại là đối tượng dự kiến; cần kiểm tra trên thiết bị thực tế.
Đổi ứng dụng/khóa màn hình sẽ dừng thu; không tự bật lại mic khi kết nối lại.

## Chạy local

```sh
npm ci
GOOGLE_API_KEY_FILE=/duong-dan/file-key.txt npm start
```

Mở `http://localhost:4317/`. Localhost có thể thu mic; điện thoại không thể dùng
mic qua một địa chỉ LAN HTTP thông thường. Dùng bản HTTPS trên server.

Các biến cấu hình:

| Biến | Ý nghĩa |
|---|---|
| `GOOGLE_API_KEY` | Gemini key chỉ dùng trên backend |
| `GOOGLE_API_KEY_FILE` | Thay thế key trực tiếp; file phải chứa đúng một key |
| `APP_ACCESS_KEY` | Mã riêng để tạo phiên; production yêu cầu ít nhất 24 ký tự |
| `PUBLIC_URL` | URL HTTPS đầy đủ, gồm base path và dấu `/` cuối |
| `PUBLIC_ALIASES` | Tên miền HTTPS bổ sung ở đường dẫn gốc, phân cách bằng dấu phẩy |
| `PORT` | Cổng loopback, mặc định `4317` |
| `NODE_ENV` | Đặt `production` khi triển khai |

## Triển khai hiện tại

- SSH: `hapo_gateway_stg`.
- URL: `https://assistant.hapo.work/live-trans/`.
- Tên miền riêng: `https://live-trans.hapo.work/`, sau khi thêm DNS `A live-trans → 52.221.187.225`.
- QR tự dùng tên miền đang mở nếu tên miền đã có trong `PUBLIC_ALIASES`.
- Caddy giữ nguyên các site cũ, thêm route riêng trong `deploy/caddy-snippet.txt`.
- Release: `/home/ubuntu/live-trans/releases/`; symlink hoạt động: `current`.
- Service: `live-trans.service`, mẫu trong `deploy/`.
- Cấu hình: `/etc/live-trans/runtime.env`, quyền `600`, root sở hữu.
- Thay hostname/path: cập nhật `PUBLIC_URL`, cấu hình Caddy và khởi động lại service.

```sh
ssh hapo_gateway_stg 'sudo systemctl status live-trans --no-pager'
ssh hapo_gateway_stg 'sudo journalctl -u live-trans -n 30 --no-pager'
ssh hapo_gateway_stg 'sudo systemctl restart live-trans'
```

Rollback: chuyển `current` về release trước, restart `live-trans`, xác nhận
`/live-trans/api/health`. Mỗi lần đổi Caddy phải sao lưu, validate rồi reload.
Restart server kết thúc các phòng trong bộ nhớ.

## Phạm vi và dữ liệu

- Google nhận audio để xử lý; ứng dụng không ghi audio, transcript hay token vào log/file/DB.
- Transcript giữ trong RAM tối đa 30 câu/phòng. Kết thúc/hết hạn/restart xóa phòng.
- Liên kết QR chứa quyền thu âm cho phòng đó; không chia sẻ cho người không tham gia.
- Tối đa 3 phòng, mỗi phòng 1 mic và 5 màn hình, thời hạn 2 giờ.
- Mỗi lượt thu dừng sau 9 phút (giới hạn upstream 10 phút); bấm bắt đầu để tiếp tục.
- Hàng đợi dịch hữu hạn, lỗi quota/mạng hiển thị rõ; không tạo bản dịch giả.
- Mất màn hình xem trong 10 giây sẽ dừng nhận âm thanh.
- Key Gemini không gửi xuống browser. Mã truy cập và token phòng không lưu localStorage.
- Model: `gemini-3.5-transcribe-live` và `gemini-3.5-flash-lite` (`minimal`).
- Prompt bảo toàn số và ý; vẫn cần đối chiếu các thông tin quan trọng.

## Kiểm chứng

```sh
npm run check
npm test
npm run test:live
```

`test:live` thực sự gọi Google qua ứng dụng, dùng giọng Linh tiếng Việt của macOS,
gửi PCM theo thời gian thực và nhận phụ đề bằng WebSocket thứ hai. File tạm được
xóa sau kiểm tra. Linux có thể cấp file PCM16 mono16kHz qua `PCM_FILE`.
Đổi đích bằng `LIVE_TRANS_URL`; truyền mã tạo phòng qua `LIVE_TRANS_ACCESS_KEY`.
Các unit test queue dùng hàm kiểm soát thời điểm hoàn tất; không chứng minh model.
Giọng tổng hợp qua hai client không thay thế kiểm tra mic trên điện thoại vật lý.
