-- Envios à Meta (Fase 7, D9).
--
-- Idempotente. Espelho do bloco 0020 de src/lib/db/schema.ts.

-- 0020 — envios à Meta (Fase 7, D9).
-- • capi_envios: a caixa de saída da Conversions API. Uma linha por (evento,
--   event_id) — o id é "<evento>:<event_id>", a mesma chave com que a Meta
--   deduplica —, com status (pendente, enviado, expirado), tentativas, próxima
--   tentativa e o último erro. O payload é o evento já montado (PII em hash) e só
--   existe enquanto falta enviar: ao sair ou expirar vira null, então IP e
--   navegador da visita não ficam guardados. Nova tentativa só dentro de 48 h do
--   fato (a janela de deduplicação): depois, reenviar poderia contar duas vezes.
create table if not exists capi_envios (
  id text primary key,
  brand text not null,
  lead_id text not null,
  event_name text not null,
  event_id text not null,
  event_time timestamptz not null,
  status text not null default 'pendente',
  tentativas integer not null default 0,
  proxima_tentativa timestamptz,
  ultimo_erro text,
  enviado_em timestamptz,
  teste boolean not null default false,
  fbtrace_id text,
  -- Só em "expirado": janela | recusado | teste | sem-payload.
  motivo text,
  payload jsonb,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
create index if not exists capi_envios_lead_idx on capi_envios (lead_id);
create index if not exists capi_envios_fila_idx on capi_envios (status, proxima_tentativa);
create index if not exists capi_envios_brand_idx on capi_envios (brand, criado_em desc);
-- Como as demais: fechada por RLS (o painel acessa com a chave de serviço).
alter table capi_envios enable row level security;
