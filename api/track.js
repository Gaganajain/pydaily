// Records who uses PyDaily: one Redis hash per visitor plus their last 50 events.
// Visitors choose their own name on the site; no name means "anonymous".
import { corsHeaders, foreignOrigin, reply, clientIp, rateLimiter, redis, redisReady } from "./_shared.js";

const EVENTS = ["visit", "lesson", "quiz", "ask", "name"];
const COUNTERS = { visit: "visits", lesson: "lessons", quiz: "quizzes", ask: "asks" };
const rateLimited = rateLimiter(60, 10 * 60 * 1000);

const clean = (s, max) => String(s ?? "").replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, max);
const num = (n) => (Number.isFinite(+n) ? Math.max(0, Math.min(1e6, Math.round(+n))) : 0);

export function OPTIONS(request) {
  return new Response(null, { status: 204, headers: corsHeaders(request.headers.get("origin")) });
}

export async function POST(request) {
  const origin = request.headers.get("origin");
  const cors = corsHeaders(origin);
  if (foreignOrigin(origin, cors)) return reply(403, "Not allowed.");
  if (!redisReady()) return new Response(null, { status: 204, headers: cors }); // tracking not set up yet
  if (rateLimited(clientIp(request))) return reply(429, "Too many events.", cors);

  let body;
  try { body = await request.json(); } catch { return reply(400, "Bad event.", cors); }
  const id = clean(body?.id, 32);
  const event = body?.event;
  if (!/^[a-z0-9]{8,32}$/.test(id) || !EVENTS.includes(event)) return reply(400, "Bad event.", cors);

  const now = Date.now();
  const stats = body.stats || {};
  const data = {};
  for (const [k, v] of Object.entries(body.data || {}).slice(0, 6)) data[clean(k, 20)] = typeof v === "number" ? num(v) : clean(v, 60);

  const key = `user:${id}`;
  const fields = [
    "name", clean(body.name, 40),
    "lastSeen", now,
    "done", num(stats.done), "streak", num(stats.streak), "xp", num(stats.xp), "examBest", num(stats.examBest),
  ];
  if (event === "lesson" && data.lesson) fields.push("lastLesson", data.lesson);
  const commands = [
    ["HSET", key, ...fields],
    ["HSETNX", key, "firstSeen", now],
    ["ZADD", "users", now, id],
    ["LPUSH", `events:${id}`, JSON.stringify({ t: now, event, ...data })],
    ["LTRIM", `events:${id}`, 0, 49],
  ];
  if (COUNTERS[event]) commands.push(["HINCRBY", key, COUNTERS[event], 1]);

  try {
    await redis(commands);
  } catch (err) {
    console.error("track failed:", err);
    return reply(502, "Couldn't save.", cors);
  }
  return new Response(null, { status: 204, headers: cors });
}
