-- Avisos de lead novo por Web Push: os navegadores que ativaram o sino do cabeçalho.
--
-- Idempotente. Espelho do bloco 0026 de src/lib/db/schema.ts. Só TABELA NOVA:
-- nenhuma tabela existente muda e nenhum dado é reescrito.
--
-- Um navegador por linha, pelo endpoint do serviço de push (Google, Apple,
-- Mozilla). É configuração do aparelho, não fato do lead: desativar (ou o serviço
-- dizer que a inscrição não existe mais) APAGA a linha. Sem PII: o usuário do
-- painel e um rótulo do aparelho ("Chrome · Android"); p256dh e auth só cifram o
-- aviso de ponta a ponta.
create table if not exists push_inscricoes (
  endpoint text primary key,
  p256dh text not null,
  auth text not null,
  usuario text,
  aparelho text,
  criada_em timestamptz not null,
  atualizada_em timestamptz not null
);
-- Como as demais: fechada por RLS (o painel acessa com a chave de serviço).
alter table push_inscricoes enable row level security;
