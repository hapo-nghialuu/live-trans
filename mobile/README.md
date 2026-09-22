# LiveTransMic — app điện thoại

App React Native thay thế trang `mic.html`: thu mic tiếng Việt và stream
PCM16 mono 16 kHz qua WebSocket `/socket` của server live-trans
(giao thức `join`/`start`/`stop` giống web client).

## Cách dùng

1. Mở app web trên máy tính (`https://live.hapo.work/` hoặc
   `https://assistant.hapo.work/live-trans/`), nhập mã truy cập,
   **Tạo phiên dịch**.
2. Quét/chép liên kết mic (`…/mic.html#room=…&token=…`) dưới mã QR.
3. Trong app: dán liên kết → **Kết nối** → **Bắt đầu nói**.
   Cả hai dạng URL đều hoạt động — app tự suy ra host và đường dẫn
   WebSocket từ liên kết (`https://live.hapo.work/mic.html#…` →
   `wss://live.hapo.work/socket`).

## Build & chạy

```sh
npm install
(cd ios && pod install)     # chỉ iOS
npx react-native run-ios    # simulator/device, cần Metro (npm start)
```

- iOS: `NSMicrophoneUsageDescription` + `UIBackgroundModes=audio` đã bật —
  thu âm tiếp tục khi khóa màn hình (khác web client).
- Android: manifest có `RECORD_AUDIO`/`WAKE_LOCK` và app xin quyền runtime,
  nhưng chưa build thử (thiếu Android SDK/JDK trên máy dev).

## Kiểm chứng

`npx tsc --noEmit` và `npx jest` trong thư mục này.
