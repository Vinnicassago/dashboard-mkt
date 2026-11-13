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
  Leads → Revisar e só uma pessoa decide: mesclar (`mesclarLeads`) = o principal
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
  **Caixa de saída** (Fase 7, D9, `meta/capi-envios.ts` + `lib/capi-politica.ts` pura):
  NADA posta direto — `enviarParaMeta` grava em `capi_envios` (migração 0020; id =
  `<evento>:<event_id>`, o mesmo fato entra uma vez) e só então tenta; NUNCA lança (o
  fato já foi gravado; sem fila, tenta uma vez direto). Falhou → nova tentativa (5 min …
  12 h, a última 30 min antes do fim) SÓ dentro de 48 h do fato (`JANELA_REENVIO_HORAS`:
  depois, reenviar contaria duas vezes) → "não chegou", com o porquê. Desiste na hora
  só com a recusa do PRÓPRIO evento (400, código 100, subcódigo 2804xxx); 100/33
  (dataset/permissão) e 190 (token) são configuração e seguem na fila. O modo (real ou
  teste) fica FIXADO na entrada: real nunca sai com `test_event_code`; teste nunca vira
  produção (teste descartado NÃO é perda: fica fora de "não chegou" e dos alertas). Cada
  linha é RESERVADA antes de postar (`reservarCapiEnvio`, atômico; o botão respeita a
  reserva viva) e só linha pendente é atualizada — "enviado" e "expirado" são finais; a
  desistência grava o `motivo` (janela | recusado | teste | sem-payload) e a tela lê
  dele, nunca do horário. O payload (IP e navegador) vira null ao sair ou expirar, e
  `expirarCapiVencidos` (que pula a linha reservada) roda em todo reenvio e ao abrir o
  painel, MESMO com a CAPI desligada. Sem dataset e token nada é gravado. Em
  `aplicarStatus` o envio entra na fila logo depois do status, ANTES do histórico. Reenvio:
  `/api/capi/retentar` (CRON_SECRET, a cada 15 min; grava a última execução), o botão em
  Integrações (força todos os pendentes da janela) e, de carona (`after`), cada lead
  novo. Eventos do painel saem pelo MARCO, só na 1ª vez (`eventosDaMudanca`): `Schedule`
  (agendou), `ReuniaoRealizada` (personalizado, compareceu), `Purchase` (fechou, com
  valor) — com e-mail e telefone em hash ("Lead sem nome" não vira primeiro nome). Tela
  lê envio com o RELÓGIO (`situacaoDoEnvio`): pendente vencido há muito = "o reenvio não
  rodou", fora da janela = "não chegou". A ficha mostra "Enviado à Meta ✓" só com a Meta
  confirmando (também dos cadastros mesclados); Integrações tira o selo dos envios da
  semana + todo pendente e diz se o cron RODA; perdido = alerta "falha"; reenvio parado e
  modo de teste em produção = aviso. GA4 continua direto (fica para depois).
- **GA4** (`ga4/measurement-protocol.ts`): não existe evento `schedule` — use
  `generate_lead` e `qualify_lead`. Sem `client_id` real do gtag, **não envie**
  (GA4 aceitaria e criaria usuário fantasma). O endpoint de produção sempre
  responde 2xx, então sucesso HTTP não prova que o evento entrou.
- **Privacidade:** nome/e-mail/telefone SÃO persistidos no lead (página Leads, para o
  comercial) e também hasheados para a CAPI. O painel exibe PII — proteja o acesso.
  Tabela `leads` atrás de RLS. Não adicionar PII nova sem necessidade (LGPD).
- **Auth** (`src/lib/auth/*` + `middleware.ts`): ativa só com `AUTH_SECRET`. Sessão
  = cookie HMAC httpOnly (Web Crypto, portável Edge/Node — `session.ts` NÃO pode ter
  import node). Senha em scrypt (`passwords.ts`, server-only). Usuários passam pelo
  store (`countUsers`/`getUser`/...). Middleware libera `/login`, `/api/track`,
  `/api/sync`, `/api/resumo-semanal`, `/api/capi/retentar`, `/api/n8n/*` (cada rota exige o
  `N8N_API_TOKEN`), `/api/health` (só a versão — `lib/version.ts`, atualizar a cada
  release: é como se confere que o deploy do EasyPanel pegou o código novo).
- **Papéis** (`auth/roles.ts`): admin/marketing/comercial + capabilities
  (`leads:write` = admin+comercial; `data:write` = admin+marketing; `leads:delete`,
  `danger:run` e `users:manage` = admin). Toda mutação chama `can(cap)` de
  `auth/guard.ts` (modo aberto sem `AUTH_SECRET` = tudo liberado). Enforçar SEMPRE no
  server, não só na UI. Ação da zona de perigo confere `CONFIRMACAO_PERIGO`
  (`lib/perigo.ts`) no server e registra em `audit_log` (`lib/auditoria.ts`); troca de
  linhas de anúncio só com o substituto em mãos (`replaceAdData`, numa transação).
- **KPIs:** somente em `src/lib/metrics.ts`, funções **puras** (sem I/O). Reutilize-as.
  Criativo citado em ação, alerta ou IA passa por `rotuloCriativo()` (por anúncio) ou `rotuloCriativoAgregado()` (por criativo: os cartões da Mídia — com a desambiguação numa linha própria —, o motor e a IA) — dois anúncios
  podem ter o mesmo nome ("Carrossel -"), e o nome sozinho manda pausar o errado.
- **Um número por métrica** (Fase 3, ADR-03): tela lê leads, CPL, reuniões e custo por
  reunião SÓ de `kpisDoPeriodo` (`lib/kpis.ts`) — valor, amostra `n`, confiança e
  anterior, e `mostrar()`/`custoExibivel()` para exibir. O lint (`eslint.config.mjs`)
  proíbe `src/app` e `src/components` de importar `overviewKpis`, `objectiveBreakdown`,
  `adKpis`, `filterLeads`, `countMeetings`… e `assessTrust`. Funil, Início, Mídia, motor de ações, insights e briefing da IA leem o mesmo objeto; `fase3.test.ts` confere 3 períodos × 2 marcas, o Início e o Funil incluídos, e `fase4-midia-tela.test.ts` confere que o resumo da Mídia é o do Início (o investimento de conversão, o CPL e o fato do custo por reunião). `fase5-conteudo.test.ts` confere que o placar do Conteúdo é o que a IA recebe (posts da grade, último post, líquido de seguidores), que o último post é o do rodapé do Início e que o "da grade" de Registros é o do placar. O custo por reunião pronto para a tela é UM,
  `fatoDoCustoPorReuniao(k)` (`{exibivel, valor, n, fato}`): a razão só quando `exibivel`,
  senão o FATO "R$ X investidos em conversão · N reuniões de conversão" (decisão 4.2; reuniões
  em quarentena = "reuniões sem leitura confiável", sem contagem) — a Mídia mostra o fato
  inteiro; o cartão do Início, os mesmos números sem o "em conversão" (`fatoNoCartao`); "esperando
  o comercial" é `esperandoOComercial` (ver Fila). Definições em `lib/dicionario.ts` (o ⓘ das
  telas e o briefing leem dali). **Reuniões agendadas = PERÍODO** (pela data do agendamento,
  `dataDoAgendamento`, no dia de Brasília — `diaDoLead`, ver Período; é a north star e o
  denominador do custo por reunião);
  **"Agendaram" = COORTE** (dos leads que entraram no período) e mede a taxa lead →
  reunião — nomes diferentes de propósito. Um CPL só: investimento de conversão ÷ leads
  de conversão; o do Pixel aparece rotulado "CPL Meta (Pixel)". O balde do lead vem do
  anúncio em TODO o histórico (`baldeDosLeads`). Junção lead → anúncio só por
  `lib/atribuicao.ts` (o `lead.adId` gravado na entrada vence; depois id ou nome único no
  `utm_content`; macro `{{…}}` = desconhecida; nome repetido = ambígua — nenhuma é
  atribuída). O id no `utm_content` vem sozinho, depois de `|` ou depois de `__ad_` — o link
  que a Meta usa desde nov/26 é `{{ad.name}}__ad_{{ad.id}}`, com `{{campaign.name}}__cid_{{campaign.id}}`
  e o POSICIONAMENTO no `utm_term` (nunca vira conjunto); o nome sem o id sai de
  `nomeDoUtmContent` — nunca `split("|")` solto. **UTM padrão** (D6, `lib/utm.ts`): UM link com as macros da Meta
  `utm_source=meta&utm_medium=paid_social&utm_campaign={{campaign.id}}&utm_term={{adset.id}}&utm_content={{ad.id}}`
  (macros nunca codificadas na URL); `/api/track` guarda `adId`/`adsetId`/`campaignId`
  (migração 0019, `idsDoUtm`: só id numérico) e `origemDoLead` monta "campanha › conjunto ›
  anúncio". Conjunto se agrupa por `adsetId` (homônimos em campanhas diferentes eram
  uma linha, S20); criativo, por `creativeId` (o mesmo criativo em vários anúncios).
  "Sem resposta" sem tentativa sai da conta da mídia (`perdasDoPeriodo`).
- **Confiança** (`src/lib/trust.ts`): `div()` devolve 0 quando o denominador é 0, então
  "nenhuma reunião" e "reunião de graça" imprimem o mesmo pixel. `assessTrust()` (pura)
  diz o que o número sustenta: `quarentena` (não exiba — vira "—"), `piso` (o real é
  maior, prefixo ≥) ou `teto` (o real é menor, ≤). **Nenhuma tela imprime custo com
  denominador zero** — guarde com `x > 0 ? formatCurrency(...) : "—"` ou passe
  `quarentena` ao `KpiCard`, que também some com delta e sparkline. NÃO troque `div()`
  para `number | null`: 75 call sites e null vazaria para o Recharts. Trava nova =
  entrada em `assessTrust`, não um `if` na página. `MIN_REUNIOES` (trust.ts) é a régua
  ÚNICA da quarentena do custo por reunião: Início, Mídia, Funil, IA e motor de ações
  leem dali — nenhuma tela imprime nem decide por CPR abaixo dela. A quarentena olha o
  denominador de VERDADE (`meetingsConversao`, `leadsConversao`) e vale também linha a
  linha (conjunto, criativo).
- **Status do lead** (`src/lib/lead-status.ts`): fonte ÚNICA de rótulo, cor, posição
  no funil e "isto encerra o lead?". UI, métricas, CSV e seed leem dali — nunca
  repita a lista de status nem hardcode um `<option>`. Os quatro motivos de perda
  se dividem em `lossKind` **qualidade** (mídia) e **decisão** (oferta) — a base do "onde
  atacar" das perdas do Funil, que mostra uma linha por motivo com quem encerrou. Status novo = entrada em `LEAD_STATUS_META` + migração em
  `db/schema.ts` E `supabase/migrations/`, e um apelido em `normalizeLeadStatus` se
  o nome antigo puder estar gravado. **Transições** (`podeTransitar`, pura): "Agendado"
  exige `meetingFor` (data DA reunião — `meetingAt` é legado e guardava a hora do
  clique), "Cliente" exige valor, "Desistência" só para quem já agendou
  (`everBooked`). A tela usa `destinosPermitidos`; o servidor confere de novo
  (`changeLeadStatus`). Gravar status = `aplicarStatus` (`lib/leads/mudar-status.ts`),
  usado pela tela, por `registrarContato` e pela API do n8n (a ponte do robô saiu em nov/26;
  `roboSessionId` só é lido). **Máquina** (Fase 2): `TRANSICOES` é a fonte
  ÚNICA dos destinos; perda e cliente ENCERRAM (sair = `reabrirLead`, admin, com
  motivo); "Em contato" nunca é escolhido — nasce da 1ª tentativa; "Não compareceu"
  (`no_show`) conta como agendou; "Sem resposta" antes de 3 tentativas em 2 dias pede
  confirmação; "Contato inválido" exige motivo (`MOTIVOS_CONTATO_INVALIDO`).
- **Tentativas** (`lib/contato.ts`, puro): NÃO há contador no lead — tudo sai dos
  eventos `tentativa` (canal, falou, próxima pela `CADENCIA_HORAS`; `occurredAt` =
  quando aconteceu). `resumoContato` é a leitura única. Desfazer = evento `desfeito`
  apontando para ela (nada é apagado). A 1ª carimba o marco `firstContactAt`. **O robô
  NÃO é tentativa**: os fatos dele são as colunas `robo_*` do lead (migração 0023) —
  nunca evento `tentativa`, `resumoContato`, cadência, `firstContactAt` nem a régua do
  "Sem resposta". Quem o robô recebeu (`roboVistoEm`) sai da base do "1º contato no
  prazo" (kpis e o "Onde atacar" das perdas do Funil: só "< 3 tentativas" vai ao comercial). Com
  opt-out (`roboOptOutEm`) o WhatsApp some de Leads, ficha e Fila e `registrarContato`
  recusa tentativa por WhatsApp.
- **Marcos vs. status** (migração `0012`): `status` é o estado ATUAL (rótulo, cor,
  fila) e é mutável; `bookedAt`/`attendedAt`/`closedAt` são o FATO, gravados uma vez
  e nunca sobrescritos (`coalesce` no Postgres, `??=` nos outros backends). A
  contagem de reuniões lê o marco, não o status — senão registrar uma perda apaga a
  reunião que aconteceu e o CPR zera. `everBooked()` é o fato; `isBooked()` é o fato
  **mais a política** (desistência sai do CPR). Toda regra de "esta reunião conta?"
  mora em `isBooked`, nunca na ordem dos status. `lostAt` é a exceção: descreve o
  estado atual e é limpo se o lead voltar ao caminho feliz.
- **Início** (Fase 2, nov/26, a home — era a Bússola): "o que chegou, quanto custou e quem
  está esperando agora?" em 4 blocos — cartões, leads chegando, atendimento, rodapé — mais o
  resumo da IA só quando existe; bloco novo = tirar um. Tudo sai de UMA função pura,
  `montarInicio` (`lib/inicio.ts`, via `montarBussola`: os nomes `bussola*` ficaram), com
  textos, ⓘ e hrefs prontos; `carregarBussola` (`bussola-server.ts`, também o caminho do
  resumo semanal) carrega e devolve a união por `modo` — `normal` (`inicio`) ou `live` (o
  painel, ver Live 01/12). Para client vão só textos, números e links — nunca `b.data`,
  `FilaItem`, `LinhaDeLead`, telefone ou e-mail (`fase2-inicio-tela.test.ts` inspeciona o
  payload). Sem `?range=` é a semana (`PERIODO_PADRAO_DO_INICIO`, `range.ts`); o comercial vai
  para `/fila`, menos no modo live. **Cartões** (de `kpisDoPeriodo`, Δ curto, sem status de
  meta; explicação e motivo da quarentena no ⓘ — `KpiCard` `info`/`ressalvaNoInfo`): cada um
  recebe só a quarentena do PRÓPRIO número (a do custo apagaria o Δ de Reuniões, uma contagem
  válida); Reuniões leva uma linha do custo (`fatoNoCartao`); o minigráfico do investimento
  (`sparkDoInvestimento`, conversão por dia até ontem) some com < 3 pontos, buraco "sem dados"
  no meio (seria queda falsa) ou piso/teto. **Leads chegando**: barras dos leads do PAINEL por
  dia de Brasília (`leadsPorDia`, Σ = `kpis.leads.valor`; nunca `dailySeries().leads`, que é
  Pixel; cinza só o dia pausado coberto por sync) e uma `<table>` dos 8 últimos de
  `montarLinhasDeLeads` com as opções de `/leads`, sem teste nem a CÓPIA de duplicado
  (`duplicadoDe`; `duplicado` marca o principal também); o título diz "nenhum no período" só
  sem lead nenhum (com lead e a lista vazia: "só teste ou duplicado") e o "último há" arredonda
  como a lista (`formatarEspera`). **Atendimento** (título =
  `esperandoOComercial`): o funil curto é um RECORTE do funil do processo do Funil
  (`funilDoAtendimento` = `recortarProcesso(funilDoProcesso(…), RECORTE_DO_INICIO)`,
  `lib/funil-processo.ts`: os mesmos números e o mesmo texto do % — `textoDaTaxa` — nos degraus
  que os dois mostram) — Leads → Com o robô (recorte sem taxa; o ⓘ diz quem ficou fora) → 1ª
  mensagem → Responderam → Convite aceito, e Agendaram em paralelo; robô desligado ou período
  todo antes dele = Leads → Agendaram → Reuniões realizadas (sobre Agendaram). `ondeTrava` vai
  para a IA (`atendimento.ondeTrava`, sempre um objeto com `situacao`), SEM marca nem palavra
  na tela; a frase da trava mora no Funil. E até 3 frases de AGORA com o número do grupo da
  MESMA `montarFila` (e `semMensagemDoRobo`). **Rodapé**: Funil, Mídia e o último post
  (`ultimoPostDaGrade` com `textoDoUltimoPost` — o MESMO texto do placar do Conteúdo —, link
  para `/conteudo`).
- **Onde trava** (Fase 3, nov/26, `lib/onde-trava.ts`, puro): UMA função — a manchete do
  Funil e `inicio.atendimento.ondeTrava` da IA (`situacao`: trava · abaixo-da-amostra ·
  sem-leads · leitura-parada; nunca um `null` só). A maior perda em PESSOAS, sem meta nem
  média, saída das `juntas` de `funilDoProcesso` (a MESMA passada pela coorte), sobre a coorte
  SEM teste nem cópia de duplicado (`testesEDuplicados`, a régua das perdas), sem a live e, com
  o robô no período, sem os de antes de 29/10 fora da Fila (sem processo, D5; contados no ⓘ):
  travados = entraram − passaram − chegaram a agendar NESTE episódio (outro caminho ou
  desistindo depois; o reaberto que agenda de novo não regrava o marco — vale a mudança de
  status depois do reaberto) − ainda no prazo da etapa (as 2 h e 24 h do robô por
  `situacaoDoRobo`; 48 h sem atividade na conversa, pausado incluído — e quem respondeu sem
  a fala do robô registrada, que nunca entra no Resgate; as 2 h úteis do convite aceito; as 24 h
  úteis do sem desfecho; 30 dias de negociação; sem o robô ou fora dele, o prazo da Fila). Todo
  lead sem reunião (menos a live e esses) é julgado numa junta só: com o robô, quem está fora
  dele cai em `fora-agendou`; o desistente trava em `realizou`. "Encerrado" = status de perda
  (nas três juntas do robô, também `encerramentoDoRobo`). Concorre com `AMOSTRA_MINIMA`
  travados; leitura do robô parada tira as três juntas do robô e põe "⚠" na manchete; vence o
  maior, empate = a mais funda. O chip é o dono da ETAPA; o link vai ao grupo da Fila com mais
  travados AGORA (o item da PESSOA: a Fila deduplica por telefone, e o principal herda o
  item da cópia) e não leva número (a Fila é o agora; a perda é a coorte). `gargalo.ts` (meta ÷
  média de 8 semanas) saiu. A landing page só conta com linha NO período
  (`temLpNoPeriodo`/`lpParouNoPeriodo`, em `metrics.ts`): histórico sem dado é rastreio que
  parou (alerta `lp-sem-dado`, `alertaLpSemDado`, no Início e no Funil; a linha Leads fica sem
  %), não "0%".
- **Motor v2** (`lib/motor.ts`, puro) — DORMENTE: sem tela (a Mídia, Fase 4, mostra o sinal no cartão do criativo, não a lista de ações), sem IA, sem escritor (`acoes-actions.ts` saiu), com todos os testes; o que segue vale quando ele voltar
  a ter tela. Regras C1–C5, M1–M5, L1–L2, D1–D2 do relatório (+ M6 escalar, M7 ritmo de verba, M8 pausar criativo, M9 candidato a escalar e B1 robô parado; a G1 foi retirada em nov/26 — não reutilize o id; M3, M4 (criativo), M6, M8 e M9 leem o MESMO `criativosComSinal` — o do cartão da Mídia —, montado uma vez por rodada, id `Mn:<chave do criativo>` (a M4 por criativo, `M4:cr:<chave>`), texto = rótulo e motivo do sinal; `CONTATO_INVALIDO_MAX` e `AMOSTRA_MIN.M4` são os da régua do sinal; o link vai à âncora onde a linha MORA — `ancoraDoConjunto`/`ancoraDoCriativo`: no ar → Detalhes ou o cartão, parada → `#pausados`, a live → `#criativos-live`; sem `cfgLive` a live não é separada), cada uma com
  id estável (`regra:alvo` — a C1 leva a `assinatura` de QUEM espera: pessoas novas fora do
  prazo = ação nova, de volta ao topo mesmo depois de um "Feito"), dono (`lib/dono.ts`),
  amostra mínima (`AMOSTRA_MIN`), impacto e confiança. Decide com os números de
  `kpisDoPeriodo` (nunca com custo em quarentena) e lê a Fila pela mesma `montarFila` da
  página. Ordem = severidade × impacto × confiança, mas C1 (gente esperando o comercial fora
  do prazo — com o robô, resgate + convite aceito com atraso > 1 e a live, `filaLive`,
  deduplicados; assinatura `resgate:<id>`) vem primeiro sempre que existir e a B1 logo depois
  (só com o robô: leitura falhando ou parada há > 45 min, dono DADOS, id
  `B1:sync:<roboFalhaDesde ?? ultimoOk>`; ou, em dia, `semMensagemDoRobo`, dono BOT). A C2 é
  nula com o robô ligado. Impacto só inteiro e só com amostra (senão `semImpacto`); confiança
  cai com piso/sync falhando (mídia) e registro em lote (comercial). Regra nova = `regraXn` +
  teste em `fase5.test.ts`; regras de conteúdo ficam em `recommendations.ts`. **Estado**
  (dormente também; store e teste de contrato ficam): `acoes_estado` (migração 0018),
  só-insert, por SEMANA (`semanaDaAcao`, segunda em Brasília, `lib/semana.ts`): vale a última
  linha de (marca, semana, ação); feita/ignorada (com motivo) sai do topo e volta com
  "reaberta"; na segunda seguinte tudo é reavaliado.
- **Resumo da semana** (H7): `/api/resumo-semanal` (CRON_SECRET, cron-job.org segunda 08:00)
  lê a semana fechada anterior (`semanaAnteriorFechada`, `carregarBussola` com `semModoLive`)
  e grava em `resumos_semanais`. A IA lê o Início (`inicioParaIA`: cartões como a tela os
  escreve, leads por dia, atendimento, com `ondeTrava` (só contagens e a `situacao`) — foto do
  momento da geração, não da semana —, último
  post; sem a lista de pessoas) e os kpis do carregador (`pago`, `regua`, `cprEmQuarentena`), mais a Mídia da semana como a tela a escreve (`pago.midia` = `midiaParaIA(montarMidiaDaTela(…))`: o resumo, a verba, os criativos no ar com sinal, motivo e ressalva, e a situação do robô — sem pessoa; `pago.criativos` por anúncio saiu); sem `bussola` nem ações do motor (`alertasJaDetectados` = só as de conteúdo). O cartão só
  aparece com resumo; sem ele, o botão "Gerar o resumo da semana" para `data:write` com IA, ou
  nada. Nunca gere no render — custa.
- **Funil do processo** (`lib/funil-processo.ts`, puro, no Funil e no Início): a COORTE do
  período (`filterLeads`, com teste e duplicado, = `kpis.leads`), lida SÓ do lead — colunas
  `robo_*` por `situacaoDoRobo` e os marcos —, nunca do banco do robô. Leads → Com o robô
  (recorte: fora os de antes de 29/10, sem telefone, live, recentes, depois da leitura,
  reabertos no painel) → 1ª mensagem → Responderam → Convite aceito (interseções) · Agendaram
  (`isBooked` = `kpis.agendaram`; com o robô, ramo paralelo sobre Leads) — Confirmaram (linha
  lateral sobre Agendaram: confirmação REGISTRADA alguma vez, `reuniaoConfirmadaEm` ou evento
  `ficha`; "≥ N" sem % com reunião de antes de 04/11, quando o registro começou) — Reuniões
  realizadas (`isAttended`, sobre Agendaram = `showRate`) → Vendas (`isClient`). Taxa só com
  base ≥ `AMOSTRA_MINIMA` e nunca acima da base (sem taxa, e o ⓘ diz por quê); leitura parada
  = "≥ N" sem taxa no trecho do robô; robô desligado ou período todo antes dele = o funil do
  painel, e o ⓘ diz isso. A Mídia conta o trecho do robô POR LINHA (criativo, conjunto) com a MESMA classificação e os mesmos fatos (`trechoDoRoboPorLinha`, `fatosDoTrecho`; sem WhatsApp = a etapa do episódio, como na junta do Funil): Σ linhas + sem linha + teste/cópia (por fato) = os degraus do robô do Funil. **Cascata** (`lib/cascata.ts`) é só o topo — impressões de
  conversão → visitas na LP → Leads —, com **duas âncoras** (acima de Leads, sobre impressões;
  de Leads para baixo, Leads = 100%; com uma só, oito linhas imprimiam "0,0%"), **selo de
  fonte** em toda linha e junta tracejada onde o dado troca de sistema; **cliques NÃO é
  degrau** (`inline_link_clicks || clicks` soma duas definições incompatíveis); quando duas
  fontes discordam do mesmo fato, `valor: null` e a divergência vira nota — nunca escolha um
  lado em silêncio (vale para o Calendly, quando ele for a 2ª fonte de reuniões). Abaixo de
  `AMOSTRA_MINIMA` a cascata não imprime taxa nem custo unitário próprio; o custo da linha
  Leads é o CPL de `kpisDoPeriodo`, com a régua do cartão do Início (`custoExibivel`).
- **Fila de contato** (`src/lib/fila.ts`, puro): para quem ligar agora, por GRUPO na
  ordem fixa (`gruposDaFila`) e, dentro do grupo, por **atraso relativo** (`horas ÷ SLA`):
  6h num SLA de 2h é mais urgente que 3 dias num de 48h. Fonte ÚNICA dos prazos, rótulos
  e do ⓘ (`hint`) em `FILA_ETAPAS` — nunca hardcode um prazo. **Robô ligado**: Resgate ·
  Aceitou o convite · Reuniões a confirmar · Reuniões sem desfecho; quem está COM o robô
  não está na Fila (só na barra "Com o robô agora"). Resgate = quem ficou sem conversa
  com o robô — `ResgateMotivo`, lista fechada: sem resposta em 24 h, sem WhatsApp, sem
  telefone, o robô não falou (2 h), não compareceu, retorno de quem já era trabalhado
  antes do robô; só os quatro primeiros avisam o n8n. Resgate e "Aceitou o convite" têm a
  cadência humana (quem já tentou some até a próxima; no convite e no "não compareceu"
  só contam as tentativas depois da entrada; no resgate, as depois do último `reaberto`).
  "Aceitou o convite" sai quando a reunião é registrada DEPOIS do aceite
  (`agendouDepoisDoAceite` — a de um episódio anterior ao reaberto não conta) ou o lead
  encerra. "Aceitou o convite" e as reuniões valem
  para todo lead (com ou sem classe); as etapas de contato, não (a live está congelada).
  Registrar a reunião = "Agendado" com `meetingFor` (`changeLeadStatus`), NUNCA
  tentativa. Quem já confirmou (`reuniaoConfirmadaEm`) sai de "a confirmar" nos dois
  modos. **Robô desligado** (sem credencial, desativado em Integrações, ou outra marca) =
  o processo antigo inteiro: "Novos — ligar agora" (1 hora útil), "Retornar hoje" e as
  reuniões; desligado não é erro. Dedupe por telefone utilizável (`chaveTelefoneValida`,
  `lib/phone.ts`), vence a etapa mais funda (`profundidade`), com o atraso na régua DELA
  (horas úteis; "a confirmar" mantém a proximidade da reunião). Prazos em **horas úteis**
  (`lib/horario-util.ts`, seg–sex 9h–18h Brasília, UTC−3 fixo, sem feriados). Lead
  reaberto recomeça o relógio no `reaberto`. Quem espera o comercial (PESSOAS,
  `esperandoOComercial`: A e B da live na 1ª tentativa + Resgate + Aceitou o convite com o
  robô; os Novos sem ele) é o número do título da Fila e do Atendimento do Início — as
  reuniões não entram. Links antigos (`?etapa=novo`…) passam por
  `grupoDaUrl` e a página rola até a `<section id>`. A página: a live primeiro (intacta),
  um título por grupo ("Resgate · 5 · 2 fora do prazo" + ⓘ), cinco pessoas + "ver todos",
  uma linha por pessoa, a barra no fim com links para `/leads?robo=<chave>&range=all`;
  "a confirmar" = Confirmada · Pediu para remarcar (robô desligado: também o Desfecho▾);
  sem WhatsApp (o robô viu, ou opt-out) a linha perde o botão e a tentativa começa por
  ligação; sem número utilizável (`telefoneUtilizavel`, `lib/phone.ts` — a régua do "sem
  telefone") não há `wa.me` em lugar nenhum (Fila, ficha, Leads); a linha resolvida some só no grupo da ação e volta quando o servidor deixa de
  listá-la ali (`components/fila/resolvidos.ts`). A
  ficha (`/leads/[id]`) não é página de menu: abre pelo nome em Leads, Fila, Início (Leads
  chegando), histórico e no link do aviso. Avisos ao n8n (`lib/avisos.ts`, docs/api-n8n.md §6): lead novo
  (`N8N_LEAD_WEBHOOK_URL`, com `robo: true` e o link da ficha quando o robô está ligado)
  e resgate (`N8N_RESGATE_WEBHOOK_URL`, webhook próprio, sem PII, seg–sex 9–18, no
  máximo um por rodada do cron — intervalo mínimo de 13 min, `FOLGA_JANELA_AVISO_MIN` —, um
  aviso por entrada `id:motivo:desde`); falha no aviso nunca
  derruba a entrada do lead nem o sync.
- **Robô no painel** (Fase 1, nov/26, `lib/robo/*`): o painel NUNCA lê o banco do robô
  para desenhar uma tela — só o sync (`sincronizarRobo`: cron `/api/sync?source=robo` a
  cada 15 min, "Sincronizar agora" e a carona ao abrir a Fila, job de sistema) lê
  "Leads WhatsApp" com a lista EXPLÍCITA de colunas (`COLUNAS_DO_ROBO`) — é ela a
  barreira de LGPD: nada de nome, e-mail, briefing, transcrição ou resumo; o telefone só
  casa e nunca é gravado nem logado. A chave lê com RLS (service_role): fica só no
  servidor. O painel NÃO escreve no banco do robô. Casa pelo telefone (`casar.ts`) e grava
  só as colunas `robo_*` (`updateLeadsRobo`): UMA VEZ (visto, recebido, saudação,
  respondeu, convite, aceitou, sem WhatsApp, opt-out) × SOBRESCREVE (etapa, última
  interação/mensagem, cobranças, encerrado, pausado). Duas linhas do robô para a mesma
  chave: vale a mais recente, com o opt-out de TODAS (o opt-out vale sempre). Reaberto
  (11.3): os fatos UMA VEZ de antes dele são da conversa antiga — recomeçam com o 1º do
  episódio novo; convite/aceite sem a data no robô só recomeçam se o robô interagiu
  depois do reaberto, e "transferido" sem o aceite do episódio é conversa nova. Lead
  reaberto no PAINEL (o admin) não é falha do robô (fora do alerta, de Integrações, do funil
  do Início e da B1: o robô só recebe inscrições); o resgate das 2 h continua. Nada muda de
  status. Toda leitura vai para `sync_runs` (fonte `robo`); `roboUltimaLeitura` guarda só
  contagens. Fontes únicas (puras, `lib/robo/situacao.ts`): `situacaoDoRobo` (resgate, balde,
  antes do robô, não recebeu, `falouEm`), `casaFiltroRobo` (as chaves do filtro de Leads, da
  barra e do alerta) e `semMensagemDoRobo` (o número do alerta, da frase do Início e de
  Integrações — e da B1 do motor). O estado (ligado, `lidoAte`, confiável, sync) sai SÓ de
  `estadoDoRoboAgora` — Fila, Início, Leads, exportação, ficha, layout, Integrações e o
  aviso. Nenhuma tela lê o banco do robô, o Funil incluído: `robo/client.ts` só tem o sync e
  a configuração, e só `robo/sync.ts`, `robo/estado.ts` e a página de Integrações o importam
  (`robo-client.test.ts` trava isso no `src` inteiro); as views `vw_robo_*` ficam no banco do
  robô, sem leitor. Fim da conversa pelo robô = `encerramentoDoRobo` (nunca com aceite no episódio — nem
  com opt-out depois: a pessoa está no "Aceitou o convite"; opt-out; esfriou depois
  do convite — o robô não registra recusa — ou esfriou na conversa, só com resposta no
  episódio; pausado não é fim; as datas são do episódio) — "Por que perdemos" (só para quem
  está no trecho do robô) e as juntas do robô leem dali; a barra "Com o robô agora" segue com
  o balde de `situacaoDoRobo` (o agora, pausado incluído).
- **Texto na tela** (régua de nov/26): o título dá a resposta ("Resgate · 5 · 2 fora do
  prazo"); nada de descrição embaixo do título — a explicação vai para o ⓘ
  (`components/ui/info.tsx`); ação em até 12 palavras; uma linha por pessoa; instrução só
  em Configurações; ressalva no ⚠ do cabeçalho ou no ⓘ. Metas: Início ≤ 100 palavras fora
  de tabela (cartões ≤ 25, títulos ≤ 10, funil ≤ 20, frases ≤ 30, rodapé + resumo ≤ 15 —
  `fase2-inicio-tela.test.ts` conta, com as datas que o gráfico desenha no navegador; o ⓘ
  fechado não). As barras do Início desenham no máximo 4 datas, sem o eixo Y e sem o
  "pausado" escrito (`BarrasDiarias` `semEixoY`/`semRotuloNasFaixas`/`maxDatasNoEixo`). Demais páginas ≤ 200 — o Funil é medido em `fase3-funil-tela.test.ts` (manchete ≤ 12, cada linha de perda ≤ 12, nenhuma frase > 25), a Mídia em `fase4-midia-tela.test.ts` (resumo ≤ 20, cada título ≤ 15, até 5 cartões ≤ 125 — nome ≤ 8, desambiguação ≤ 4, selo, linha ≤ 10 — com os números em mini-tabelas, nenhuma frase > 25, também dentro dos ⓘ) e o Conteúdo em `fase5-conteudo-tela.test.ts` (placar ≤ 15, a linha das variações ≤ 10, o título ≤ 8, até 3 cartões ≤ 16 — legenda ≤ 8, linha ≤ 8 —, até 2 ações ≤ 12, nenhuma frase > 25, também dentro dos ⓘ; nenhuma legenda inteira no HTML) —, Fila em até 3 telas de rolagem. O `<summary>` de um bloco
  recolhido é rótulo de navegação, não título de resposta (sem número). Todo `Info` leva
  `rotulo` próprio ("Sobre …").
- **Navegação** (`components/layout/nav-items.ts`): 7 páginas nomeadas pela PERGUNTA
  que respondem ou pelo DONO do trabalho — Início (`/`, ícone casa), Funil (`/funil`), Mídia (`/midia`, 7 dias), Conteúdo (`/conteudo`, 30 dias), Fila de contato, Leads (`/leads`), Configurações
  (`/configuracoes`) —, agrupadas na sidebar (Visão geral · Diagnóstico · Operação ·
  Configurações), não pela fonte do dado — eram 14, uma por sistema, e a mesma pessoa
  aparecia contada em três com números diferentes. A pergunta é o ⓘ ao lado do título do
  cabeçalho, nunca uma linha embaixo dele. Página nova = fundir outra;
  sub-vista (`vistas`) só onde o trabalho é outro (Conteúdo: Posts · Registros — a Produção
  saiu das abas e abre pelas ações do Conteúdo; Configurações: Metas · Integrações · Marcas · Usuários · Importar ·
  Ferramentas · Zona de perigo); o Início não tem vistas (a antiga aba Live é um atalho de
  período, ver Live 01/12) e o item ativo sai só da rota (`itemAtivo`). Um fato mora num
  lugar só: se duas páginas precisam dele, uma mostra e a outra linka — e o número do link é
  o da página que ele abre. O período viaja em TODOS os links (`comPeriodo`, `lib/range.ts`;
  sem `?range=` vale o `periodoPadrao` da página — `useComPeriodo`, `periodoPadraoDe`); "Campanha" vai EXPLÍCITA (`range=all`) para destino cujo padrão é outro — o Início e a Mídia (7 dias: `PERIODO_PADRAO_DO_INICIO`, `PERIODO_PADRAO_DA_MIDIA`) e o Conteúdo (30 dias: `PERIODO_PADRAO_DO_CONTEUDO`) —: o padrão do destino sai de `periodoPadraoDaRota` (`PERIODO_PADRAO_POR_ROTA`, `lib/range.ts`, pelo caminho do href: `/#topo` é `/`), que é o 3º argumento padrão de `comPeriodo` e a fonte de `periodoPadraoDe` — também nos links montados no servidor (senão Funil → Início ou Mídia abria em 7 dias). Rota
  antiga (`/jornada`, `/dinheiro`, `/pessoas`, `/config`, `/conteudo/posts`…) = redirect em `next.config.ts`,
  nunca 404; `/funil?vista=` antigo é ignorado (o Funil é só coorte) — exceção: `/live` redireciona na própria página (`destinoDaLive`), porque as
  datas da régua estão no store.
- **Telas de diagnóstico** (Fase 6): cada página extrai sua visão de UMA função pura
  (`lib/funil.ts`, `lib/midia.ts`, `lib/leads-vista.ts`, `lib/conteudo.ts`,
  `lib/configuracoes.ts`) — a página só carrega e renderiza. **Funil** (Fase 3, nov/26;
  `montarFunilDaTela` + `carregarFunil`): só COORTE e só conversão. De cima para baixo: a
  manchete (`ondeTrava`, com o dono da etapa e o link da Fila); o funil (o topo da cascata +
  o funil do processo, uma linha por degrau com n, %, selo e barra; a receita na linha de
  Vendas e, no ⓘ dela, CAC, ROAS e ticket com 3+ vendas e o "≥"/"≤" da verba, valor por
  reunião com 3+ agendaram); "Por que perdemos" (título "Perdemos N sem reunião"; uma linha
  por motivo: n · motivo · quem encerrou — robô ou comercial, vale o primeiro — → onde
  atacar, pela regra explícita: "Sem resposta" → comercial com < 3 tentativas ou 1ª fora do
  prazo, → mídia/formulário só com 3+ no prazo; esfriou depois do convite → não dá para
  dizer; esfriou na conversa → roteiro do robô; não quer mensagens → mídia/formulário; sem
  teste, sem duplicado, sem `everBooked`); recolhidos, semana a semana e a coorte por semana
  (TODA semana: 0 lead = "campanha pausada" ou "sem dados" pela cobertura; taxa com a régua
  `AMOSTRA_MINIMA`). Com 0 lead, só a manchete e os recolhidos. Sem Δ, sem meta, sem vista
  por período, sem descoberta (seguidores estão em Conteúdo), sem notas de medição (cliques e
  Pixel estão no ⓘ do card). Confiança do registro (lote/atraso, constantes do motor) =
  alerta `registro-suspeito` no ⚠ e uma frase no ⓘ das perdas. **Mídia** (Fase 4, nov/26; `montarMidiaDaTela` + `carregarMidia`, `lib/midia-server.ts`; os tipos da tela, as colunas e os helpers do client em `lib/midia-tela.ts` — os clients nunca importam valor de `lib/midia.ts`): "o que faço com a verba esta semana?" — abre em 7 dias. De cima para baixo: o resumo em UMA linha que abre com o investimento de CONVERSÃO (o do cartão do Início; com orçamento, "(orçamento R$ X)" colado a ele), o CPL e o fato do custo por reunião = os do Início, sem status de meta (o total e a descoberta no ⓘ; zero com piso de cobertura = "Sem dados de gasto"; awareness = só o investido) e "Conferir com o Gerenciador →" (Configurações → Integrações `#conferir-gasto`, que compara o TOTAL); "Para onde vai a verba" (`paraOndeVaiAVerba`: só conversão, % do gasto de CONVERSÃO — `gastoDaVerba`: num conjunto misto, sem a linha de descoberta; Σ = o investimento de conversão — × % dos leads de conversão por conjunto NO AR + a live numa linha só + "Fora do ar" = 100%, maior resto, os leads da MESMA passada do "fora das linhas" — D + n = leads de conversão por construção; "Fora das linhas" = n de N, fora dos 100%; título = o destaque com |Δ| ≥ 10 pontos pelos inteiros exibidos, ou "Leads acompanham a verba"; acima de 25% fora das linhas, " ⚠" no fim do título e o alerta `midia-fora-das-linhas`); os criativos de conversão NO AR em até 5 cartões (miniatura, nome ≤ 8 palavras + a desambiguação numa linha própria, selo do sinal, números em mini-tabelas na largura do cartão — gasto, leads, CPL e o múltiplo da média, % da verba e dos leads, e a resposta ao robô —, a ressalva visível; "≥" com piso de gasto — no gasto, no CPL e no R$ do motivo, e nas tabelas de Detalhes e Pausados, `pisoDeGasto`); recolhidos: "Criativos da live 01/12", "Pausados no período" (as MESMAS tabelas, só as linhas de conversão fora do ar) e "Detalhes" (tendência semanal; tabelas de conjuntos — `#conjuntos` — e criativos — `#criativos-tabela` — de conversão NO AR — sem verba de conversão, nenhuma, e `#conjuntos` é a descoberta —, e a descoberta inteira; alcance e seguidores; investimento por dia — `RolarParaAncora abrirDetalhes` abre o `<details>` da âncora na chegada, no `hashchange` e no clique; toda âncora com `scroll-mt-24`). "No ar" = `veiculacaoNoFim` (`lib/veiculacao.ts`): impressão ou gasto nos 3 dias (`DIAS_DE_ATRASO_DA_META + 1`) até o dia do último sync de anúncios OK (≤ `fimDoPeriodo`; sem sync, o último dia com linha); senão "último gasto em dd/mm" se um dia depois dele foi coberto por sync (ADR-06), senão "sem leitura" — sem o status do Meta; quando o `ref` é anterior a hoje, os títulos dizem "no ar em dd/mm"; quem não está no ar não tem sinal (nunca "Sem resultado" em anúncio desligado). **Sinal** (`sinalDoCriativo`, `lib/sinal-do-criativo.ts`, puro, UMA régua `REGUA_DO_SINAL`, amostra de pessoas `AMOSTRA_DE_PESSOAS`; tela, motor e IA leem `linha.sinal`), o primeiro que casar: Escalar (3+ reuniões por id a custo ≤ o da conta, sem fadiga) · Pausar (sem reunião e nenhum lead ou CPL ≥ 2× a média, com gasto que torna isso improvável por acaso — Poisson < 5%: 0 lead com 3 esperados, 1 com 4,75…; os leads de nome ambíguo contam a favor; ou caro e não responde ao robô) · Trocar arte (fadiga, ou barato e não responde) · Cedo (sem média, ou gasto < 3 leads da média com menos de 10 leads) · Candidato a escalar (com 10 maduros no robô: responde — ≥ 50% — e CPL até a média; sem leitura do robô ou abaixo da amostra, a D9: CPL ≤ 0,7× a média com 10 leads, sem fadiga, rotulado "sinal de topo de funil, ainda sem reunião", com a trava de qualidade — contato inválido ≤ 25%, sem telefone + sem WhatsApp ≤ 25%, resposta ≥ 25% com 3+ maduros —, nunca com piso de gasto; selo vazado) · Manter. Média = Σ gasto ÷ Σ leads com criativo dos criativos de conversão do período, sem a live (aparece só como múltiplo; o valor no ⓘ). Os anúncios da live têm chave própria (`live|…`): o criativo misto vira duas linhas; o mesmo com o criativo que roda em conversão E em descoberta (`desc|…`, fora do sinal e da média). A resposta ao robô é COORTE, por linha (`trechoDoRoboPorLinha`, a classificação do Funil): responderam ÷ 1ª mensagem, aceitaram ÷ responderam, sem WhatsApp ÷ no robô, sem teste nem cópia; % só com base ≥ `AMOSTRA_MINIMA`, "≥ N" com a leitura parada, colunas somem sem gente dos criativos no robô; reunião na linha vence a leitura. CPL de linha só com 3+ leads ("— (n = 1)"), também no motivo do sinal. Saíram: rankings, faixa de saúde, Gancho e Retenção (janela do sync, não do período), o "sem resultado" da fadiga, meta e ritmo como status, `notaDeNaoAtribuidos` (o "fora das linhas" é UM texto, `textoDosForaDasLinhas`, nos ⓘ da verba e dos conjuntos). Ficam: conjunto por `adsetId`, criativo por `creativeId`, reunião atribuída só com id (conjuntos, criativos e motor), "Leads (painel)" × "Conversões Meta (Pixel)", quarentena por linha, a fadiga com a regra na dica e a janela em `fimDoPeriodo`, o gasto nunca como orçamento. **Leads**: colunas da ficha (etapa máxima = `etapaMaxima`, função dos
  marcos — ADR-01), "Atendimento" (`atendimentoAgora`: o grupo da Fila pela MESMA
  `etapaDoLead`, senão o robô, "Antes do robô" ou nada — o filtro "dono" lê dali; o de 5
  estados da live se chama "Status do atendimento", chave `?atendimento=`), filtro `robo`
  (`casaFiltroRobo`, só com o robô ligado), abas com contagem que somam o total, origem campanha › conjunto ›
  anúncio, exportação só com `leads:write`, montada NO SERVIDOR (`POST /leads/exportar`
  recalcula linhas e contagem) e SEMPRE registrada em `audit_log` antes de devolver o
  arquivo — célula que começa com = + - @ ganha apóstrofo e o telefone só leva dígitos e
  separadores; o papel Marketing vê telefone e e-mail mascarados (`lib/lgpd.ts`) em
  tabela, ficha, histórico e no motivo de "parece teste".
  **Conteúdo** (Fase 5, nov/26; `montarConteudoDaTela` e `registrosDoPeriodo` em `lib/conteudo.ts` + `carregarConteudo`, `lib/conteudo-server.ts`; os tipos da tela e o que o client lê em `lib/conteudo-tela.ts` — valor só de `./format`): "a grade está em dia, e quais posts funcionaram?" — UMA página (a antiga vista Posts é redirect), abre em 30 dias. O dia do post é o de Brasília em TUDO (`diaDoPost`: período, datas, variações, Registros, grade da semana). De cima para baixo: o placar sem régua (sem Δ, sem meta) numa linha — "N posts no período" (`aggregatePostPerformance(...).count`: a grade, sem teste nem impulsionado) · "Último post há N dias" (`ultimoPostDaGrade` + `textoDoUltimoPost`, o MESMO do rodapé do Início; histórico inteiro; `null` = "Nenhum post ainda", nunca "há 0") · "Seguidores +N (pago + orgânico)" (`resumoSeguidores`, a regra única; sem total = "—"; total, ganhos e perdas, a nota dos 100+ e desde quando a variação conta — véspera ou 1ª leitura — no ⓘ); a linha "N grupos de posts iguais no mesmo dia para conferir →" (`variacoesNaGrade`: os grupos de `variacoesDeAnuncio` no histórico INTEIRO que ainda têm 2+ posts na GRADE — um post que sobra é a peça do dia; o impulsionado já está fora); o recolhido "Posts iguais no mesmo dia" tem um checkbox por post da grade (todos marcados de início, com hora e link do post) e marca só os marcados por `marcarComoTesteAction` — nada muda sem uma pessoa confirmar; desmarcar = Registros); os posts que mais funcionaram (`melhoresDaGrade`: salvos + compartilhamentos, depois interações, em número, não taxa; empate por alcance e recência; ≥ 1 interação; o título diz a chave que decidiu e "empatam" no empate; a IA usa a MESMA função no período dela), até 3 cartões com miniatura (`MiniaturaDoCriativo`; reel = `thumbnailUrl`, os outros a imagem que não é vídeo; `miniaturaValida` em `lib/miniatura.ts`) e a legenda em 1 linha (`legendaCurta`: 1ª linha, ≤ 8 palavras ou 60 caracteres + "…"; a completa abre no post, nunca no DOM, em `title=` nem na chave do grupo das variações, que é dia + id do 1º post); até 2 ações de conteúdo (`acoesDaGrade`: `IDS_DE_CONTEUDO` — cadência, a grade da SEMANA CORRENTE e formato —, por severidade, uma linha ≤ 12 palavras com o verbo e o número — `Recommendation.linha` — e "→ Produção"; o `detail` no ⓘ; `same-day-pileup` espera os grupos de variação do período; `no-recent-post` e `grade-da-semana` são do AGORA e aparecem em qualquer período; a IA recebe a lista inteira, com `grade-composicao`, a média do período); recolhidos "Posts iguais no mesmo dia", "Todos os posts" (`PostsTable` recebe só `LinhaDePost`: teste e impulsionado com selo) e "Conta do Instagram" ("Alcance da conta (pago + orgânico)" ≠ "Alcance orgânico dos posts", views, interações, visitas ao perfil; o gráfico "Total de seguidores" só na marca de conversão). Saíram: leads orgânicos (moram no ⓘ do cartão Leads do Início), custo por seguidor (Início da awareness), "Cliques no link da bio" (`profile_links_taps` mede os botões de contato do perfil, não o link — tela, dicionário e IA), conversas de DM, metas e status, funis do perfil, o melhor dia (sem leitor; `weekdayPerformance` saiu), formato campeão, CTA, pilar e retenção (a IA continua lendo). `vanity-objective` (verba de descoberta) é ação só da marca de awareness. A marca de awareness vê a mesma página sem ações (moram no Início dela). **Registros** = só "Conteúdo dos posts" (teste, duração, pilar, CTA) dos posts do período, com "dd/mm hh:mm" e o link do post; título "N posts da grade · N de teste · N impulsionados" (soma a lista; o "da grade" é o do placar); o formulário manda o valor de origem (`orig_*`) e `updatePostsMetaAction` só grava o campo que a pessoa mudou — uma aba velha não desfaz a marcação (a linha do formulário remonta quando o valor gravado muda: o React não reaplica o `defaultValue` de um `<select>`, e o reset do form depois da action o voltaria ao da montagem). Risco conhecido: o sync do Instagram regrava teste, duração, pilar e CTA lidos no INÍCIO dele — uma marcação feita durante um sync é desfeita (fica para quando o sync for mexido). Saíram o snapshot manual (o sync grava a mesma linha), as DMs e a rotina de presença (nunca usadas; o sync apagava a rotina). As métricas
  da conta estão no MESMO dicionário (`lib/dicionario.ts`). **Configurações**: uma rota
  por vista, loader compartilhado (`_carregar.ts`), `lib/configuracoes.ts` é a fonte de
  qual vista tem qual âncora (`linkDeConfiguracoes`) e das pendências; guardas de papel no
  servidor como antes.
- **Régua editorial** (`src/lib/content/playbook.ts`): o "Guia de Produção" como código
  — grade semanal, ≤25s, gancho de 7 palavras, ciclo de CTA, "Nunca mais", metas de
  90 dias. Fonte ÚNICA: `validator.ts` (pré-publicação) e `recommendations.ts`
  (pós-publicação) leem dali — nunca hardcode um limite. Guia novo = subir
  `PLAYBOOK_VERSION` (cada validação grava contra qual régua passou). Só marcas em
  `hasPlaybook()` têm a Produção (`/conteudo/producao`): fora das abas desde a Fase 5 de
  nov/26, abre pelo "→ Produção" das ações do Conteúdo e pelo link no fim de "Todos os
  posts". A grade da semana é UMA função, `gradeDaSemana` (`content/outcomes.ts`, dia de
  Brasília): a Produção e a ação "Complete a grade da semana" leem dela.
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
  último sync que deu certo POR FONTE e POR MARCA (`lib/sincronizacao.ts`, tabela
  `sync_runs` — toda execução é gravada, dê certo ou não, com a janela coberta), nunca o
  `updated_at` global; falha vira "(falhando)" e alerta. Dia sem linha de anúncio coberto
  por sync bem-sucedido é **sem veiculação** (cinza, sem "≥"); sem cobertura é **sem
  dados** (âmbar, piso) — `lib/cobertura.ts`, ADR-06; um sync só cobre até 2 dias antes
  de terminar (a Meta atrasa). Período que ainda não começou = o 1º dia, vazio
  (`resolveRange`; `pageRange` diz `naoComecou`), nunca "tudo" em silêncio; dia depois de hoje
  é FUTURO e dia antes da 1ª linha de anúncio não existia — nem "sem dados" nem "sem
  veiculação"; Mídia, motor e IA terminam em `fimDoPeriodo` = min(range.to, hoje); o "no ar" ancora em min(`fimDoPeriodo`, dia do último sync de anúncios OK) (`refDaVeiculacao`; sem sync, o último dia com linha) e, quando esse dia é anterior a hoje, a tela diz "no ar em dd/mm" (`noArTexto`). **Dia de
  lead e de evento = Brasília** (`diaDoLead`, `horario-util.ts`, nunca lança) — em UTC o lead
  das 22h de quinta caía na sexta. Seguem o dia da FONTE: `ad_daily` e a conta do Instagram
  (`dayOf`); o post é um instante e conta no dia de Brasília (`diaDoPost`, desde a Fase 5 de
  nov/26) em todo filtro e toda data de post — período, cadência, variações, último post,
  Registros, a grade da semana e a Produção (o dia ocupado da nota gravada, o vínculo peça →
  post e as datas exibidas); `lp_daily` é de Brasília desde 05/11/2026 (histórico em UTC).
  O CSV grava `-03:00` (`instanteDoCsv`); lead antigo importado só com a data recua 1 dia. O
  painel da live, os criativos da live (Mídia) e `ehInscritoDaLive` (congelados) contam o dia
  em UTC até a D1 — na mesma Mídia, o lead das 22h cai num dia nos criativos da live e no
  seguinte nos conjuntos. Período que ainda não começou não tem "anterior" (`carregarBussola`
  compara só com `!naoComecou`; o cartão também o descarta): a seta seria −100% contra hoje.
- **Metas** (Fase 4, `lib/metas.ts`, tabela `metas`, migração `0017`): a régua do
  funil tem VIGÊNCIA — mudar uma meta INSERE uma linha (`addMeta`), nunca altera; cada
  dia é julgado pela meta que valia nele (`metaVigente`), `alvo: null` limpa. Contagem
  e verba somam a meta semanal dia a dia (`alvoNoPeriodo`); custo e taxa valem como
  estão. Status SÓ por `statusContraMeta` (verde ≥ 100%, âmbar 80–99%, vermelho < 80%;
  custo invertido até 120%; verba = ritmo ±10%/±25%) e SEMPRE com texto
  (`StatusMetaBadge`, prop `meta` do `KpiCard`). Sem status quando a meta não cobre o
  período inteiro, o período ainda não começou ou o número não se sustenta
  (`reguaDoPeriodo`); os cartões do Início e o resumo da Mídia não levam status de meta. As metas saem da
  calculadora (`calcularMetas`, V·c·m·f·s·a·N, entradas gravadas com a meta); sem
  amostra (< 20 leads ou < 5 agendadas em 8 semanas) ficam "provisórias". Cor de status
  usa os tokens `--status-*` (nunca `--warning`, que colide com o âmbar da marca) —
  validados em `paleta.test.ts`. Metas de conteúdo (seguidores, plano de 90 dias)
  continuam em `goals`.
- **Alertas** (`lib/alertas.ts`, `components/layout/alertas.tsx`): um lugar só, o
  "⚠ N" do cabeçalho com painel lateral. Globais (sync falhando — `sync-robo` inclusive —,
  gasto sem marca, rastreio sem chave e `robo-sem-1a-msg`, a MESMA contagem da frase do
  Início e de Integrações, só com a leitura do robô em dia) vêm do layout; os do período a
  página registra com `<RegistrarAlertas>` — no Início, `alertasDoInicio` (travas, saúde do
  dado — só ele a registra —, atribuição, `lp-sem-dado` só em período já começado); no modo
  live, `alertasDaLive` (sem as travas de CPL/CPR, que a tela não mostra; com
  `live-sem-campanhas`, que era faixa no painel); no Funil, `alertasDoFunil` (só as travas que
  afetam verba ou CPL — sem as do custo por reunião nem a atribuição, que a tela não mostra —,
  `lp-sem-dado` e `registro-suspeito`); na Mídia, `alertasDaMidia` (as travas de `kpisDoPeriodo`, a atribuição, `midia-fora-das-linhas` — mais de 25% dos leads de conversão sem conjunto — e `midia-reunioes-so-por-nome` — o link com `{{ad.id}}`; só a Mídia registra os dois). Trava `config` (meta, orçamento em branco)
  NÃO entra no ⚠ (`alertasDeConfianca`): mora em Configurações → Pendências (`assessTrust` não
  muda). Não crie faixa de aviso no meio da tela — o que desqualifica um número fica colado
  nele ("—", "≥", "≤") e a explicação vai para o painel.
- **Marca da linha de anúncio** (`brandForCampaign`): regra por token do nome ou id de
  campanha (`ad_daily.campaign_id`). Sem casar: conta de uma marca só → ela; `*` → o
  resto declarado; ninguém com regra → a padrão; uma única sem regra → ela; senão
  `NAO_CLASSIFICADO` — fora de todos os números, com alerta e prévia em Configurações → Marcas. A
  reclassificação inclui esse balde (`replaceAdData` sem escopo troca TUDO).
- **Charts (client) recebem props serializáveis.** Server Components não podem
  passar funções para Client Components. Cores vêm de CSS vars (`components/charts/colors.ts`),
  da paleta data-viz validada — não invente hex novos sem rodar o validador.
- **Ícones:** lucide-react não tem mais ícones de marca (`Instagram`, etc.) — use genéricos.
- **UI em pt-BR.** Tabelas ordenáveis usam `components/ui/data-table.tsx` com colunas
  definidas em componentes client (`components/tables/*`).

## Live 01/12 (nov/2026)

- **Marcas** (E1-14): o casamento token × campanha é UM só (`lib/regra-de-marca.ts`,
  `marcaDaCampanha`: sem diferença de maiúsculas, espaços, `[ KRN ]`, colchete de largura cheia)
  — sync, reclassificação e a prévia da tela usam a mesma função. A trava "a regra não pega nada"
  olha a CONTA inteira (`contextoDeMarcas` → `listCampanhasDaConta`): só com as linhas da marca
  aberta, regra que funciona parecia inerte e o "≤" nunca saía. Salvar a regra reclassifica o
  histórico na hora (a tela mostra antes o que muda). `upsertAdDaily`: o mesmo (dia, anúncio de id
  numérico) que chega em outra marca sai da antiga — nunca duas cópias.
- **Ficha da live** (migração 0021, `lib/qualificacao.ts`): vocabulários das respostas (bem, faixa
  de valor, finalidade, parcela, prazo, horário) são fonte única; a leitura em 5 estados do
  atendimento (`statusAtendimento`) e o estado da reunião (`statusReuniao`) são DERIVADOS — não há
  2ª máquina de estados. `updateLeadFicha`: respostas sobrescrevem, fatos da automação
  (`FICHA_UMA_VEZ`: mensagem, aviso, escalonamento, comunidade) são gravados uma vez. Escrita de
  ficha passa por `gravarFicha` (evento `ficha` por fato que mudou); tentativa com resultado e
  notas por `registrarContato` (ficha, Fila e API — um caminho só).
- **Classe** (`lib/classe.ts`, puro): X (quitar dívidas) → C (abaixo do mínimo ou parcela
  incompatível, pela tabela de parcela) → B (bem Outro, "Preciso agora", "Mais de 3 anos") → A. A do
  painel é GRAVADA (`comClasse` em toda escrita de resposta) e salvar a tabela (Configurações →
  Atendimento e classe, `classe_tabela_parcela`) recalcula todos. A que vale é `classeDoLead`
  (painel, senão n8n); as duas diferentes = alerta global e "≠ n8n" em Leads.
- **API do n8n** (`/api/n8n/*`, `lib/n8n/*`, `docs/api-n8n.md`): token `N8N_API_TOKEN` (sem ele,
  503 — nunca aberta). Chave = WhatsApp normalizado (55 + DDD). A inscrição e o `/api/track` rodam
  na `comTravaDaPessoa` (fila no processo + advisory lock) — a LP manda aos dois ao mesmo tempo. O
  mesmo cadastro pelo outro caminho em até `MESMA_INSCRICAO_MIN` não é reenvio. PATCH aplica passo
  a passo pela régua de transição; o primeiro que não pode devolve 409 com o que já foi gravado.
  Log de erro sem corpo (telefone e e-mail nunca).
- **Página de inscrição direto no painel** (`/api/track`): a página manda as 5 respostas e o aceite
  com as chaves da API do n8n (`lerRespostasDoFormulario`, sem a classe — da página ela é
  ignorada); vazio não apaga, opção fora da lista é ignorada sem perder o lead, e a ficha passa
  pela mesma `gravarFicha` + `comClasse`. Classifica sem depender do n8n (`docs/api-n8n.md` §5).
- **CAPI da live** (E2-19, `eventosDaFicha` em `leads/gravar-ficha.ts`): `LeadQualificado` (a
  classe vira A ou B pela 1ª vez, `ehQualificado`) e `EntrouNaComunidade` (`comunidadeEm`),
  personalizados, ids `qualificado-<lead>`/`comunidade-<lead>`, pela caixa de saída ANTES do
  histórico. Só o painel sabe a classe: os dois saem SÓ pela CAPI — o Pixel manda só o `Lead`.
- **Turno e Fila da live** (`lib/turno.ts`, `lib/fila-live.ts`, `atendimento_expediente`): turno
  por dia da semana, feriados, faixas, prazo A (1 hora do turno; com faixa escolhida, início da
  faixa + folga), B (fim do turno do dia ou do próximo útil), cadência (2ª: horas do turno; 3ª:
  horas corridas empurradas para o turno; janela de 48 h → "Sem resposta"). A e B vão para a Fila
  da live, por prazo; C e X ficam só em Leads; sem classe segue a régua de sempre
  (`horario-util.ts`, 9h–18h). `etapaDoLead` tira os leads com classe das etapas de contato (as de
  reunião ficam); a Fila da live entra no `esperandoOComercial` e na frase "Live 01/12 · N na
  fila" do Início (e na C1 do motor, dormente).
- **Painel da live** (era a aba `/live`; no Início desde a Fase 2): o atalho "Live 01/12" do
  seletor é um PERÍODO — a chave do período livre da régua (`lib/atalho-live.ts`, puro e
  importável no client), que toda tela que lê `?range=` entende. Numa das 3 chaves (campanha,
  captação, pós-live — `periodoDaLive`, SÓ pela chave: depois do fim continua abrindo; chave de
  régua editada = período comum) o Início troca os 4 blocos pelo painel (`montarModoLive`,
  `components/live/painel-live.tsx`) + o resumo, se existir, sem rodapé; os sub-atalhos são
  `/?range=<chave>`. O recorte do painel é EXATAMENTE o da antiga `/live` (`rangeDoPainelLive`,
  sem o clamp do 1º dado); kpis e alertas usam o `pageRange`. O comercial fica no modo live
  (grava os números manuais) e, com o atalho visível, o Início dele aponta para a chave
  (`inicioDoComercial`). O botão (`cfg.nome`) some depois de max(`periodo.ate`, `posLive.ate`)
  e na awareness, mas aparece aceso com a chave na URL; com as 3 chaves o "Escolher" abre
  vazio. Abaixo de `2xl` (1536 px) o seletor é UM botão ("7 dias ▾", `estadoDoSeletor`): os 7
  em linha, com o menu do usuário e a data do dado, não cabem no cabeçalho de um notebook.
  Régua em
  `lib/live.ts` (`live_campanha`, padrão = briefing, editável em Metas e orçamento); conta em
  `lib/live-painel.ts` (puro, congelado). Inscrito da live = veio com a ficha (ou
  `utm_campaign`, se configurado). Custos seguem as travas: denominador zero é "—", reunião
  abaixo de `MIN_REUNIOES` é fato. Verba é da linha inteira até hoje; o resto é do período.
  Resumo do ClickUp = `resumoSemanalDaLive`.
- **Criativos da live** (`lib/criativos-live.ts`, na Mídia) — recolhido em "Criativos da live 01/12", com o mesmo conteúdo; o recorte decide pela CHAVE do período: período livre (e os atalhos da live) recorta; 7/14/30/90 dias ou Campanha mostram a campanha da live até hoje (o mesmo seletor aceso nunca dá dois conteúdos); na verba, a live é UMA linha, fora do destaque: sinal é SUGESTÃO (nada é pausado no
  Meta): cedo demais até 5 dias E R$ 60; pausar acima de 2× a média dos julgáveis; o de carro só
  a partir de `carro.julgarDesde`, contra os de imóvel da mesma semana. Nomes das campanhas,
  conjuntos e anúncios = trechos editáveis (proposta `[LIVE] …`, `Carro`, `C9`, `C4A/C4B`).
- **Reunião com o Brunno** (E5-05, `lib/reuniao.ts`, puro): a ficha mostra a linha da véspera
  (`mensagemDaVespera`, com os alertas do diagnóstico) e, com a reunião realizada, "proposta enviada"
  ou "vai pensar" — FATO da ficha (`resultado_reuniao`), não status novo; vendeu continua "Cliente"
  com valor. "Vendas" do painel da live = o digitado, senão os clientes da ficha (um número só nos textos).
  Os textos das tarefas (E3-13, E3-07, E4-05, E5-08, E5-05) saem de `relatoriosDaLive`.
- **Conferência com o Gerenciador** (`lib/conferencia.ts` + `lib/conferencia-periodo.ts`, tabela `conferencias_gasto`, 0022): mora em Configurações → Integrações (`#conferir-gasto`, com o período do link, visível para todos os papéis; o campo só com `data:write`); a Mídia só linka ("Conferir com o Gerenciador →"). O servidor recalcula o gasto TOTAL do período (`gastoDoPeriodoParaConferir`, o "Investimento total" do ⓘ do resumo da Mídia); até 5% é verde.

## Rodar / validar

```bash
npm run dev            # http://localhost:3000
npm test               # Vitest (unidade + contrato do store em JSON e Postgres/PGlite)
npx tsc --noEmit       # typecheck
npm run build          # build de produção
```

Reset dos dados de exemplo: botão em **Configurações → Zona de perigo**, ou `rm -rf .localdata`.

Roadmap (Supabase + Meta Marketing API v25 + Instagram Login + GA4/CAPI): ver README.
