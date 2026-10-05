# Báo cáo: phụ đề theo từng câu khi MC nói dài

Ngày đo: 05/10/2026 · Dịch vụ nhận giọng nói: Gemini (mặc định production) · Dịch: Gemini flash-lite

## Vấn đề

Phản hồi từ người thử: đoạn 2–3 câu hiển thị nhanh, nhưng đoạn dài 5–6 dòng thì chậm. MC phải ngắt
đoạn thì phụ đề mới lên màn hình.

Nguyên nhân: Gemini chỉ chốt câu (`inputTranscription`) khi người nói ngừng hẳn
(`server/transcriber.js`), và server chỉ gửi đi dịch khi có câu chốt. Nói liền mạch thì cả đoạn
thành một khối, dịch sau khi nói xong.

## Cách sửa

`server/sentence-commit.js` theo dõi chữ tạm (đã có dấu câu) và chốt từng câu ngay khi:

- câu kết thúc bằng `.` `?` `!` `…` và người nói đã nói tiếp sang câu sau; hoặc
- câu cuối giữ nguyên 0,7 giây; hoặc
- nói quá ~220 ký tự không có dấu câu: cắt ở dấu phẩy gần nhất.

Khi Gemini chốt cả lượt nói, chỉ phần chưa thành phụ đề được thêm vào. Đối chiếu theo số từ và
ranh giới câu, nên không lặp hay mất chữ khi Gemini sửa chính tả ở bản cuối.

## Cách đo

Đoạn nói mẫu 6 câu (~33 giây) do giọng đọc tiếng Việt của macOS (Linh) đọc liền mạch, gửi vào
server qua WebSocket đúng giao thức của điện thoại, cùng một máy, cùng key, trước và sau khi sửa.

> Kính thưa quý vị đại biểu, quý khách hàng và các đối tác. Mười năm trước, chúng tôi bắt đầu từ
> một văn phòng nhỏ với một đội ngũ chỉ vài người. Trong suốt chặng đường đó, chúng tôi đã cùng
> nhau vượt qua rất nhiều thử thách. Hôm nay, công ty đã có hơn bảy mươi thành viên và làm việc
> với nhiều đối tác tại Nhật Bản. Thành công này có được là nhờ sự tin tưởng và đồng hành của tất
> cả quý vị. Chúng tôi xin gửi lời cảm ơn chân thành nhất và mong tiếp tục được hợp tác trong
> những năm tới.

## Kết quả (giây tính từ lúc bắt đầu nói)

### Trước khi sửa (MC nói xong ở giây 33,7)

| Khối | Ký tự | Tiếng Việt hiện | Bản dịch EN/JA hiện |
|---|---|---|---|
| 1 (cả đoạn) | 477 | 35,3 | **37,4** |

### Sau khi sửa (MC nói xong ở giây 37,1)

| Khối | Ký tự | Tiếng Việt hiện | Bản dịch EN/JA hiện |
|---|---|---|---|
| 1 | 141 | 12,1 | **15,0** |
| 2 | 79 | 20,1 | 21,1 |
| 3 | 84 | 26,6 | 29,8 |
| 4 | 74 | 31,9 | 32,9 |
| 5 | 95 | 38,7 | 40,0 |

Bản dịch đầu tiên hiện sớm hơn **22,4 giây**; sau đó cứ vài giây có thêm một câu trong lúc MC
vẫn đang nói. Câu cuối hiện 2,9 giây sau khi MC dừng.

### Nội dung sau khi sửa

| Tiếng Việt | English | 日本語 |
|---|---|---|
| Kính thưa quý vị đại biểu, quý khách hàng và các đối tác, 10 năm trước, chúng tôi bắt đầu từ một văn phòng nhỏ với một đội ngũ chỉ vài người. | Distinguished delegates, valued customers, and partners, 10 years ago, we started in a small office with a team of just a few people. | ご来賓の皆様、お客様、パートナーの皆様、10年前、私たちはわずか数名のチームで小さなオフィスからスタートしました。 |
| Trong suốt chặng đường đó, chúng tôi đã cùng nhau vượt qua rất nhiều thử thách. | Throughout that journey, we have together overcome many challenges. | その道のりの中で、私たちは共に多くの困難を乗り越えてきました。 |
| Hôm nay, công ty đã có hơn 70 thành viên và làm việc với nhiều đối tác tại Nhật Bản. | Today, the company has more than 70 members and works with many partners in Japan. | 現在、当社は70名以上のメンバーを擁し、日本における多くのパートナーと協力しています。 |
| Thành công này có được là nhờ sự tin tưởng và đồng hành của tất cả quý vị. | This success is thanks to the trust and companionship of all of you. | この成功は、皆様の信頼と歩みがあってこそのものです。 |
| Chúng tôi xin gửi lời cảm ơn chân thành nhất và mong tiếp tục được hợp tác trong những năm tới. | We would like to express our deepest gratitude and look forward to your continued cooperation in the coming years. | 心より感謝申し上げますとともに、今後ともよろしくお願いいたします。 |

Đủ cả 6 câu, không lặp, không mất chữ.

## Giới hạn

- Câu 1 và 2 thành một khối vì Gemini đặt dấu phẩy thay cho dấu chấm sau "các đối tác". Việc tách
  câu phụ thuộc dấu câu mà dịch vụ nhận giọng nói tự thêm.
- Đo bằng giọng đọc máy, phát âm đều và rõ. Giọng MC thật, tiếng vang hội trường và tốc độ mạng
  có thể làm số liệu khác đi; cần thử lại tại địa điểm.
- Mỗi câu là một lần gọi dịch, nên số lần gọi API tăng (khoảng 5 lần thay vì 1 cho đoạn này).

## Kiểm chứng tự động

- `test/sentence-commit.test.js`: 8 test cho việc tách câu, chốt câu, số `1.000`, thiếu dấu cách
  sau dấu chấm, bản cuối sửa chính tả, cắt ở dấu phẩy, kết thúc lượt nói.
- `test/backend.test.js` › `long speech is captioned sentence by sentence before the turn closes`:
  phụ đề được tạo trước khi lượt nói kết thúc. Test này fail với code cũ (đã chạy kiểm chứng).
- `npm test`: 48/48, ổn định qua 3 lần chạy liên tiếp.
