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
- **Privacidade:** nome/e-mail/telefone SÃO persistidos no lead (página Pessoas, para o
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
- **Confiança** (`src/lib/trust.ts`): `div()` devolve 0 quando o denominador é 0, então
  "nenhuma reunião" e "reunião de graça" imprimem o mesmo pixel. `assessTrust()` (pura)
  diz o que o número sustenta: `quarentena` (não exiba — vira "—"), `piso` (o real é
  maior, prefixo ≥) ou `teto` (o real é menor, ≤). **Nenhuma tela imprime custo com
  denominador zero** — guarde com `x > 0 ? formatCurrency(...) : "—"` ou passe
  `quarentena` ao `KpiCard`, que também some com delta e sparkline. NÃO troque `div()`
  para `number | null`: 75 call sites e null vazaria para o Recharts. Trava nova =
  entrada em `assessTrust`, não um `if` na página.
- **Status do lead** (`src/lib/lead-status.ts`): fonte ÚNICA de rótulo, cor, posição
  no funil e "isto encerra o lead?". UI, métricas, CSV e seed leem dali — nunca
  repita a lista de status nem hardcode um `<option>`. Os quatro motivos de perda
  se dividem em `lossKind` **qualidade** (mídia) e **decisão** (oferta) — é a quebra
  que o funil mostra. Status novo = entrada em `LEAD_STATUS_META` + migração em
  `db/schema.ts` E `supabase/migrations/`, e um apelido em `normalizeLeadStatus` se
  o nome antigo puder estar gravado.
- **Marcos vs. status** (migração `0012`): `status` é o estado ATUAL (rótulo, cor,
  fila) e é mutável; `bookedAt`/`attendedAt`/`closedAt` são o FATO, gravados uma vez
  e nunca sobrescritos (`coalesce` no Postgres, `??=` nos outros backends). A
  contagem de reuniões lê o marco, não o status — senão registrar uma perda apaga a
  reunião que aconteceu e o CPR zera. `everBooked()` é o fato; `isBooked()` é o fato
  **mais a política** (desistência sai do CPR). Toda regra de "esta reunião conta?"
  mora em `isBooked`, nunca na ordem dos status. `lostAt` é a exceção: descreve o
  estado atual e é limpo se o lead voltar ao caminho feliz.
- **Farol** (`src/lib/farol.ts`): o primeiro bloco da home (Hoje) e o ÚNICO com destaque
  — hierarquia é escassez. O número é escolhido, não fixo: gente parada no funil vence
  qualquer custo (já foi paga, dá para recuperar, não exige verba nova); sem ninguém
  parado, cai no CPR, e se o CPR estiver em quarentena, no degrau mais fundo da cascata
  com amostra ≥3, dizendo que desceu. Se a leitura do robô falhar, o farol diz "não sei"
  — nunca "no ritmo", que seria a mentira mais cara da tela. A home tem 5 blocos: farol,
  ações, tira de 3 números, cascata resumida, rodapé de links. Bloco novo na home = tirar
  um.
- **Cascata** (`src/lib/cascata.ts`): o funil ponta a ponta atravessando os quatro
  sistemas (Meta → LP → painel → robô → atendimento). Regras: **duas âncoras** (acima
  de Leads mede sobre impressões; de Leads para baixo, Leads = 100%) — com uma só,
  oito linhas imprimem "0,0%", que é mentira por arredondamento; **selo de fonte** em
  todo degrau e junta tracejada onde o dado troca de sistema; **cliques NÃO é degrau**
  (`inline_link_clicks || clicks` soma duas definições incompatíveis); quando duas
  fontes discordam do mesmo fato, `valor: null` e a divergência vira nota — nunca
  escolha um lado em silêncio. Sem robô, cai no funil do painel e diz isso.
- **Fila de contato** (`src/lib/fila.ts`): funde as três filas que vivem em bancos
  diferentes (leads sem desfecho, convite pendente no robô, transferido sem 1º contato)
  numa lista só. Fonte ÚNICA dos SLAs por etapa em `FILA_ETAPAS` — nunca hardcode um
  prazo. Ordena por **atraso relativo** (`horas ÷ SLA da etapa`), não por idade crua:
  6h num SLA de 2h é mais urgente que 3 dias num de 48h. Dedupe por telefone via
  `src/lib/phone.ts` (fonte única do pareamento, usada também pela ponte do Comercial) —
  a mesma pessoa costuma estar em duas filas, e vence a etapa mais funda. Etapa nova =
  entrada em `FILA_ETAPAS` + um ramo em `montarFila`.
- **Navegação** (`components/layout/nav-items.ts`): 7 páginas nomeadas pela PERGUNTA
  que respondem (Hoje, Dinheiro, Jornada, Fila, Pessoas, Conteúdo, Ajustes), não pela
  fonte do dado — eram 14, uma por sistema, e a mesma pessoa aparecia contada em três
  com números diferentes. Página nova = fundir outra; sub-vista (`vistas`) só onde o
  trabalho é outro (Produção). Um fato mora num lugar só: se duas páginas precisam
  dele, uma mostra e a outra linka — e o número do link é o da página que ele abre.
  O período viaja nos links (`comPeriodo`, `lib/range.ts`). Rota antiga = redirect em
  `next.config.ts`, nunca 404.
- **Régua editorial** (`src/lib/content/playbook.ts`): o "Guia de Produção" como código
  — grade semanal, ≤25s, gancho de 7 palavras, ciclo de CTA, "Nunca mais", metas de
  90 dias. Fonte ÚNICA: `validator.ts` (pré-publicação) e `recommendations.ts`
  (pós-publicação) leem dali — nunca hardcode um limite. Guia novo = subir
  `PLAYBOOK_VERSION` (cada validação grava contra qual régua passou). Só marcas em
  `hasPlaybook()` têm a vista Produção (em Conteúdo).
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

Reset dos dados de exemplo: botão em **Ajustes**, ou `rm -rf .localdata`.

Roadmap (Supabase + Meta Marketing API v25 + Instagram Login + GA4/CAPI): ver README.
