// Owner-only list of PyDaily visitors, for admin.html.
// Needs the X-Admin-Key header to match the ADMIN_KEY set in Vercel.
import { timingSafeEqual } from "node:crypto";
import { json, reply, redis, redisReady } from "./_shared.js";

const MAX_USERS = 300;

function keyMatches(given) {
  const expected = process.env.ADMIN_KEY || "";
  const a = Buffer.from(String(given || "")), b = Buffer.from(expected);
  return expected.length >= 8 && a.length === b.length && timingSafeEqual(a, b);
}

export async function GET(request) {
  if (!process.env.ADMIN_KEY) return reply(503, "ADMIN_KEY isn't set in Vercel yet.");
  if (!keyMatches(request.headers.get("x-admin-key"))) return reply(401, "Wrong admin key.");
  if (!redisReady()) return reply(503, "The database isn't connected yet.");

  try {
    const [ids] = await redis([["ZREVRANGE", "users", 0, MAX_USERS - 1]]);
    if (!ids.length) return json(200, { users: [] });
    const results = await redis(ids.flatMap((id) => [["HGETALL", `user:${id}`], ["LRANGE", `events:${id}`, 0, 9]]));
    const users = ids.map((id, i) => {
      const flat = results[i * 2] || [];
      const user = { id };
      for (let k = 0; k < flat.length; k += 2) user[flat[k]] = /^\d+$/.test(flat[k + 1]) ? +flat[k + 1] : flat[k + 1];
      user.recent = (results[i * 2 + 1] || []).map((e) => { try { return JSON.parse(e); } catch { return null; } }).filter(Boolean);
      return user;
    });
    return json(200, { users });
  } catch (err) {
    console.error("users failed:", err);
    return reply(502, "Couldn't read the database.");
  }
}
