-- O robô de WhatsApp no lead (Fase 1, nov/26).
--
-- Idempotente. Espelho do bloco 0023 de src/lib/db/schema.ts. Só colunas novas,
-- todas opcionais, sem índice e sem backfill: nenhum lead existente muda.
-- Rode ANTES de subir o código no backend Supabase: o insert do lead manda
-- todas as colunas, e sem elas todo lead novo falharia.

-- • Só o sync do robô grava (lib/robo/sync.ts, a cada 15 min): fatos gravados
--   UMA VEZ (visto, recebido, 1ª mensagem, respondeu, convite, aceitou, sem
--   WhatsApp, opt-out) e o estado da última leitura, que SOBRESCREVE (última
--   mensagem, última interação, etapa, cobranças, encerrado, pausado).
-- • O robô NÃO é tentativa: nada disto entra na cadência nem no 1º contato.
-- • Sem texto de conversa, nome ou telefone do robô (LGPD): só datas, a etapa
--   e contagens. O status do lead nunca muda pelo sync.
alter table leads add column if not exists robo_visto_em timestamptz;
alter table leads add column if not exists robo_recebido_em timestamptz;
alter table leads add column if not exists robo_saudacao_em timestamptz;
alter table leads add column if not exists robo_respondeu_em timestamptz;
alter table leads add column if not exists robo_ultima_msg_cliente_em timestamptz;
alter table leads add column if not exists robo_ultima_interacao_em timestamptz;
alter table leads add column if not exists robo_etapa text;
alter table leads add column if not exists robo_cobrancas integer;
alter table leads add column if not exists robo_ultima_cobranca_em timestamptz;
alter table leads add column if not exists robo_convite_em timestamptz;
alter table leads add column if not exists robo_aceitou_em timestamptz;
alter table leads add column if not exists robo_sem_whatsapp_em timestamptz;
alter table leads add column if not exists robo_encerrado_em timestamptz;
alter table leads add column if not exists robo_opt_out_em timestamptz;
alter table leads add column if not exists robo_pausado boolean;
