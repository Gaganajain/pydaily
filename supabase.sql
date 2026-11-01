-- PyDaily visitor tracking. Paste this whole file into Supabase → SQL Editor → Run.
-- Safe to run again: it only creates what's missing and replaces the function.

create table if not exists visitors (
  id          text primary key,
  name        text not null default '',
  first_seen  timestamptz not null default now(),
  last_seen   timestamptz not null default now(),
  visits      int not null default 0,
  lessons     int not null default 0,
  quizzes     int not null default 0,
  asks        int not null default 0,
  done        int not null default 0,
  streak      int not null default 0,
  xp          int not null default 0,
  exam_best   int not null default 0,
  last_lesson text
);

create table if not exists events (
  id         bigint generated always as identity primary key,
  visitor_id text not null references visitors(id) on delete cascade,
  t          timestamptz not null default now(),
  event      text not null,
  data       jsonb not null default '{}'
);
create index if not exists events_visitor_recent on events (visitor_id, id desc);

-- Lock both tables: with row level security on and no policies, the public
-- "anon" key can't read or write anything. Only the server (service role) can.
alter table visitors enable row level security;
alter table events enable row level security;

-- One call records an event: updates the visitor's row, adds to their counters,
-- and keeps only their latest 50 events.
create or replace function track_event(
  p_id text, p_name text, p_event text, p_data jsonb,
  p_done int, p_streak int, p_xp int, p_exam_best int
) returns void
language plpgsql
set search_path = public
as $$
begin
  insert into visitors as v (id, name, last_seen, done, streak, xp, exam_best, visits, lessons, quizzes, asks, last_lesson)
  values (p_id, p_name, now(), p_done, p_streak, p_xp, p_exam_best,
          (p_event = 'visit')::int, (p_event = 'lesson')::int, (p_event = 'quiz')::int, (p_event = 'ask')::int,
          case when p_event = 'lesson' then p_data->>'lesson' end)
  on conflict (id) do update set
    name        = excluded.name,
    last_seen   = now(),
    done        = excluded.done,
    streak      = excluded.streak,
    xp          = excluded.xp,
    exam_best   = excluded.exam_best,
    visits      = v.visits + excluded.visits,
    lessons     = v.lessons + excluded.lessons,
    quizzes     = v.quizzes + excluded.quizzes,
    asks        = v.asks + excluded.asks,
    last_lesson = coalesce(excluded.last_lesson, v.last_lesson);

  insert into events (visitor_id, event, data) values (p_id, p_event, p_data);

  delete from events
  where visitor_id = p_id
    and id < (select min(id) from (select id from events where visitor_id = p_id order by id desc limit 50) latest);
end;
$$;

-- Only the server may call it.
revoke execute on function track_event(text, text, text, jsonb, int, int, int, int) from public, anon, authenticated;
