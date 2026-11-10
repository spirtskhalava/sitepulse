create table crawls (
  id               bigserial primary key,
  url              text not null,
  max_pages        int not null default 200,
  status           text not null default 'queued'
                   check (status in ('queued', 'running', 'done', 'failed', 'cancelled')),
  crawled          int not null default 0,
  cancel_requested boolean not null default false,
  worker_id        text,
  error            text,
  summary          jsonb,
  created_at       timestamptz not null default now(),
  started_at       timestamptz,
  finished_at      timestamptz,
  heartbeat_at     timestamptz
);

-- the worker only ever looks for the oldest queued crawl
create index crawls_queued_idx on crawls (created_at) where status = 'queued';
create index crawls_created_idx on crawls (created_at desc);

create table pages (
  id                 bigserial primary key,
  crawl_id           bigint not null references crawls(id) on delete cascade,
  url                text not null,
  final_url          text not null,
  status             int not null,
  redirects          text[] not null default '{}',
  content_type       text not null default '',
  bytes              int not null default 0,
  ms                 int not null default 0,
  depth              int not null default 0,
  title              text,
  description        text,
  canonical          text,
  robots             text,
  h1                 text[] not null default '{}',
  images_without_alt int not null default 0,
  internal_links     int not null default 0,
  external_links     int not null default 0,
  error              text,
  issue_count        int not null default 0,
  unique (crawl_id, url)
);

create index pages_issue_count_idx on pages (crawl_id, issue_count desc);

create table issues (
  id       bigserial primary key,
  crawl_id bigint not null references crawls(id) on delete cascade,
  type     text not null,
  severity text not null,
  url      text not null,
  detail   text
);

create index issues_crawl_type_idx on issues (crawl_id, type);
