-- Bússola (Fase 5).
--
-- Idempotente. Espelho do bloco 0018 de src/lib/db/schema.ts.

-- • acoes_estado: o que alguém decidiu sobre uma ação do motor numa semana
--   (feita, ignorada, reaberta). Só se INSERE: a última linha de (marca, semana,
--   ação) é o estado atual e as anteriores são o histórico — ninguém apaga nem
--   sobrescreve uma decisão. Na semana seguinte a ação volta a ser avaliada do zero.
-- • resumos_semanais: a leitura da semana escrita pela IA. Uma linha por geração
--   (cron de segunda ou regerada à mão); a Bússola mostra a mais recente e guarda
--   as anteriores como histórico.
create table if not exists acoes_estado (
  id text primary key,
  brand text not null,
  semana date not null,
  acao text not null,
  estado text not null,
  motivo text,
  titulo text not null default '',
  por text not null default '',
  em timestamptz not null default now()
);
create index if not exists acoes_estado_idx on acoes_estado (brand, semana, acao, em desc);
create table if not exists resumos_semanais (
  id text primary key,
  brand text not null,
  semana date not null,
  periodo_de date not null,
  periodo_ate date not null,
  analise jsonb not null,
  origem text not null default 'cron',
  criado_em timestamptz not null default now()
);
create index if not exists resumos_semanais_idx on resumos_semanais (brand, semana desc, criado_em desc);
-- Como as tabelas de 0001-0013: fechadas por RLS (o painel acessa com a chave de serviço).
alter table acoes_estado enable row level security;
alter table resumos_semanais enable row level security;
