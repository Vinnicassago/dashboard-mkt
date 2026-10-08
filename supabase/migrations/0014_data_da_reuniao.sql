-- A data DA REUNIÃO.
--
-- meeting_at guardava o momento em que o status virou "Agendado" — esse fato já
-- é booked_at (0012). A reunião em si não tinha onde morar, então a coluna
-- "Reunião" de Pessoas mostrava a hora do clique. A partir daqui, agendar exige
-- a data e a hora, gravadas em meeting_for; meeting_at fica como legado.
--
-- Idempotente. Espelho do bloco 0014 de src/lib/db/schema.ts.

alter table leads add column if not exists meeting_for timestamptz;
