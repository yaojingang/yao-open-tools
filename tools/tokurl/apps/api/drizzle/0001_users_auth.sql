create table if not exists users (
  id uuid primary key default gen_random_uuid(),
  email varchar(254) not null,
  name varchar(120),
  password_hash text not null,
  role varchar(16) not null default 'user' check (role in ('admin', 'user')),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_login_at timestamptz
);

create unique index if not exists users_email_unique on users (email);
create index if not exists users_role_idx on users (role);

alter table links add column if not exists owner_id uuid references users(id) on delete restrict;
create index if not exists links_owner_created_at_idx on links (owner_id, created_at);
