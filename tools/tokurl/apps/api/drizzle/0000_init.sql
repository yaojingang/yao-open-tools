create extension if not exists pgcrypto;

create table if not exists links (
  id uuid primary key default gen_random_uuid(),
  slug varchar(64) not null,
  target_url text not null,
  title varchar(160),
  description text,
  is_active boolean not null default true,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  click_count integer not null default 0,
  last_clicked_at timestamptz
);

create unique index if not exists links_slug_unique on links (slug);
create index if not exists links_created_at_idx on links (created_at);

create table if not exists clicks (
  id bigint generated always as identity primary key,
  link_id uuid not null references links(id) on delete cascade,
  slug varchar(64) not null,
  clicked_at timestamptz not null default now(),
  referrer text,
  user_agent text,
  ip_hash varchar(96),
  source varchar(32) not null default 'redirect'
);

create index if not exists clicks_link_id_clicked_at_idx on clicks (link_id, clicked_at);
create index if not exists clicks_slug_clicked_at_idx on clicks (slug, clicked_at);
