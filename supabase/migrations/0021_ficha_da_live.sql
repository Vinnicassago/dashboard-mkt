-- Ficha da live de 01/12 (E1-15).
--
-- Idempotente. Espelho do bloco 0021 de src/lib/db/schema.ts. Só colunas novas,
-- todas opcionais: nenhum lead existente muda.

-- • As respostas do formulário (bem, faixa de valor, finalidade, faixa de
--   parcela, prazo) e as duas classes: a que o PAINEL calcula (lib/classe.ts,
--   recalculada quando uma resposta ou a tabela de parcela muda) e a que o n8n
--   mandou — discordar vira aviso.
-- • Os fatos da automação: mensagem automática (quando saiu e o status),
--   horário preferido, aviso ao atendimento, escalonamento, clique na comunidade
--   (gravados uma vez) e o diagnóstico (as respostas e o perfil, jsonb).
-- • Reunião confirmada / pediu para remarcar — estado da reunião marcada, limpo
--   quando a data muda. Tentativas e resultado continuam nos eventos
--   (lead_events): nada de contador no lead.
alter table leads add column if not exists bem text;
alter table leads add column if not exists faixa_valor text;
alter table leads add column if not exists finalidade text;
alter table leads add column if not exists faixa_parcela text;
alter table leads add column if not exists prazo_compra text;
alter table leads add column if not exists classe text;
alter table leads add column if not exists classe_n8n text;
alter table leads add column if not exists aceite_mensagens boolean;
alter table leads add column if not exists msg1_enviada_em timestamptz;
alter table leads add column if not exists msg1_status text;
alter table leads add column if not exists horario_preferido text;
alter table leads add column if not exists atendimento_avisado_em timestamptz;
alter table leads add column if not exists escalado_em timestamptz;
alter table leads add column if not exists comunidade_em timestamptz;
alter table leads add column if not exists diagnostico jsonb;
alter table leads add column if not exists reuniao_confirmada_em timestamptz;
alter table leads add column if not exists reuniao_remarcar_em timestamptz;
