-- Nada de lead se perde.
--
-- Até aqui, excluir um lead apagava a linha E todo o histórico dele, e
-- "Restaurar dados de exemplo" apagava o histórico de todos. A partir daqui:
--   • exclusão é reversível (deleted_at/by/reason) — o lead some das listas e
--     métricas, a linha e os eventos ficam;
--   • o histórico tem marca e detalhe do evento (motivo, contato novo num reenvio);
--   • ações que mexem em muitos dados de uma vez ficam registradas em audit_log.
--
-- Idempotente: pode rodar mais de uma vez. Espelho do bloco 0013 de
-- src/lib/db/schema.ts (que o backend Postgres aplica sozinho).

alter table leads add column if not exists deleted_at timestamptz;
alter table leads add column if not exists deleted_by text;
alter table leads add column if not exists deleted_reason text;

alter table lead_events add column if not exists brand text;
alter table lead_events add column if not exists payload jsonb;
update lead_events e set brand = l.brand
  from leads l where l.id = e.lead_id and e.brand is null;
create index if not exists lead_events_brand_idx on lead_events (brand, created_at desc);

create table if not exists audit_log (
  id text primary key,
  at timestamptz not null default now(),
  actor text not null default '',
  action text not null,
  detail text
);
create index if not exists audit_log_at_idx on audit_log (at desc);

alter table audit_log enable row level security;
