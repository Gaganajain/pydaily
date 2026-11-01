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

// Supabase over its REST API (tables and SQL functions from supabase.sql).
// The key must be the server-only secret key, never the public anon/publishable one.
const SB_URL = () => (process.env.SUPABASE_URL || "").replace(/\/+$/, "");
const SB_KEY = () => process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
export const dbReady = () => !!(SB_URL() && SB_KEY());

// path is relative to /rest/v1/, e.g. "rpc/track_event" or "visitors?select=*"
export async function supabase(path, { method = "GET", body } = {}) {
  const key = SB_KEY();
  const headers = { apikey: key, "Content-Type": "application/json" };
  if (key.startsWith("eyJ")) headers.Authorization = `Bearer ${key}`; // older JWT-style service_role keys
  const res = await fetch(`${SB_URL()}/rest/v1/${path}`, { method, headers, body: body && JSON.stringify(body) });
  const text = await res.text();
  if (!res.ok) throw new Error(`supabase ${res.status}: ${text.slice(0, 200)}`);
  return text ? JSON.parse(text) : null;
}
