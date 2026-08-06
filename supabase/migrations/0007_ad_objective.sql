-- Objetivo do anúncio (string crua da Meta, ex. OUTCOME_LEADS / OUTCOME_ENGAGEMENT).
-- Permite separar o orçamento de CONVERSÃO (leads/reuniões) do de DESCOBERTA
-- (alcance/engajamento/seguidores) e manter CPL/CPR fiéis. Nullable: linhas
-- antigas e CSVs sem a coluna caem no balde de conversão até um re-sync.

alter table ad_daily add column if not exists objective text;
