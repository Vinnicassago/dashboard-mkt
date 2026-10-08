-- Um número por métrica (Fase 3).
--
-- Idempotente. Espelho do bloco 0016 de src/lib/db/schema.ts.

-- • sync_runs: cada sincronização, dê certo ou não, com a JANELA que cobriu. É o
--   que separa "dia sem veiculação" (coberto, sem linha) de "dia sem dados"
--   (nenhum sync cobriu) e mostra "falhando desde…" no lugar de silêncio.
-- • ad_daily.campaign_id: a regra de marca por id de campanha sobrevive a uma
--   reclassificação (antes só o nome ficava gravado).
-- • leads.utm_medium / utm_term / fbclid: a atribuição que a LP já mandava e o
--   painel descartava.
create table if not exists sync_runs (
  id text primary key,
  source text not null,
  brand text not null,
  started_at timestamptz not null,
  finished_at timestamptz not null,
  ok boolean not null,
  date_from date,
  date_to date,
  rows integer,
  error text
);
create index if not exists sync_runs_fonte_idx on sync_runs (source, brand, finished_at desc);
alter table ad_daily add column if not exists campaign_id text;
alter table leads add column if not exists utm_medium text;
alter table leads add column if not exists utm_term text;
alter table leads add column if not exists fbclid text;
