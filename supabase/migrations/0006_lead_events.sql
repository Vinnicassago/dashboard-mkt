-- Log de auditoria dos leads: quem criou / alterou o status de cada lead.
-- RLS ligada e sem policies: só o service role (server-side) acessa.

create table if not exists lead_events (
  id           text primary key,
  lead_id      text        not null,
  lead_name    text        not null default '',
  actor        text        not null default '',
  action       text        not null,
  from_status  text,
  to_status    text,
  created_at   timestamptz not null default now()
);

create index if not exists lead_events_created_idx on lead_events (created_at desc);
create index if not exists lead_events_lead_idx on lead_events (lead_id);

alter table lead_events enable row level security;
