create table if not exists site_settings (
  id varchar(32) primary key,
  site_name varchar(120) not null,
  seo_title varchar(160) not null,
  seo_description text not null,
  seo_keywords text not null,
  updated_at timestamptz not null default now()
);
