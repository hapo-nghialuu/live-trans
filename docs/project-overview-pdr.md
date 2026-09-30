# Tổng quan Live Trans

Dùng điện thoại thu lời MC tiếng Việt và chiếu phụ đề Anh/Nhật lên màn hình
để khách nước ngoài theo dõi nội dung. Lời gốc tiếng Việt dành cho người vận hành. Ưu tiên độ trễ thấp,
giao diện đơn giản và xử lý trên dịch vụ AI, không cần GPU tại máy người dùng.

## Phạm vi hiện tại

- Desktop tạo phòng (có thể chọn mã phiên 6 số hoặc để server tự sinh), hiện QR
  và mã phiên để ghép điện thoại hoặc màn hình xem khác.
- Trang vào chỉ giữ tạo/xem phiên và mô tả ngắn; tự chọn mã phiên nằm trong
  mục mở rộng. Trang Hướng dẫn cạnh Cài đặt giải thích 3 bước và điều khiển,
  kèm ảnh chụp minh họa và link GitHub Releases để chọn bản mới nhất. Hướng
  dẫn tải APK và cài IPA chưa ký được tách trong mục
  mở rộng; iPhone có thể quét QR để dùng micro trên Safari.
- Logo hội thoại xanh được dùng chung trên web, favicon, app, icon iOS/Android
  và launch screen iOS. Favicon web bo góc với phần ngoài góc trong suốt.
  Giao diện vẫn dùng light theme.
- App React Native trong `mobile/` có thể quét QR, nhập mã phiên, dán liên kết
  mic, hoặc tự tạo phòng rồi vào vai trò mic; nó thay thế `mic.html` khi cần app
  cài trên điện thoại.
- App ưu tiên QR/mã phiên, thu gọn tạo phiên/liên kết; cài đặt mở riêng.
  Nút micro lớn với icon bắt đầu/dừng, phụ đề nằm trong màn mở rộng.
  Rời phiên khi đang thu cần xác nhận; icon trang trí không thêm vào accessibility.
- Điện thoại xin quyền mic sau khi người dùng bấm bắt đầu; có nút dừng rõ ràng.
- Server yêu cầu có ít nhất một màn hình web trong phòng trước khi thu âm,
  kể cả khi phòng được tạo từ app điện thoại.
- Chờ điện thoại: ưu tiên QR lớn và mã phiên. Điện thoại kết nối: hiện nút
  mở riêng cửa sổ tiếng Anh và tiếng Nhật, đặt trên hai màn hình dọc.
- Mỗi cửa sổ phụ đề nền trắng, chữ lớn, chỉ một ngôn ngữ, giữ tối đa 30 câu.
  Có bản dịch mới thì tự cuộn; lời nhận dạng tạm thời không kéo vị trí cuộn.
  Fullscreen và kết nối lại nằm trong từng cửa sổ; không hiện nhãn “Live captions”.
- Trang chính có bảng Điều khiển phiên: dừng từ xa, rời phiên trên máy này,
  hoặc kết thúc phiên cho mọi người sau xác nhận. Mic ngắt thì hiện lại QR.
- Mỗi phòng có một mic, tối đa năm màn hình xem; tối đa ba phòng trên server.
- Không có tài khoản, cơ sở dữ liệu, lưu âm thanh hay xuất lịch sử.

## Vận hành và dữ liệu

Theo README và mẫu triển khai, Node.js 24 chạy trên `hapo_gateway_stg`, sau
Caddy HTTPS. URL chính:
`https://live.hapo.work/`; URL ban đầu `https://assistant.hapo.work/live-trans/`
vẫn được hỗ trợ. Hướng dẫn cấu hình và khởi động nằm trong [README](../README.md).

Âm thanh gửi tới Google để nhận dạng; văn bản gửi tới Google để dịch.
Ứng dụng chỉ giữ tối đa 30 câu/phòng trong RAM; kết thúc phòng, hết hạn hoặc
restart xóa dữ liệu này. Gemini key chỉ ở server. Mã truy cập tạo phòng và liên
kết QR là thông tin riêng, không đưa lên Git. `APP_ACCESS_KEY` là tùy chọn:
khi có thì phải dài ít nhất 24 ký tự; khi bỏ trống, tạo phòng bị giới hạn 30
lần/giờ/IP. Tra mã phiên cũng giới hạn 30 lần/phút/IP.

Biết mã phiên có thể lấy liên kết tham gia, nên mã này cần chia sẻ có chủ đích.
Backend không ghi audio/transcript/token xuống file hoặc DB. Web không lưu mã
truy cập/token vào localStorage. App mobile lưu địa chỉ server và mã truy cập
đã dùng tạo phòng trong AsyncStorage; không lưu token phòng theo cách này.

Workflow `.github/workflows/mobile-builds.yml` chạy khi push nhánh `build` có
thay đổi mobile/workflow hoặc khi gọi thủ công. Nó tạo APK debug, IPA chưa ký
và GitHub prerelease. Có workflow chưa chứng minh các job đã chạy thành công
hay app đã phát hành trên App Store/Google Play.

## Giới hạn kiểm chứng

Repo có kiểm tra cú pháp, test HTTP/WebSocket và bộ resample. Script
`npm run test:live` gửi giọng Việt tổng hợp thật qua hai client tới Gemini.
Các kiểm tra này không thay thế thử mic trên điện thoại vật lý, đổi mạng hay
phiên thu kéo dài. Gemini tự nối upstream kế tiếp sau khoảng 8,5 phút;
đóng bất ngờ được thử nối lại tối đa 3 lần. Cấu hình này không chứng minh phiên
thu thực tế liền mạch; phòng vẫn hết hạn sau hai giờ.
Phòng chờ không có mic hay lượt thu trong 15 phút sẽ bị đóng sớm; phòng đang
hoạt động vẫn hết hạn sau hai giờ.
Mức trễ thực tế phụ thuộc mạng, cách ngắt câu và dịch vụ AI.

Mobile có test render cơ bản và test URL dùng URL shim của React Native;
camera, clipboard, storage và HTTP dùng mock, không kiểm chứng mic/Google thật.
Đối chiếu ngày 2026-09-30: `npm run check` kiểm tra 25 file JavaScript và
`npm test` chạy 28 test, đều exit 0. Chrome headless kiểm tra QR ở 1280/390/320 px;
hai cửa sổ độc lập ở 600×1000, 1080×1920 và 320×844 không tràn ngang.
Đã kiểm tra một ngôn ngữ/cửa sổ, 30 câu, cuộn mới/interim, reload lấy lịch sử,
fullscreen, mất/kết nối lại, rời trang điều khiển vẫn giữ hai cửa sổ, hủy/xác nhận
kết thúc và xóa phụ đề ở mọi cửa sổ. QA dùng caption mẫu, không gọi provider;
chưa kiểm chứng màn hình LED, mic điện thoại hoặc AI thật trong lượt này.
Không build native app trong thay đổi này.

Thay đổi UI ngày 2026-09-30 tập trung vào người xem phụ đề; không thay đổi
giao thức âm thanh/phòng.

Kiến trúc: [system-architecture.md](system-architecture.md).
`.sync_hash` ghi revision mã nguồn đã đối chiếu với tài liệu, không phải bằng
chứng deploy hay kiểm chứng thiết bị.
