-- Ids de atribuição (Fase 6, D6/S20).
--
-- Idempotente. Espelho do bloco 0019 de src/lib/db/schema.ts.

-- • ad_daily.adset_id: o conjunto passa a ser agrupado por id — conjuntos
--   homônimos em campanhas diferentes viravam uma linha só quando o agrupamento
--   era pelo nome.
-- • creatives.creative_id: o id do CRIATIVO na Meta. O mesmo criativo roda em
--   vários anúncios (um por conjunto); a Mídia agrega por ele e detalha por
--   conjunto ao expandir.
-- • leads.ad_id / adset_id / campaign_id: os ids que o UTM traz
--   (utm_campaign={{campaign.id}}, utm_term={{adset.id}}, utm_content={{ad.id}}),
--   guardados na entrada quando vêm numéricos. Macro literal ou nome em vez de
--   id ficam vazios e a atribuição cai no utm_content.
alter table ad_daily add column if not exists adset_id text;
alter table creatives add column if not exists creative_id text;
alter table leads add column if not exists ad_id text;
alter table leads add column if not exists adset_id text;
alter table leads add column if not exists campaign_id text;
