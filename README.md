# Dashboard de Campanha — Consórcio

Central de análise da campanha de tráfego pago do Instagram do head de consórcio.
Reúne, numa só ferramenta que todo o time acompanha: **orgânico do Instagram**,
**tráfego pago**, **comparação de criativos** e o **funil de leads até a reunião**.

North Star: **Custo por Reunião Agendada (CPR)**.
Funil (por coorte): `Impressões → Visitas → Leads → robô (1ª mensagem → Responderam → Convite aceito) → Agendaram (Confirmaram) → Reuniões realizadas → Vendas`.

## Stack

- **Next.js 16** (App Router) + **React 19** + **TypeScript**
- **Tailwind CSS v4** + componentes próprios (shadcn-style)
- **Recharts** para gráficos (cores da paleta data-viz validada, theme-aware claro/escuro)
- **Store local em JSON** hoje → **Supabase** na Fase 2 (ver Roadmap)

## Rodar

```bash
npm install
npm run dev
```

Abre em `http://localhost:3000`. O dashboard já sobe com **dados de exemplo**
(seed) para você ver tudo funcionando. Substitua pelos dados reais em
**Configurações**.

Build de produção:

```bash
npm run build && npm start
```

### Medir o texto de uma tela

Ferramenta de quem desenvolve. Rode `npm run dev`, abra a página como ela abre (sem `#`, nada
aberto), cole `scripts/medir-texto.js` no console (F12) e dê Enter: sai a rolagem em telas, as
palavras fora de tabela, as frases longas (7+ palavras) e o pior trecho, mais uma linha pronta para
a nota de entrega. `medirTexto({ comparar: true })` confere com a régua dos testes (`src/test/tela.ts`).

Cole só o arquivo deste repositório, no commit que está no ar — nunca uma cópia que chegou por chat,
e-mail ou link: o console de um painel com dados de pessoas não é lugar de código de terceiros. Fora
do localhost (produção), o console leva só contagens e a página não é contornada nem rolada, já na
colagem. No localhost sai também o começo do pior trecho e das frases longas (6 palavras, algarismo
como `#`), nunca da ficha nem de linha de pessoa, e nas telas de pessoas só o de títulos; confira antes
de colar a saída fora daqui.

## Estrutura

```
src/
  app/
    (dashboard)/            # grupo de rotas com o layout (sidebar + header)
      page.tsx              # Início — cartões, leads chegando, atendimento, rodapé (ou o painel da live)
      funil/                # o funil do processo (robô → reunião → venda), onde trava, perdas, coortes
      midia/                # o que fazer com a verba: para onde vai, criativos no ar com sinal e resposta ao robô; detalhes recolhidos
      fila/                 # fila de contato única (painel + robô + especialista)
      leads/                # leads, ficha, revisão, excluídos, histórico
      conteudo/             # Instagram: placar, os posts que mais funcionaram, ações da grade e todos os posts; registros (teste, duração, pilar, CTA); produção fora das abas
      configuracoes/        # metas, integrações, marcas, usuários, importar, ferramentas, zona de perigo
        actions.ts          # server actions (import, entradas manuais, reset)
    layout.tsx              # root: tema claro/escuro, fontes, metadados
    globals.css             # design tokens (paleta validada) + tema
  components/
    charts/                 # Recharts wrappers (linha/área, barras diárias)
    kpi/                    # KpiCard, GoalBar
    tables/                 # tabelas ordenáveis (criativos, posts, leads)
    layout/                 # sidebar, header, seletor de período, tema
    ui/                     # card, badge, table, data-table, etc.
    config/                 # formulários (client) da tela de Config
  lib/
    types.ts                # modelo de dados do domínio
    metrics.ts              # KPIs (funções puras: CPL, CPR, funil, conversões)
    format.ts               # formatadores pt-BR (R$, %, datas)
    csv.ts                  # parser do CSV do Ads Manager
    insights.ts             # geração dos insights escritos
    data/
      seed.ts               # dataset de exemplo (determinístico)
      store.ts              # camada de dados (JSON local) — PONTO DE PLUGUE do Supabase
scripts/
  medir-texto.js            # régua de texto da tela, para colar no console (T5)
```

## Dados

Toda leitura/escrita passa por `src/lib/data/store.ts`, que escolhe o backend em
tempo de execução:

| Backend | Quando é usado | Onde fica |
|---|---|---|
| **Supabase (Postgres)** | quando `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` existem | `supabase-store.ts` |
| **JSON local** | caso contrário (dev / sem credenciais) | `local-store.ts` — `.localdata/store.json` |

Os dois implementam a mesma interface (`backend.ts`), então páginas, actions e os
jobs de sync não sabem qual está ativo. A tela **Config** mostra qual é.

> Em produção serverless o JSON local não serve (o disco é efêmero e não é
> compartilhado) — use o Supabase.

### Importar do Ads Manager (CSV)

Em **Configurações → Importar**, envie o CSV exportado do Gerenciador de Anúncios. As
linhas são mescladas por `data + anúncio` (reimportar atualiza). O parser
reconhece cabeçalhos em PT ou EN. Baixe o **modelo** na própria tela para ver o
formato exato. Colunas usadas:

`Dia, Nome do anúncio, ID do anúncio, Nome do conjunto de anúncios, Nome da campanha, Valor gasto, Impressões, Alcance, Cliques no link, Leads`

### Entrada manual

Em Conteúdo → Registros: a marcação de teste, a duração do reel, o pilar e o CTA dos
posts. Leads em Configurações → Importar; metas em Configurações. O histórico de
seguidores vem do sync diário do Instagram (não há mais snapshot manual).

## Fase 2 — Supabase + coleta automática (implementada)

O código já está pronto; falta você criar as contas e preencher as credenciais.
Copie `.env.example` para `.env.local` — cada bloco preenchido liga uma peça.
**Enquanto nada estiver preenchido, o dashboard continua rodando** no JSON local.

### 1. Banco (Supabase)

1. Crie um projeto em [supabase.com](https://supabase.com).
2. No **SQL Editor**, rode `supabase/migrations/0001_init.sql`.
3. Em **Project Settings > API**, copie a URL e a chave `service_role` para
   `SUPABASE_URL` e `SUPABASE_SERVICE_ROLE_KEY`.

RLS fica ligada e sem policies de propósito: só o service role (server-side) lê.
Isso importa porque a tabela `leads` guarda dados pessoais (LGPD).

### 2. Instagram orgânico

Usa **Instagram API with Instagram Login** — não precisa de Página do Facebook.

1. Converta a conta para **Profissional** (Business ou Creator).
2. Crie um app em [developers.facebook.com](https://developers.facebook.com) e
   adicione o produto Instagram. Escopos: `instagram_business_basic` e
   `instagram_business_manage_insights`.
3. Faça o Business Login, troque o token curto por um de 60 dias e preencha
   `IG_USER_ID` e `IG_ACCESS_TOKEN`.

Para a **sua própria conta** o App Review não é necessário (Standard Access em
Development mode). Ele só entra se um dia o dashboard for ler contas de terceiros.
O token de 60 dias **se renova sozinho** e o novo fica salvo no banco.

### 3. Tráfego pago

Token de **System User** da Business Manager com permissão `ads_read`:
`META_AD_ACCOUNT_ID` e `META_ADS_ACCESS_TOKEN`.

### 4. Coleta automática

Defina `CRON_SECRET`. O `vercel.json` já agenda `/api/sync` diariamente às 09:00 UTC.
Também dá para rodar sob demanda pelo botão **Sincronizar agora** em Config, ou:

```bash
curl "https://SEU-APP/api/sync?secret=SEU_CRON_SECRET&source=all"
```

**Resumo da semana (IA).** Com `ANTHROPIC_API_KEY` e o mesmo `CRON_SECRET`, agende no
cron-job.org (ou em qualquer cron) para **segunda às 08:00 (Brasília)**:

```bash
curl "https://SEU-APP/api/resumo-semanal?secret=SEU_CRON_SECRET"
```

**Reenvio da CAPI.** Com a CAPI configurada e o mesmo `CRON_SECRET`, agende **a cada
15 minutos** (sem custo além das chamadas à Meta):

```bash
curl "https://SEU-APP/api/capi/retentar?secret=SEU_CRON_SECRET"
```

Ele tenta de novo os eventos que ainda não chegaram à Meta (ver "Caixa de saída da
CAPI", abaixo). Sem ele, a nova tentativa só acontece quando entra lead novo ou
alguém aperta **Reenviar agora** em Configurações → Integrações.

Ele lê a semana fechada anterior (segunda a domingo) pelo mesmo carregador do Início
— os cartões, os leads por dia e o atendimento como a tela os escreve, sem o motor de
ações — e grava a leitura, que aparece recolhida no Início com as 12 anteriores. Custa
cerca de US$ 0,09 por execução; `?brand=` gera para uma marca só. Sem leitura, quem
pode gerar vê no Início o botão "Gerar o resumo da semana" (com leitura, "Gerar de
novo" fica dentro do cartão).

### Como a coleta funciona (e por que assim)

- **Versão fixada** (`v25.0`). A Meta lança versão nova a cada ~trimestre e aposenta
  as antigas; nunca dependemos do default.
- **Janela retroativa + upsert.** Os insights atrasam até 48h, então re-sincronizamos
  os últimos dias em vez de só inserir os novos.
- **Instagram: 1 request por dia.** Só `reach` suporta série temporal; as demais
  métricas só existem como total agregado. Como contas novas têm cota baixa, a
  janela padrão é curta (7 dias).
- **Histórico de seguidores** só é construído daqui pra frente: a API devolve o
  número de hoje, não o de ontem. Por isso guardamos snapshots diários.
- **Leads** vêm do `action_type` `offsite_conversion.fb_pixel_lead` (o evento do
  Pixel na landing page). O `lead` "puro" é um agregado e nunca é somado com ele.
- Os números do Instagram **não vão bater** com os do Ads: insights orgânicos
  excluem o engajamento gerado pelo anúncio. Isso é esperado.

## Login (usuário e senha)

O painel tem login próprio, que **ativa quando `AUTH_SECRET` está definido** (sem
ele, o dashboard fica aberto — cômodo em dev; defina em produção).

- **Primeiro acesso:** com `AUTH_SECRET` setado e nenhum usuário ainda, abra
  qualquer página → você cai em `/login`, que mostra "criar primeiro acesso". Esse
  usuário vira admin.
- **Papéis de acesso:**
  - **Administrador** — tudo, incluindo gerenciar usuários.
  - **Marketing** — vê tudo e opera dados de marketing (importar CSV, sync, metas),
    mas **não altera leads** (vê os contatos em modo leitura).
  - **Comercial** — **altera leads** (status, adicionar lead), mas não mexe nas
    configurações de marketing.
  - Regra-chave: **só Comercial e Administrador alteram algo na aba de Leads.**
  - Enforçado nos dois lados: a UI esconde/desabilita, e cada server action valida
    o papel (`src/lib/auth/roles.ts` + `guard.ts`). No modo aberto (sem
    `AUTH_SECRET`) todos têm acesso total.
- **Mais usuários:** em **Config → Usuários do painel** (adicionar/remover e trocar
  o papel). No Supabase, rode também `supabase/migrations/0005_user_roles.sql`.
- **Senhas** são guardadas com hash **scrypt** (nunca em texto puro); a sessão fica
  num **cookie assinado (HMAC) httpOnly**. O `middleware.ts` protege todas as rotas,
  menos `/login`, `/api/track` (LP) e `/api/sync` (cron, com o próprio segredo).
- No Supabase, rode `supabase/migrations/0004_auth_users.sql`. No modo local os
  usuários ficam no mesmo `.localdata`.

Gere o segredo com `openssl rand -hex 32` e coloque em `AUTH_SECRET` (em
`.env.local` no dev, e nas variáveis de ambiente da Vercel em produção).

## Fase 3 — Rastreio da landing page (implementada)

Fecha o ciclo: o anúncio leva à landing page, a LP reporta o lead, e quando o lead
**agenda a reunião** esse sinal volta para a Meta — que passa a otimizar por quem
marca reunião, não por quem só preenche formulário barato.

### 1. Gere as UTMs

Na tela **UTMs**, gere um link por criativo. `utm_content` recebe o **ID do anúncio**
— é esse campo que liga o lead de volta ao criativo. UTM que não foi marcada no
anúncio não dá para reconstruir depois.

### 2. Instale o rastreio na landing page

Copie `public/lp-tracking.js` para a sua LP e adicione antes do `</body>`,
**depois** do Pixel:

```html
<script>
  window.__DASH_CONFIG = {
    endpoint: "https://SEU-APP.vercel.app/api/track",
    ingestKey: "SUA_TRACK_INGEST_KEY",
    requireConsent: true
  };
</script>
<script src="lp-tracking.js"></script>
```

Marque os elementos no HTML:

```html
<form data-track="lead-form"> ... </form>
<a data-track="cta">Agendar reunião</a>
```

O script captura UTMs e `fbclid` no primeiro acesso, guarda em cookie first-party
(a origem precisa sobreviver até o envio do formulário), preenche campos ocultos
`utm_*` e reporta visitas, cliques no CTA e leads.

### Depois da inscrição: comunidade e diagnóstico (nov/26)

Dois tipos de evento a mais no `/api/track`, com a **mesma** checagem de
`ingestKey` e o mesmo formato dos outros: JSON enviado como `text/plain` (por
`sendBeacon`, sem preflight). `page_view`, `cta_click` e `lead` não mudaram. A hora
que vale é a de **chegada ao servidor**; a tela mostra em America/Sao_Paulo.
Evento inválido = `400` com a lista `erros` (o nome do campo, nunca o valor) e
**nada gravado**; corpo acima de 16 KB = `413`; certo = `204`.

**`comunidade`** — a página de obrigado, no clique em "Entrar na comunidade". O
`eventId` é o **mesmo** do evento `lead` (passe-o da LP para a página de obrigado,
por exemplo na URL do redirecionamento):

```json
{ "type": "comunidade", "ingestKey": "...", "eventId": "k3x9qa", "pageUrl": "https://.../obrigado.html" }
```

Com o `lp-tracking.js` na página, use a função dos tipos novos (faz o mesmo envio
do `post()` interno: chave, página, atribuição, fila do consentimento):

```html
<a href="https://chat.whatsapp.com/..." onclick="window.dashTrackEvento('comunidade', { eventId: codigo })">
  Entrar na comunidade
</a>
```

O painel guarda o **primeiro** clique por `eventId` (tabela `comunidade_cliques`) e,
achando o lead (pelo `eventId` da entrada — também quando a pessoa já era lead e o
reenvio caiu no cadastro antigo), grava o horário em `comunidadeEm`: é o mesmo fato
que o n8n mandava como `clicou_comunidade` — a ficha, o painel da live ("Na
comunidade") e a CAPI (`EntrouNaComunidade`) leem dali.

**`diagnostico`** — o Diagnóstico do Próximo Patrimônio manda direto ao
`/api/track` (sem o `lp-tracking.js`), em três momentos: `inicio` (senha certa),
`resposta` (a cada pergunta respondida) e `resultado` (a tela final).

```json
{
  "type": "diagnostico",
  "ingestKey": "...",
  "tentativa": "5d0c3c9e-1b7a-4c1e-9a51-2f0f4d3e8b10",
  "etapa": "resposta",
  "phone": "5511987654321",
  "respondidas": 6,
  "total": 9,
  "respostas": [
    { "n": 1, "pergunta": "Onde está a maior parte do dinheiro", "resposta": "CDB, Tesouro ou fundos" },
    { "n": 6, "pergunta": "Consórcio é um tipo de empréstimo.", "resposta": "Falso", "acertou": true }
  ],
  "pageUrl": "https://..."
}
```

No `resultado` vêm também:

```json
{ "perfil": "Construtor de patrimônio", "notas": { "reserva": 85, "lance": 40, "conhecimento": 65, "plano": 30 }, "conquistas": 7, "conquistas_total": 12 }
```

Envio sugerido (sem preflight, como o do script):

```js
navigator.sendBeacon(ENDPOINT, new Blob([JSON.stringify(evento)], { type: "text/plain;charset=UTF-8" }));
```

| Campo | Regra |
| --- | --- |
| `tentativa` | obrigatório; letras, números, `-` e `_`, até 100 caracteres (um uuid por tentativa) |
| `etapa` | `inicio`, `resposta` ou `resultado` |
| `phone` | WhatsApp com DDD (com ou sem 55, com ou sem o 9) |
| `respondidas` | inteiro de 0 a 9 (sem ele, o tamanho de `respostas`); não passa de `total` |
| `total` | inteiro de 1 a 9 (padrão 9) |
| `respostas` | a lista **completa** até aquele momento, no máximo 9, sem repetir `n` (1 a 9); `pergunta` e `resposta` com até 200 caracteres; `acertou` (true/false) nas de verdadeiro ou falso (6, 7 e 8) |
| `perfil` | até 200 caracteres (só vale no `resultado`) |
| `notas` | `reserva`, `lance`, `conhecimento`, `plano`: de 0 a 100 |
| `conquistas` | inteiro de 0 a `conquistas_total` (até 12; padrão 12) |

Como o painel lê:

- **O último evento de cada tentativa vale** (a lista de respostas vem inteira,
  porque a pessoa pode voltar e mudar uma). Uma linha por tentativa, tabela
  `diagnosticos`. Concluir é fato: o primeiro `resultado` grava `concluidoEm`, e um
  beacon da 9ª resposta que chegue depois dele não desfaz.
- **Ligação com o lead pelo telefone:** só dígitos, sem o 55 da frente quando sobram
  mais de 11 dígitos, e compara DDD + os 8 últimos dígitos (com e sem o 9). Mais de um
  lead com o número: o da campanha da live e, entre eles, o mais recente.
- **Várias tentativas da mesma pessoa:** vale a mais avançada — concluída vence
  incompleta; entre iguais, a mais recente.
- Sem lead correspondente, o diagnóstico **não se perde**: aparece em Leads →
  "Diagnóstico sem inscrição" e passa para o lead quando ele existir.
- Ao concluir, o resultado vai também para a ficha do lead (`diagnostico`, o formato
  que o n8n mandava; o que o n8n gravou não é sobrescrito).

Em **Leads**: colunas "Comunidade" e "Diagnóstico", o filtro "Diagnóstico" (Não
começou · Começou, não concluiu · Concluiu), o resumo do período (inscritos,
clicaram na comunidade, começaram, concluíram e quantos chegaram a cada pergunta) e
as colunas no CSV. Na **ficha**: a linha do tempo depois da inscrição, o resultado
(perfil, raio-x, conquistas) e as respostas, com acerto ou erro.

Se `LP_ALLOWED_ORIGIN` estiver preenchida, inclua o domínio da página do diagnóstico
na lista (separada por vírgula).

Migração: `supabase/migrations/0025_depois_da_inscricao.sql` — só tabelas novas
(`comunidade_cliques` e `diagnosticos`). No Postgres do EasyPanel ela roda sozinha
no boot (`src/lib/db/schema.ts`).

### 3. Conecte CAPI e GA4

Preencha `META_DATASET_ID` + `META_CAPI_TOKEN` (Events Manager > Conversions API >
*Generate access token*) e `GA4_MEASUREMENT_ID` + `GA4_API_SECRET`. Defina também
`TRACK_INGEST_KEY`, `LP_ALLOWED_ORIGIN` e `LP_BASE_URL`.

### Como a deduplicação funciona

No envio do formulário o script gera **um** `event_id` e usa o mesmo nos dois lados:

- **navegador:** `fbq('track','Lead',{},{eventID: id})`
- **servidor:** o `/api/track` manda `Lead` à CAPI com `event_id: id`

A Meta casa `event_id` + `event_name` no mesmo dataset (janela de 48h) e descarta o
segundo — então você recupera o sinal que o navegador perde **sem** contar o lead
duas vezes. Por isso o `event_id` é gerado uma única vez, no cliente.

### Reunião agendada → sinal de volta

Cada fato do comercial vira um evento na Meta, **só na primeira vez** que acontece (pelo
marco do lead, não pelo status):

| Fato | Evento na CAPI | `event_id` |
| --- | --- | --- |
| Agendou (1ª vez) | `Schedule` | `schedule-<leadId>` |
| Compareceu (1ª vez) | `ReuniaoRealizada` (personalizado) | `realizada-<leadId>` |
| Fechou (1ª vez) | `Purchase`, com o valor da carta | `purchase-<leadId>` |

Os três levam e-mail e telefone em SHA-256, o nome, `fbc`/`fbp` crus e o id do lead.
Agendar, desistir e agendar de novo não manda um 2º `Schedule`. O GA4 segue com
`qualify_lead` (agendou) e `purchase` (fechou).

### Caixa de saída da CAPI

Todo evento passa pela tabela `capi_envios` (migração 0020): é gravado **antes** de
ir à Meta e fica `pendente` até ela confirmar. Falhou? Nova tentativa em 5 min, 15 min,
1 h, 3 h, 6 h e a cada 12 h (a última 30 min antes do fim) — **só nas 48 h depois do
fato**, a janela em que a Meta deduplica pelo `event_id` (depois dela, reenviar poderia
contar duas vezes). Token vencido, dataset errado ou Meta fora do ar seguem na fila:
corrigida a configuração, **Reenviar agora** (Integrações) manda tudo que ainda está na
janela. Só a recusa do próprio evento desiste na hora. O que não sair fica "não chegou",
com o porquê, na ficha do lead e num alerta. O evento guardado (com IP e navegador da
visita) é apagado assim que sai ou expira — mesmo com a CAPI desligada. A ficha do lead
mostra "Enviado à Meta ✓" ao lado do fato; Integrações mostra o placar da semana e se o
cron está rodando. Com `META_CAPI_TEST_EVENT_CODE` definido, os eventos NOVOS saem como
**teste** (não contam nos relatórios) — a tela e o alerta dizem isso; o que já estava na
fila sai no modo em que entrou.

### Status do lead

A régua vive em `src/lib/lead-status.ts` — rótulo, cor, posição no funil e "isto
encerra o lead?" saem todos de lá. Status novo = uma entrada nessa tabela.

| Status | O que significa |
| --- | --- |
| **Novo** | Entrou e ninguém contatou ainda. É o estoque da fila do comercial (SLA de resposta). |
| **Agendado** | Reunião marcada — exige a data e a hora da reunião. Na 1ª vez, com CAPI/GA4 configurados, dispara `Schedule` para a Meta e `qualify_lead` para o GA4. |
| **Reunião realizada** | Compareceu. Na 1ª vez, dispara `ReuniaoRealizada` para a Meta. |
| **Cliente** | Fechou, com o valor da carta registrado. Na 1ª vez, dispara `Purchase`. |
| **Contato inválido** | Telefone/e-mail não existe. Perda de **qualidade** — o comercial não teve chance. |
| **Sem resposta** | Contato válido, nunca retornou. Perda de **qualidade**. |
| **Não tem interesse** | Falou com o comercial e disse não. Perda de **decisão**. |
| **Desistência** | Chegou a agendar e caiu antes de fechar. Perda de **decisão**. |

Os quatro últimos encerram o lead. A distinção entre perda de **qualidade**
(resolve-se na segmentação/criativo/formulário) e de **decisão** (resolve-se na
oferta e no pitch) é a base do "onde atacar" do card **"Por que perdemos"**, no Funil, que mostra uma
linha por motivo e quem encerrou (robô ou comercial).

Desistência **não** conta como reunião: quem marcou e caiu não gerou reunião, então
sai do denominador do CPR; no Funil, o ⓘ de "Agendaram" diz quantos desistiram, e eles contam
como "agendaram e a reunião não aconteceu".

Migration: `supabase/migrations/0011_lead_status_reasons.sql`. Ela renomeia
`agendou`/`compareceu` e joga o antigo `perdido` — que não guardava motivo — em
*Sem resposta*; a quebra de perdas de períodos anteriores a ela não é diagnóstico.

### Aba Leads

A tela **Leads** lista todos os contatos da campanha (nome, telefone, e-mail),
com busca, filtro por status, status editável, link de WhatsApp/e-mail e
**exportação em CSV** para o time comercial. A tabela abre com as 50 entradas mais recentes e "Mostrar mais"; a busca, as abas, a ordenação e a exportação valem para a lista inteira.

Logo abaixo há o **Histórico de alterações** (log de auditoria): cada criação e
cada mudança de status registra **quem** fez, **de/para** qual status e **quando**.
O ator é o usuário logado (ou "Landing page" quando o lead entra pelo formulário).
Migration no Supabase: `supabase/migrations/0006_lead_events.sql`.

### Avisos de lead novo no navegador (Web Push)

Cada pessoa liga o **sino do cabeçalho** no próprio navegador — computador ou
celular — e recebe uma notificação do sistema a cada **lead novo** (pela landing
page ou pela API do n8n) e a cada **lead perdido que voltou**, na hora, mesmo com o
painel fechado. Tocar no aviso abre a ficha do lead.

1. Gere o par de chaves **uma vez** (não troque depois: trocar obriga cada aparelho a
   ligar de novo):

   ```bash
   npx web-push generate-vapid-keys
   ```

2. No servidor (EasyPanel → Ambiente): `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` e
   `VAPID_SUBJECT` (`https://<endereço do painel>` ou `mailto:<e-mail da equipe>`).
   Implante. A tabela `push_inscricoes` (migração 0026) se cria sozinha no Postgres;
   no Supabase, rode `supabase/migrations/0026_push_inscricoes.sql`.
3. Cada pessoa clica no sino e aceita as notificações; chega um aviso de teste. No
   **iPhone/iPad** (iOS 16.4+) o push só existe com o painel na Tela de Início:
   Safari → Compartilhar → **Adicionar à Tela de Início**, abrir por lá e ligar o sino.

**Configurações → Integrações** mostra quantos aparelhos ligaram e como foi o último
envio. O aviso leva só o **primeiro nome**, a classe e de onde veio — nunca telefone
ou e-mail (aparece na tela bloqueada); o conteúdo vai cifrado de ponta a ponta. Com
login, só recebe quem ainda é usuário do painel; aparelho que desligou as
notificações no navegador sai da lista sozinho. O código: `src/lib/push/`,
`public/sw.js` e `src/components/layout/avisos-push.tsx`.

### Privacidade (LGPD)

- **Nome, e-mail e telefone são armazenados** na tabela `leads` (a pedido, para o
  time comercial) e também hasheados em SHA-256 para a CAPI. Como o dashboard passa
  a **exibir dados pessoais**, proteja o acesso ao painel (senha na Vercel ou o
  login do Supabase) — a tabela já fica atrás de RLS (só service role), mas o
  painel em si ainda é aberto.
- Rastreio não essencial exige **consentimento opt-in**. Com `requireConsent: true`
  nada dispara até a sua CMP chamar `window.dashConsent(true)`.

## Deploy (Vercel)

`next build` já passa. Observações de custo: o plano **Hobby** da Vercel é para uso
**não comercial** — para um dashboard de negócio use o **Pro**. O free do Supabase
**pausa** após 1 semana de inatividade. Como o store atual escreve em disco local,
em produção serverless troque-o pelo Supabase (Fase 2) para persistência real e
compartilhada.

## Design system

As cores dos gráficos usam a **paleta data-viz validada** (contraste e segurança
para daltonismo verificados com o validador do skill de dataviz), referenciadas por
CSS variables em `globals.css` — por isso trocam de tema claro/escuro
automaticamente.

---

Plano completo do projeto: `~/.claude/plans/quero-desenvolver-um-dashboard-scalable-boot.md`.
