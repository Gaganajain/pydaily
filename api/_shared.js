// Helpers shared by the /api functions. Files starting with _ are not served as routes.

const ALLOWED_ORIGINS = [
  /^https:\/\/pydaily(-[a-z0-9-]+)?\.vercel\.app$/,
  /^https:\/\/gaganajain\.github\.io$/,
  /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/,
];

export function corsHeaders(origin, methods = "POST, OPTIONS") {
  return origin && ALLOWED_ORIGINS.some((re) => re.test(origin))
    ? { "Access-Control-Allow-Origin": origin, "Access-Control-Allow-Methods": methods, "Access-Control-Allow-Headers": "Content-Type, X-Admin-Key", Vary: "Origin" }
    : {};
}

// true when the request comes from a page that isn't PyDaily
export const foreignOrigin = (origin, cors) => !!origin && !Object.keys(cors).length;

export const reply = (status, text, headers = {}) =>
  new Response(text, { status, headers: { "Content-Type": "text/plain; charset=utf-8", ...headers } });

export const json = (status, data, headers = {}) =>
  new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...headers } });

export const clientIp = (request) => (request.headers.get("x-forwarded-for") || "unknown").split(",")[0].trim();

// Simple per-visitor limit. Each server instance keeps its own count, so it's best effort.
export function rateLimiter(max, windowMs) {
  const hits = new Map();
  return (key) => {
    const now = Date.now();
    const recent = (hits.get(key) || []).filter((t) => now - t < windowMs);
    recent.push(now);
    hits.set(key, recent);
    return recent.length > max;
  };
}

// Upstash Redis over its REST API. Vercel's Upstash integration sets one of these pairs.
const REDIS_URL = () => process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const REDIS_TOKEN = () => process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
export const redisReady = () => !!(REDIS_URL() && REDIS_TOKEN());

// Runs several Redis commands in one request; returns their results in order
export async function redis(commands) {
  const res = await fetch(`${REDIS_URL()}/pipeline`, {
    method: "POST",
    headers: { Authorization: `Bearer ${REDIS_TOKEN()}`, "Content-Type": "application/json" },
    body: JSON.stringify(commands),
  });
  if (!res.ok) throw new Error(`redis ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return (await res.json()).map((r) => {
    if (r.error) throw new Error(`redis: ${r.error}`);
    return r.result;
  });
}
