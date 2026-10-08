# CLAUDE.md — Dashboard de Campanha (Consórcio)

Dashboard de marketing (Next.js 16 / React 19 / Tailwind v4 / Recharts) para uma
campanha de lead-gen no Instagram. North Star: **Custo por Reunião (CPR)**.

## Regras do projeto

- **Dados:** tudo passa por `src/lib/data/store.ts`, que é **async** e escolhe o
  backend por env (Supabase se configurado, senão JSON local). Nunca ler/escrever
  fora dele; ao adicionar uma operação, implemente nos backends (local, Postgres e
  Supabase) e no `backend.ts`. `seed.ts` é o dataset de exemplo determinístico.
  `src/lib/data/__tests__/store-contract.test.ts` roda a MESMA suíte no JSON local e
  num Postgres real (PGlite): operação nova entra lá também.
- **Nada de lead se perde** (Fase 0, out/2026): `addLead` insere lead NOVO; se o id
  já existe, só PREENCHE contato vazio (`LEAD_CONTACT_FIELDS`) — nunca toca status,
  entrada, marcos, reunião, valor, marca ou exclusão (o upsert de linha inteira
  zerava o lead a cada reenvio da LP). Reenvio vira evento `reenvio`. O id da LP
  sai de `lib/lead-id.ts` (event_id inteiro; o esquema antigo de 8 caracteres só é
  reconhecido). Exclusão é **reversível** (`softDeleteLead`, `deleted_at`): o lead
  some de `getData` e das métricas, a linha e os eventos ficam. Nunca `DELETE` em
  `leads` nem em `lead_events` — nem no reset do exemplo.
- **Identidade** (Fase 2, `lib/identidade.ts`, pura): lead é PESSOA. Envio com
  event_id novo cujo telefone/e-mail já é de um lead da marca (`acharMesmaPessoa`)
  vira `reenvio` NESSE lead; se ele estava perdido, volta a "Novo" (evento
  `reaberto`, aviso ao n8n) — o mesmo event_id reenviado nunca reabre nada. Pelo
  CONTATO, nunca pelo nome. Teste, duplicado e desistência sem reunião aparecem em
  Pessoas → Revisar e só uma pessoa decide: mesclar (`mesclarLeads`) = o principal
  recebe contato e marcos vazios, o duplicado é excluído de forma reversível com o
  motivo e o principal ganha evento `mesclado`. Nada é corrigido sozinho.
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
  `/api/sync`, `/api/health` (só a versão — `lib/version.ts`, atualizar a cada
  release: é como se confere que o deploy do EasyPanel pegou o código novo).
- **Papéis** (`auth/roles.ts`): admin/marketing/comercial + capabilities
  (`leads:write` = admin+comercial; `data:write` = admin+marketing; `leads:delete`,
  `danger:run` e `users:manage` = admin). Toda mutação chama `can(cap)` de
  `auth/guard.ts` (modo aberto sem `AUTH_SECRET` = tudo liberado). Enforçar SEMPRE no
  server, não só na UI. Ação da zona de perigo confere `CONFIRMACAO_PERIGO`
  (`lib/perigo.ts`) no server e registra em `audit_log` (`lib/auditoria.ts`); troca de
  linhas de anúncio só com o substituto em mãos (`replaceAdData`, numa transação).
- **KPIs:** somente em `src/lib/metrics.ts`, funções **puras** (sem I/O). Reutilize-as.
  Criativo citado em ação, alerta ou IA passa por `rotuloCriativo()` — dois anúncios
  podem ter o mesmo nome ("Carrossel -"), e o nome sozinho manda pausar o errado.
- **Confiança** (`src/lib/trust.ts`): `div()` devolve 0 quando o denominador é 0, então
  "nenhuma reunião" e "reunião de graça" imprimem o mesmo pixel. `assessTrust()` (pura)
  diz o que o número sustenta: `quarentena` (não exiba — vira "—"), `piso` (o real é
  maior, prefixo ≥) ou `teto` (o real é menor, ≤). **Nenhuma tela imprime custo com
  denominador zero** — guarde com `x > 0 ? formatCurrency(...) : "—"` ou passe
  `quarentena` ao `KpiCard`, que também some com delta e sparkline. NÃO troque `div()`
  para `number | null`: 75 call sites e null vazaria para o Recharts. Trava nova =
  entrada em `assessTrust`, não um `if` na página. `MIN_REUNIOES` (trust.ts) é a régua
  ÚNICA da quarentena do custo por reunião: motor de ações, IA, Dinheiro e cascata leem
  dali — nenhuma tela imprime nem decide por CPR abaixo dela. A quarentena olha o
  denominador de VERDADE (`meetingsConversao`, `leadsConversao`) e vale também linha a
  linha (conjunto, criativo).
- **Status do lead** (`src/lib/lead-status.ts`): fonte ÚNICA de rótulo, cor, posição
  no funil e "isto encerra o lead?". UI, métricas, CSV e seed leem dali — nunca
  repita a lista de status nem hardcode um `<option>`. Os quatro motivos de perda
  se dividem em `lossKind` **qualidade** (mídia) e **decisão** (oferta) — é a quebra
  que o funil mostra. Status novo = entrada em `LEAD_STATUS_META` + migração em
  `db/schema.ts` E `supabase/migrations/`, e um apelido em `normalizeLeadStatus` se
  o nome antigo puder estar gravado. **Transições** (`podeTransitar`, pura): "Agendado"
  exige `meetingFor` (data DA reunião — `meetingAt` é legado e guardava a hora do
  clique), "Cliente" exige valor, "Desistência" só para quem já agendou
  (`everBooked`). A tela usa `destinosPermitidos`; o servidor confere de novo
  (`changeLeadStatus`). Gravar status = `aplicarStatus` (`lib/leads/mudar-status.ts`),
  usado pela tela e pela ponte do robô. **Máquina** (Fase 2): `TRANSICOES` é a fonte
  ÚNICA dos destinos; perda e cliente ENCERRAM (sair = `reabrirLead`, admin, com
  motivo); "Em contato" nunca é escolhido — nasce da 1ª tentativa; "Não compareceu"
  (`no_show`) conta como agendou; "Sem resposta" antes de 3 tentativas em 2 dias pede
  confirmação; "Contato inválido" exige motivo (`MOTIVOS_CONTATO_INVALIDO`).
- **Tentativas** (`lib/contato.ts`, puro): NÃO há contador no lead — tudo sai dos
  eventos `tentativa` (canal, falou, próxima pela `CADENCIA_HORAS`; `occurredAt` =
  quando aconteceu). `resumoContato` é a leitura única. Desfazer = evento `desfeito`
  apontando para ela (nada é apagado). A 1ª carimba o marco `firstContactAt`.
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
  escolha um lado em silêncio. `maiorVazamento()` (maior perda em pessoas depois do
  lead, sem contar quem está parado) é a resposta da Jornada e a ÚNICA junta com cor;
  abaixo de `AMOSTRA_MINIMA` a cascata não imprime taxa nem custo unitário. Sem robô,
  cai no funil do painel e diz isso.
- **Fila de contato** (`src/lib/fila.ts`): funde as três filas que vivem em bancos
  diferentes (leads sem desfecho, convite pendente no robô, transferido sem 1º contato)
  numa lista só. Fonte ÚNICA dos SLAs por etapa em `FILA_ETAPAS` — nunca hardcode um
  prazo. Ordena por **atraso relativo** (`horas ÷ SLA da etapa`), não por idade crua:
  6h num SLA de 2h é mais urgente que 3 dias num de 48h. Dedupe por telefone via
  `src/lib/phone.ts` (fonte única do pareamento, usada também pela ponte do Comercial) —
  a mesma pessoa costuma estar em duas filas, e vence a etapa mais funda. Etapa nova =
  entrada em `FILA_ETAPAS` + um ramo em `montarFila`. Rótulo de dono (marketing, robô,
  comercial) vem de `src/lib/dono.ts`. Etapas do painel saem de `etapaDoLead` (novo,
  retornar, confirmar, sem desfecho); prazos em **horas úteis** (`lib/horario-util.ts`,
  seg–sex 9h–18h Brasília, UTC−3 fixo, sem feriados) — "novo" é 1 hora útil. Lead
  reaberto recomeça o relógio no `reaberto`. Robô desligado em Ajustes
  (`robo_desativado`, `roboLigado()`) some com as etapas dele — desligado não é erro.
  A ficha (`/pessoas/[id]`) não é página de menu: abre pelo nome em Pessoas, Fila,
  histórico e no link do aviso. Aviso de lead novo = webhook do n8n (`lib/avisos.ts`,
  `N8N_LEAD_WEBHOOK_URL`); falha no aviso nunca derruba a entrada do lead.
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
  **tipo de formato** (`NumFmt`, string) — nunca uma função (fronteira RSC). Espera e
  duração: `formatarEspera` (arredonda o total antes de fatiar — nada de "31 d 24 h").
  Data exibida no servidor sempre com `timeZone: "America/Sao_Paulo"`. Erro técnico
  nunca vai cru para a tela: `mensagemHumana` (`lib/erros.ts`) e o detalhe no log.
- **Período** (`lib/range.ts`): os presets contam a partir de HOJE em Brasília
  (`hojeEmBrasilia`), não do último dia com anúncio. O cabeçalho mostra a data do
  último sync que deu certo POR FONTE (`lib/frescor.ts`), nunca o `updated_at` global.
- **Charts (client) recebem props serializáveis.** Server Components não podem
  passar funções para Client Components. Cores vêm de CSS vars (`components/charts/colors.ts`),
  da paleta data-viz validada — não invente hex novos sem rodar o validador.
- **Ícones:** lucide-react não tem mais ícones de marca (`Instagram`, etc.) — use genéricos.
- **UI em pt-BR.** Tabelas ordenáveis usam `components/ui/data-table.tsx` com colunas
  definidas em componentes client (`components/tables/*`).

## Rodar / validar

```bash
npm run dev            # http://localhost:3000
npm test               # Vitest (unidade + contrato do store em JSON e Postgres/PGlite)
npx tsc --noEmit       # typecheck
npm run build          # build de produção
```

Reset dos dados de exemplo: botão em **Ajustes**, ou `rm -rf .localdata`.

Roadmap (Supabase + Meta Marketing API v25 + Instagram Login + GA4/CAPI): ver README.
