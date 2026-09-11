alter table users add column if not exists session_version integer not null default 0;
update users set session_version = 1 where is_active = false and session_version = 0;
alter table site_settings add column if not exists registration_enabled boolean not null default true;
