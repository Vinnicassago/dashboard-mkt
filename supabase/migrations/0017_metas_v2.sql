-- Metas com vigência (Fase 4).
--
-- Idempotente. Espelho do bloco 0017 de src/lib/db/schema.ts.

-- Mudar uma meta INSERE uma linha nova a
-- partir de uma data: o passado continua julgado pela meta que valia nele.
-- "alvo" nulo limpa a meta. As entradas da calculadora ficam com a meta, para
-- ela ser auditável. As metas de custo antigas (CPL e custo por reunião, que não
-- dependem do tamanho do período) migram; as de contagem "da campanha" não têm
-- semana para virar e ficam onde estavam.
create table if not exists metas (
  id text primary key,
  brand text not null,
  metrica text not null,
  periodo text not null default 'semana',
  alvo numeric,
  vigente_desde date not null,
  provisoria boolean not null default false,
  origem text not null default 'manual',
  entradas jsonb,
  criada_em timestamptz not null default now(),
  criada_por text not null default ''
);
create index if not exists metas_brand_idx on metas (brand, metrica, vigente_desde desc);
insert into metas (id, brand, metrica, periodo, alvo, vigente_desde, origem, criada_por)
  select 'legado-' || brand || '-' || metric, brand,
         case metric when 'cpl' then 'cpl' else 'custo_por_reuniao' end,
         'semana', target, date '2020-01-01', 'legado', 'migração 0017'
  from goals where metric in ('cpl', 'cpr')
  on conflict (id) do nothing;
