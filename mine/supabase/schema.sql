-- Supabase schema for TUMO Web Mining MVP

create table if not exists users(
  id bigserial primary key,
  wallet text unique not null,
  created_at timestamptz default now()
);

create table if not exists mining_events(
  id bigserial primary key,
  user_id bigint references users(id) on delete cascade,
  points integer not null,
  reason text,
  created_at timestamptz default now()
);

create table if not exists daily_pools(
  day date primary key,
  e_day numeric not null,
  source jsonb
);

create table if not exists claimables(
  id bigserial primary key,
  day date not null,
  user_id bigint references users(id) on delete cascade,
  amount numeric not null,
  claimed boolean default false,
  unique(day, user_id)
);

create table if not exists claims(
  id bigserial primary key,
  user_id bigint references users(id) on delete cascade,
  day date not null,
  sig text,
  created_at timestamptz default now()
);

-- RPC: sum of points in a period
create or replace function sum_points(from_ts timestamptz, to_ts timestamptz)
returns table(sum_points bigint) language sql as $$
  select coalesce(sum(points),0)::bigint as sum_points
  from mining_events
  where created_at >= from_ts and created_at < to_ts;
$$;

-- RPC: points by user in a period
create or replace function points_by_user(from_ts timestamptz, to_ts timestamptz)
returns table(user_id bigint, points bigint) language sql as $$
  select user_id, coalesce(sum(points),0)::bigint as points
  from mining_events
  where created_at >= from_ts and created_at < to_ts
  group by user_id;
$$;

