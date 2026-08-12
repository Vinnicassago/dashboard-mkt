# CLAUDE.md — Dashboard de Campanha (Consórcio)

Dashboard de marketing (Next.js 16 / React 19 / Tailwind v4 / Recharts) para uma
campanha de lead-gen no Instagram. North Star: **Custo por Reunião (CPR)**.

## Regras do projeto

- **Dados:** tudo passa por `src/lib/data/store.ts`, que é **async** e escolhe o
  backend por env (Supabase se configurado, senão JSON local). Nunca ler/escrever
  fora dele; ao adicionar uma operação, implemente nos DOIS backends e no
  `backend.ts`. `seed.ts` é o dataset de exemplo determinístico.
- **APIs Meta** (`src/lib/meta/*`): versão **fixada** em `config.ts` — não use o
  default. Janela retroativa + upsert (insights atrasam até 48h). No Instagram, só
  `reach` tem série temporal; o resto é 1 request por dia. Leads vêm de
  `offsite_conversion.fb_pixel_lead` — nunca some com o agregado `lead`.
- **CAPI** (`meta/capi.ts`): `access_token` vai na QUERY, não no body;
  `test_event_code` no TOP-LEVEL. PII em SHA-256 (sem remover acentos); `fbc`,
  `fbp`, IP e user-agent **nunca** hasheados. `event_id` + `event_name` iguais aos
  do Pixel para deduplicar (janela 48h) — gere o id UMA vez, no cliente.
- **GA4** (`ga4/measurement-protocol.ts`): não existe evento `schedule` — use
  `generate_lead` e `qualify_lead`. Sem `client_id` real do gtag, **não envie**
  (GA4 aceitaria e criaria usuário fantasma). O endpoint de produção sempre
  responde 2xx, então sucesso HTTP não prova que o evento entrou.
- **Privacidade:** nome/e-mail/telefone SÃO persistidos no lead (aba Leads, para o
  comercial) e também hasheados para a CAPI. O painel exibe PII — proteja o acesso.
  Tabela `leads` atrás de RLS. Não adicionar PII nova sem necessidade (LGPD).
- **Auth** (`src/lib/auth/*` + `middleware.ts`): ativa só com `AUTH_SECRET`. Sessão
  = cookie HMAC httpOnly (Web Crypto, portável Edge/Node — `session.ts` NÃO pode ter
  import node). Senha em scrypt (`passwords.ts`, server-only). Usuários passam pelo
  store (`countUsers`/`getUser`/...). Middleware libera `/login`, `/api/track`,
  `/api/sync`.
- **Papéis** (`auth/roles.ts`): admin/marketing/comercial + capabilities
  (`leads:write` = admin+comercial; `data:write` = admin+marketing; `users:manage` =
  admin). Toda mutação chama `can(cap)` de `auth/guard.ts` (modo aberto sem
  `AUTH_SECRET` = tudo liberado). Enforçar SEMPRE no server, não só na UI.
- **KPIs:** somente em `src/lib/metrics.ts`, funções **puras** (sem I/O). Reutilize-as.
- **Régua editorial** (`src/lib/content/playbook.ts`): o "Guia de Produção" como código
  — grade semanal, ≤25s, gancho de 7 palavras, ciclo de CTA, "Nunca mais", metas de
  90 dias. Fonte ÚNICA: `validator.ts` (pré-publicação) e `recommendations.ts`
  (pós-publicação) leem dali — nunca hardcode um limite. Guia novo = subir
  `PLAYBOOK_VERSION` (cada validação grava contra qual régua passou). Só marcas em
  `hasPlaybook()` têm a página Produção.
- **Validação de peça** (`content/validator.ts`): função **pura**, roda no servidor e
  no cliente. `bloqueio` = item do checklist ou "Nunca mais" (não publica);
  `aviso` = fora do padrão. A nota gravada é sempre recalculada no servidor —
  o cliente valida só para retorno imediato. Regra que dá para checar
  mecanicamente fica AQUI; julgamento (gancho cria tensão? soa como anúncio?)
  fica para a camada de IA (Etapa 2), nunca misturado.
- **Formatação:** sempre via `src/lib/format.ts` (pt-BR). Para charts, passe o
  **tipo de formato** (`NumFmt`, string) — nunca uma função (fronteira RSC).
- **Charts (client) recebem props serializáveis.** Server Components não podem
  passar funções para Client Components. Cores vêm de CSS vars (`components/charts/colors.ts`),
  da paleta data-viz validada — não invente hex novos sem rodar o validador.
- **Ícones:** lucide-react não tem mais ícones de marca (`Instagram`, etc.) — use genéricos.
- **UI em pt-BR.** Tabelas ordenáveis usam `components/ui/data-table.tsx` com colunas
  definidas em componentes client (`components/tables/*`).

## Rodar / validar

```bash
npm run dev            # http://localhost:3000
npx tsc --noEmit       # typecheck
npm run build          # build de produção
```

Reset dos dados de exemplo: botão em **Importar / Config**, ou `rm -rf .localdata`.

Roadmap (Supabase + Meta Marketing API v25 + Instagram Login + GA4/CAPI): ver README.
