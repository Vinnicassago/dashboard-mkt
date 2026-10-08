-- O processo comercial instrumentado.
--
-- • first_contact_at: marco da 1ª tentativa de contato (gravado uma vez) — mede
--   velocidade de contato, a alavanca nº 1 com o robô parado.
-- • lost_reason_detail: por que o contato é inválido (número não existe, sem
--   WhatsApp, pessoa errada…), que separa problema de formulário de problema de base.
-- • lead_events.occurred_at: quando o fato ACONTECEU, separado de quando foi
--   registrado (created_at). A diferença mede o atraso de registro.
--
-- Os status novos ("em_contato", "no_show") não pedem DDL: status é texto.
-- Idempotente. Espelho do bloco 0015 de src/lib/db/schema.ts.

alter table leads add column if not exists first_contact_at timestamptz;
alter table leads add column if not exists lost_reason_detail text;
alter table lead_events add column if not exists occurred_at timestamptz;
