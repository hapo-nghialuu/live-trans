# Kiến trúc hệ thống

## Luồng dữ liệu

1. `public/desktop.js` hoặc app React Native tạo phòng qua `POST /api/rooms`.
   Mã truy cập là tùy chọn, mã phiên 6 số có thể tự chọn hoặc server tự sinh.
2. `server/rooms.js` tạo token riêng cho màn hình và mic; QR chứa URL mic có
   token trong fragment. `GET /api/join?code=…` đổi mã phiên sang token mic
   hoặc viewer (`role=viewer`) mà không để token trong mã phiên.
3. `public/audio-capture.js`/AudioWorklet hoặc `mobile/src/audio.ts` lấy âm
   thanh, thành PCM16 mono 16 kHz rồi gửi WebSocket theo frame khoảng 100 ms.
4. `server/transcriber.js` truyền PCM tới Gemini Live, model cấu hình trong
   `server/config.js`: `gemini-3.5-transcribe-live`. VI interim phát ngay về client.
5. Câu VI hoàn chỉnh vào `TranslationQueue`; `server/translation.js` gọi
   `gemini-3.5-flash-lite` với JSON gồm EN/JA và tối đa ba câu nguồn làm ngữ cảnh.
   Hàng đợi xử lý lần lượt từng câu; một request trả cả hai ngôn ngữ.
6. Kết quả phát về các client bằng WebSocket. `public/captions.js` cập nhật
   phụ đề, lịch sử và trạng thái câu đang được nhận dạng/dịch.
   `mobile/App.tsx` cũng nhận và hiển thị các sự kiện phụ đề.

## Ranh giới module

| Module | Trách nhiệm |
|---|---|
| `server/config.js` | Đọc cấu hình, kiểm tra độ dài mã truy cập tùy chọn, danh sách origin |
| `server/app.js` | Static files, health/config API, tạo/tra phòng theo mã, giới hạn IP, chọn URL QR |
| `server/sockets.js` | Upgrade, xác thực token/vai trò, giới hạn frame và heartbeat |
| `server/rooms.js` | Phòng, kết nối, trạng thái thu, lịch sử và dọn tài nguyên |
| `server/transcriber.js` | Kết nối Google Live, transcript, stop/drain |
| `server/translation.js` | Dịch có timeout, kiểm tra schema và hàng đợi hữu hạn |
| `public/` | Trang desktop/mobile và xử lý âm thanh trong trình duyệt |
| `mobile/` | React Native mic: quét QR, nhập mã, stream PCM16 và hiển thị phụ đề |

## Kết nối mobile

`mobile/src/protocol.ts` lấy room/token từ fragment của liên kết mic và dựng
URL socket theo host/base path. `normalizeBase` loại query/fragment và tên
trang khỏi địa chỉ server được dán. App dựng URL tuyệt đối vì URL shim của
React Native trong dự án ghép chuỗi khi dùng `new URL(relative, base)` thay
vì phân giải đường dẫn như browser. Test protocol dùng chính shim này.

Socket gửi `join` sau khi mở; app chỉ đánh dấu đã tham gia khi nhận `snapshot`
và chỉ bật stream mic sau sự kiện `ready` từ server. Kết nối socket có timeout
12 giây; lỗi đóng có mã/reason khi runtime cung cấp. Lỗi server được hiển thị
và dừng mic; kết nối lại cần bấm bắt đầu.

## Giới hạn và vòng đời

Phòng hết hạn sau hai giờ; phòng chờ không có mic/lượt thu quá 15 phút sẽ bị
đóng sớm. Tối đa ba phòng, một mic và năm viewer/phòng.
Lịch sử giữ 30 câu. Hàng đợi dịch giữ tối đa sáu câu chờ ngoài câu đang xử lý;
quá tải trả lỗi rõ ràng. Request dịch timeout sau 12 giây.

Server yêu cầu ít nhất một viewer trước khi bắt đầu thu. Dọn phòng chạy mỗi
30 giây; điều kiện 15 phút tính từ lúc tạo phòng, không phải lúc ngắt mic.

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

Browser có `Origin` sai bị từ chối khi tạo phòng và nâng cấp WebSocket;
native client có thể không gửi `Origin`, nên được phép đi tiếp tới kiểm tra
role/token. Mã truy cập chỉ bảo vệ việc tạo phòng khi cấu hình; khi không có,
tạo phòng bị giới hạn 30 lần/giờ/IP, 20 lần/phút toàn server và tra mã 30 lần/phút/IP. Token phòng cấp
quyền theo vai trò; mã phiên chỉ là định danh tra cứu, không phải token. Gemini
key chỉ ở server; backend không lưu audio, transcript hay credential vào
log/file/DB. Web không lưu mã truy cập/token vào localStorage. App lưu địa chỉ
server và mã truy cập tạo phòng trong AsyncStorage, không lưu token phòng
tại đó. Google vẫn nhận dữ liệu để xử lý.

App iOS khai báo quyền micro/camera và audio background; Android khai báo
`RECORD_AUDIO`/`CAMERA`/`WAKE_LOCK` và xin runtime permission. Đây là cấu hình mã nguồn,
không phải bằng chứng biên dịch/phát hành Android hoặc kiểm thử trên thiết bị thật.

`PUBLIC_URL` giữ URL có base path ban đầu; `PUBLIC_ALIASES` chứa
`https://live.hapo.work/`. Cách này cho phép dùng cả hai địa chỉ và tạo QR đúng
tên miền đang mở. Mẫu triển khai: [deploy/](../deploy/).
Các địa chỉ/cấu hình trên được đối chiếu từ repo; chưa kiểm tra lại server
trực tiếp trong lần đồng bộ này.

## Build và kiểm chứng

Backend dùng `ws` cho WebSocket và `qrcode` cho QR; HTTP/static files dùng
module chuẩn Node.js. `npm run check` kiểm tra cú pháp backend, web, scripts
và test, không kiểm tra TypeScript/native mobile. `npm test` kiểm tra backend
và audio; `npm run test:live` cần app đang chạy và gọi Google thật.
Mobile kiểm tra riêng bằng `npx tsc --noEmit` và `npm test -- --runInBand` trong
`mobile/`; các test dùng mock không chứng minh thu âm/quét QR trên thiết bị.

Workflow mobile chạy trên nhánh `build` hoặc khi gọi `workflow_dispatch`, tạo
APK debug, IPA chưa ký và GitHub prerelease. Nó không deploy backend. Chưa
xác nhận kết quả CI và build native trong lần đồng bộ tài liệu này.
