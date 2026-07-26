-- ============================================================================
-- Dashboard de Campanha — schema completo (cole TUDO isto no SQL Editor do
-- Supabase e clique em "Run"). É seguro rodar mais de uma vez.
-- ============================================================================

-- Campanha
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

-- Instagram — snapshot diário da conta
create table if not exists ig_account_daily (
  date                date primary key,
  followers           integer not null default 0,
  reach               integer not null default 0,
  views               integer not null default 0,
  profile_link_taps   integer not null default 0,
  accounts_engaged    integer not null default 0,
  total_interactions  integer not null default 0,
  profile_views       integer not null default 0
);

-- Instagram — posts
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
  avg_watch_time  numeric,
  total_watch_time numeric
);

-- Criativos (anúncios)
create table if not exists creatives (
  ad_id         text primary key,
  name          text not null,
  format        text not null default 'imagem',
  thumbnail_url text,
  video_plays   integer,
  thru_plays    integer
);

-- Tráfego pago — desempenho diário por anúncio
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

-- Landing page — contadores diários
create table if not exists lp_daily (
  date          date primary key,
  visits        integer not null default 0,
  clicks        integer not null default 0,
  form_submits  integer not null default 0
);

-- Leads (contém dados pessoais — protegido por RLS)
create table if not exists leads (
  id            text primary key,
  created_at    timestamptz not null,
  name          text        not null,
  email         text,
  phone         text,
  utm_source    text,
  utm_campaign  text,
  utm_content   text,
  status        text        not null default 'lead',
  meeting_at    timestamptz,
  fbc           text,
  fbp           text,
  ga_client_id  text,
  ga_session_id text
);

-- Metas
create table if not exists goals (
  metric           text    not null,
  period           text    not null,
  target           numeric not null,
  lower_is_better  boolean not null default false,
  primary key (metric, period)
);

-- Chave/valor: updated_at, is_seed, últimas sincronizações, token do Instagram
create table if not exists app_state (
  key         text primary key,
  value       jsonb       not null,
  updated_at  timestamptz not null default now()
);

-- Usuários do painel (senha em hash scrypt) + papel de acesso
create table if not exists app_users (
  username      text primary key,
  password_hash text        not null,
  role          text        not null default 'marketing',
  created_at    timestamptz not null default now()
);

-- Log de auditoria dos leads (quem criou/alterou)
create table if not exists lead_events (
  id           text primary key,
  lead_id      text        not null,
  lead_name    text        not null default '',
  actor        text        not null default '',
  action       text        not null,
  from_status  text,
  to_status    text,
  created_at   timestamptz not null default now()
);

-- Índices
create index if not exists ad_daily_date_idx     on ad_daily (date);
create index if not exists leads_created_idx      on leads (created_at desc);
create index if not exists ig_posts_pub_idx       on ig_posts (published_at desc);
create index if not exists lead_events_created_idx on lead_events (created_at desc);
create index if not exists lead_events_lead_idx    on lead_events (lead_id);

-- Migrações idempotentes para bancos já existentes (adiciona colunas novas com segurança)
alter table ig_account_daily add column if not exists profile_views integer not null default 0;
alter table ig_posts         add column if not exists total_watch_time numeric;

-- Row Level Security ligada em tudo (só o service role, usado pelo servidor, acessa)
alter table campaign          enable row level security;
alter table ig_account_daily  enable row level security;
alter table ig_posts          enable row level security;
alter table creatives         enable row level security;
alter table ad_daily          enable row level security;
alter table lp_daily          enable row level security;
alter table leads             enable row level security;
alter table goals             enable row level security;
alter table app_state         enable row level security;
alter table app_users         enable row level security;
alter table lead_events       enable row level security;
