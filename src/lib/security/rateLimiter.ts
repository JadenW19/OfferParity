const WINDOW_MS = 60_000;
const MAX_TRACKED_KEYS = 5_000;

const requestBuckets = new Map<string, number[]>();

export interface RateLimitDecision {
  allowed: boolean;
  limit: number;
  remaining: number;
  retryAfterSeconds: number;
}

export function getClientIp(req: Request): string {
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) {
    const firstHop = forwarded.split(",")[0]?.trim();
    if (firstHop) return firstHop;
  }
  const realIp = req.headers.get("x-real-ip")?.trim();
  if (realIp) return realIp;
  return "127.0.0.1";
}

export function getConfiguredSingleRpm(): number {
  const raw = process.env.RATE_LIMIT_RPM?.trim();
  if (!raw) return 30;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 30;
}

export function checkRateLimit(
  bucketKey: string,
  limitPerMinute: number,
  options?: { nowMs?: number; forceEnableInTest?: boolean }
): RateLimitDecision {
  if (process.env.NODE_ENV === "test" && !options?.forceEnableInTest) {
    return {
      allowed: true,
      limit: limitPerMinute,
      remaining: limitPerMinute,
      retryAfterSeconds: 0,
    };
  }

  const now = options?.nowMs ?? Date.now();
  const cutoff = now - WINDOW_MS;

  if (requestBuckets.size > MAX_TRACKED_KEYS && !requestBuckets.has(bucketKey)) {
    const oldestKey = requestBuckets.keys().next().value;
    if (oldestKey !== undefined) {
      requestBuckets.delete(oldestKey);
    }
  }

  const existing = requestBuckets.get(bucketKey) ?? [];
  const activeTimestamps = existing.filter((ts) => ts > cutoff);

  if (activeTimestamps.length >= limitPerMinute) {
    requestBuckets.set(bucketKey, activeTimestamps);
    const oldestInWindow = activeTimestamps[0] ?? now;
    const retryAfterMs = Math.max(1000, oldestInWindow + WINDOW_MS - now);
    return {
      allowed: false,
      limit: limitPerMinute,
      remaining: 0,
      retryAfterSeconds: Math.ceil(retryAfterMs / 1000),
    };
  }

  activeTimestamps.push(now);
  requestBuckets.set(bucketKey, activeTimestamps);

  return {
    allowed: true,
    limit: limitPerMinute,
    remaining: Math.max(0, limitPerMinute - activeTimestamps.length),
    retryAfterSeconds: 0,
  };
}

export function resetRateLimiterForTests(): void {
  requestBuckets.clear();
}
