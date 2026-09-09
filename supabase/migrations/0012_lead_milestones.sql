-- Marcos do lead: o que ACONTECEU, com data.
--
-- Até aqui o painel contava reunião pelo STATUS ATUAL do lead
-- (`status in ('agendado','reuniao_realizada','cliente')`). Como status é um
-- campo único e mutável, e as perdas ficam abaixo de "lead" na régua, registrar
-- o desfecho de um lead apagava a reunião que ele teve — e o custo por reunião,
-- North Star do painel, ficava R$ 0,00 mesmo com reuniões acontecendo.
--
-- A partir daqui: `status` continua sendo o estado atual (rótulo, cor, fila) e
-- os marcos guardam o fato. A política de qual reunião entra no CPR
-- (desistência sai) passa a ser aplicada sobre o fato, deliberadamente, em vez
-- de ser um efeito colateral de sobrescrita. Ver src/lib/metrics.ts.
--
-- Idempotente: pode rodar mais de uma vez.

alter table leads add column if not exists booked_at timestamptz;
alter table leads add column if not exists attended_at timestamptz;
alter table leads add column if not exists closed_at timestamptz;
alter table leads add column if not exists lost_at timestamptz;
alter table leads add column if not exists robo_session_id text;

-- Um lead do painel para cada sessão do robô de WhatsApp, no máximo.
create unique index if not exists leads_robo_session_idx
  on leads (robo_session_id) where robo_session_id is not null;

-- ---------------------------------------------------------------- backfill

-- 1. A data que o painel já guardava para a reunião.
update leads set booked_at = meeting_at
  where meeting_at is not null and booked_at is null;

-- 2. O HISTÓRICO. `lead_events` registra toda transição de status desde sempre,
--    com ator e carimbo de tempo, e nenhuma métrica jamais leu essa tabela.
--    É daqui que voltam as reuniões dos leads marcados como perda depois de
--    terem agendado. Assume os nomes de status já migrados pelo 0011.
update leads l set booked_at = e.first_at from (
  select lead_id, min(created_at) as first_at from lead_events
  where to_status in ('agendado', 'reuniao_realizada', 'cliente')
  group by lead_id
) e where e.lead_id = l.id and l.booked_at is null;

update leads l set attended_at = e.first_at from (
  select lead_id, min(created_at) as first_at from lead_events
  where to_status in ('reuniao_realizada', 'cliente')
  group by lead_id
) e where e.lead_id = l.id and l.attended_at is null;

update leads l set closed_at = e.first_at from (
  select lead_id, min(created_at) as first_at from lead_events
  where to_status = 'cliente'
  group by lead_id
) e where e.lead_id = l.id and l.closed_at is null;

-- 3. Quem está num estágio avançado AGORA mas não deixou rastro (import de CSV,
--    lead criado já agendado). `created_at` é o melhor palpite disponível — sem
--    ele o lead sumiria da contagem de reuniões.
update leads set booked_at = created_at
  where booked_at is null and status in ('agendado', 'reuniao_realizada', 'cliente');
update leads set attended_at = created_at
  where attended_at is null and status in ('reuniao_realizada', 'cliente');
update leads set closed_at = created_at
  where closed_at is null and status = 'cliente';

-- `lost_at` descreve o estado atual, não um fato permanente: é limpo se o lead
-- voltar ao caminho feliz.
update leads set lost_at = coalesce(lost_at, created_at)
  where status in ('contato_invalido', 'sem_resposta', 'sem_interesse', 'desistencia');
update leads set lost_at = null
  where lost_at is not null
    and status not in ('contato_invalido', 'sem_resposta', 'sem_interesse', 'desistencia');
