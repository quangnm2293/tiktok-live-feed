# Thư mục sign/ — tài sản của máy ký tự host

- `webmssdk_1.0.0.368.js` — SDK chống bot (webmssdk) của chính TikTok,
  bản đã được dự án mã nguồn mở **carcabot/tiktok-signature** vá nhẹ để
  phơi bảng module nội bộ ra `window.__sdkN` và ghi lại các lần gọi ký
  vào `window.__cap3` (phục vụ việc gọi thẳng hàm ký X-Bogus và lấy
  counters cho X-Gnarly). SDK gốc thuộc về ByteDance/TikTok; bản vá
  thuộc dự án tiktok-signature.
- `xgnarly.mjs` — thuật toán mã hóa X-Gnarly viết lại ở Node, lấy từ
  cùng dự án carcabot/tiktok-signature.

Dự án tiktok-signature công bố giấy phép **MIT** trong package.json
(bản npm 4.3.6). Giữ nguyên ghi công này khi phân phối lại.

Cập nhật khi TikTok đổi SDK: thay file webmssdk bằng bản mới tương ứng
(cùng cơ chế vá `__sdkN`/`__cap3`) và chỉnh `sdkVersion` trong
`sign-local.js` nếu cần. Xem thêm `../SIGN-NOTES.md`.
