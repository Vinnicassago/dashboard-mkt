-- Etapa 3 do diagnóstico do perfil: vínculo orgânico<->pago (posts impulsionados
-- e dark posts via effective_instagram_media_id), posts de TESTE fora da análise,
-- atribuição por post (visitas/follows) e crescimento bruto de seguidores.
alter table ig_posts add column if not exists profile_visits integer;
alter table ig_posts add column if not exists follows integer;
alter table ig_posts add column if not exists media_url text;
alter table ig_posts add column if not exists thumbnail_url text;
alter table ig_posts add column if not exists is_test boolean not null default false;
alter table ig_account_daily add column if not exists follows_day integer;
alter table ig_account_daily add column if not exists unfollows_day integer;
alter table ig_account_daily add column if not exists link_taps_website integer;
alter table ig_account_daily add column if not exists link_taps_whatsapp integer;
alter table creatives add column if not exists instagram_media_id text;
alter table creatives add column if not exists instagram_permalink text;
