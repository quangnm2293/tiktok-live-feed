# tiktok-live-feed — Nguồn cấp sự kiện TikTok LIVE độ trễ thấp

Dịch vụ Node.js nhỏ, chạy local, chuyên làm **một việc**: lấy sự kiện của một
phòng TikTok LIVE (chat, quà, like, follow, share, số người xem, người vào
phòng) và phát lại ngay cho các game/overlay trên cùng máy qua WebSocket.

## Kiến trúc

```
Phòng TikTok LIVE
      │  WebSocket webcast (nối THẲNG tới TikTok)
      ▼
tiktok-live-connector v2.5 ──(chỉ lúc bắt tay)──► EulerStream: KÝ request
      │                                            (API key miễn phí)
      ▼  sự kiện protobuf đã giải mã
src/normalize.js  →  một shape JSON duy nhất cho mọi game
      ▼
Dịch vụ này (:3010) ── WebSocket ws://localhost:3010/events ──► Game / OBS / Godot
```

## Vì sao độ trễ thấp?

- **EulerStream chỉ ký, không chuyển tiếp sự kiện.** Chữ ký chỉ cần ở bước bắt
  tay kết nối. Sau đó sự kiện chảy **thẳng từ máy chủ TikTok** về máy nhà qua
  đúng 1 kết nối WebSocket của connector — không qua mây của Euler, không
  thêm hop nào. (Dịch vụ cố ý KHÔNG dùng cloud-websocket relay của Euler.)
- **Hop cuối là localhost:** game và dịch vụ ở cùng máy, WebSocket nội bộ có
  độ trễ ~0.
- **Không polling, không tầng trung gian:** sự kiện được chuẩn hoá và
  broadcast ngay trong cùng tick khi connector nhận được.
- Dịch vụ còn **đo độ trễ thật** của từng sự kiện (`latencyMs` = thời điểm
  nhận − `createTime` TikTok gắn) và báo cáo avg/p95 ở `/status`.

> Nói thẳng: độ trễ phía TikTok (từ lúc người xem bấm gửi tới lúc Webcast
> phát ra, thường dưới 1 giây tới vài giây tuỳ phòng/mạng) là **bẩm sinh của
> nền tảng, không công cụ nào xoá được**. Dịch vụ này chỉ đảm bảo phần mình
> kiểm soát được — đường đi sau TikTok — là ngắn nhất có thể.

## Cài đặt

1. **Lấy API key EulerStream (miễn phí):** đăng ký tài khoản tại
   [eulerstream.com](https://www.eulerstream.com), vào trang quản lý API key
   và tạo một key (gói Community miễn phí).
2. **Tạo file cấu hình:**

   ```bash
   cp .env.example .env
   ```

   Mở `.env`, điền:

   ```
   EULER_API_KEY=<key vừa tạo>
   TIKTOK_USERNAME=<username phòng live, không có dấu @>
   PORT=3010
   ```

3. **Cài dependencies:** `npm install`
4. **Chạy:** `npm start`
5. **Kiểm tra:** mở <http://localhost:3010/status> — thấy
   `"state": "connected"` là đã vào phòng. Nếu phòng chưa live, state sẽ là
   `waiting_room` và dịch vụ tự thử lại mỗi 15 giây; chưa có key thì state là
   `waiting_key` kèm hướng dẫn.

Các lệnh phụ:

- `npm run selftest` — tự kiểm tra toàn bộ đường sự kiện bằng chế độ giả lập
  (không cần key, không dùng mạng ngoài).
- `npm run connect-test -- <username>` — thử kết nối thật một lần, in lỗi rõ
  ràng nếu thiếu key / phòng chưa live / bị giới hạn gói.
- Chạy thử không cần key: `FEED_FAKE=1 npm start` — phát sự kiện giả lập qua
  đúng đường như thật, để dev game nối vào test trước.

## Game lấy sự kiện như thế nào?

```js
const ws = new WebSocket('ws://localhost:3010/events');
ws.onmessage = (e) => {
  const ev = JSON.parse(e.data);
  if (ev.type === 'hello') return; // gói chào khi mới nối
  if (ev.type === 'chat' && ev.text === 'ăn') choRongAn(ev.uniqueId);
  if (ev.type === 'gift') congDiem(ev.uniqueId, ev.coins * ev.repeatCount);
};
```

### Shape sự kiện (ổn định cho mọi game)

| Trường | Ý nghĩa |
|---|---|
| `type` | `chat` \| `gift` \| `like` \| `follow` \| `share` \| `roomUser` \| `member` |
| `userId`, `uniqueId`, `nickname`, `avatarUrl` | Người gửi (avatar có thể `null`) |
| `text` | Nội dung chat (chỉ `chat`) |
| `giftName`, `giftId`, `coins`, `repeatCount` | Quà: tên, id, giá diamond 1 cái, số lượng chuỗi (chỉ `gift`; kèm `repeatEnd` = đã hết chuỗi) |
| `likeCount`, `totalLikeCount` | Like trong sự kiện / tổng like phòng (chỉ `like`) |
| `viewerCount` | Số người xem (chỉ `roomUser`; `member` mang số người trong phòng tại lúc vào) |
| `ts` | Thời điểm DỊCH VỤ nhận được (epoch ms) |
| `sourceTs` | `createTime` TikTok gắn cho sự kiện (epoch ms, có thể `null`) |
| `latencyMs` | `ts − sourceTs` khi tính được — độ trễ đầu-cuối đo thật |
| `msgId` | Id thông điệp TikTok (dịch vụ đã khử trùng theo id này) |

Trường không áp dụng cho loại sự kiện đó luôn là `null` — game cứ đọc thẳng,
không cần kiểm tra tồn tại.

### Các endpoint HTTP

| Endpoint | Trả về |
|---|---|
| `GET /health` | `{ "ok": true }` |
| `GET /status` | Trạng thái kết nối (`waiting_key` \| `waiting_username` \| `connecting` \| `connected` \| `reconnecting` \| `waiting_room` \| `error`), username, bộ đếm sự kiện theo loại, thống kê latency (avg/p95 trên 200 mẫu gần nhất), lỗi gần nhất (đã làm sạch, không chứa API key) |
| `GET /recent` | 50 sự kiện gần nhất (mới nhất trước) |

### Hành vi khi rớt mạng / phòng tắt

- Rớt kết nối: tự nối lại với backoff 1s → 2s → 5s → 10s → 30s (giữ 30s).
- Phòng chưa live hoặc vừa tắt live: state `waiting_room`, thử lại mỗi 15s.
- Lỗi connector **không bao giờ** làm sập tiến trình.
- `Ctrl+C` / SIGTERM: dừng gọn gàng.

## Về hạn mức Euler miễn phí

Gói EulerStream Community miễn phí cho khoảng **2.500 lượt ký/ngày**. Điểm
quan trọng: quota tính theo **lượt ký khi (tái) kết nối**, KHÔNG tính theo
sự kiện — một kết nối đã mở thì chat/quà/like chảy về bao nhiêu cũng không
tốn thêm quota. Một buổi live vài giờ, kể cả rớt mạng nối lại vài lần, chỉ
tốn vài chục lượt ký.

## Ghi chú kỹ thuật (bản connector 2.5.0)

- Connector phát sự kiện dạng protobuf đã giải mã (schema v3): user ở
  `data.user` (`id`, `displayId`, `nickname`, `avatarThumb`), metadata ở
  `data.common` (`msgId`, `createTime`), quà ở `data.gift` /
  `data.extendedGiftInfo` (bật sẵn `enableExtendedGiftInfo: true` để có tên
  và giá quà). `src/normalize.js` đọc phòng thủ cả shape v3 lẫn shape phẳng
  kiểu cũ trong README của connector, nên game không phụ thuộc vào chi tiết này.
- Sự kiện `follow` / `share` là event connector suy ra từ `social`; lớp khử
  trùng theo `msgId` đảm bảo không tính trùng.
- Dịch vụ **chưa được kiểm chứng với phòng live thật** — cần API key Euler
  miễn phí của chủ tài khoản và một phòng đang phát để chạy `connect-test`.
