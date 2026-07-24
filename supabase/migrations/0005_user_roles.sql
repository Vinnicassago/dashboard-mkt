-- Papel de acesso por usuário: admin | marketing | comercial.
-- Regra do produto: só admin e comercial alteram leads; admin e marketing
-- operam dados de marketing; só admin gerencia usuários.

alter table app_users
  add column if not exists role text not null default 'marketing';
