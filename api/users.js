// Owner-only list of PyDaily visitors, for admin.html.
// Needs the X-Admin-Key header to match the ADMIN_KEY set in Vercel.
import { timingSafeEqual } from "node:crypto";
import { json, reply, supabase, dbReady } from "./_shared.js";

const MAX_USERS = 300;

function keyMatches(given) {
  const expected = process.env.ADMIN_KEY || "";
  const a = Buffer.from(String(given || "")), b = Buffer.from(expected);
  return expected.length >= 8 && a.length === b.length && timingSafeEqual(a, b);
}

const ms = (t) => (t ? Date.parse(t) : 0);

export async function GET(request) {
  if (!process.env.ADMIN_KEY) return reply(503, "ADMIN_KEY isn't set in Vercel yet.");
  if (!keyMatches(request.headers.get("x-admin-key"))) return reply(401, "Wrong admin key.");
  if (!dbReady()) return reply(503, "The database isn't connected yet.");

  try {
    const rows = await supabase(
      `visitors?select=*,events(t,event,data)&order=last_seen.desc&limit=${MAX_USERS}&events.order=id.desc&events.limit=10`,
    );
    const users = rows.map((r) => ({
      id: r.id, name: r.name,
      firstSeen: ms(r.first_seen), lastSeen: ms(r.last_seen),
      visits: r.visits, lessons: r.lessons, quizzes: r.quizzes, asks: r.asks,
      done: r.done, streak: r.streak, xp: r.xp, examBest: r.exam_best, lastLesson: r.last_lesson,
      recent: (r.events || []).map((e) => ({ t: ms(e.t), event: e.event, ...e.data })),
    }));
    return json(200, { users });
  } catch (err) {
    console.error("users failed:", err);
    return reply(502, "Couldn't read the database.");
  }
}
