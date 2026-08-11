-- Etapa 2 do diagnóstico do perfil (@consorcio.brunno): retenção real de reels
-- (duração manual), taxonomia de conteúdo (pilar/CTA) e conversas de DM
-- (registro manual — a API do Instagram não expõe DMs).
alter table ig_posts add column if not exists duration_sec numeric;
alter table ig_posts add column if not exists pillar text;
alter table ig_posts add column if not exists cta_type text;
alter table ig_account_daily add column if not exists dm_conversations integer;
