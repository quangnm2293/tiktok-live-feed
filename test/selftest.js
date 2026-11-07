'use strict';

// SELFTEST — không dùng mạng ngoài, không cần API key.
// Bật dịch vụ ở chế độ FEED_FAKE=1 (sự kiện giả lập chạy qua ĐÚNG đường
// normalize -> broadcast như sự kiện thật) rồi kiểm tra:
//   (1) GET /health trả { ok: true }
//   (2) Client WS nối ws://localhost:<port>/events nhận được sự kiện chat +
//       gift đúng shape chuẩn hoá
//   (3) GET /status: bộ đếm sự kiện đã tăng
//   (4) GET /recent chứa các sự kiện đó
// In "SELFTEST PASS" / "SELFTEST FAIL <lý do>" và thoát với exit code tương ứng.

process.env.FEED_FAKE = '1';

const http = require('http');
const WebSocket = require('ws');
const { FeedService } = require('../src/feed');
const { FeedServer } = require('../src/server');

function getJson(port, path) {
  return new Promise((resolve, reject) => {
    http
      .get({ host: '127.0.0.1', port, path }, (res) => {
        let body = '';
        res.on('data', (c) => (body += c));
        res.on('end', () => {
          try { resolve(JSON.parse(body)); } catch (e) { reject(e); }
        });
      })
      .on('error', reject);
  });
}

function fail(reason) {
  console.log(`SELFTEST FAIL ${reason}`);
  process.exit(1);
}

(async () => {
  const config = { eulerApiKey: '', username: 'fake_room', fake: true, debug: false };
  const feed = new FeedService(config);
  const server = new FeedServer({ feed, config });
  const port = await server.listen(0); // cổng ngẫu nhiên, tránh đụng độ
  feed.start();
  console.log(`[selftest] server giả lập chạy ở cổng ${port}`);

  try {
    // (1) /health
    const health = await getJson(port, '/health');
    if (!health || health.ok !== true) return fail('/health không trả {ok:true}');
    console.log('[selftest] (1) /health ok');

    // (2) WS nhận chat + gift đúng shape
    const received = await new Promise((resolve, reject) => {
      const ws = new WebSocket(`ws://127.0.0.1:${port}/events`);
      const got = [];
      const timer = setTimeout(() => reject(new Error('quá 5s không nhận đủ sự kiện chat+gift qua WS')), 5000);
      ws.on('message', (buf) => {
        let msg;
        try { msg = JSON.parse(buf.toString()); } catch (_) { return; }
        if (msg.type === 'hello') return;
        got.push(msg);
        const hasChat = got.some((e) => e.type === 'chat');
        const hasGift = got.some((e) => e.type === 'gift');
        if (hasChat && hasGift) {
          clearTimeout(timer);
          ws.close();
          resolve(got);
        }
      });
      ws.on('error', reject);
    });

    const chat = received.find((e) => e.type === 'chat');
    const gift = received.find((e) => e.type === 'gift');
    if (chat.text !== 'ăn' || chat.uniqueId !== 'nguoi_choi_1' || !chat.userId || typeof chat.ts !== 'number') {
      return fail(`sự kiện chat sai shape: ${JSON.stringify(chat)}`);
    }
    if (gift.giftName !== 'Hoa hồng' || gift.coins !== 1 || gift.giftId !== '5655' || gift.repeatCount !== 1) {
      return fail(`sự kiện gift sai shape: ${JSON.stringify(gift)}`);
    }
    if (typeof chat.latencyMs !== 'number') {
      return fail(`chat thiếu latencyMs dạng số: ${JSON.stringify(chat)}`);
    }
    console.log('[selftest] (2) WS nhận chat + gift đúng shape chuẩn hoá');

    // Chờ thêm vài nhịp giả lập để bộ đếm tăng đủ loại
    await new Promise((r) => setTimeout(r, 1500));

    // (3) /status counters
    const status = await getJson(port, '/status');
    if (!status.eventsReceived || status.eventsReceived.chat < 1 || status.eventsReceived.gift < 1 || status.eventsReceived.total < 5) {
      return fail(`/status bộ đếm không tăng đúng: ${JSON.stringify(status.eventsReceived)}`);
    }
    if (!status.latency || status.latency.samples < 1 || typeof status.latency.avgMs !== 'number') {
      return fail(`/status thiếu thống kê latency: ${JSON.stringify(status.latency)}`);
    }
    console.log(`[selftest] (3) /status counters ok: ${JSON.stringify(status.eventsReceived)}`);

    // (4) /recent
    const recent = await getJson(port, '/recent');
    if (!recent.events || !recent.events.some((e) => e.type === 'chat') || !recent.events.some((e) => e.type === 'gift')) {
      return fail('/recent không chứa sự kiện chat/gift vừa phát');
    }
    console.log(`[selftest] (4) /recent ok (${recent.events.length} sự kiện trong bộ đệm)`);

    console.log('SELFTEST PASS');
  } catch (err) {
    return fail(err.message);
  } finally {
    try { await feed.stop(); } catch (_) { /* bỏ qua */ }
    try { await server.close(); } catch (_) { /* bỏ qua */ }
  }
  process.exit(0);
})();
