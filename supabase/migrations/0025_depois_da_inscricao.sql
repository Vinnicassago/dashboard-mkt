-- Depois da inscrição na live: o clique em "Entrar na comunidade" e o Diagnóstico
-- do Próximo Patrimônio, que chegam pelo /api/track (tipos `comunidade` e
-- `diagnostico`).
--
-- Idempotente. Espelho do bloco 0025 de src/lib/db/schema.ts. Só TABELAS NOVAS:
-- nenhuma tabela existente muda e nenhum dado é reescrito.
--
-- • comunidade_cliques: um por event_id (o mesmo do lead); o 1º horário fica.
--   Com o lead achado, o 1º clique também vira leads.comunidade_em (coluna 0021).
-- • diagnosticos: uma linha por tentativa, com o estado do ÚLTIMO evento (a lista
--   de respostas vem sempre completa); concluido_em = o 1º resultado (fato). A
--   ligação com o lead é pelo telefone (DDD + 8 últimos dígitos), na leitura.
-- PII: o telefone fica aqui para a ligação e a lista "sem inscrição" — fechada
-- por RLS como as demais (o painel acessa com a chave de serviço).
create table if not exists comunidade_cliques (
  event_id text primary key,
  primeiro_em timestamptz not null,
  ultimo_em timestamptz not null,
  cliques integer not null default 1,
  lead_id text,
  page_url text
);
alter table comunidade_cliques enable row level security;

create table if not exists diagnosticos (
  tentativa text primary key,
  telefone text not null,
  chave_telefone text,
  etapa text not null,
  respondidas integer not null default 0,
  total integer not null default 9,
  respostas jsonb not null default '[]'::jsonb,
  perfil text,
  notas jsonb,
  conquistas integer,
  conquistas_total integer,
  page_url text,
  iniciado_em timestamptz not null,
  concluido_em timestamptz,
  atualizado_em timestamptz not null,
  eventos integer not null default 1
);
create index if not exists diagnosticos_chave_idx on diagnosticos (chave_telefone);
alter table diagnosticos enable row level security;
