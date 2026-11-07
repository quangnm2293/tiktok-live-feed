'use strict';

// Điểm khởi động dịch vụ tiktok-live-feed.
// Đọc cấu hình từ .env (EULER_API_KEY, TIKTOK_USERNAME, PORT),
// bật HTTP/WebSocket server cho game local và vòng đời kết nối TikTok.

require('dotenv').config();

const { FeedService } = require('./src/feed');
const { FeedServer } = require('./src/server');

const config = {
  eulerApiKey: (process.env.EULER_API_KEY || '').trim(),
  username: (process.env.TIKTOK_USERNAME || '').trim().replace(/^@/, ''),
  fake: process.env.FEED_FAKE === '1',
  debug: process.env.DEBUG_EVENTS === '1',
};
const port = parseInt(process.env.PORT || '3010', 10);

const feed = new FeedService(config);
const server = new FeedServer({ feed, config });

let shuttingDown = false;
async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`\n[main] Nhận ${signal} — đang dừng gọn gàng...`);
  try { await feed.stop(); } catch (_) { /* bỏ qua */ }
  try { await server.close(); } catch (_) { /* bỏ qua */ }
  process.exit(0);
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

// An toàn cuối: lỗi lạ ở bất cứ đâu cũng không được làm sập nguồn cấp sự kiện.
process.on('unhandledRejection', (err) => {
  console.error('[main] unhandledRejection (đã nuốt để giữ dịch vụ sống):', err && err.message);
});

(async () => {
  const actualPort = await server.listen(port);
  console.log(`[main] tiktok-live-feed đang chạy: http://localhost:${actualPort}`);
  console.log(`[main] Game nối vào: ws://localhost:${actualPort}/events`);
  console.log(`[main] Trạng thái:     http://localhost:${actualPort}/status`);
  if (config.fake) console.log('[main] FEED_FAKE=1 — đang phát sự kiện GIẢ LẬP (không nối TikTok thật)');
  feed.start();
  if (feed.state === 'waiting_key') {
    console.log('[main] Chưa có EULER_API_KEY trong .env -> chế độ chờ key (xem README để lấy key miễn phí).');
  } else if (feed.state === 'waiting_username') {
    console.log('[main] Chưa có TIKTOK_USERNAME trong .env -> chưa biết nối phòng nào.');
  }
})();
