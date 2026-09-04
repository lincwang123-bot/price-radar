import { metaGet, metaSet } from "./db.mjs";

const KEY_PREFIX = "source_last_attempt_ms:";

function timestampMs(value) {
  const number = value instanceof Date ? value.getTime() : Number(value);
  if (!Number.isFinite(number)) throw new Error("source-timing: nowMs 必须是有效时间");
  return Math.trunc(number);
}

/**
 * “尝试占位”：只有在间隔已过时才写入本次尝试时间。
 * 被节流拒绝的调用不推进时间，避免频繁轮询导致永远无法再次采集。
 */
export function claimSourceAttempt(db, sourceId, minIntervalMinutes, nowMs = Date.now()) {
  const id = String(sourceId ?? "").trim();
  if (!id) throw new Error("source-timing: sourceId 不能为空");

  const minutes = Number(minIntervalMinutes);
  if (!Number.isFinite(minutes) || minutes < 0) {
    throw new Error("source-timing: minIntervalMinutes 必须是非负数");
  }

  const now = timestampMs(nowMs);
  const intervalMs = Math.round(minutes * 60_000);
  const key = `${KEY_PREFIX}${id}`;
  const stored = metaGet(db, key);
  const parsed = stored == null ? null : Number(stored);
  const lastAttemptMs = Number.isFinite(parsed) ? Math.trunc(parsed) : null;
  const elapsedMinutes = lastAttemptMs == null
    ? null
    : Math.max(0, (now - lastAttemptMs) / 60_000);
  const nextAllowedMs = lastAttemptMs == null ? now : lastAttemptMs + intervalMs;

  if (lastAttemptMs != null && now < nextAllowedMs) {
    const remainingMs = nextAllowedMs - now;
    return {
      allowed: false,
      lastAttemptMs,
      lastAttemptAt: new Date(lastAttemptMs).toISOString(),
      nextAllowedMs,
      nextAllowedAt: new Date(nextAllowedMs).toISOString(),
      elapsedMinutes,
      remainingMs,
      waitMs: remainingMs,
    };
  }

  metaSet(db, key, String(now));
  const claimedNextMs = now + intervalMs;
  return {
    allowed: true,
    lastAttemptMs: now,
    lastAttemptAt: new Date(now).toISOString(),
    nextAllowedMs: claimedNextMs,
    nextAllowedAt: new Date(claimedNextMs).toISOString(),
    elapsedMinutes,
    remainingMs: 0,
    waitMs: 0,
  };
}
