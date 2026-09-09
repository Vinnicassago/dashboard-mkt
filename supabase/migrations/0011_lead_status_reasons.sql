-- Régua nova de status do lead: "perdido" virou QUATRO motivos (contato
-- inválido, sem resposta, não tem interesse, desistência) e os dois estágios do
-- meio ganharam nome próprio (agendado, reuniao_realizada).
--
-- A coluna é text livre — não há enum/CHECK para alterar, só o conteúdo.
-- Idempotente: num banco já migrado nenhuma linha casa.
--
-- ATENÇÃO ao 'perdido': a régua antiga não guardava o motivo, então não há de
-- onde tirar um. Essas linhas caem em 'sem_resposta', a leitura que menos afirma
-- sobre o lead — logo, a quebra de perdas de períodos anteriores a esta migração
-- não deve ser lida como diagnóstico.
update leads set status = 'agendado'          where status = 'agendou';
update leads set status = 'reuniao_realizada' where status = 'compareceu';
update leads set status = 'sem_resposta'      where status = 'perdido';

-- O log de auditoria guarda os mesmos rótulos em from_status/to_status.
update lead_events set from_status = 'agendado'          where from_status = 'agendou';
update lead_events set from_status = 'reuniao_realizada' where from_status = 'compareceu';
update lead_events set from_status = 'sem_resposta'      where from_status = 'perdido';
update lead_events set to_status   = 'agendado'          where to_status   = 'agendou';
update lead_events set to_status   = 'reuniao_realizada' where to_status   = 'compareceu';
update lead_events set to_status   = 'sem_resposta'      where to_status   = 'perdido';
