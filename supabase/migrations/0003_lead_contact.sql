-- Contato do lead (nome já existe). Armazenado a pedido do time comercial.
-- LGPD: a tabela `leads` fica atrás de RLS (só service role) e o acesso ao
-- painel deve ser protegido (o dashboard passa a exibir dados pessoais).

alter table leads add column if not exists email text;
alter table leads add column if not exists phone text;
