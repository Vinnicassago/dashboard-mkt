-- Dashboard de Campanha — schema inicial (Fase 2)
-- Rode no SQL Editor do Supabase (ou via CLI: supabase db push).
--
-- RLS fica LIGADA e sem policies de propósito: o app acessa apenas pelo
-- service role (server-side), que ignora RLS. Assim a anon key não lê nada —
-- importante porque a tabela `leads` contém dados pessoais (LGPD).

create table if not exists campaign (
  id            text primary key,
  name          text        not null,
  objective     text        not null default '',
  status        text        not null default 'ativa',
  start_date    date        not null,
  end_date      date,
  budget_total  numeric     not null default 0,
  daily_budget  numeric
);

create table if not exists ig_account_daily (
  date                date primary key,
  followers           integer not null default 0,
  reach               integer not null default 0,
  views               integer not null default 0,
  profile_link_taps   integer not null default 0,
  accounts_engaged    integer not null default 0,
  total_interactions  integer not null default 0
);

create table if not exists ig_posts (
  id              text primary key,
  published_at    timestamptz not null,
  type            text        not null,
  caption         text        not null default '',
  permalink       text        not null default '',
  reach           integer     not null default 0,
  views           integer     not null default 0,
  likes           integer     not null default 0,
  comments        integer     not null default 0,
  saved           integer     not null default 0,
  shares          integer     not null default 0,
  avg_watch_time  numeric
);

create table if not exists creatives (
  ad_id         text primary key,
  name          text not null,
  format        text not null default 'imagem',
  thumbnail_url text,
  video_plays   integer,
  thru_plays    integer
);

create table if not exists ad_daily (
  date        date    not null,
  ad_id       text    not null,
  campaign    text    not null default '',
  adset       text    not null default '',
  spend       numeric not null default 0,
  impressions integer not null default 0,
  reach       integer not null default 0,
  frequency   numeric not null default 0,
  clicks      integer not null default 0,
  leads       integer not null default 0,
  primary key (date, ad_id)
);

create table if not exists lp_daily (
  date          date primary key,
  visits        integer not null default 0,
  clicks        integer not null default 0,
  form_submits  integer not null default 0
);

create table if not exists leads (
  id            text primary key,
  created_at    timestamptz not null,
  name          text        not null,
  utm_source    text,
  utm_campaign  text,
  utm_content   text,
  status        text        not null default 'lead',
  meeting_at    timestamptz
);

create table if not exists goals (
  metric           text    not null,
  period           text    not null,
  target           numeric not null,
  lower_is_better  boolean not null default false,
  primary key (metric, period)
);

-- chave/valor para metadados: updated_at, is_seed, últimas sincronizações
-- e o token de longa duração do Instagram (renovado automaticamente).
create table if not exists app_state (
  key         text primary key,
  value       jsonb       not null,
  updated_at  timestamptz not null default now()
);

create index if not exists ad_daily_date_idx   on ad_daily (date);
create index if not exists leads_created_idx   on leads (created_at desc);
create index if not exists ig_posts_pub_idx    on ig_posts (published_at desc);

alter table campaign          enable row level security;
alter table ig_account_daily  enable row level security;
alter table ig_posts          enable row level security;
alter table creatives         enable row level security;
alter table ad_daily          enable row level security;
alter table lp_daily          enable row level security;
alter table leads             enable row level security;
alter table goals             enable row level security;
alter table app_state         enable row level security;
