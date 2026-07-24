-- Fase 3: identificadores de matching capturados na landing page.
--
-- Guardados para que um evento server-side posterior (Schedule, quando o lead
-- agenda a reunião) consiga ser casado à mesma pessoa pela Meta/GA4. Não são
-- e-mail nem telefone — esses são hasheados na entrada e descartados.

alter table leads add column if not exists fbc            text;
alter table leads add column if not exists fbp            text;
alter table leads add column if not exists ga_client_id   text;
alter table leads add column if not exists ga_session_id  text;
