# tiktok-live-feed — Nguồn cấp sự kiện TikTok LIVE độ trễ thấp

Dịch vụ Node.js nhỏ, chạy local, chuyên làm **một việc**: lấy sự kiện của một
phòng TikTok LIVE (chat, quà, like, follow, share, số người xem, người vào
phòng) và phát lại ngay cho các game/overlay trên cùng máy qua WebSocket.

## Kiến trúc

```
Phòng TikTok LIVE
      │  WebSocket webcast
      ▼
tiktok-live-connector v2.5 ──(lúc bắt tay)──► MÁY KÝ TỰ HOST (mặc định)
      │                                          src/sign-local.mjs — chạy
      │                                          trong CÙNG tiến trình feed
      ▼  sự kiện protobuf đã giải mã
src/normalize.js  →  một shape JSON duy nhất cho mọi game
      ▼
Dịch vụ này (:3010) ── WebSocket ws://localhost:3010/events ──► Game / OBS / Godot
```

### Máy ký tự host (`SIGN_MODE=local`, mặc định)

Từ 08/11/2026, tuyến ký EulerStream bị khóa sau gói Business (kể cả key
Community miễn phí cũng bị từ chối ở route ký), nên dịch vụ **không còn phụ
thuộc Euler nữa**. `src/sign-local.mjs` thay hai route ký của connector
thông qua registry chính thức `RouteConfig` của thư viện (không sửa
node_modules):

- **Tuyến chính — "phiên ấm" + relay:** một Chrome thật (hồ sơ bền
  `src/sign-profile/`) mở trang live của phòng như một khán giả web bình
  thường; TikTok tự cấp cookie + luồng WebSocket cho chính trang đó, và
  dịch vụ relay nguyên bản các frame của trang cho connector. Kết nối
  TikTok duy nhất là của trang thật nên đây là đường đáng tin nhất.
- **Dự phòng — ký cổ điển:** X-Bogus sinh bởi SDK webmssdk của chính
  TikTok chạy trong Chrome + X-Gnarly sinh ở Node + msToken thu hoạch,
  fetch `im/fetch` từ Node. Bộ ký này đã được TikTok chấp nhận ở các
  endpoint ký phụ (gift/list), nhưng riêng `im/fetch` đòi mức tin cậy
  phiên cao hơn — phiên khách ở phòng nhỏ/mới có thể bị trả rỗng.
- Bước dò room-id đã tắt hẳn tuyến Euler
  (`skipFetchRoomIdFromEulerRoute`).

Máy ký chạy **ngay trong tiến trình feed** — không có tiến trình riêng
phải bật tay. Chrome được tìm tự động (Google Chrome cài sẵn, hoặc bản
trong `~/.cache/puppeteer`); ghi đè bằng `SIGN_CHROME_PATH` nếu cần.

### Fallback Euler (`SIGN_MODE=euler`)

Đặt `SIGN_MODE=euler` trong `.env` để quay lại tuyến cũ: EulerStream ký
bằng `EULER_API_KEY`. Chỉ còn ý nghĩa nếu tài khoản Euler đã có gói
Business + add-on Signature Access — key miễn phí hiện bị Euler từ chối
ở route ký. Ở chế độ này sự kiện vẫn chảy thẳng từ TikTok, Euler chỉ ký.

## Vì sao độ trễ thấp?

- **Không mây trung gian cho sự kiện:** chữ ký chỉ cần ở bước bắt tay.
  Sau đó sự kiện chảy từ máy chủ TikTok về máy nhà qua kết nối của
  connector / trang Chrome ấm trên chính máy đó.
- **Hop cuối là localhost:** game và dịch vụ ở cùng máy, WebSocket nội
  bộ có độ trễ ~0.
- **Không polling, không tầng trung gian:** sự kiện được chuẩn hoá và
  broadcast ngay trong cùng tick khi connector nhận được.
- Dịch vụ còn **đo độ trễ thật** của từng sự kiện (`latencyMs` = thời
  điểm nhận − `createTime` TikTok gắn) và báo cáo avg/p95 ở `/status`.

> Nói thẳng: độ trễ phía TikTok (từ lúc người xem bấm gửi tới lúc Webcast
> phát ra, thường dưới 1 giây tới vài giây tuỳ phòng/mạng) là **bẩm sinh
> của nền tảng, không công cụ nào xoá được**. Dịch vụ này chỉ đảm bảo
> phần mình kiểm soát được — đường đi sau TikTok — là ngắn nhất có thể.

## Cài đặt

1. **Máy phải có Google Chrome** (máy ký local dùng Chrome thật để mở
   trang live + sinh chữ ký). Mac/Windows cài Chrome như bình thường là
   đủ; không cần tải thêm gì.
2. **Tạo file cấu hình:**

   ```bash
   cp .env.example .env
   ```

   Mở `.env`, điền tối thiểu:

   ```
   TIKTOK_USERNAME=<username phòng live, không có dấu @>
   PORT=3010
   ```

   Không cần `EULER_API_KEY` (chỉ cần khi `SIGN_MODE=euler`).
3. **Cài dependencies:** `npm install` (có `puppeteer-core` — chỉ là
   client điều khiển Chrome có sẵn, KHÔNG tải trình duyệt riêng).
4. **Chạy:** `npm start`
5. **Kiểm tra:** mở <http://localhost:3010/status> — thấy
   `"state": "connected"` là đã vào phòng. Nếu phòng chưa live, state
   là `waiting_room` và dịch vụ tự thử lại mỗi 15 giây.

### Lần chạy đầu trên Mac — đăng nhập 1 lần trong Chrome ký

Khi feed chạy ở chế độ local, một cửa sổ Chrome riêng ("Chrome ký",
dùng hồ sơ `src/sign-profile/`) sẽ mở trang live của phòng. **Hãy đăng
nhập TikTok trong cửa sổ đó một lần duy nhất** (nên dùng nick phụ vẫn
dùng để xem live): phiên khách bị TikTok cấp thiếu dữ liệu ở các phòng
nhỏ/mới (đã gặp thật: chat không chảy), còn phiên đã đăng nhập được
cấp luồng đầy đủ. Các lần sau Chrome ký tự nhớ đăng nhập.

- **TUYỆT ĐỐI không xoá thư mục `src/sign-profile/`** (mất phiên đăng
  nhập) và không copy/commit nó đi nơi khác — nó chứa cookie đăng nhập
  cá nhân (đã nằm trong `.gitignore`).
- Nếu log báo hồ sơ đang bị một cửa sổ Chrome khác chiếm: đóng hẳn cửa
  sổ Chrome ký của lần chạy trước rồi chạy lại.

Các lệnh phụ:

- `npm run selftest` — tự kiểm tra toàn bộ đường sự kiện bằng chế độ
  giả lập (không cần key, không dùng mạng ngoài).
- `npm run connect-test -- <username>` — thử kết nối thật một lần theo
  đúng `SIGN_MODE` trong `.env`, in lỗi rõ ràng nếu phòng chưa live /
  máy ký bị chặn / bị giới hạn gói Euler.
- Chạy thử không cần phòng thật: `FEED_FAKE=1 npm start` — phát sự
  kiện giả lập qua đúng đường như thật, để dev game nối vào test trước.

### Dùng cùng `trieu-phu-live/start-live.sh`

Không cần sửa gì ở `start-live.sh`: script đó chỉ chạy
`node index.js` trong thư mục này, và feed tự bật máy ký trong cùng
tiến trình. **Một lưu ý duy nhất:** sau khi cập nhật bản có máy ký
local, hãy chạy `npm install` một lần trong thư mục `tiktok-live-feed`
trên Mac (thêm dependency `puppeteer-core`) — `start-live.sh` chỉ tự
cài khi thư mục `node_modules` chưa tồn tại, nên máy đã cài từ trước
sẽ thiếu thư viện này nếu bỏ qua bước đó.

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

Trường không áp dụng cho loại sự kiện đó luôn là `null` — game cứ đọc
thẳng, không cần kiểm tra tồn tại.

### Các endpoint HTTP

| Endpoint | Trả về |
|---|---|
| `GET /health` | `{ "ok": true }` |
| `GET /status` | Trạng thái kết nối (`waiting_username` \| `connecting` \| `connected` \| `reconnecting` \| `waiting_room` \| `sign_blocked` \| `error` \| `waiting_key` khi euler), `signMode`, username, bộ đếm sự kiện theo loại, thống kê latency (avg/p95 trên 200 mẫu gần nhất), gợi ý xử lý theo trạng thái, lỗi gần nhất (đã làm sạch, không chứa API key) |
| `GET /recent` | 50 sự kiện gần nhất (mới nhất trước) |

### Hành vi khi rớt mạng / phòng tắt

- Rớt kết nối: tự nối lại với backoff 1s → 2s → 5s → 10s → 30s (giữ 30s).
- Phòng chưa live hoặc vừa tắt live: state `waiting_room`, thử lại mỗi 15s.
- Máy ký local bị TikTok từ chối ở `im/fetch`: state `sign_blocked`,
  thử lại mỗi 60s (thử dồn cũng ra cùng kết quả; sau khi đăng nhập
  trong Chrome ký thì lần thử sau có thể qua).
- Lỗi connector **không bao giờ** làm sập tiến trình.
- `Ctrl+C` / SIGTERM: dừng gọn gàng (đóng cả Chrome ký).

## Trạng thái kiểm chứng (trung thực, cập nhật 08/11/2026)

- Đường sự kiện giả lập (normalize → broadcast → game): `npm run
  selftest` PASS.
- Bộ ký cổ điển: TikTok **đã chấp nhận** ở endpoint ký phụ `gift/list`
  (774 món quà thật của một phòng đang live, kiểm chứng 02/11/2026).
- Máy ký (bản gốc ở dự án ho-cau-live, cùng một code) đã relay được sự
  kiện THẬT trên phòng thật khi chạy trên **Mac của chủ phòng** —
  gồm cả phòng của chính chủ phòng sau khi Chrome ký được đăng nhập
  (chat chảy 3–6 sự kiện/phút ở phòng nhỏ, kiểm chứng 02/11/2026).
- Kiểm chứng bản feed này trên VM của Muse (08/11/2026, phòng
  @user6as3xopq89 đang live): pipeline chạy đúng tới bước cuối —
  dò được phòng đang live, route ký local được cắm, phiên ấm dựng —
  nhưng **chưa nhận được sự kiện**: Chrome trên VM không tải nổi
  tiktok.com qua chuỗi proxy của VM (`net::ERR_EMPTY_RESPONSE`, lỗi
  mạng riêng của VM, đã biết từ 02/11) nên tuyến relay không có trang
  để relay, và `im/fetch` từ IP của VM trả 0 byte → state
  `sign_blocked` đúng thiết kế. **Phép kiểm chứng quyết định là lần
  chạy trên Mac của chủ phòng** (IP nhà + Chrome hệ thống + đã đăng
  nhập Chrome ký): chạy `node index.js`, mở trang live, nhìn
  `/status` — `eventsReceived.chat > 0` là đường sự kiện đã thông hẳn.

## Ghi chú kỹ thuật (bản connector 2.5.0)

- Connector phát sự kiện dạng protobuf đã giải mã (schema v3): user ở
  `data.user` (`id`, `displayId`, `nickname`, `avatarThumb`), metadata
  ở `data.common` (`msgId`, `createTime`), quà ở `data.gift` /
  `data.extendedGiftInfo` (bật sẵn `enableExtendedGiftInfo: true` để
  có tên và giá quà). `src/normalize.js` đọc phòng thủ cả shape v3 lẫn
  shape phẳng kiểu cũ trong README của connector, nên game không phụ
  thuộc vào chi tiết này. Lưu ý schema v3: nội dung chat nằm ở
  `content` (không phải `comment`), like ở `count`, số người xem ở
  `total` — normalize đã xử lý.
- Sự kiện `follow` / `share` là event connector suy ra từ `social`;
  lớp khử trùng theo `msgId` đảm bảo không tính trùng.
- `src/sign-local.mjs` là bản vendor từ `~/workspace/ho-cau-live`
  (máy ký qua 6 vòng kiểm chứng 02–03/11/2026, tài liệu đầy đủ trong
  `SIGN-NOTES.md` của dự án đó). Nếu bên đó có vòng sửa mới, chép lại
  file này để đồng bộ.
