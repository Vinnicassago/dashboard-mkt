-- Conferência do gasto com o Gerenciador (E2-23).
--
-- Idempotente. Espelho do bloco 0022 de src/lib/db/schema.ts. Tabela nova; nada
-- existente muda.

-- Só se insere: cada conferência guarda o período, o gasto do painel na hora, o que a pessoa
-- digitou do Gerenciador, a diferença (%) e o último sync que deu certo — o
-- histórico é a prova de quando o número bateu (ou não).
create table if not exists conferencias_gasto (
  id text primary key,
  brand text not null,
  periodo_de date not null,
  periodo_ate date not null,
  gasto_painel numeric not null,
  gasto_gerenciador numeric not null,
  diferenca numeric,
  ultimo_sync timestamptz,
  criada_em timestamptz not null default now(),
  criada_por text not null
);
create index if not exists conferencias_gasto_idx on conferencias_gasto (brand, criada_em desc);
-- Como as demais: fechada por RLS (o painel acessa com a chave de serviço).
alter table conferencias_gasto enable row level security;
