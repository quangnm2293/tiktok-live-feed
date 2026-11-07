'use strict';

// Chuẩn hoá sự kiện thô từ tiktok-live-connector (v2.5.x) về MỘT shape duy nhất
// cho mọi game: { type, userId, uniqueId, nickname, avatarUrl, text, giftName,
// giftId, coins, repeatCount, likeCount, totalLikeCount, viewerCount,
// ts, sourceTs, latencyMs, msgId }
//
// Lưu ý thực tế của bản 2.5.0:
// - TikTokLiveConnection phát ra object protobuf đã decode (schema v3): user ở
//   data.user (id, displayId, nickname, avatarThumb.urlList), metadata ở
//   data.common (msgId, createTime), text chat ở data.content, quà ở data.gift.
// - README của connector lại ghi theo shape phẳng kiểu cũ (comment, giftDetails,
//   user.uniqueId...). Hàm này đọc PHÒNG THỦ cả hai shape để game không bao giờ
//   phải quan tâm connector đổi nội bộ.

function toInt(v) {
  if (v === null || v === undefined) return null;
  if (typeof v === 'bigint') return Number(v);
  const n = typeof v === 'string' ? parseInt(v, 10) : Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

function firstUrl(imageModel) {
  if (!imageModel) return null;
  const urls = imageModel.urlList || imageModel.urls;
  return Array.isArray(urls) && urls.length ? String(urls[0]) : null;
}

// Trích thông tin user từ cả shape lồng (data.user) lẫn shape phẳng (data.*)
function extractUser(data) {
  const u = data.user || data;
  const userId =
    (u && (u.userId ?? u.id)) ?? data.userId ?? null;
  const uniqueId =
    (u && (u.uniqueId || u.displayId)) || data.uniqueId || null;
  const nickname = (u && u.nickname) || data.nickname || null;
  const avatarUrl =
    (u && (u.profilePictureUrl || firstUrl(u.avatarLarge) || firstUrl(u.avatarMedium) || firstUrl(u.avatarThumb))) ||
    data.profilePictureUrl ||
    null;
  return {
    userId: userId === null || userId === undefined ? null : String(userId),
    uniqueId: uniqueId ? String(uniqueId) : null,
    nickname: nickname ? String(nickname) : null,
    avatarUrl: avatarUrl ? String(avatarUrl) : null,
  };
}

// createTime của TikTok là epoch MILLI giây (dạng string). Một vài message phụ
// dùng giây -> tự nhận biết theo độ lớn.
function parseSourceTs(data) {
  const raw =
    (data.common && data.common.createTime) ??
    data.createTime ??
    null;
  let n = toInt(raw);
  if (n === null) return null;
  if (n > 0 && n < 1e12) n = n * 1000; // đang là giây -> đổi sang ms
  return n;
}

function extractMsgId(data) {
  const id = (data.common && data.common.msgId) ?? data.msgId ?? null;
  return id === null || id === undefined || id === '' || id === '0' ? null : String(id);
}

function baseEvent(type, data, receivedAt) {
  const user = extractUser(data || {});
  const sourceTs = data ? parseSourceTs(data) : null;
  let latencyMs = null;
  if (sourceTs !== null) {
    const diff = receivedAt - sourceTs;
    // Chỉ chấp nhận độ trễ hợp lý (0ms .. 10 phút) để tránh số rác khi
    // createTime của TikTok bất thường.
    if (diff >= 0 && diff < 10 * 60 * 1000) latencyMs = diff;
  }
  return {
    type,
    userId: user.userId,
    uniqueId: user.uniqueId,
    nickname: user.nickname,
    avatarUrl: user.avatarUrl,
    text: null,
    giftName: null,
    giftId: null,
    coins: null,
    repeatCount: null,
    likeCount: null,
    totalLikeCount: null,
    viewerCount: null,
    ts: receivedAt,
    sourceTs,
    latencyMs,
    msgId: data ? extractMsgId(data) : null,
  };
}

// type: 'chat' | 'gift' | 'like' | 'follow' | 'share' | 'roomUser' | 'member'
// data: payload thô từ connector. receivedAt: Date.now() tại thời điểm nhận.
function normalizeEvent(type, data, receivedAt = Date.now()) {
  if (!data || typeof data !== 'object') data = {};
  const ev = baseEvent(type, data, receivedAt);

  switch (type) {
    case 'chat':
      // v3: content | shape phẳng/README: comment
      ev.text = data.comment ?? data.content ?? null;
      break;

    case 'gift': {
      const ext = data.extendedGiftInfo || {};
      const details = data.giftDetails || {};
      const gift = data.gift || {};
      ev.giftId = data.giftId ?? gift.id ?? null;
      if (ev.giftId !== null) ev.giftId = String(ev.giftId);
      ev.giftName = ext.name || details.giftName || gift.name || null;
      ev.coins =
        toInt(ext.diamondCount ?? ext.diamond_count) ??
        toInt(details.diamondCount) ??
        toInt(gift.diamondCount);
      ev.repeatCount = toInt(data.repeatCount) ?? toInt(data.comboCount);
      // Cờ kết thúc chuỗi quà liên tiếp (v3: số 0/1, shape cũ: boolean).
      // Game tự quyết định xử lý streak; ở đây chỉ đính kèm để tham khảo.
      ev.repeatEnd = data.repeatEnd === true || data.repeatEnd === 1;
      break;
    }

    case 'like':
      // README: likeCount/totalLikeCount | v3 proto: count/total
      ev.likeCount = toInt(data.likeCount) ?? toInt(data.count);
      ev.totalLikeCount = toInt(data.totalLikeCount) ?? toInt(data.total);
      break;

    case 'roomUser':
      // README: viewerCount | v3 proto: total / popStr
      ev.viewerCount =
        toInt(data.viewerCount) ?? toInt(data.total) ?? toInt(data.popStr);
      break;

    case 'member':
      ev.viewerCount = toInt(data.memberCount);
      break;

    case 'follow':
    case 'share':
      // Sự kiện suy ra từ 'social' — không có trường số liệu riêng.
      break;

    default:
      return null; // loại sự kiện ngoài schema -> bỏ qua
  }
  return ev;
}

module.exports = { normalizeEvent, toInt };
