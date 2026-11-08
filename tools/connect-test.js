'use strict';

// CONNECT-TEST — thử kết nối THẬT tới một phòng live TikTok (một lần duy nhất).
// Cách dùng:
//   node tools/connect-test.js [username_khong_co_@]
//   (hoặc lấy TIKTOK_USERNAME từ .env)
//
// Tuyến ký đi theo SIGN_MODE như dịch vụ chính: 'local' (MẶC ĐỊNH) dùng
// máy ký tự host src/sign-local.mjs — không cần EULER_API_KEY;
// 'euler' dùng EULER_API_KEY như bản cũ.
//
// Mã thoát:
//   0 = kết nối được (in ra số sự kiện thấy trong vài giây)
//   2 = thiếu cấu hình (username, hoặc EULER_API_KEY khi SIGN_MODE=euler)
//   3 = phòng chưa live (UserOfflineError)
//   1 = lỗi khác (in thông báo lỗi ĐÃ LÀM SẠCH — không bao giờ in API key)
//
// Lưu ý: lỗi từ EulerStream thường nhắc tới giới hạn gói (plan limit) —
// thông báo đó được trích nguyên văn để dễ chẩn đoán.

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const CONNECT_TIMEOUT_MS = 60000;
const OBSERVE_MS = 5000;

const apiKey = (process.env.EULER_API_KEY || '').trim();
const signMode = String(process.env.SIGN_MODE || 'local').toLowerCase() === 'euler' ? 'euler' : 'local';
const username = (process.argv[2] || process.env.TIKTOK_USERNAME || '').trim().replace(/^@/, '');

function sanitize(msg) {
  let s = String(msg || 'unknown error');
  if (apiKey) s = s.split(apiKey).join('***');
  return s;
}

(async () => {
  const missing = [];
  if (signMode === 'euler' && !apiKey) missing.push('EULER_API_KEY (SIGN_MODE=euler — đăng ký tại eulerstream.com rồi điền vào file .env; hoặc bỏ SIGN_MODE để dùng máy ký local)');
  if (!username) missing.push('TIKTOK_USERNAME (truyền qua tham số dòng lệnh hoặc điền vào file .env)');
  if (missing.length) {
    console.log('Chưa thể kết nối — đang thiếu:');
    for (const m of missing) console.log(`  - ${m}`);
    process.exit(2);
  }

  const ttlc = await import('tiktok-live-connector');
  const { TikTokLiveConnection, WebcastEvent } = ttlc;
  const connOptions = { enableExtendedGiftInfo: true };
  let signLocal = null;
  if (signMode === 'euler') {
    connOptions.signApiKey = apiKey;
  } else {
    signLocal = await import('../src/sign-local.mjs');
    signLocal.installLocalSignRoutes(ttlc, (m) => console.log(m));
    Object.assign(connOptions, signLocal.localConnectionOptions());
    const p = signLocal.prepareWarmSession(username, (m) => console.log(m));
    if (p && p.catch) p.catch(() => {});
  }
  const conn = new TikTokLiveConnection(username, connOptions);

  const counts = {};
  for (const name of ['chat', 'gift', 'like', 'follow', 'share', 'roomUser', 'member']) {
    conn.on(name, () => { counts[name] = (counts[name] || 0) + 1; });
  }
  void WebcastEvent;

  console.log(`[connect-test] Đang kết nối tới phòng live của @${username} (timeout ${CONNECT_TIMEOUT_MS / 1000}s)...`);
  let timer;
  try {
    const state = await Promise.race([
      conn.connect(),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`Quá ${CONNECT_TIMEOUT_MS / 1000}s chưa kết nối được`)), CONNECT_TIMEOUT_MS);
      }),
    ]);
    clearTimeout(timer);
    console.log(`[connect-test] KẾT NỐI THÀNH CÔNG — roomId ${state && state.roomId}`);
    console.log(`[connect-test] Lắng nghe thêm ${OBSERVE_MS / 1000}s để đếm sự kiện...`);
    await new Promise((r) => setTimeout(r, OBSERVE_MS));
    console.log(`[connect-test] Sự kiện đã thấy: ${JSON.stringify(counts)}`);
    await conn.disconnect();
    if (signLocal) { try { await signLocal.closeWarmSession(); } catch (_) { /* bỏ qua */ } }
    process.exit(0);
  } catch (err) {
    clearTimeout(timer);
    const msg = sanitize(err && err.message);
    if (err && (err.name === 'UserOfflineError' || /offline|not live/i.test(msg))) {
      console.log(`[connect-test] @${username} hiện KHÔNG live (UserOfflineError). Hãy thử lại khi phòng đang phát.`);
      process.exit(3);
    }
    console.log(`[connect-test] Kết nối thất bại: ${msg}`);
    try { await conn.disconnect(); } catch (_) { /* bỏ qua */ }
    if (signLocal) { try { await signLocal.closeWarmSession(); } catch (_) { /* bỏ qua */ } }
    process.exit(1);
  }
})();
