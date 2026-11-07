'use strict';

const http = require('http');
const { WebSocketServer } = require('ws');

// Server local cho game: HTTP (health/status/recent) + WebSocket /events.
// Mọi game trên cùng máy nối ws://localhost:<PORT>/events là nhận sự kiện
// đã chuẩn hoá theo thời gian thực — hop cuối này là localhost nên độ trễ
// cộng thêm ~0.

const RECENT_CAP = 50;
const LATENCY_CAP = 200;
const EVENT_TYPES = ['chat', 'gift', 'like', 'follow', 'share', 'roomUser', 'member'];

const STATE_HINTS = {
  waiting_key:
    'Chưa có EULER_API_KEY. Đăng ký miễn phí tại eulerstream.com, tạo API key rồi điền vào file .env (xem README).',
  waiting_username:
    'Chưa có TIKTOK_USERNAME trong file .env — điền username TikTok của phòng live (không có dấu @).',
  waiting_room: 'Chủ phòng chưa live. Dịch vụ sẽ tự thử kết nối lại mỗi 15 giây.',
};

class FeedServer {
  constructor({ feed, config }) {
    this.feed = feed;
    this.config = config;
    this.startedAt = Date.now();
    this.counts = { total: 0 };
    for (const t of EVENT_TYPES) this.counts[t] = 0;
    this.recent = [];        // ring buffer sự kiện gần nhất
    this.latencyWindow = []; // cửa sổ trượt latencyMs để tính avg/p95
    this.wsClients = new Set();

    this.httpServer = http.createServer((req, res) => this._handleHttp(req, res));
    this.wss = new WebSocketServer({ noServer: true });
    this.httpServer.on('upgrade', (req, socket, head) => {
      const url = new URL(req.url, 'http://localhost');
      if (url.pathname === '/events') {
        this.wss.handleUpgrade(req, socket, head, (ws) => this.wss.emit('connection', ws, req));
      } else {
        socket.destroy();
      }
    });
    this.wss.on('connection', (ws) => {
      this.wsClients.add(ws);
      ws.send(JSON.stringify({
        type: 'hello',
        state: this.feed.state,
        username: this.config.username || null,
        ts: Date.now(),
      }));
      ws.on('close', () => this.wsClients.delete(ws));
      ws.on('error', () => this.wsClients.delete(ws));
    });

    // Nối feed -> stats + broadcast
    this.feed.on('event', (ev) => this._ingest(ev));
  }

  _ingest(ev) {
    this.counts.total += 1;
    if (this.counts[ev.type] !== undefined) this.counts[ev.type] += 1;

    this.recent.push(ev);
    if (this.recent.length > RECENT_CAP) this.recent.shift();

    if (typeof ev.latencyMs === 'number') {
      this.latencyWindow.push(ev.latencyMs);
      if (this.latencyWindow.length > LATENCY_CAP) this.latencyWindow.shift();
    }

    if (this.config.debug) {
      console.log(`[event] ${ev.type} @${ev.uniqueId || '?'} ${ev.text || ev.giftName || ''}`.trim());
    }

    if (this.wsClients.size) {
      const payload = JSON.stringify(ev);
      for (const ws of this.wsClients) {
        if (ws.readyState === ws.OPEN) {
          try { ws.send(payload); } catch (_) { /* client lỗi -> kệ, close handler sẽ dọn */ }
        }
      }
    }
  }

  _latencyStats() {
    const w = this.latencyWindow;
    if (!w.length) return { samples: 0, avgMs: null, p95Ms: null };
    const sorted = [...w].sort((a, b) => a - b);
    const avg = w.reduce((s, v) => s + v, 0) / w.length;
    const p95 = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))];
    return { samples: w.length, avgMs: Math.round(avg), p95Ms: p95 };
  }

  status() {
    const state = this.feed.state;
    return {
      state,
      hint: STATE_HINTS[state] || null,
      username: this.config.username || null,
      fakeMode: !!this.config.fake,
      roomId: this.feed.roomId || null,
      uptimeSec: Math.floor((Date.now() - this.startedAt) / 1000),
      wsClients: this.wsClients.size,
      eventsReceived: { ...this.counts },
      latency: this._latencyStats(),
      lastError: this.feed.lastError || null,
    };
  }

  _sendJson(res, code, obj) {
    const body = JSON.stringify(obj);
    res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(body);
  }

  _handleHttp(req, res) {
    const url = new URL(req.url, 'http://localhost');
    if (req.method === 'GET' && url.pathname === '/health') {
      this._sendJson(res, 200, { ok: true });
    } else if (req.method === 'GET' && url.pathname === '/status') {
      this._sendJson(res, 200, this.status());
    } else if (req.method === 'GET' && url.pathname === '/recent') {
      this._sendJson(res, 200, { events: [...this.recent].reverse() });
    } else {
      this._sendJson(res, 404, { error: 'not_found', path: url.pathname });
    }
  }

  listen(port) {
    return new Promise((resolve) => {
      this.httpServer.listen(port, () => {
        resolve(this.httpServer.address().port);
      });
    });
  }

  async close() {
    for (const ws of this.wsClients) {
      try { ws.close(); } catch (_) { /* bỏ qua */ }
    }
    this.wsClients.clear();
    await new Promise((resolve) => this.wss.close(() => resolve()));
    await new Promise((resolve) => this.httpServer.close(() => resolve()));
  }
}

module.exports = { FeedServer };
