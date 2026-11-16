-- A data da inscrição na live (nov/26).
--
-- Idempotente. Espelho do bloco 0024 de src/lib/db/schema.ts. Rode ANTES de subir
-- o código no backend Supabase: o insert do lead manda todas as colunas, e sem
-- esta todo lead novo falharia.
--
-- • Quem já era lead de outra campanha e se inscreve na live ganha
--   inscrito_live_em (a API do n8n e a página com as respostas gravam,
--   marcarInscricaoNaLive); created_at fica como está — a origem e a atribuição da
--   campanha antiga não mudam. A live conta por inscrito_live_em, senão created_at
--   (entradaNaLive, lib/live.ts).
-- • A 2ª inscrição dentro do período não muda a data (vale a 1ª); uma data de
--   antes do período (outra live, teste) é trocada pela inscrição nova.
alter table leads add column if not exists inscrito_live_em timestamptz;

-- Reparo, só para o que chegou ANTES deste código (captação aberta em 16/11; a
-- janela fecha em 17/11 12h UTC — depois dela o código grava na entrada). Lê só o
-- histórico (lead_events) da janela e só preenche o vazio: o mesmo resultado a cada
-- boot, e uma ficha preenchida depois pelo comercial não vira inscrição.
-- 1) Quem já era lead e se inscreveu na live: a hora da inscrição — o reenvio do n8n
--    (origem n8n) ou o da página com as respostas (seguido da ficha gravada por ela).
update leads l set inscrito_live_em = e.em from (
  select r.lead_id, min(r.created_at) as em from lead_events r
  where r.action = 'reenvio'
    and r.created_at >= '2026-11-16T00:00:00Z' and r.created_at < '2026-11-17T12:00:00Z'
    and (r.payload->>'origem' = 'n8n'
         or (r.actor = 'Landing page' and exists (
               select 1 from lead_events f
               where f.lead_id = r.lead_id and f.action = 'ficha' and f.actor = 'Landing page'
                 and f.created_at >= r.created_at and f.created_at < r.created_at + interval '2 minutes')))
  group by r.lead_id
) e
where l.id = e.lead_id and l.inscrito_live_em is null and l.created_at < '2026-11-16T00:00:00Z';
--    O reenvio que É essa inscrição ganha o texto dela na linha do tempo ("Inscreveu-se
--    na live 01/12 (já era lead desde DD/MM)"): só ACRESCENTA ao payload, nada se apaga.
update lead_events ev set payload = coalesce(ev.payload, '{}'::jsonb)
    || jsonb_build_object('inscricaoLive', 'Live 01/12',
                          'leadDesde', to_char(l.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
  from leads l
  where ev.lead_id = l.id and ev.action = 'reenvio' and ev.created_at = l.inscrito_live_em
    and ev.created_at >= '2026-11-16T00:00:00Z' and ev.created_at < '2026-11-17T12:00:00Z'
    and l.created_at < '2026-11-16T00:00:00Z'
    and not (coalesce(ev.payload, '{}'::jsonb) ? 'inscricaoLive');
-- 2) Quem entrou JÁ na captação pela live (criado pelo n8n, ou com a ficha gravada pela
--    página ou pelo n8n na janela): a própria entrada — sem ela, a 2ª inscrição depois
--    deste código trocaria a data (a regra é: dentro do período, vale a 1ª).
update leads l set inscrito_live_em = l.created_at
  where l.inscrito_live_em is null
    and l.created_at >= '2026-11-16T00:00:00Z' and l.created_at < '2026-11-17T12:00:00Z'
    and exists (
      select 1 from lead_events f
      where f.lead_id = l.id and f.created_at < '2026-11-17T12:00:00Z'
        and ((f.action = 'created' and f.actor = 'n8n')
             or (f.action = 'ficha' and f.actor in ('n8n', 'Landing page'))));
