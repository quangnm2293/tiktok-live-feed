'use strict';

const { EventEmitter } = require('events');
const { normalizeEvent } = require('./normalize');

// FeedService: quản lý vòng đời kết nối tiktok-live-connector.
//
// Kiến trúc độ-trễ-thấp:
// - Connector mở WebSocket THẲNG tới TikTok (webcast). Chữ ký lúc bắt tay
//   do MÁY KÝ TỰ HOST sinh ngay trên máy này (SIGN_MODE=local, MẶC ĐỊNH):
//   src/sign-local.mjs thay 2 route ký của connector (RouteConfig) —
//   tuyến chính là "phiên ấm": một Chrome thật mở trang live của phòng,
//   luồng WebSocket của chính trang được relay nguyên bản cho connector;
//   dự phòng là ký cổ điển (X-Bogus/X-Gnarly tự sinh trong cùng tiến
//   trình feed — không tiến trình riêng, không dịch vụ ngoài).
// - SIGN_MODE=euler là FALLBACK: EulerStream ký qua option signApiKey
//   như bản cũ (lưu ý: route ký Euler nay bị khóa sau gói Business —
//   xem README). Sự kiện không đi vòng qua máy chủ Euler ở cả hai chế độ.
// - Mọi sự kiện thô đều qua normalizeEvent() rồi phát 'event' cho server
//   broadcast ngay tới các game local.
//
// State machine (đọc qua .state):
//   waiting_key      -> SIGN_MODE=euler mà thiếu EULER_API_KEY
//   waiting_username -> thiếu TIKTOK_USERNAME
//   connecting       -> đang connect()
//   connected        -> đang nhận sự kiện
//   reconnecting     -> rớt kết nối, đang backoff để nối lại
//   waiting_room     -> chủ phòng chưa live (UserOfflineError), thử lại 15s
//   sign_blocked     -> máy ký local bị TikTok từ chối ở im/fetch
//                       (LocalSignBlocked), thử lại thưa (60s)
//   error            -> lỗi khác, vẫn tiếp tục backoff (không crash)
//   stopped          -> đã dừng chủ động (shutdown)
//
// Process KHÔNG BAO GIỜ thoát vì lỗi connector: mọi lỗi đều bị bắt tại đây.

const BACKOFF_STEPS = [1000, 2000, 5000, 10000, 30000];
const OFFLINE_RETRY_MS = 15000;
const SIGN_BLOCKED_RETRY_MS = 60000;
const DEDUPE_CAP = 2000;

class FeedService extends EventEmitter {
  constructor(config) {
    super();
    this.config = config; // { eulerApiKey, username, fake, debug, signMode }
    this._signLocal = null;        // module src/sign-local.mjs (nạp lười, chỉ chế độ local)
    this._signInstalled = false;   // đã cắm route ký local vào RouteConfig chưa
    this.state = 'idle';
    this.roomId = null;
    this.lastError = null;
    this.connection = null;
    this._backoffIdx = 0;
    this._timer = null;
    this._stopped = true;
    this._connecting = false;
    this._seenMsgIds = new Set();
    this._seenQueue = [];
    this._fakeTimer = null;
    this._fakeSeq = 0;
  }

  setState(state, lastError) {
    this.state = state;
    if (lastError !== undefined) this.lastError = lastError;
    this.emit('state', this.state);
  }

  // Làm sạch thông báo lỗi trước khi đưa ra ngoài: TUYỆT ĐỐI không để lọt API key.
  sanitizeError(err) {
    let msg = err && err.message ? String(err.message) : String(err || 'unknown error');
    const key = this.config.eulerApiKey;
    if (key) msg = msg.split(key).join('***');
    return msg.slice(0, 300);
  }

  start() {
    this._stopped = false;
    if (this.config.fake) {
      this.setState('connected');
      this._startFake();
      return;
    }
    // Chế độ local (mặc định) KHÔNG cần key Euler — máy ký tự host lo.
    // Chỉ fallback euler mới đòi EULER_API_KEY.
    if (this.config.signMode === 'euler' && !this.config.eulerApiKey) {
      this.setState('waiting_key');
      return;
    }
    if (!this.config.username) {
      this.setState('waiting_username');
      return;
    }
    this._attemptConnect();
  }

  async stop() {
    this._stopped = true;
    if (this._timer) { clearTimeout(this._timer); this._timer = null; }
    if (this._fakeTimer) { clearInterval(this._fakeTimer); this._fakeTimer = null; }
    if (this.connection) {
      try { await this.connection.disconnect(); } catch (_) { /* bỏ qua */ }
      this.connection = null;
    }
    if (this._signLocal && this._signLocal.closeWarmSession) {
      try { await this._signLocal.closeWarmSession(); } catch (_) { /* bỏ qua */ }
    }
    this.setState('stopped');
  }

  // Nạp máy ký tự host (ESM) vào tiến trình CommonJS này + cắm route ký
  // vào RouteConfig của connector (một lần duy nhất — registry là toàn
  // cục của thư viện) + dựng PHIÊN ẤM trước (không chờ: route ký tự chờ
  // phiên ấm khi connector thật sự cần). Chỉ chạy ở SIGN_MODE=local.
  async _ensureLocalSign(ttlc) {
    if (!this._signLocal) {
      this._signLocal = await import('./sign-local.mjs');
    }
    const log = (m) => console.log(m);
    if (!this._signInstalled) {
      this._signLocal.installLocalSignRoutes(ttlc, log);
      this._signInstalled = true;
    }
    try {
      const p = this._signLocal.prepareWarmSession(this.config.username, log);
      if (p && typeof p.catch === 'function') p.catch(() => { /* lỗi đã được ghi log trong module ký */ });
    } catch (_) { /* phiên ấm lỗi không được làm sập đường connect */ }
    return this._signLocal;
  }

  _isLocalSignBlocked(err) {
    if (!err) return false;
    if (err.name === 'LocalSignBlocked') return true;
    return /LocalSignBlocked/.test(String(err.message || err));
  }

  _scheduleRetry(ms, state) {
    if (this._stopped) return;
    if (state) this.setState(state);
    if (this._timer) clearTimeout(this._timer);
    this._timer = setTimeout(() => this._attemptConnect(), ms);
    this._timer.unref && this._timer.unref();
  }

  _nextBackoff() {
    const ms = BACKOFF_STEPS[Math.min(this._backoffIdx, BACKOFF_STEPS.length - 1)];
    this._backoffIdx += 1;
    return ms;
  }

  _isOfflineError(err) {
    return (
      err &&
      (err.name === 'UserOfflineError' ||
        /offline/i.test(err.message || '') ||
        /not live/i.test(err.message || ''))
    );
  }

  async _attemptConnect() {
    if (this._stopped || this._connecting) return;
    this._connecting = true;
    this.setState(this._backoffIdx > 0 ? 'reconnecting' : 'connecting');

    let ttlc, TikTokLiveConnection, ControlEvent, WebcastEvent;
    try {
      // Nạp bằng import() động: bản 2.5.0 của connector là ES Module —
      // require() chỉ nuốt được ESM từ Node 22.12+/20.19+; Node cũ hơn
      // (vd Mac của chủ phòng) ném ERR_REQUIRE_ESM ngay bước này, feed
      // chết trước khi kịp ký/mở Chrome. import() chạy mọi bản Node.
      ttlc = await import('tiktok-live-connector');
      ({ TikTokLiveConnection, ControlEvent, WebcastEvent } = ttlc);
    } catch (err) {
      this._connecting = false;
      this.setState('error', this.sanitizeError(err));
      this._scheduleRetry(30000, 'error');
      return;
    }

    // Huỷ connection cũ nếu còn sót
    if (this.connection) {
      try { await this.connection.disconnect(); } catch (_) { /* bỏ qua */ }
      this.connection = null;
    }

    const connOptions = {
      enableExtendedGiftInfo: true, // để sự kiện gift có tên + giá diamond
    };
    if (this.config.signMode === 'euler') {
      connOptions.signApiKey = this.config.eulerApiKey; // Euler ký; WS nối thẳng TikTok
    } else {
      // SIGN_MODE=local (mặc định): cắm máy ký tự host TRƯỚC khi tạo
      // connection. Không truyền signApiKey — connector không được chạm
      // tới Euler nữa (room-id cũng đã tắt tuyến Euler trong module ký).
      try {
        const sl = await this._ensureLocalSign(ttlc);
        Object.assign(connOptions, sl.localConnectionOptions());
      } catch (err) {
        this._connecting = false;
        console.error('[feed] Không bật được máy ký local:', this.sanitizeError(err));
        this.setState('error', 'Máy ký local không nạp được: ' + this.sanitizeError(err));
        this._scheduleRetry(30000, 'error');
        return;
      }
      if (this._stopped) { this._connecting = false; return; }
    }

    const conn = new TikTokLiveConnection(this.config.username, connOptions);
    this.connection = conn;

    const forward = (type) => (data) => this.ingest(type, data);
    conn.on(WebcastEvent.CHAT, forward('chat'));
    conn.on(WebcastEvent.GIFT, forward('gift'));
    conn.on(WebcastEvent.LIKE, forward('like'));
    conn.on(WebcastEvent.FOLLOW, forward('follow'));
    conn.on(WebcastEvent.SHARE, forward('share'));
    conn.on(WebcastEvent.ROOM_USER, forward('roomUser'));
    conn.on(WebcastEvent.MEMBER, forward('member'));
    // 'social' thô: follow/share đã có event suy ra riêng; msgId trùng nhau
    // nên lớp dedupe ở ingest() sẽ loại bản trùng nếu cả hai cùng phát.

    conn.on(ControlEvent.DISCONNECTED, () => {
      if (this._stopped) return;
      this.roomId = null;
      this._scheduleRetry(this._nextBackoff(), 'reconnecting');
    });
    conn.on(WebcastEvent.STREAM_END, () => {
      // Chủ phòng tắt live -> về trạng thái chờ phòng, thử lại sau 15s
      if (this._stopped) return;
      this._scheduleRetry(OFFLINE_RETRY_MS, 'waiting_room');
    });
    conn.on(ControlEvent.ERROR, (payload) => {
      const err = (payload && (payload.exception || payload.info)) || payload;
      this.lastError = this.sanitizeError(err);
      if (this.config.debug) console.error('[feed] connector error:', this.lastError);
      // Không tự retry ở đây: DISCONNECTED / connect() reject sẽ lo việc đó.
    });

    try {
      const state = await conn.connect();
      this._connecting = false;
      this._backoffIdx = 0;
      this.roomId = state && state.roomId ? String(state.roomId) : null;
      this.lastError = null;
      this.setState('connected');
      console.log(`[feed] Đã kết nối phòng live của @${this.config.username} (roomId ${this.roomId || '?'})`);
    } catch (err) {
      this._connecting = false;
      const msg = this.sanitizeError(err);
      this.lastError = msg;
      if (this._isOfflineError(err)) {
        this.setState('waiting_room', null);
        console.log(`[feed] @${this.config.username} chưa live — thử lại sau ${OFFLINE_RETRY_MS / 1000}s`);
        this._scheduleRetry(OFFLINE_RETRY_MS, 'waiting_room');
      } else if (this.config.signMode !== 'euler' && this._isLocalSignBlocked(err)) {
        // Máy ký local bị TikTok từ chối ở im/fetch: thử lại THƯA (60s)
        // — thử dồn cũng ra cùng kết quả, mà mỗi lần thử đều dựng lại
        // phiên ấm. Nếu vừa đăng nhập TikTok trong cửa sổ Chrome ký
        // thì lần thử sau có thể qua.
        this.setState('sign_blocked', msg);
        console.error('[feed] Máy ký local bị chặn ở im/fetch — thử lại sau 60s. Chi tiết:', msg);
        this._scheduleRetry(SIGN_BLOCKED_RETRY_MS, 'sign_blocked');
      } else {
        console.error('[feed] Kết nối thất bại:', msg);
        this._scheduleRetry(this._nextBackoff(), 'error');
      }
    }
  }

  // Điểm vào DUY NHẤT của mọi sự kiện (thật + giả lập): chuẩn hoá -> khử trùng
  // theo msgId -> phát cho server broadcast.
  ingest(type, data) {
    const ev = normalizeEvent(type, data, Date.now());
    if (!ev) return;
    if (ev.msgId) {
      if (this._seenMsgIds.has(ev.msgId)) return;
      this._seenMsgIds.add(ev.msgId);
      this._seenQueue.push(ev.msgId);
      if (this._seenQueue.length > DEDUPE_CAP) {
        this._seenMsgIds.delete(this._seenQueue.shift());
      }
    }
    this.emit('event', ev);
  }

  // ---- Chế độ giả lập (FEED_FAKE=1): phát sự kiện tổng hợp qua ĐÚNG đường
  // normalize + dedupe + broadcast như sự kiện thật. Dùng cho selftest/demo
  // khi chưa có API key. Object thô mô phỏng shape protobuf v3 của connector.
  _startFake() {
    const now = Date.now();
    const mkUser = (id, uniqueId, nickname) => ({
      user: {
        id: String(id),
        displayId: uniqueId,
        nickname,
        avatarThumb: { urlList: [`https://example.invalid/avatar/${uniqueId}.jpg`] },
      },
      common: { msgId: `fake-${++this._fakeSeq}`, createTime: String(Date.now()) },
    });
    const cycle = [
      () => this.ingest('chat', { ...mkUser(1001, 'nguoi_choi_1', 'Người Chơi 1'), content: 'ăn' }),
      () => this.ingest('gift', {
        ...mkUser(1002, 'tang_qua_vip', 'Tặng Quà VIP'),
        giftId: '5655',
        repeatCount: 1,
        repeatEnd: 1,
        gift: { id: '5655', name: 'Hoa hồng', diamondCount: 1 },
      }),
      () => this.ingest('like', { ...mkUser(1003, 'thich_ne', 'Thích Nè'), count: 12, total: '3456' }),
      () => this.ingest('follow', { ...mkUser(1004, 'moi_follow', 'Mới Follow'), action: '1' }),
      () => this.ingest('share', { ...mkUser(1005, 'chia_se_di', 'Chia Sẻ Đi'), action: '3' }),
      () => this.ingest('roomUser', { total: '128', popStr: '128', common: { msgId: `fake-${++this._fakeSeq}`, createTime: String(Date.now()) } }),
      () => this.ingest('member', { ...mkUser(1006, 'khach_moi', 'Khách Mới'), memberCount: 129 }),
    ];
    let i = 0;
    const tick = () => { cycle[i % cycle.length](); i += 1; };
    tick(); // phát ngay sự kiện đầu tiên
    this._fakeTimer = setInterval(tick, 400);
    this._fakeTimer.unref && this._fakeTimer.unref();
    void now;
  }
}

module.exports = { FeedService };
