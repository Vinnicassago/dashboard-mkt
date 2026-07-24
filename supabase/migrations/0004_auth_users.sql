-- Usuários do painel (login com usuário e senha).
-- A senha é guardada como hash scrypt (nunca em texto puro). RLS ligada e sem
-- policies: só o service role (server-side) lê/escreve.

create table if not exists app_users (
  username      text primary key,
  password_hash text        not null,
  created_at    timestamptz not null default now()
);

alter table app_users enable row level security;
