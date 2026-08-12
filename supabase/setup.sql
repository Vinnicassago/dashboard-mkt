-- ============================================================================
-- Dashboard de Campanha — schema completo (cole TUDO isto no SQL Editor do
-- Supabase e clique em "Run"). É seguro rodar mais de uma vez.
-- ============================================================================

-- Campanha
create table if not exists campaign (
  id            text primary key,
  brand         text        not null default 'consorcio',
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
  brand               text not null default 'consorcio',
  date                date not null,
  followers           integer not null default 0,
  reach               integer not null default 0,
  views               integer not null default 0,
  profile_link_taps   integer not null default 0,
  accounts_engaged    integer not null default 0,
  total_interactions  integer not null default 0,
  profile_views       integer not null default 0,
  reach_followers     integer,
  reach_non_followers integer,
  primary key (brand, date)
);

-- Instagram — posts
create table if not exists ig_posts (
  id              text primary key,
  brand           text        not null default 'consorcio',
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
  brand         text not null default 'consorcio',
  name          text not null,
  format        text not null default 'imagem',
  thumbnail_url text,
  video_plays   integer,
  thru_plays    integer
);

-- Tráfego pago — desempenho diário por anúncio
create table if not exists ad_daily (
  brand       text    not null default 'consorcio',
  date        date    not null,
  ad_id       text    not null,
  campaign    text    not null default '',
  adset       text    not null default '',
  objective   text,
  spend       numeric not null default 0,
  impressions integer not null default 0,
  reach       integer not null default 0,
  frequency   numeric not null default 0,
  clicks      integer not null default 0,
  leads       integer not null default 0,
  primary key (brand, date, ad_id)
);

-- Landing page — contadores diários
create table if not exists lp_daily (
  brand         text not null default 'consorcio',
  date          date not null,
  visits        integer not null default 0,
  clicks        integer not null default 0,
  form_submits  integer not null default 0,
  primary key (brand, date)
);

-- Leads (contém dados pessoais — protegido por RLS)
create table if not exists leads (
  id            text primary key,
  brand         text        not null default 'consorcio',
  created_at    timestamptz not null,
  name          text        not null,
  email         text,
  phone         text,
  utm_source    text,
  utm_campaign  text,
  utm_content   text,
  status        text        not null default 'lead',
  meeting_at    timestamptz,
  value         numeric,
  fbc           text,
  fbp           text,
  ga_client_id  text,
  ga_session_id text
);

-- Metas
create table if not exists goals (
  brand            text    not null default 'consorcio',
  metric           text    not null,
  period           text    not null,
  target           numeric not null,
  lower_is_better  boolean not null default false,
  primary key (brand, metric, period)
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
alter table ig_account_daily add column if not exists reach_followers integer;
alter table ig_account_daily add column if not exists reach_non_followers integer;
alter table ad_daily         add column if not exists objective text;
alter table leads            add column if not exists value numeric;
-- Etapa 2 do diagnóstico: duração de reel + taxonomia + conversas de DM (manuais)
alter table ig_posts         add column if not exists duration_sec numeric;
alter table ig_posts         add column if not exists pillar text;
alter table ig_posts         add column if not exists cta_type text;
alter table ig_account_daily add column if not exists dm_conversations integer;
-- Etapa 3: vínculo orgânico<->pago, posts de teste, atribuição por post e follows brutos
alter table ig_posts         add column if not exists profile_visits integer;
alter table ig_posts         add column if not exists follows integer;
alter table ig_posts         add column if not exists media_url text;
alter table ig_posts         add column if not exists thumbnail_url text;
alter table ig_posts         add column if not exists is_test boolean not null default false;
alter table ig_account_daily add column if not exists follows_day integer;
alter table ig_account_daily add column if not exists unfollows_day integer;
alter table ig_account_daily add column if not exists link_taps_website integer;
alter table ig_account_daily add column if not exists link_taps_whatsapp integer;
alter table creatives        add column if not exists instagram_media_id text;
alter table creatives        add column if not exists instagram_permalink text;

-- Multimarca (krone.capital + consorcio.brunno): carimba cada linha com a marca.
-- Bancos já existentes recebem 'brand' com default 'consorcio' (backfill) e têm as
-- PKs recompostas para incluir a marca — evita que a linha diária/meta de uma marca
-- sobrescreva a de outra na mesma data.
alter table campaign         add column if not exists brand text not null default 'consorcio';
alter table ig_account_daily add column if not exists brand text not null default 'consorcio';
alter table ig_posts         add column if not exists brand text not null default 'consorcio';
alter table creatives        add column if not exists brand text not null default 'consorcio';
alter table ad_daily         add column if not exists brand text not null default 'consorcio';
alter table lp_daily         add column if not exists brand text not null default 'consorcio';
alter table leads            add column if not exists brand text not null default 'consorcio';
alter table goals            add column if not exists brand text not null default 'consorcio';

do $$
begin
  if not exists (
    select 1 from pg_constraint c
    join lateral unnest(c.conkey) as k(attnum) on true
    join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum
    where c.conrelid = 'ig_account_daily'::regclass and c.contype = 'p' and a.attname = 'brand'
  ) then
    alter table ig_account_daily drop constraint if exists ig_account_daily_pkey;
    alter table ig_account_daily add constraint ig_account_daily_pkey primary key (brand, date);
  end if;
  if not exists (
    select 1 from pg_constraint c
    join lateral unnest(c.conkey) as k(attnum) on true
    join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum
    where c.conrelid = 'lp_daily'::regclass and c.contype = 'p' and a.attname = 'brand'
  ) then
    alter table lp_daily drop constraint if exists lp_daily_pkey;
    alter table lp_daily add constraint lp_daily_pkey primary key (brand, date);
  end if;
  if not exists (
    select 1 from pg_constraint c
    join lateral unnest(c.conkey) as k(attnum) on true
    join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum
    where c.conrelid = 'ad_daily'::regclass and c.contype = 'p' and a.attname = 'brand'
  ) then
    alter table ad_daily drop constraint if exists ad_daily_pkey;
    alter table ad_daily add constraint ad_daily_pkey primary key (brand, date, ad_id);
  end if;
  if not exists (
    select 1 from pg_constraint c
    join lateral unnest(c.conkey) as k(attnum) on true
    join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum
    where c.conrelid = 'goals'::regclass and c.contype = 'p' and a.attname = 'brand'
  ) then
    alter table goals drop constraint if exists goals_pkey;
    alter table goals add constraint goals_pkey primary key (brand, metric, period);
  end if;
end $$;

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

-- ---------------------------------------------------------------------------
-- Etapa 1 (produção): peças ANTES de publicar. O painel só conhecia post já
-- publicado (vindo da API); sem esta tabela não há o que validar contra o guia.
-- Espelha `src/lib/db/schema.ts` — mantenha os dois em sincronia.
create table if not exists post_drafts (
  id text primary key,
  brand text not null default 'consorcio',
  status text not null default 'rascunho',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  planned_for date,
  type text not null default 'reel',
  pillar text,
  hook_text text not null default '',
  hook_spoken text not null default '',
  promise text,
  script text not null default '',
  caption text not null default '',
  cta_type text,
  cta_keyword text,
  duration_sec numeric,
  has_burned_captions boolean not null default false,
  score numeric,
  validated_at timestamptz,
  playbook_version text,
  published_post_id text,
  notes text,
  ai_review jsonb,
  validation_failed jsonb
);

create index if not exists post_drafts_planned_idx on post_drafts (brand, planned_for);

alter table post_drafts enable row level security;

-- Etapa 4: loop fechado e rotina diária de presença.
alter table post_drafts      add column if not exists validation_failed jsonb;
alter table ig_account_daily add column if not exists stories_posted integer;
alter table ig_account_daily add column if not exists stories_interactive integer;
alter table ig_account_daily add column if not exists niche_comments integer;
alter table ig_account_daily add column if not exists accounts_followed integer;
alter table ig_account_daily add column if not exists replied_all boolean;
