/* =====================================================================
   BẢN VENDOR cho tiktok-live-feed (nạp vào từ src/feed.js khi
   SIGN_MODE=local). Nguồn gốc: ~/workspace/ho-cau-live/sign-local.js
   (máy ký đã qua 6 vòng kiểm chứng thật 02–03/11/2026 — xem lịch sử
   vòng trong thân file và SIGN-NOTES.md của ho-cau-live). Giữ file
   này đồng bộ với bản gốc nếu ho-cau-live có vòng sửa mới.
   =====================================================================
   MÁY KÝ TỰ HOST (sign-local.js) — tuyến ký LOCAL cho tiktok-live-connector
   ---------------------------------------------------------------------
   Vì sao cần file này: tuyến ký EulerStream (mặc định của thư viện) đã
   khóa endpoint ký sau gói Business $50/tháng — kể cả khi có API key
   Community miễn phí (đã kiểm chứng 02/11/2026, lỗi "This endpoint
   requires a Business plan"). File này thay 2 route ký của thư viện
   (RouteConfig.fetchSignedWebSocketFromProvider +
   RouteConfig.fetchWebcastSignatureFromProvider) bằng máy ký chạy
   ngay trên máy host.

   VÒNG 1 (đã kiểm chứng): chữ ký tự sinh (X-Bogus từ SDK TikTok
   webmssdk 1.0.0.368 trong Chrome + X-Gnarly ở Node + msToken thu
   hoạch) ĐƯỢC TikTok chấp nhận ở endpoint gift/list (774 món quà
   thật), nhưng im/fetch trả 0 byte ở CẢ VM (IP datacenter) lẫn Mac
   của user (IP dân cư, phòng live thật @docauduli 02/11 18:00) →
   loại trừ giả thuyết IP; điểm tắc là MỨC TIN CẬY CỦA PHIÊN đối với
   riêng im/fetch.

   VÒNG 2 — "PHIÊN ẤM": một Chrome riêng mở THẬT trang live của phòng
   đích như một khán giả web bình thường: TikTok tự cấp bộ cookie đầy
   đủ, SDK của chính trang tự tích lũy bộ đếm/telemetry khi duyệt, và
   trang tự thực hiện im/fetch + mở WebSocket push bằng phiên của nó.
   Route lấy luồng sự kiện thử theo thứ tự (mỗi bước ghi chẩn đoán):
     C) RELAY: bắt frame WebSocket CỦA CHÍNH TRANG qua CDP và chuyển
        tiếp nguyên bản vào một WebSocket server local mà thư viện
        kết nối tới (pushServer = ws://127.0.0.1). Nếu trang không
        dùng WS mà polling im/fetch, bọc mỗi response im/fetch của
        trang thành WebcastPushFrame rồi relay tương tự. Đây là đường
        đáng tin nhất: kết nối TikTok duy nhất là của trang thật.
     A) Dùng NGUYÊN fetchResult im/fetch mà trang đã nhận (cursor /
        internalExt / pushServer thật) → thư viện tự mở WS từ Node.
     A2) Fetch im/fetch NGAY TRONG ngữ cảnh trang (page.evaluate,
        credentials include — SDK của trang tự ký qua cơ chế chặn
        fetch/XHR của nó; dự phòng: gọi frontierSign nếu có).
     B) Trích xuất từ phiên ấm (TOÀN BỘ cookie + bộ đếm thật đo bằng
        CDP + fingerprint thật của trang) rồi ký và fetch từ Node.
     D) Đường cổ điển vòng 1 (phiên ký SDK riêng + jar msToken).

   VÒNG 3 — sửa theo chẩn đoán THẬT từ Mac (02/11 18:24, @docauduli):
   ngay cả im/fetch CỦA CHÍNH TRANG cũng chỉ trả 27 byte và mọi fetch
   từ Node đều HTTP 200/0 byte → TikTok cố ý để RỖNG kênh polling
   cho phiên khách; kênh dữ liệu thật của khán giả web là WebSocket
   (im-ws-sg). Thay đổi:
     - C-relay BỎ cổng cursor: relay frame WS của trang ngay khi
       trang mở WS. Cursor khởi tạo (thư viện bắt buộc khác rỗng)
       suy ra từ lưu lượng trang (query URL WS / frame WS đầu /
       body im/fetch); không suy ra được thì dùng cursor TỔNG HỢP —
       an toàn vì nó chỉ bị gửi vào relay local của mình, trang vẫn
       giữ cursor thật trên kết nối của nó.
     - Relay có ĐỆM frame: frame của trang đến trước khi thư viện
       nối vào được GIỮ LẠI và PHÁT LẠI theo thứ tự (frame đầu chứa
       trạng thái khởi tạo), sau đó mới chảy trực tiếp.
     - Vận chuyển nhị phân base64/byte-array END-TO-END: body
       im/fetch qua CDP đọc latin1 khi không có base64 (đọc 'utf8'
       phá mọi byte ≥ 0x80 của protobuf — nghi vấn gây lỗi giải mã
       "premature EOF" ở A2 vòng 2); giải mã thử NHIỀU DẠNG
       (fetchResult thô / gzip / WebcastPushFrame); body nhỏ của
       trang được ghi hex + base64 vào log để nhận diện.
     - Chống throttle cho Chrome ấm: cờ tắt bóp timer/nền, trên Mac
       chạy headed (có cửa sổ); làm ấm tối đa ~45s và CHỈ dừng sớm
       khi WS của trang đã chảy ≥5 frame (không dừng vì im/fetch
       nữa); chẩn đoán ghi số frame WS theo mốc thời gian.
   VÒNG 4 — sửa theo chẩn đoán THẬT từ phòng của chính user
   (02/11 21:02–21:11): relay chạy đúng nhưng PHIÊN KHÁCH bị TikTok
   cho "ăn kiêng" dữ liệu ở phòng nhỏ/mới — 9,5 phút live chỉ có 1
   sự kiện (follow) qua được relay, chat = 0, trong khi im/fetch của
   trang ngay sau khi live kết thúc lại phình lên 58KB/19 tin. Thay
   đổi:
     - Phiên ấm dùng HỒ SƠ CHROME BỀN (thư mục sign-profile/ cạnh
       file này): user TỰ đăng nhập TikTok 1 LẦN trong cửa sổ Chrome
       ấm (máy KHÔNG tự đăng nhập, không chạm mật khẩu/thông tin
       đăng nhập của user) và phiên đó được giữ cho mọi lần chạy sau
       — kỳ vọng phiên đã đăng nhập được TikTok cấp luồng đầy đủ như
       trình duyệt cá nhân của user (đây là GIẢ THUYẾT kế thừa từ
       vòng 3 — CHƯA chứng minh; cần buổi live thật tiếp theo trên
       phòng của user để kết luận).
     - Trạng thái đăng nhập được ghi log dựa trên TÊN cookie
       (sessionid / sessionid_ss) — không bao giờ in giá trị cookie.
     - Relay nạp MỌI body im/fetch của trang (bỏ cổng pollRelay của
       vòng 2/3): ở phòng nhỏ, kênh polling có thể là đường duy nhất
       còn mang tin nhắn.
     - Đo xa frame WS mỗi 60 giây, tách theo loại socket.
   VÒNG 5 — rà soát toàn vẹn byte sau buổi live 02/11 21:46 (chat đã
   chảy nhưng lệnh GIẬT vẫn không ăn): test-text-integrity.mjs chứng
   minh MỌI chặng vận chuyển trong file này đều byte-exact (gồm cả
   hai phép chuyển đổi CDP chạy với Chrome thật) — gốc bệnh thật nằm
   ở server.js (schema v3 đổi tên trường text chat "comment" →
   "content"). Đóng góp của vòng này ở file này chỉ là siết invariant
   byte: BỎ nhánh thay buf bằng biến thể utf8 khi bản byte-exact
   không giải mã được (xem handler im/fetch). Chi tiết: SIGN-NOTES
   mục 12.
   VÒNG 6 — chống LẪN PHÒNG (vụ 02/11 22:11: relay chuyển về chat
   sạch, đọc được, nhưng user khẳng định phòng mình không có ai
   ngoài chính mình; 3 tên trong mẫu 🔤 không xuất hiện ở panel chat
   Studio lẫn panel web): trang ấm được mở từ lúc server khởi động —
   thường TRƯỚC khi user lên live — có thể bị TikTok đẩy trôi sang
   một live ĐỀ XUẤT trên trang /@user/live của người chưa phát, và
   relay (vốn chuyển tiếp trung thực mọi thứ trang nhận) chuyển luôn
   sự kiện của PHÒNG LẠ đó. Vòng 6: (1) mỗi lần provider được gọi cho
   một lần connect (lần bám đầu lẫn mọi lần bám lại — phiên phòng
   thay đổi theo từng buổi live), trang bị ÉP ĐIỀU HƯỚNG TƯƠI vào
   đúng /@<user>/live, kể cả khi đang ở đúng URL đó, kèm xoá trạng
   thái của phiên phòng cũ (đệm relay, im/fetch, cursor) và cửa sổ
   ân hạn 25s để việc điều hướng không tự ngắt client thư viện qua
   handler WS-đóng; (2) ~5s sau khi điều hướng lắng xuống, log ĐỊNH
   DANH phòng (URL cuối + tiêu đề trang + tên chủ phòng hiển thị nếu
   đọc được từ DOM) và cảnh báo ⚠️ nổi bật khi URL cuối không phải
   phòng đích. Từ nay "sự kiện thuộc phòng nào" đọc được trong log.
   Chi tiết: SIGN-NOTES mục 13.
   Chỉ ĐỌC dữ liệu live công khai. Máy không tự đăng nhập tài khoản
   nào — đăng nhập (nếu có) là do user tự làm trong cửa sổ Chrome ấm.
   Log chẩn đoán CHỈ ghi TÊN cookie — không bao giờ ghi giá trị
   cookie/msToken/chữ ký ra log.

   Bật/tắt: server.js chỉ nạp file này khi SIGN_MODE=local. Mặc định
   (không đặt SIGN_MODE) hành vi cũ (EulerStream) giữ nguyên.

   Biến môi trường phụ:
   - SIGN_CHROME_PATH: đường dẫn Chrome/Chromium tùy chọn.
   - Máy có proxy HTTP(S) qua biến môi trường https_proxy (dạng có
     mật khẩu nhúng trong URL): file này tự dựng một cầu nối CONNECT
     nội bộ để Chrome dùng được. Trên máy nhà không có proxy thì bỏ
     qua hoàn toàn.
   ===================================================================== */
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import net from 'node:net';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';
import { WebSocketServer } from 'ws';
import { encode as encodeXGnarly } from './sign/xgnarly.mjs';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const SDK_PATH = path.join(DIR, 'sign', 'webmssdk_1.0.0.368.js');
/* VÒNG 4 — hồ sơ Chrome BỀN của phiên ấm: nằm cạnh file này (thư mục
   sign-profile/) để user đăng nhập TikTok 1 lần trong cửa sổ Chrome
   ấm và phiên đăng nhập được giữ qua các lần khởi động lại server.
   TUYỆT ĐỐI không đóng gói thư mục này vào zip phân phối: nó chứa
   cookie đăng nhập của user (dữ liệu cá nhân, chỉ sống trên máy của
   user). Phiên ký cổ điển (chiến lược D) cố ý KHÔNG dùng hồ sơ này —
   nó không bao giờ đăng nhập, và hai Chrome chạy đồng thời cũng
   không thể dùng chung một hồ sơ (Chrome khóa hồ sơ theo tiến trình). */
const SIGN_PROFILE_DIR = path.join(DIR, 'sign-profile');

/* UA của phiên ký CỔ ĐIỂN (chiến lược D + ký quà) — giữ nguyên vòng 1
   vì đã chứng minh hợp lệ ở gift/list. Các chiến lược ấm dùng UA thật
   của chính trang ấm. */
export const SIGN_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Safari/605.1.15';
const FP = { browser_platform: 'MacIntel', os: 'mac', screen_width: '1920', screen_height: '1080', browser_language: 'en-US', browser_version: SIGN_UA };

/* ------------------------- Phân loại lỗi ------------------------- */
export class LocalSignBlockedError extends Error { constructor(m) { super(m); this.name = 'LocalSignBlocked'; } }
export class LocalSignBrowserError extends Error { constructor(m) { super(m); this.name = 'LocalSignBrowser'; } }

/* ------------------------- Chẩn đoán -------------------------
   Khối này được test-sign-local.mjs in ra cuối buổi chạy để user
   chụp 1 ảnh là đủ thông tin. TUYỆT ĐỐI không lưu giá trị cookie /
   msToken / chữ ký vào đây — chỉ tên cookie và số đo. */
const COOKIE_WATCH = ['msToken', 'ttwid', 'tt_chain_token', 'sessionid', 'sessionid_ss', 'sid_tt', 'tt-target-idc', 'odin_tt', 'store-country-code', 'tt_csrf_token'];
const diag = {
  warm: null,          // tóm tắt phiên ấm (xem snapshotWarm)
  strategies: [],      // [{name, result, httpStatus, bytes, note}]
  relay: { started: false, clients: 0, rxFrames: 0, txFrames: 0, rxFromLibrary: 0, replayedFrames: 0, buffered: 0 },
  initCursor: null,    // {mode:'real'|'synthetic', source} — cursor khởi tạo đã cấp cho thư viện ở chiến lược C
};
function recordStrategy(name, info) {
  const entry = { name, ...info };
  const i = diag.strategies.findIndex((s) => s.name === name);
  if (i >= 0) diag.strategies[i] = entry; else diag.strategies.push(entry);
  return entry;
}
export function getDiagnostics() {
  return JSON.parse(JSON.stringify(diag));
}

/* ------------------------- Tìm Chrome ------------------------- */
function resolveChromePath() {
  const candidates = [];
  if (process.env.SIGN_CHROME_PATH) candidates.push(process.env.SIGN_CHROME_PATH);
  candidates.push(
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'
  );
  try {
    const cacheRoot = path.join(process.env.HOME || '', '.cache', 'puppeteer', 'chrome');
    if (fs.existsSync(cacheRoot)) {
      for (const v of fs.readdirSync(cacheRoot).sort().reverse()) {
        candidates.push(path.join(cacheRoot, v, 'chrome-linux64', 'chrome'));
      }
    }
    const shellRoot = path.join(process.env.HOME || '', '.cache', 'puppeteer', 'chrome-headless-shell');
    if (fs.existsSync(shellRoot)) {
      for (const v of fs.readdirSync(shellRoot).sort().reverse()) {
        candidates.push(path.join(shellRoot, v, 'chrome-headless-shell-linux64', 'chrome-headless-shell'));
      }
    }
  } catch { /* bỏ qua */ }
  for (const c of candidates) { try { if (c && fs.existsSync(c)) return c; } catch { /* bỏ qua */ } }
  throw new LocalSignBrowserError('Không tìm thấy Chrome/Chromium trên máy. Cài Google Chrome, hoặc đặt biến môi trường SIGN_CHROME_PATH trỏ tới file chạy của trình duyệt.');
}

/* ------------- Cầu nối proxy cho Chrome (khi có proxy) ------------- */
async function startProxyForwarder() {
  const raw = process.env.https_proxy || process.env.HTTPS_PROXY || process.env.http_proxy || process.env.HTTP_PROXY;
  if (!raw) return null;
  let u;
  try { u = new URL(raw); } catch { return null; }
  if (!u.hostname || !u.port) return null;
  if (!u.username && !u.password) return { directProxy: `http://${u.hostname}:${u.port}` };
  const srv = http.createServer();
  srv.on('connect', (req, clientSock, head) => {
    const up = net.connect(parseInt(u.port, 10), u.hostname, () => {
      const auth = Buffer.from(decodeURIComponent(u.username) + ':' + decodeURIComponent(u.password)).toString('base64');
      up.write(`CONNECT ${req.url} HTTP/1.1\r\nHost: ${req.url}\r\nProxy-Authorization: Basic ${auth}\r\n\r\n`);
      if (head && head.length) up.write(head);
    });
    let buf = Buffer.alloc(0); let done = false;
    up.on('data', (d) => {
      if (done) { clientSock.write(d); return; }
      buf = Buffer.concat([buf, d]);
      const idx = buf.indexOf('\r\n\r\n');
      if (idx !== -1) { done = true; const rest = buf.subarray(idx + 4); if (rest.length) clientSock.write(rest); up.pipe(clientSock); clientSock.pipe(up); }
    });
    up.on('error', () => clientSock.destroy());
    clientSock.on('error', () => up.destroy());
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  return { localProxy: `http://127.0.0.1:${srv.address().port}`, srv };
}

function chromeArgs(proxy, w, h) {
  // Ba cờ --disable-*-throttling/backgrounding: chống Chrome bóp timer
  // và render khi cửa sổ bị che/chạy nền (nghi vấn vòng 2: WS của trang
  // chỉ nhận 1 frame trong cửa sổ làm ấm vì bị throttle).
  const args = ['--no-sandbox', '--disable-dev-shm-usage', '--disable-blink-features=AutomationControlled', `--window-size=${w},${h}`, '--disable-quic', '--autoplay-policy=no-user-gesture-required', '--enable-unsafe-swiftshader', '--mute-audio', '--disable-background-timer-throttling', '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding'];
  if (proxy && proxy.localProxy) args.push(`--proxy-server=${proxy.localProxy}`);
  else if (proxy && proxy.directProxy) args.push(`--proxy-server=${proxy.directProxy}`);
  return args;
}

/* ------------------- Phiên ký cổ điển (SDK tiêm) ------------------- */
let sdkSource = null;
let sessionPromise = null;

async function buildSession(log) {
  if (!sdkSource) sdkSource = fs.readFileSync(SDK_PATH, 'utf8');
  const chromePath = resolveChromePath();
  const proxy = await startProxyForwarder();
  const browser = await puppeteer.launch({
    executablePath: chromePath, headless: true,
    acceptInsecureCerts: !!proxy,
    args: chromeArgs(proxy, 1920, 1080),
  });
  const page = await browser.newPage();
  await page.setUserAgent(SIGN_UA);
  await page.setViewport({ width: 1920, height: 1080 });
  await page.evaluateOnNewDocument(() => { Object.defineProperty(navigator, 'platform', { get: () => 'MacIntel', configurable: true }); });
  await page.evaluateOnNewDocument(() => { if (typeof window.process === 'undefined') window.process = { env: { NODE_ENV: 'production' }, browser: true, version: '', versions: {} }; });
  await page.evaluateOnNewDocument((code) => { try { eval(code); } catch { /* SDK tự báo lỗi khi ký */ } }, sdkSource);
  try {
    await page.goto('https://www.tiktok.com/@zara', { waitUntil: 'domcontentloaded', timeout: 60000 });
  } catch (e) {
    log && log('[sign-local] Điều hướng trang TikTok lỗi (' + String(e.message || e).slice(0, 90) + ') — vẫn thử kiểm tra SDK…');
  }
  let ready = false;
  for (let i = 0; i < 24 && !ready; i++) {
    ready = await page.evaluate(() => {
      const n = window.__sdkN;
      if (!n) return false;
      const t = (n.u && n.u[995] && n.u[995].v) ? n.u : (n.B && n.B.o) ? n.B.o : n.o;
      return !!(t && typeof t[995].v === 'function');
    }).catch(() => false);
    if (!ready) await new Promise((r) => setTimeout(r, 500));
  }
  if (!ready) {
    try { await browser.close(); } catch { /* bỏ qua */ }
    if (proxy && proxy.srv) proxy.srv.close();
    throw new LocalSignBrowserError('SDK ký của TikTok không khởi tạo được trong Chrome (không thấy bảng module ký). Có thể TikTok đã đổi bản SDK — cần cập nhật file sign/webmssdk_*.js.');
  }
  log && log('[sign-local] Phiên ký sẵn sàng (Chrome: ' + path.basename(chromePath) + ').');
  return { browser, page, proxy };
}

function getSession(log) {
  if (!sessionPromise) {
    sessionPromise = buildSession(log).catch((e) => { sessionPromise = null; throw e; });
  }
  return sessionPromise;
}

async function resetSession() {
  const p = sessionPromise; sessionPromise = null;
  if (p) { try { const s = await p; await s.browser.close(); if (s.proxy && s.proxy.srv) s.proxy.srv.close(); } catch { /* bỏ qua */ } }
}

/* ------------------- Kho cookie/msToken cổ điển ------------------- */
const jar = {}; // name -> value (chỉ trong bộ nhớ, không log giá trị)
let jarAt = 0;
function grabSetCookies(res) {
  try {
    const sc = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : [];
    for (const c of sc) { const [pair] = c.split(';'); const i = pair.indexOf('='); if (i > 0) jar[pair.slice(0, i).trim()] = pair.slice(i + 1).trim(); }
  } catch { /* bỏ qua */ }
}
async function refreshJar(roomId) {
  if (jar.msToken && Date.now() - jarAt < 5 * 60 * 1000) return;
  try {
    const r1 = await fetch('https://webcast.tiktok.com/webcast/im/fetch/?aid=1988&app_name=tiktok_web&room_id=' + encodeURIComponent(roomId || '0'), { headers: { 'User-Agent': SIGN_UA, 'Referer': 'https://www.tiktok.com/' } });
    grabSetCookies(r1); await r1.arrayBuffer().catch(() => {});
    const r2 = await fetch('https://www.tiktok.com/', { headers: { 'User-Agent': SIGN_UA } });
    grabSetCookies(r2); await r2.arrayBuffer().catch(() => {});
    jarAt = Date.now();
  } catch { /* mạng lỗi thì ký tiếp bằng jar cũ */ }
  try {
    const s = await getSession(null);
    const cks = await s.page.cookies();
    for (const c of cks) if (!jar[c.name]) jar[c.name] = c.value;
  } catch { /* bỏ qua */ }
}
function cookieHeader() {
  return Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; ');
}

/* ------------------------- Ký một URL ------------------------- */
let signChain = Promise.resolve();
function withSignLock(fn) {
  const run = signChain.then(fn, fn);
  signChain = run.catch(() => {});
  return run;
}

/* Ký bằng SDK trong phiên ký cổ điển. opts:
   - ua: UA dùng cho X-Gnarly (mặc định SIGN_UA).
   - fp: bộ fingerprint ghi đè các param fingerprint CÓ trong URL.
   - msToken: nếu truyền, đặt param msToken trước khi ký.
   - counters: nếu truyền, dùng cho X-Gnarly thay vì đọc __cap3
     của phiên ký (chiến lược B dùng bộ đếm THẬT đo từ phiên ấm). */
async function signUrlWith(unsignedUrl, log, opts = {}) {
  const ua = opts.ua || SIGN_UA;
  const fp = opts.fp || FP;
  return withSignLock(async () => {
    const u = new URL(unsignedUrl);
    for (const [k, v] of Object.entries(fp)) if (u.searchParams.has(k)) u.searchParams.set(k, v);
    if (opts.msToken) u.searchParams.set('msToken', opts.msToken);
    const queryString = u.search.slice(1);
    const s = await getSession(log);
    const out = await s.page.evaluate((qs, extCounters) => {
      const n = window.__sdkN;
      if (!n) return { error: 'SDK chưa sẵn sàng' };
      const t = (n.u && n.u[995] && n.u[995].v) ? n.u : (n.B && n.B.o) ? n.B.o : n.o;
      if (!t || typeof t[995].v !== 'function') return { error: 'Không thấy hàm ký trong SDK' };
      let xb;
      try { xb = t[995].v.call(window.byted_acrawler || null, qs, ''); } catch (e) { return { error: 'Hàm ký lỗi: ' + String(e).slice(0, 100) }; }
      let counters = extCounters || null;
      if (!counters) {
        counters = { totalXHRRequests: 60, totalFetchRequests: 43, interceptedXHRRequests: 10, interceptedFetchRequests: 6 };
        try {
          const cap = window.__cap3 || [];
          const last = [...cap].reverse().find((c) => c.fn === 'gnarly_x' && c.args && c.args[3] && c.args[3].v);
          if (last) { const v = last.args[3].v; counters = { totalXHRRequests: (v.totalXHRRequests || {}).v || 0, totalFetchRequests: (v.totalFetchRequests || {}).v || 0, interceptedXHRRequests: (v.interceptedXHRRequests || {}).v || 0, interceptedFetchRequests: (v.interceptedFetchRequests || {}).v || 0 }; }
        } catch { /* dùng counters mặc định */ }
      }
      return { xBogus: xb, counters };
    }, queryString, opts.counters || null).catch((e) => ({ error: 'evaluate lỗi: ' + String(e.message || e).slice(0, 100) }));
    if (!out || out.error || !out.xBogus) {
      await resetSession();
      throw new LocalSignBrowserError('Ký thất bại: ' + ((out && out.error) || 'không rõ') + ' (đã hủy phiên ký, lần gọi sau sẽ dựng lại).');
    }
    const xg = encodeXGnarly(queryString, '', ua, out.counters, { ubcode: 4, sdkVersion: '1.0.0.368' });
    u.searchParams.set('X-Bogus', out.xBogus);
    u.searchParams.set('X-Gnarly', xg);
    return u.toString();
  });
}

function signUrl(unsignedUrl, log) {
  return signUrlWith(unsignedUrl, log, {});
}

/* =====================================================================
   PHIÊN ẤM (vòng 2) — Chrome mở thật trang live của phòng đích
   ===================================================================== */
let TT = null; // tham chiếu ttlc (gán khi installLocalSignRoutes) để giải mã protobuf
let warm = null;        // state phiên ấm hiện tại
let warmPromise = null; // promise quan sát ban đầu của phiên ấm

function uaShort(ua) {
  if (!ua) return '';
  const m = String(ua).match(/(Chrome|Chromium)\/(\d+)/);
  if (m) return `${m[1]} ${m[2]}`;
  const s = String(ua).match(/Safari\/(\d+)/);
  return s ? `Safari ${s[1]}` : String(ua).slice(0, 40);
}

function snapshotWarm() {
  if (!warm) { diag.warm = null; return; }
  diag.warm = {
    username: warm.username,
    navOk: !!warm.navOk,
    navError: warm.navError || '',
    pageUrl: warm.pageUrl || '',
    hostName: warm.hostName || '',
    pageTitle: warm.pageInfo.title || '',
    pageTextLen: warm.pageInfo.textLen || 0,
    hasVideo: !!warm.pageInfo.hasVideo,
    browser: uaShort(warm.ua),
    cookieNames: [...warm.cookieMap.keys()].sort(),
    cookiesPresent: Object.fromEntries(COOKIE_WATCH.map((n) => [n, warm.cookieMap.has(n)])),
    loggedIn: warmLoggedIn(warm),
    imFetch: warm.imFetch.map((f) => ({ status: f.status, bytes: f.bytes, decoded: !!f.decoded, decodeVia: f.decodeVia || '', wasBase64: f.wasBase64, hex16: f.hex16 || '', hasCursor: !!(f.decoded && f.decoded.cursor), hasPushServer: !!(f.decoded && f.decoded.pushServer), msgs: f.decoded ? (f.decoded.messages || []).length : 0 })),
    imFetchParamNames: warm.imFetchParamNames || [],
    ws: warm.wsList.map((s) => ({ host: s.host, frames: s.frames, closed: s.closed })),
    wsTimeline: (warm.wsTimeline || []).slice(-20),
    cursorFound: !!warm.lastCursor,
    cursorSource: warm.cursorSource || '',
    counters: { ...warm.reqCounts },
    transport: warm.transport || '',
  };
}

/* ------------------------- Relay WebSocket local -------------------------
   Thư viện kết nối vào đây thay vì push server của TikTok; relay
   chuyển tiếp nguyên bản frame WS của trang ấm (hoặc frame bọc từ
   response im/fetch khi trang polling). Frame vào từ thư viện
   (im_enter_room/heartbeat/ack) được BỎ QUA — trang ấm tự lo phần đó
   trên kết nối của chính nó.
   VÒNG 3 — relay có ĐỆM: frame của trang đến TRƯỚC khi thư viện nối
   vào (đặc biệt frame đầu chứa trạng thái khởi tạo) được giữ trong
   pageFrames và PHÁT LẠI nguyên vẹn theo thứ tự ngay khi thư viện
   kết nối, rồi mới chảy trực tiếp. Mọi frame đi qua relay đều là
   Buffer nhị phân nguyên bản — không qua text ở bất kỳ chặng nào. */
const relay = { wss: null, url: '', clients: new Set(), starting: null, pageFrames: [], pageBytes: 0, navGraceUntil: 0 };
const PAGE_FRAME_CAP_COUNT = 1200;
const PAGE_FRAME_CAP_BYTES = 16 * 1024 * 1024;
export function ensureLocalRelay() {
  if (relay.wss) return Promise.resolve(relay.url);
  if (relay.starting) return relay.starting;
  relay.starting = new Promise((resolve) => {
    const wss = new WebSocketServer({ host: '127.0.0.1', port: 0 });
    wss.on('connection', (sock) => {
      relay.clients.add(sock);
      diag.relay.clients = relay.clients.size;
      sock.on('message', () => { diag.relay.rxFromLibrary++; });
      sock.on('close', () => { relay.clients.delete(sock); diag.relay.clients = relay.clients.size; });
      sock.on('error', () => { try { sock.close(); } catch { /* bỏ qua */ } });
      // Phát lại toàn bộ frame của trang đã đệm (theo thứ tự, byte-exact).
      // Vòng lặp đồng bộ: frame trực tiếp không thể chen giữa chừng.
      let replayed = 0;
      for (const f of relay.pageFrames) {
        try { sock.send(f); replayed++; } catch { break; }
      }
      if (replayed) { diag.relay.replayedFrames += replayed; diag.relay.txFrames += replayed; }
    });
    wss.on('listening', () => {
      relay.wss = wss;
      relay.url = `ws://127.0.0.1:${wss.address().port}/webcast/im/push/v2/`;
      diag.relay.started = true; diag.relay.url = relay.url;
      resolve(relay.url);
    });
  });
  return relay.starting;
}
function broadcastToRelayClients(buf) {
  let n = 0;
  for (const sock of relay.clients) {
    if (sock.readyState === 1) { try { sock.send(buf); n++; } catch { /* bỏ qua */ } }
  }
  if (n > 0) diag.relay.txFrames += n;
  return n;
}
/* Nạp MỘT frame thô của trang vào relay: đệm lại (giữ frame đầu tiên —
   chứa trạng thái khởi tạo — và các frame gần nhất) + phát cho các
   client thư viện đang nối. Trả số client đã nhận trực tiếp. */
export function ingestPageFrame(buf) {
  if (!Buffer.isBuffer(buf)) buf = Buffer.from(buf);
  if (!buf.length) return 0;
  relay.pageFrames.push(buf);
  relay.pageBytes += buf.length;
  while ((relay.pageFrames.length > PAGE_FRAME_CAP_COUNT || relay.pageBytes > PAGE_FRAME_CAP_BYTES) && relay.pageFrames.length > 1) {
    relay.pageBytes -= relay.pageFrames[1].length;
    relay.pageFrames.splice(1, 1);
  }
  diag.relay.buffered = relay.pageFrames.length;
  diag.relay.rxFrames++;
  return broadcastToRelayClients(buf);
}
/* Tên cũ giữ tương thích — nay nạp qua đường đệm. */
export function relayBroadcastFrame(buf) {
  return ingestPageFrame(buf);
}
function clearRelayBuffer() {
  relay.pageFrames = [];
  relay.pageBytes = 0;
  diag.relay.buffered = 0;
}
function relayCloseClients() {
  for (const sock of relay.clients) { try { sock.close(1000, 'warm stream ended'); } catch { /* bỏ qua */ } }
}

/* Chrome ấm: trên Mac chạy CÓ CỬA SỔ (headed) để tránh bị bóp
   timer/nền như headless (vòng 2: WS của trang chỉ có 1 frame trong
   cửa sổ ấm headless); máy không màn hình (VM Linux) giữ headless.
   Ghi đè bằng SIGN_WARM_HEADED=1 / SIGN_WARM_HEADLESS=1. */
function warmHeadless() {
  if (process.env.SIGN_WARM_HEADLESS === '1') return true;
  if (process.env.SIGN_WARM_HEADED === '1') return false;
  return process.platform !== 'darwin';
}
function totalWsFrames(w) {
  return w.wsList.reduce((a, s) => a + s.frames, 0);
}

/* ------------------------- Dựng phiên ấm ------------------------- */
/* VÒNG 4 — trạng thái đăng nhập TikTok của phiên ấm: chỉ xét TÊN
   cookie — cookieMap có 'sessionid' hoặc 'sessionid_ss' hay không.
   TUYỆT ĐỐI không đọc/in giá trị cookie ở đây hay bất cứ đâu trong
   log. Chỉ ghi log khi trạng thái THAY ĐỔI để khỏi spam Terminal. */
function warmLoggedIn(w) {
  return !!(w && (w.cookieMap.has('sessionid') || w.cookieMap.has('sessionid_ss')));
}
function noteLoginState(w, log) {
  if (!w || !log) return;
  const li = warmLoggedIn(w);
  if (w.loginState === li) return;
  w.loginState = li;
  if (li) {
    log('[sign-local][ấm] TikTok: ĐÃ đăng nhập trong Chrome ký (có cookie phiên đăng nhập) — phiên này được lưu trong thư mục sign-profile, các lần chạy sau tự nhớ, không cần đăng nhập lại.');
  } else {
    log('[sign-local][ấm] TikTok: CHƯA đăng nhập trong Chrome ký — hiện đang là PHIÊN KHÁCH. Hãy đăng nhập TikTok trong cửa sổ Chrome vừa mở (1 lần duy nhất, những lần sau tự nhớ): phiên khách ở phòng nhỏ/mới có thể bị TikTok giới hạn dữ liệu (đã gặp: chat không chảy về game).');
  }
}
function stopWarmTimers(w) {
  if (w && w.frameTelTimer) { clearInterval(w.frameTelTimer); w.frameTelTimer = null; }
  if (w && w.identityTimer) { clearTimeout(w.identityTimer); w.identityTimer = null; }
}

async function harvestWarmCookies(w) {
  try {
    let cookies = [];
    try { const r = await w.cdp.send('Storage.getCookies'); cookies = r.cookies || []; }
    catch { const r = await w.cdp.send('Network.getAllCookies'); cookies = r.cookies || []; }
    for (const c of cookies) {
      if (c && c.name && /tiktok\.com$/.test(c.domain || '')) w.cookieMap.set(c.name, c.value);
    }
  } catch { /* bỏ qua */ }
  try {
    const cks = await w.page.cookies();
    for (const c of cks) if (!w.cookieMap.has(c.name)) w.cookieMap.set(c.name, c.value);
  } catch { /* bỏ qua */ }
}

function noteDecodedFetchResult(w, decoded, source) {
  if (!decoded) return;
  /* Chốt chặn khả tín: protobufjs giải mã "khoan dung" — một buffer
     KHÔNG phải fetchResult (vd WebcastPushFrame) vẫn có thể bị đọc
     chéo thành object rác có cursor="0". Cursor thật của TikTok có
     dạng "d-1_u-1_h-1_t-…" (dài), pushServer là URL wss/https —
     chỉ nhận các giá trị đúng hình dạng đó. */
  const cur = decoded.cursor ? String(decoded.cursor) : '';
  if (cur.length >= 4) { w.lastCursor = cur; if (source) w.cursorSource = source; }
  if (decoded.internalExt && String(decoded.internalExt).length >= 4) w.lastInternalExt = String(decoded.internalExt);
  if (decoded.pushServer && /^(wss?|https?):\/\//.test(String(decoded.pushServer))) w.lastPushServer = String(decoded.pushServer);
}

/* Đọc body response qua CDP thành Buffer byte-exact: base64 → giải
   thẳng; chuỗi thường → 'latin1' (CDP giao body nhị phân dạng chuỗi
   ký-tự-theo-byte; đọc 'utf8' sẽ phá mọi byte ≥ 0x80). Export để
   kiểm chứng độc lập được đường vận chuyển này. */
export function bufferFromCdpBody(body) {
  if (!body || typeof body.body !== 'string') return Buffer.alloc(0);
  return body.base64Encoded ? Buffer.from(body.body, 'base64') : Buffer.from(body.body, 'latin1');
}

/* ---------------- Giải mã fetchResult đa dạng (vòng 3) ----------------
   Body im/fetch của phiên khách (27 byte ở vòng 2) KHÔNG chắc là
   ProtoMessageFetchResult thô — giải mã thẳng từng ném "premature
   EOF". Thử lần lượt: (1) fetchResult thô; (2) gzip → fetchResult;
   (3) WebcastPushFrame → payload của nó (deserializeWebSocketMessage
   tự xử lý gunzip + trích protoMessageFetchResult). Trả {decoded, via}
   hoặc null. Mọi đầu vào đều là Buffer nhị phân nguyên bản. */
function tryDecodeFetchResultSync(buf) {
  if (!buf || !buf.length || !TT) return null;
  try {
    const d = TT.deserializeMessage('ProtoMessageFetchResult', buf);
    if (d) return { decoded: d, via: 'fetchResult' };
  } catch { /* thử dạng khác */ }
  if (buf.length > 2 && buf[0] === 0x1f && buf[1] === 0x8b) {
    try {
      const d = TT.deserializeMessage('ProtoMessageFetchResult', zlib.gunzipSync(buf));
      if (d) return { decoded: d, via: 'gzip+fetchResult' };
    } catch { /* thử dạng khác */ }
  }
  return null;
}
/* Giải mã một FRAME WebSocket: frame theo định nghĩa là
   WebcastPushFrame bọc fetchResult — đi thẳng đường chuyên dụng,
   KHÔNG thử decode trực tiếp (tránh đọc chéo rác như đã nói ở
   noteDecodedFetchResult). */
export async function decodePushFrameFetchResult(buf) {
  if (!buf || !buf.length || !TT || typeof TT.deserializeWebSocketMessage !== 'function') return null;
  try {
    const cont = await TT.deserializeWebSocketMessage(buf);
    if (cont && cont.protoMessageFetchResult) return { decoded: cont.protoMessageFetchResult, via: 'pushFrame' };
  } catch { /* không phải push frame hợp lệ */ }
  return null;
}
function fetchResultUseful(d) {
  if (!d) return false;
  if (d.pushServer) return true;
  if (d.cursor && String(d.cursor).length >= 4) return true;
  if (Array.isArray(d.messages) && d.messages.some((m) => m && typeof m.method === 'string' && m.method.length > 0)) return true;
  return false;
}
export async function tryDecodeFetchResult(buf) {
  const s = tryDecodeFetchResultSync(buf);
  if (s && fetchResultUseful(s.decoded)) return s;
  // Bản sync có thể là fetchResult rỗng hợp lệ (kênh polling) HOẶC rác
  // đọc chéo từ push frame — thử đường push frame trước khi kết luận.
  const pf = await decodePushFrameFetchResult(buf);
  if (pf) return pf;
  return s;
}

async function buildWarmSession(username, log) {
  const w = {
    username, roomId: '', browser: null, page: null, cdp: null, proxy: null,
    navOk: false, navError: '', pageInfo: {}, ua: '', fp: null,
    cookieMap: new Map(), imFetch: [], imFetchParamNames: [], wsList: [], wsTimeline: [],
    reqCounts: { totalXHRRequests: 0, totalFetchRequests: 0, interceptedXHRRequests: 0, interceptedFetchRequests: 0 },
    lastCursor: '', lastInternalExt: '', lastPushServer: '', cursorSource: '',
    transport: '', pollRelay: false, dead: false, startedAt: Date.now(),
    loginState: undefined, frameTelTimer: null,
    pageUrl: '', hostName: '', navInFlight: false, lastForcedNavAt: 0, identityTimer: null,
  };
  warm = w;
  const chromePath = resolveChromePath();
  const proxy = await startProxyForwarder();
  w.proxy = proxy;
  /* VÒNG 4: Chrome ấm chạy với hồ sơ BỀN sign-profile/ (tạo thư mục
     nếu chưa có) — user đăng nhập TikTok 1 lần trong cửa sổ này là
     các lần sau tự nhớ. Nếu hồ sơ đang bị một Chrome khác chiếm
     (SingletonLock — thường do cửa sổ Chrome ký của lần chạy trước
     còn mở), lần mở này sẽ lỗi: báo rõ cách xử lý rồi ném lỗi ra
     ngoài cho prepareWarmSession ghi nhận, KHÔNG lùi về hồ sơ tạm
     (lùi lặng lẽ sẽ làm mất phiên đăng nhập mà không ai biết). */
  try { fs.mkdirSync(SIGN_PROFILE_DIR, { recursive: true }); } catch { /* bỏ qua */ }
  let browser;
  try {
    browser = await puppeteer.launch({
      executablePath: chromePath, headless: warmHeadless(), userDataDir: SIGN_PROFILE_DIR,
      acceptInsecureCerts: !!proxy,
      args: chromeArgs(proxy, 1280, 900),
    });
  } catch (e) {
    const m = String((e && e.message) || e);
    if (/already running|processsingleton|singleton|user data|profile/i.test(m)) {
      log && log('[sign-local][ấm] ⚠️ Không mở được Chrome ký: hồ sơ sign-profile đang bị MỘT cửa sổ Chrome khác chiếm giữ (thường là cửa sổ Chrome ký của lần chạy trước còn mở). Hãy đóng hẳn cửa sổ Chrome đó rồi chạy lại server.');
    }
    throw e;
  }
  w.browser = browser;
  log && log('[sign-local][ấm] Chrome ký dùng hồ sơ bền: ' + SIGN_PROFILE_DIR);
  /* VÒNG 4 — đo xa frame WS mỗi 60 giây: tổng frame đã nhận tách
     theo loại socket, để nhìn Terminal là biết luồng của trang đang
     chảy hay đang bị bóp. Tự hủy khi phiên ấm bị thay/đóng. */
  w.frameTelTimer = setInterval(() => {
    if (warm !== w || w.dead) { stopWarmTimers(w); return; }
    let im = 0, wc = 0, other = 0;
    for (const s of w.wsList) {
      if (/im-ws/.test(s.host)) im += s.frames;
      else if (/webcast-ws/.test(s.host)) wc += s.frames;
      else other += s.frames;
    }
    log && log(`[sign-local][ấm] Tổng frame WS đã nhận: im-ws-sg=${im}, webcast-ws=${wc}, socket khác=${other}`);
  }, 60000);
  if (w.frameTelTimer.unref) w.frameTelTimer.unref();
  browser.on('disconnected', () => { w.dead = true; });
  const page = await browser.newPage();
  w.page = page;
  await page.setViewport({ width: 1280, height: 900 });
  const cdp = await page.createCDPSession();
  w.cdp = cdp;
  await cdp.send('Network.enable', { maxResourceBufferSize: 50 * 1024 * 1024, maxTotalBufferSize: 200 * 1024 * 1024 });

  const reqUrlById = new Map();
  const reqTypeById = new Map();
  cdp.on('Network.requestWillBeSent', (e) => {
    const u = (e.request && e.request.url) || '';
    reqUrlById.set(e.requestId, u);
    reqTypeById.set(e.requestId, e.type || '');
    const isWebcast = /webcast\.tiktok\.com/.test(u);
    if (e.type === 'XHR') { w.reqCounts.totalXHRRequests++; if (isWebcast) w.reqCounts.interceptedXHRRequests++; }
    else if (e.type === 'Fetch') { w.reqCounts.totalFetchRequests++; if (isWebcast) w.reqCounts.interceptedFetchRequests++; }
    if (/\/webcast\/im\/fetch/.test(u) && !w.imFetchParamNames.length) {
      try { w.imFetchParamNames = [...new URL(u).searchParams.keys()]; } catch { /* bỏ qua */ }
    }
  });
  cdp.on('Network.responseReceived', (e) => {
    const u = (e.response && e.response.url) || '';
    if (/\/webcast\/im\/fetch/.test(u)) {
      w.pendingImFetch = w.pendingImFetch || {};
      w.pendingImFetch[e.requestId] = e.response.status;
    }
  });
  cdp.on('Network.loadingFinished', async (e) => {
    const u = reqUrlById.get(e.requestId) || '';
    if (!/\/webcast\/im\/fetch/.test(u)) return;
    const item = { at: Date.now(), status: (w.pendingImFetch || {})[e.requestId] || 0, bytes: 0, buf: null, decoded: null, decodeVia: '', wasBase64: null, hex16: '' };
    try {
      const body = await cdp.send('Network.getResponseBody', { requestId: e.requestId });
      item.wasBase64 = !!body.base64Encoded;
      /* VẬN CHUYỂN NHỊ PHÂN (vòng 3, siết lại ở vòng 5): base64 → giải
         thẳng. Không base64 → CDP đưa body dạng chuỗi ký tự-theo-byte:
         PHẢI đọc 'latin1' để giữ byte 1:1. Đọc 'utf8' (vòng 2) sẽ nới
         mọi byte ≥ 0x80 thành 2 byte → protobuf hỏng → "premature EOF".
         VÒNG 5 — BỎ nhánh "bản latin1 không giải mã được thì thay buf
         bằng biến thể utf8" của vòng 3: biến thể utf8 là bản ĐÃ HỎNG
         (test-text-integrity.mjs chứng minh 98B gốc → 110B), mà giải
         mã protobuf vốn "khoan dung" — nó có thể đọc chéo ra một kết
         quả trông-dùng-được từ byte hỏng, khiến buf bị thay bằng byte
         hỏng rồi chảy tiếp vào relay (poll) và vào trích xuất cursor.
         Từ nay buf LUÔN là body byte-exact; giải mã chỉ thử trên
         chính byte đó — không giải mã được thì ghi nhận "chưa giải mã
         được" và vẫn relay byte nguyên vẹn cho thư viện tự xử lý. */
      let buf = bufferFromCdpBody(body);
      let dec = buf.length ? await tryDecodeFetchResult(buf) : null;
      item.buf = buf; item.bytes = buf.length;
      item.hex16 = buf.subarray(0, 16).toString('hex');
      if (dec) {
        item.decoded = dec.decoded; item.decodeVia = dec.via;
        noteDecodedFetchResult(w, dec.decoded, 'im/fetch của trang');
      }
      // Ghi hex + base64 của body NHỎ vào log (= hidden-test-sign.log ở
      // đường test) để nhận diện nó là gì (27 byte ở vòng 2 là ẩn số).
      if (log && buf.length > 0 && buf.length <= 2048) {
        log(`[sign-local][ấm] Body im/fetch của trang: ${buf.length}B, hex đầu ${item.hex16}, base64: ${buf.toString('base64')}`);
      }
    } catch (err) { item.error = String(err.message || err).slice(0, 100); }
    w.imFetch.push(item);
    log && log(`[sign-local][ấm] Trang tự gọi im/fetch: HTTP ${item.status}, ${item.bytes} byte${item.decoded ? ' (giải mã OK qua ' + item.decodeVia + ', ' + ((item.decoded.messages || []).length) + ' tin)' : ' (chưa giải mã được thành fetchResult)'}.`);
    /* VÒNG 4 — relay nạp MỌI body im/fetch của trang, không còn chờ
       điều kiện pollRelay (chỉ bật khi trang polling thuần) như vòng
       2/3: ở phòng nhỏ/mới mà phiên khách bị TikTok cho ăn kiêng dữ
       liệu, body im/fetch có thể mang tin nhắn mà kênh WS không có —
       và sau sự cố 02/11 (chat = 0 suốt 9,5 phút) thì kênh nào còn
       dữ liệu cũng phải dùng. Đánh đổi đã cân nhắc: cùng một tin vừa
       đi qua WS vừa nằm trong body im/fetch thì thư viện có thể nhận
       TRÙNG — phía game chịu được (mọi comment đều chạy qua đường
       vào hồ: đã có ghế thì no-op; "GIẬT" trùng sau khi cá đã vào
       trạng thái kéo thì vô hại; quà streak đã được server.js lọc
       bằng repeatEnd). Giữ nguyên cơ chế bọc frame + vận chuyển
       byte-exact của vòng 2/3. */
    if (item.buf && item.buf.length && TT) {
      try {
        const frame = TT.createBaseWebcastPushFrame({ payloadType: 'msg', payloadEncoding: 'pb', payload: item.buf });
        ingestPageFrame(Buffer.from(frame.finish()));
      } catch { /* bỏ qua */ }
    }
    snapshotWarm();
  });
  cdp.on('Network.webSocketCreated', (e) => {
    let host = '';
    try { host = new URL(e.url).host; } catch { /* bỏ qua */ }
    const s = { id: e.requestId, url: e.url, host, frames: 0, closed: false };
    try {
      const q = new URL(e.url).searchParams;
      if (q.get('cursor') && !w.lastCursor) { w.lastCursor = q.get('cursor'); w.cursorSource = 'URL WebSocket của trang'; }
      if (q.get('internal_ext') && !w.lastInternalExt) w.lastInternalExt = q.get('internal_ext');
    } catch { /* bỏ qua */ }
    w.wsList.push(s);
    log && log(`[sign-local][ấm] Trang mở WebSocket push tới ${host}.`);
    snapshotWarm();
  });
  cdp.on('Network.webSocketFrameReceived', (e) => {
    const s = w.wsList.find((x) => x.id === e.requestId);
    const p = (e.response && e.response.payloadData) || '';
    if (!p) return;
    let buf;
    if (e.response.opcode === 2) buf = Buffer.from(p, 'base64');
    else if (e.response.opcode === 1) buf = Buffer.from(p, 'utf8');
    else return;
    if (s) s.frames++;
    ingestPageFrame(buf);
    if (TT && (!w.lastCursor || !w.lastInternalExt)) {
      // Giải mã thử vài frame đầu để lấy cursor/internalExt thật của trang
      decodePushFrameFetchResult(buf).then((r) => {
        if (r && r.decoded) noteDecodedFetchResult(w, r.decoded, 'frame WS của trang (' + r.via + ')');
      }).catch(() => {});
    }
  });
  cdp.on('Network.webSocketClosed', (e) => {
    const s = w.wsList.find((x) => x.id === e.requestId);
    if (s) s.closed = true;
    log && log('[sign-local][ấm] WebSocket của trang đã đóng.');
    snapshotWarm();
    const anyOpen = w.wsList.some((x) => !x.closed);
    if (!anyOpen && relay.clients.size) {
      /* VÒNG 6 — CỬA SỔ ÂN HẠN SAU ÉP ĐIỀU HƯỚNG: forceWarmEnterRoom
         (xem dưới) điều hướng trang vào đúng phòng ở mỗi lần bám —
         điều hướng ĐÓNG mọi WS hiện tại của trang là hệ quả đã biết
         trước, trang sẽ mở WS mới của phiên phòng hiện tại ngay sau
         đó. Nếu handler này ngắt client thư viện (vừa nối vào relay)
         chỉ vì WS cũ đóng, lần bám sẽ tự phá chính nó. Vì vậy: còn
         trong cửa sổ ân hạn (relay.navGraceUntil, ~25s kể từ lúc bắt
         đầu điều hướng) thì HOÃN quyết định đóng tới khi ân hạn hết;
         hết ân hạn mà vẫn không có WS nào mở mới đóng như cũ. */
      const checkClose = () => {
        if (warm !== w) return;
        if (w.wsList.some((x) => !x.closed)) return;
        const remain = (relay.navGraceUntil || 0) - Date.now();
        if (remain > 0) { setTimeout(checkClose, remain + 1000); return; }
        relayCloseClients();
      };
      setTimeout(checkClose, 6000);
    }
  });
  cdp.on('Network.loadingFailed', (e) => {
    const u = reqUrlById.get(e.requestId) || '';
    if (/tiktok\.com/.test(u) && !w.navError && /ERR_/.test(e.errorText || '')) {
      w.navError = e.errorText + ' @ ' + u.slice(0, 80);
    }
  });

  const liveUrl = `https://www.tiktok.com/@${username}/live`;
  log && log(`[sign-local][ấm] Đang mở trang live thật @${username} để làm ấm phiên…`);
  try {
    await page.goto(liveUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });
    w.navOk = true;
  } catch (e) {
    w.navError = w.navError || String(e.message || e).slice(0, 140);
    log && log('[sign-local][ấm] Điều hướng trang live lỗi: ' + w.navError);
  }
  /* VÒNG 3 — Quan sát tối đa ~45s, đo đếm theo thời gian. KHÔNG dừng
     vì im/fetch nữa: kênh polling của phiên khách gần như rỗng (trang
     thật cũng chỉ nhận 27 byte — việc có body im/fetch KHÔNG nói lên
     luồng đã sẵn sàng). Chỉ dừng sớm khi WS của trang đã chảy ≥5
     frame, hoặc trang chết hẳn (mọi WS đóng / điều hướng lỗi nặng). */
  const deadline = Date.now() + 45000;
  while (Date.now() < deadline) {
    try {
      w.pageInfo = await page.evaluate(() => ({
        title: document.title || '',
        textLen: (document.body && document.body.innerText || '').length,
        hasVideo: !!document.querySelector('video'),
        ua: navigator.userAgent || '',
        platform: navigator.platform || '',
        language: navigator.language || '',
        sw: (window.screen && screen.width) || 0,
        sh: (window.screen && screen.height) || 0,
      }));
      if (w.pageInfo.ua) {
        w.ua = w.pageInfo.ua;
        w.fp = {
          browser_platform: w.pageInfo.platform || 'MacIntel',
          browser_language: w.pageInfo.language || 'en-US',
          browser_version: w.ua,
          browser_name: /Chrome/.test(w.ua) ? 'Chrome' : 'Safari',
          os: /Mac/.test(w.pageInfo.platform || '') ? 'mac' : 'windows',
          screen_width: String(w.pageInfo.sw || 1920),
          screen_height: String(w.pageInfo.sh || 1080),
        };
      }
    } catch { /* trang đang chuyển hướng */ }
    await harvestWarmCookies(w);
    noteLoginState(w, log);
    w.wsTimeline.push({ t: Math.round((Date.now() - w.startedAt) / 1000), frames: totalWsFrames(w) });
    snapshotWarm();
    if (totalWsFrames(w) >= 5) break;
    const elapsed = Date.now() - w.startedAt;
    const wsAllClosed = w.wsList.length > 0 && w.wsList.every((s) => s.closed);
    if (wsAllClosed && elapsed > 15000) break;
    if (w.navError && /ERR_/.test(w.navError) && elapsed > 12000) break;
    await new Promise((r) => setTimeout(r, 3000));
  }
  w.wsTimeline.push({ t: Math.round((Date.now() - w.startedAt) / 1000), frames: totalWsFrames(w) });
  await harvestWarmCookies(w);
  noteLoginState(w, log);
  snapshotWarm();
  log && log(`[sign-local][ấm] Phiên ấm @${username}: cookie=${w.cookieMap.size} tên, im/fetch=${w.imFetch.length} lần, WS=${w.wsList.length} (${totalWsFrames(w)} frame), trang ${w.navOk ? 'mở OK' : 'mở lỗi'}.`);
  return w;
}

/* Gọi từ server.js / test TRƯỚC khi connect (biết username). Không
   chặn lâu: trả promise; route sẽ chờ nốt phần còn thiếu. */
export function prepareWarmSession(username, log) {
  username = String(username || '').replace(/^@/, '').trim();
  if (!username) return Promise.resolve(null);
  if (warm && warm.username === username && !warm.dead && warmPromise) return warmPromise;
  if (warm) { // đổi phòng → đóng phiên ấm cũ
    const old = warm; warm = null; warmPromise = null;
    old.dead = true;
    stopWarmTimers(old);
    clearRelayBuffer(); // frame của phòng cũ không được chảy sang phòng mới
    diag.initCursor = null;
    if (old.browser) old.browser.close().catch(() => {});
    if (old.proxy && old.proxy.srv) old.proxy.srv.close();
  }
  diag.strategies = diag.strategies.filter((s) => s.name === 'D-cổ-điển' || s.name === 'ký-phụ');
  warmPromise = buildWarmSession(username, log).catch((e) => {
    log && log('[sign-local][ấm] Dựng phiên ấm lỗi: ' + String(e.message || e).slice(0, 160));
    if (warm) { warm.dead = true; warm.navError = warm.navError || String(e.message || e).slice(0, 140); snapshotWarm(); }
    return warm;
  });
  return warmPromise;
}

export async function closeWarmSession() {
  const w = warm; warm = null; warmPromise = null;
  relayCloseClients();
  clearRelayBuffer();
  if (w) {
    w.dead = true;
    stopWarmTimers(w);
    try { if (w.browser) await w.browser.close(); } catch { /* bỏ qua */ }
    if (w.proxy && w.proxy.srv) w.proxy.srv.close();
  }
}

/* ---------------- VÒNG 6 — Ép vào đúng phòng + định danh phòng ----------------
   Bối cảnh (buổi live thật 02/11 22:11): server in "ĐÃ BÁM PHÒNG"
   với roomId hẳn hoi và relay chuyển về những mẩu chat sạch, đọc
   được — nhưng user khẳng định phòng của mình không có ai xem hay
   comment ngoài chính mình, và 3 cái tên trong mẫu 🔤 không hề có
   trong panel chat của LIVE Studio lẫn panel web. Giả thuyết dẫn
   đầu: phiên ấm được dựng từ lúc server khởi động — thường là TRƯỚC
   khi user lên live (user hay khởi động lại server giữa các buổi);
   trang /@user/live của một người CHƯA live có thể bị TikTok đẩy
   trôi sang một live ĐỀ XUẤT đang phát, và relay — vốn chuyển tiếp
   trung thực 100% những gì trang nhận — chuyển luôn sự kiện của
   PHÒNG LẠ đó vào game mà không ai hay. Giả thuyết này chỉ phòng
   thật mới kết luận được; vòng 6 không cần nó đúng mới có ích:
   vòng 6 làm cho việc LẪN PHÒNG không thể xảy ra lặng lẽ nữa bằng
   hai lớp dưới đây. Điểm móc: awaitWarmForRoute — hàm mà provider
   (chiến lược C và cả A/A2/B) gọi ở ĐẦU mỗi lần connect, tức là
   lần bám đầu tiên VÀ mọi lần bám lại sau streamEnd/rớt kết nối
   đều đi qua đây (phiên phòng thay đổi theo từng buổi live nên
   phải vào lại mỗi lần, không chỉ lần đầu). */

const RELAY_NAV_GRACE_MS = 25000;    // cửa sổ ân hạn cho client thư viện sau một lần ép điều hướng
const FORCED_NAV_COOLDOWN_MS = 5000; // chống điều hướng dồn dập khi provider bị gọi lại ngay lập tức

/* Ép trang ấm điều hướng TƯƠI vào https://www.tiktok.com/@<user>/live.
   - Kể cả trang đang ở đúng URL đó vẫn điều hướng lại: chỉ điều
     hướng mới bảo đảm trang bước vào ĐÚNG PHIÊN PHÒNG HIỆN TẠI
     (phòng cũ đã tắt / trang đang trôi ở phòng đề xuất đều bị kéo
     về). Lỗi điều hướng (mạng, trang chết) chỉ ghi log rồi BỎ QUA —
     không bao giờ ném lỗi ra đường connect, không lặp chặt.
   - Chống chồng: đang có một điều hướng dở (navInFlight) hoặc vừa
     ép xong <5s thì bỏ qua lần này.
   - TRƯỚC khi điều hướng: mở cửa sổ ân hạn relay 25s (điều hướng sẽ
     đóng mọi WS của trang — handler webSocketClosed không được vì
     thế mà ngắt client thư viện) và XOÁ trạng thái của phiên phòng
     cũ (đệm frame relay, danh sách im/fetch, cursor đã trích): các
     thứ đó thuộc phiên phòng TRƯỚC — hoặc tệ hơn, thuộc một phòng
     lạ — và không được phép chảy sang lần bám này. Đây là cùng kỷ
     luật "đổi phòng thì xoá đệm" của prepareWarmSession, áp ở tầng
     PHIÊN PHÒNG thay vì tầng phiên ấm. */
async function forceWarmEnterRoom(w, log) {
  if (!w || w.dead || !w.page) return false;
  if (w.navInFlight) return false;
  if (Date.now() - (w.lastForcedNavAt || 0) < FORCED_NAV_COOLDOWN_MS) return false;
  w.navInFlight = true;
  w.lastForcedNavAt = Date.now();
  relay.navGraceUntil = Date.now() + RELAY_NAV_GRACE_MS;
  clearRelayBuffer();
  w.imFetch = [];
  w.wsList = [];
  w.lastCursor = ''; w.lastInternalExt = ''; w.lastPushServer = ''; w.cursorSource = '';
  diag.initCursor = null;
  const liveUrl = `https://www.tiktok.com/@${w.username}/live`;
  log && log(`[sign-local][ấm] Ép trang vào đúng phòng: điều hướng tới ${liveUrl} (mỗi lần bám phòng đều vào lại từ đầu để chắc chắn đúng phiên live hiện tại; trạng thái của phiên phòng cũ đã xoá).`);
  let navErr = '';
  try {
    await w.page.goto(liveUrl, { waitUntil: 'domcontentloaded', timeout: 20000 });
    w.navOk = true;
  } catch (e) {
    navErr = String(e.message || e).slice(0, 140);
    if (!w.navError) w.navError = navErr;
    log && log('[sign-local][ấm] Điều hướng ép vào phòng lỗi (bỏ qua, lần bám vẫn tiếp tục): ' + navErr);
  }
  w.navInFlight = false;
  scheduleWarmIdentityLog(w, log);
  return !navErr;
}

/* ĐỊNH DANH PHÒNG: ~5s sau khi điều hướng lắng xuống, đọc từ chính
   trang: URL cuối (sau mọi chuyển hướng TikTok tự làm), tiêu đề
   trang, và — best-effort — tên chủ phòng HIỂN THỊ gần đầu trang
   live (thử vài selector quen thuộc + neo hồ sơ /@... đầu tiên có
   chữ; DOM TikTok thay đổi thường xuyên nên không thấy thì BỎ QUA
   trường này, tuyệt đối không ném lỗi). Chạy tách rời (không await
   ở đường provider) để không làm chậm lần bám; kết quả vừa in log
   vừa lưu vào snapshot (pageUrl/hostName) cho khối chẩn đoán. URL
   cuối không chứa /@<user>/live → cảnh báo ⚠️ nổi bật: đó là dấu
   hiệu trang đang ở phòng khác với phòng server tưởng mình bám. */
function scheduleWarmIdentityLog(w, log) {
  if (!log) return;
  if (w.identityTimer) { clearTimeout(w.identityTimer); w.identityTimer = null; }
  const username = w.username;
  w.identityTimer = setTimeout(async () => {
    w.identityTimer = null;
    if (warm !== w || w.dead || !w.page) return;
    let href = '', title = '', host = '';
    try {
      const info = await w.page.evaluate(() => {
        const out = { href: location.href || '', title: document.title || '', host: '' };
        try {
          const pick = (el) => (el && el.textContent ? el.textContent.trim().replace(/\s+/g, ' ').slice(0, 60) : '');
          const cand = [
            document.querySelector('[data-e2e="live-username"]'),
            document.querySelector('[data-e2e="live-room-info"] a[href^="/@"]'),
            document.querySelector('[data-e2e="live-room-info"]'),
          ];
          for (const el of cand) { const t = pick(el); if (t) { out.host = t; break; } }
          if (!out.host) {
            const a = [...document.querySelectorAll('a[href^="/@"]')]
              .find((x) => /^\/@[^/]+\/?$/.test(x.getAttribute('href') || '') && pick(x));
            out.host = pick(a);
          }
        } catch { /* DOM khác dự kiến — bỏ qua tên chủ phòng */ }
        return out;
      });
      href = (info && info.href) || ''; title = (info && info.title) || ''; host = (info && info.host) || '';
    } catch {
      // Trang lỗi (vd chrome-error trên VM) — evaluate không chạy
      // được thì lấy URL qua API của puppeteer, vẫn ghi được dòng
      // định danh với những gì có.
      try { href = w.page.url() || ''; } catch { /* bỏ qua */ }
    }
    w.pageUrl = href;
    w.hostName = host;
    if (title) w.pageInfo.title = title;
    snapshotWarm();
    log(`[sign-local][ấm] Trang đang ở: ${href || '(không đọc được URL)'} — tiêu đề: "${title}"` + (host ? ` — chủ phòng hiển thị: ${host}` : ''));
    if (!href.toLowerCase().includes(`/@${String(username).toLowerCase()}/live`)) {
      log(`⚠️ [sign-local] Trang ấm CHƯA vào đúng phòng @${username} (đang ở: ${href || 'không đọc được'}) — sự kiện nhận được có thể thuộc phòng khác.`);
    }
  }, 5000);
  if (w.identityTimer.unref) w.identityTimer.unref();
}

/* Route chờ phiên ấm: tối đa ~25s cho phần quan sát còn dở (làm ấm
   tối đa ~45s nhưng trạng thái w được cập nhật LIÊN TỤC trong lúc
   quan sát, nên route dùng được trạng thái dở dang) + tối đa ~10s
   nữa để trang mở WS / gọi im/fetch lần đầu. Vòng 3: relay không còn
   cần cursor/pushServer nên chỉ cần trang ĐÃ MỞ WS là đủ kích hoạt. */
async function awaitWarmForRoute(roomId, log) {
  if (!warmPromise) return null;
  await Promise.race([warmPromise, new Promise((r) => setTimeout(r, 25000))]);
  const w = warm;
  if (!w || w.dead) return null;
  if (roomId) w.roomId = String(roomId);
  /* VÒNG 6: provider được gọi = một lần connect (đầu hoặc bám lại)
     → ép trang vào đúng phiên phòng hiện tại TRƯỚC khi chờ WS /
     im/fetch đầu tiên của phiên phòng đó (việc chờ ở dưới tính trên
     trạng thái đã xoá sạch của phiên phòng cũ). */
  await forceWarmEnterRoom(w, log);
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    if (w.wsList.length > 0 || w.imFetch.length > 0) break;
    await new Promise((r) => setTimeout(r, 1000));
  }
  await harvestWarmCookies(w);
  noteLoginState(w, log);
  snapshotWarm();
  return w;
}

function warmCookiePair(w) {
  if (w && w.cookieMap.has('ttwid')) return `ttwid=${w.cookieMap.get('ttwid')}`;
  if (w && w.cookieMap.has('msToken')) return `msToken=${w.cookieMap.get('msToken')}`;
  if (jar.ttwid) return `ttwid=${jar.ttwid}`;
  if (jar.msToken) return `msToken=${jar.msToken}`;
  return '';
}
function warmCookieHeader(w) {
  return [...w.cookieMap.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
}
function warmCounters(w) {
  const c = w.reqCounts;
  if (c.totalXHRRequests + c.totalFetchRequests < 5) return null;
  return {
    totalXHRRequests: Math.max(c.totalXHRRequests, 1),
    totalFetchRequests: Math.max(c.totalFetchRequests, 1),
    interceptedXHRRequests: c.interceptedXHRRequests,
    interceptedFetchRequests: c.interceptedFetchRequests,
  };
}

/* ------------------------- Cắm route vào thư viện ------------------------- */
export function installLocalSignRoutes(ttlc, log) {
  TT = ttlc;
  const RC = ttlc.RouteConfig;
  if (!RC) throw new Error('Thư viện không có RouteConfig — bản thư viện không tương thích với máy ký local.');

  function buildParams(webClient, roomId, cursor, internalExt) {
    const params = { ...(webClient && webClient.clientParams ? webClient.clientParams : {}), room_id: String(roomId), cursor: cursor || '', internal_ext: internalExt || '' };
    if (!params.aid) params.aid = '1988';
    if (!params.app_name) params.app_name = 'tiktok_web';
    return params;
  }
  function toUrl(params, fp) {
    const p = { ...params };
    if (fp) for (const [k, v] of Object.entries(fp)) if (k in p) p[k] = v;
    return 'https://webcast.tiktok.com/webcast/im/fetch/?' + new URLSearchParams(p).toString();
  }
  async function nodeFetchImFetch(signedUrl, headers) {
    const res = await fetch(signedUrl, { headers });
    grabSetCookies(res);
    const buf = Buffer.from(await res.arrayBuffer());
    return { status: res.status, buf };
  }
  function decodeOrThrow(buf, strategyName) {
    // Đa dạng như mọi đường khác (fetchResult thô / gzip) + thông điệp
    // lỗi phân biệt "không giải mã được" với "giải mã được nhưng rỗng".
    const r = tryDecodeFetchResultSync(buf);
    if (!r || !r.decoded) throw new Error(strategyName + ': body không giải mã được thành ProtoMessageFetchResult');
    if (!r.decoded.pushServer) throw new Error(strategyName + ': giải mã được (' + r.via + ') nhưng thiếu pushServer — kênh polling rỗng');
    return r.decoded;
  }

  // 1) Route lấy dữ liệu mở đầu + mở WebSocket: thử C → A → A2 → B → D.
  RC.fetchSignedWebSocketFromProvider = async ({ webClient, roomId, cursor, internalExt }) => {
    diag.strategies = [];
    const baseParams = buildParams(webClient, roomId, cursor, internalExt);
    const w = await awaitWarmForRoute(roomId, log);

    /* ---- Chiến lược C (VÒNG 3): relay frame WS của chính trang ấm ----
       BỎ CỔNG CURSOR của vòng 2 (chính cổng đó làm C bị "bỏ qua" trên
       Mac trong khi trang có luồng WS thật). Điều kiện kích hoạt giờ
       chỉ là: trang ĐÃ MỞ WS (đang mở hoặc đã có frame), hoặc trang
       polling im/fetch thuần (≥2 lần, không WS). Cursor khởi tạo mà
       thư viện bắt buộc (nó ném lỗi nếu rỗng) được suy ra từ lưu
       lượng trang theo thứ tự: query URL WS của trang → giải mã
       frame WS đầu trong đệm relay → body im/fetch của trang. Không
       suy ra được thì dùng cursor TỔNG HỢP: an toàn vì giá trị này
       chỉ bị thư viện gửi vào relay local của mình (tham số WS +
       clientParams), KHÔNG bao giờ tới TikTok — trang ấm vẫn giữ
       cursor thật trên kết nối của nó. Frame của trang đến trước khi
       thư viện nối vào relay đã nằm trong đệm và sẽ được phát lại. */
    if (w) {
      const wsSeen = w.wsList.length > 0;
      const wsOpen = w.wsList.some((s) => !s.closed);
      const wsFrames = totalWsFrames(w);
      const pollingOnly = !wsSeen && w.imFetch.length >= 2;
      if (wsSeen || pollingOnly) {
        if (!w.lastCursor && relay.pageFrames.length) {
          for (const fbuf of relay.pageFrames.slice(0, 4)) {
            const r = await decodePushFrameFetchResult(fbuf);
            if (r && r.decoded && r.decoded.cursor && String(r.decoded.cursor).length >= 4) {
              w.lastCursor = String(r.decoded.cursor);
              if (r.decoded.internalExt && !w.lastInternalExt) w.lastInternalExt = String(r.decoded.internalExt);
              if (r.decoded.pushServer && !w.lastPushServer) w.lastPushServer = String(r.decoded.pushServer);
              w.cursorSource = 'frame WS đầu của trang (' + r.via + ')';
              break;
            }
          }
        }
        const realCursor = w.lastCursor || '';
        const cursor = realCursor || `relay-${String(roomId)}-${w.startedAt || Date.now()}`;
        diag.initCursor = realCursor
          ? { mode: 'real', source: w.cursorSource || 'lưu lượng của trang' }
          : { mode: 'synthetic', source: 'tổng hợp cho relay — trang giữ cursor thật' };
        await ensureLocalRelay();
        w.pollRelay = true; // vòng 4: chỉ còn là dấu ghi nhận "relay đang dùng" — việc nạp im/fetch vào relay nay vô điều kiện ở handler loadingFinished
        w.transport = pollingOnly ? 'relay-poll' : 'relay-ws';
        const cursorNote = realCursor ? `cursor THẬT từ ${w.cursorSource || 'lưu lượng trang'}` : 'cursor TỔNG HỢP (trang giữ cursor thật)';
        recordStrategy('C-relay-trang-ấm', {
          result: 'DÙNG',
          note: pollingOnly
            ? `trang polling im/fetch (${w.imFetch.length} lần, không WS) — relay bọc frame; ${cursorNote}`
            : `relay WS của trang: ${wsFrames} frame đã chảy, đệm ${relay.pageFrames.length} frame chờ phát lại, WS ${wsOpen ? 'đang mở' : 'đã đóng'}; ${cursorNote}`,
        });
        log && log(`[sign-local] Chiến lược C: relay luồng của trang ấm (${w.transport}), ${cursorNote}, đệm ${relay.pageFrames.length} frame.`);
        snapshotWarm();
        return {
          fetchResult: { cursor, internalExt: w.lastInternalExt || '', pushServer: relay.url, routeParams: {}, messages: [], needAck: false },
          fetchResultCookieHeader: warmCookiePair(w),
          fetchResultRoomId: String(roomId),
        };
      }
      recordStrategy('C-relay-trang-ấm', { result: 'bỏ qua', note: `trang chưa mở WS nào, im/fetch mới ${w.imFetch.length} lần` });
    } else {
      recordStrategy('C-relay-trang-ấm', { result: 'bỏ qua', note: 'không có phiên ấm (chưa gọi prepareWarmSession hoặc trang mở lỗi)' });
    }

    /* ---- Chiến lược A: nguyên fetchResult trang đã nhận ---- */
    if (w) {
      const cap = [...w.imFetch].reverse().find((f) => f.decoded && f.decoded.pushServer && f.decoded.cursor);
      if (cap) {
        recordStrategy('A-fetchResult-của-trang', { result: 'DÙNG', httpStatus: cap.status, bytes: cap.bytes, note: 'cursor/pushServer thật do trang nhận — thư viện tự mở WS từ Node' });
        log && log('[sign-local] Chiến lược A: dùng fetchResult thật của trang (thư viện tự mở WebSocket).');
        return { fetchResult: cap.decoded, fetchResultCookieHeader: warmCookiePair(w), fetchResultRoomId: String(roomId) };
      }
      recordStrategy('A-fetchResult-của-trang', { result: 'bỏ qua', note: 'chưa bắt được im/fetch nào giải mã được của trang' });
    }

    /* ---- Chiến lược A2: fetch im/fetch trong ngữ cảnh trang ---- */
    if (w && w.page && !w.dead) {
      try {
        const unsigned = toUrl(baseParams, { ...FP, ...(w.fp || {}) });
        const attempt = await w.page.evaluate(async (url) => {
          const out = { tried: [] };
          const doFetch = async (u) => {
            const r = await fetch(u, { credentials: 'include', headers: { 'Accept': 'application/protobuf' } });
            const b = await r.arrayBuffer();
            let bin = ''; const bytes = new Uint8Array(b);
            for (let i = 0; i < bytes.length; i += 32768) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 32768));
            return { status: r.status, b64: btoa(bin), bytes: b.byteLength };
          };
          try {
            const r1 = await doFetch(url);
            out.tried.push({ via: 'fetch-thường(SDK trang tự ký)', status: r1.status, bytes: r1.bytes });
            if (r1.bytes > 0) { out.result = r1; return out; }
          } catch (e) { out.tried.push({ via: 'fetch-thường(SDK trang tự ký)', error: String(e).slice(0, 120) }); }
          try {
            const ac = window.byted_acrawler;
            if (ac && typeof ac.frontierSign === 'function') {
              const u = new URL(url);
              const params = {}; u.searchParams.forEach((v, k) => { params[k] = v; });
              const signed = ac.frontierSign(params);
              const xb = signed && (signed['X-Bogus'] || signed.XBogus);
              if (xb) {
                u.searchParams.set('X-Bogus', xb);
                const r2 = await doFetch(u.toString());
                out.tried.push({ via: 'frontierSign+fetch', status: r2.status, bytes: r2.bytes });
                if (r2.bytes > 0) { out.result = r2; return out; }
              } else out.tried.push({ via: 'frontierSign', error: 'frontierSign không trả X-Bogus' });
            } else out.tried.push({ via: 'frontierSign', error: 'trang không có byted_acrawler.frontierSign' });
          } catch (e) { out.tried.push({ via: 'frontierSign', error: String(e).slice(0, 120) }); }
          return out;
        }, unsigned);
        const notes = (attempt.tried || []).map((t) => `${t.via}: ${t.error ? 'lỗi ' + t.error : `HTTP ${t.status}, ${t.bytes} byte`}`).join(' | ');
        if (attempt.result && attempt.result.bytes > 0) {
          /* Vận chuyển trong evaluate là base64 end-to-end (mảng byte →
             chuỗi nhị phân → btoa) nên buf ở đây byte-exact. Vòng 3 tách
             bạch lỗi FETCH khỏi lỗi GIẢI MÃ (vòng 2 gộp chung thành
             "evaluate lỗi ... premature EOF" gây hiểu nhầm hỏng byte),
             và giải mã thử đủ dạng fetchResult/gzip/pushFrame. */
          const buf = Buffer.from(attempt.result.b64, 'base64');
          if (log && buf.length <= 2048) {
            log(`[sign-local] Body A2 (${buf.length}B, hex đầu ${buf.subarray(0, 16).toString('hex')}) base64: ${buf.toString('base64')}`);
          }
          const dec = await tryDecodeFetchResult(buf);
          if (dec && dec.decoded && dec.decoded.pushServer) {
            recordStrategy('A2-fetch-trong-trang', { result: 'DÙNG', httpStatus: attempt.result.status, bytes: attempt.result.bytes, note: notes + ` | giải mã OK qua ${dec.via}` });
            log && log('[sign-local] Chiến lược A2: fetch trong trang thành công (' + attempt.result.bytes + ' byte, giải mã qua ' + dec.via + ').');
            return { fetchResult: dec.decoded, fetchResultCookieHeader: warmCookiePair(w), fetchResultRoomId: String(roomId) };
          }
          recordStrategy('A2-fetch-trong-trang', {
            result: 'thất bại', httpStatus: attempt.result.status, bytes: attempt.result.bytes,
            note: notes + (dec
              ? ` | giải mã OK qua ${dec.via} nhưng THIẾU pushServer — body là fetchResult gần-rỗng (kênh polling của khách bị TikTok để rỗng, giống hệt trang thật)`
              : ' | body không giải mã được thành fetchResult ở mọi dạng (fetchResult/gzip/pushFrame) — xem base64 body trong log'),
          });
        } else {
          recordStrategy('A2-fetch-trong-trang', { result: 'thất bại', note: notes || 'không rõ' });
        }
      } catch (e) {
        recordStrategy('A2-fetch-trong-trang', { result: 'thất bại', note: 'lỗi khi fetch trong trang (evaluate): ' + String(e.message || e).slice(0, 140) });
      }
    } else if (w) {
      recordStrategy('A2-fetch-trong-trang', { result: 'bỏ qua', note: 'trang ấm đã chết' });
    }

    /* ---- Chiến lược B: trích xuất phiên ấm, ký + fetch từ Node ---- */
    if (w && w.cookieMap.size && w.ua) {
      try {
        const counters = warmCounters(w);
        const unsigned = toUrl(baseParams, null);
        const signed = await signUrlWith(unsigned, log, {
          ua: w.ua,
          fp: { ...FP, ...(w.fp || {}) },
          msToken: w.cookieMap.get('msToken') || null,
          counters,
        });
        const { status, buf } = await nodeFetchImFetch(signed, {
          'User-Agent': w.ua, 'Referer': `https://www.tiktok.com/@${w.username}/live`,
          'Accept': 'application/protobuf', 'Cookie': warmCookieHeader(w),
        });
        if (status === 200 && buf.length) {
          const decoded = decodeOrThrow(buf, 'B');
          recordStrategy('B-trích-xuất-phiên-ấm', { result: 'DÙNG', httpStatus: status, bytes: buf.length, note: `cookie đầy đủ ${w.cookieMap.size} tên, counters ${counters ? 'thật (CDP)' : 'mặc định'}` });
          log && log('[sign-local] Chiến lược B: fetch từ Node bằng phiên ấm thành công (' + buf.length + ' byte).');
          return { fetchResult: decoded, fetchResultCookieHeader: warmCookiePair(w), fetchResultRoomId: String(roomId) };
        }
        recordStrategy('B-trích-xuất-phiên-ấm', { result: 'thất bại', httpStatus: status, bytes: buf.length, note: `Node fetch bằng cookie/counters của phiên ấm vẫn ${buf.length === 0 ? 'rỗng' : 'không dùng được'}` });
      } catch (e) {
        recordStrategy('B-trích-xuất-phiên-ấm', { result: 'thất bại', note: String(e.message || e).slice(0, 160) });
      }
    } else {
      recordStrategy('B-trích-xuất-phiên-ấm', { result: 'bỏ qua', note: w ? 'phiên ấm chưa có cookie/UA' : 'không có phiên ấm' });
    }

    /* ---- Chiến lược D: đường cổ điển vòng 1 ---- */
    try {
      const unsigned = toUrl({ ...baseParams, ...FP }, null);
      const signed = await signUrl(unsigned, log);
      await refreshJar(roomId);
      const { status, buf } = await nodeFetchImFetch(signed, {
        'User-Agent': SIGN_UA, 'Referer': 'https://www.tiktok.com/',
        'Accept': 'application/protobuf', 'Cookie': cookieHeader(),
      });
      if (status !== 200) {
        recordStrategy('D-cổ-điển', { result: 'thất bại', httpStatus: status, bytes: buf.length });
        throw new LocalSignBlockedError(`TikTok trả HTTP ${status} cho im/fetch đã ký. Tóm tắt: ` + diag.strategies.map((s) => `${s.name}=${s.result}`).join('; '));
      }
      if (!buf.length) {
        recordStrategy('D-cổ-điển', { result: 'thất bại', httpStatus: status, bytes: 0 });
        throw new LocalSignBlockedError('Mọi chiến lược đều bị im/fetch từ chối (chi tiết trong khối chẩn đoán): ' + diag.strategies.map((s) => `${s.name}=${s.result}${s.bytes != null ? `(${s.bytes}B)` : ''}`).join('; ') + '. Chữ ký vẫn hợp lệ ở gift/list — điểm tắc là mức tin cậy phiên đối với riêng im/fetch, KHÔNG phải IP (mạng nhà cũng lỗi y hệt, 02/11).');
      }
      const decoded = decodeOrThrow(buf, 'D');
      recordStrategy('D-cổ-điển', { result: 'DÙNG', httpStatus: status, bytes: buf.length });
      return { fetchResult: decoded, fetchResultCookieHeader: warmCookiePair(null), fetchResultRoomId: String(roomId) };
    } catch (e) {
      if (e && e.name === 'LocalSignBlocked') throw e;
      recordStrategy('D-cổ-điển', { result: 'thất bại', note: String(e.message || e).slice(0, 160) });
      throw new LocalSignBlockedError('Mọi chiến lược đều thất bại (chi tiết trong khối chẩn đoán): ' + diag.strategies.map((s) => `${s.name}=${s.result}`).join('; ') + ' | D lỗi: ' + String(e.message || e).slice(0, 140));
    }
  };

  // 2) Route ký phụ (danh sách quà…): giữ đường cổ điển vòng 1 (đã chứng minh).
  RC.fetchWebcastSignatureFromProvider = async ({ url }) => {
    const signed = await signUrl(url, log);
    return { response: { signedUrl: signed, userAgent: SIGN_UA } };
  };

  // 3) Không để thư viện lùi về tuyến Euler (trả phí) khi dò roomId/isLive.
  for (const cfgName of ['RoomIdRouteConfig', 'IsLiveRouteConfig']) {
    const cfg = ttlc[cfgName];
    if (cfg && 'skipFetchRoomIdFromEulerRoute' in cfg) cfg.skipFetchRoomIdFromEulerRoute = true;
  }

  // Dựng phiên ký cổ điển sớm (không chặn khởi động server).
  getSession(log).catch((e) => { log && log('[sign-local] Dựng phiên ký sớm lỗi: ' + String(e.message || e).slice(0, 140)); });
  log && log('[sign-local] Đã cắm tuyến ký LOCAL (không dùng EulerStream).');
  return { SIGN_UA };
}

/* Options nên truyền kèm khi tạo TikTokLiveConnection ở chế độ local,
   để các request thường của thư viện (danh sách quà…) dùng đúng UA +
   fingerprint của phiên ký cổ điển. */
export function localConnectionOptions() {
  return {
    webClientOptions: {
      headers: { 'User-Agent': SIGN_UA },
      searchParams: { ...FP },
    },
  };
}
