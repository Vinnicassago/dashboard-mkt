# Dashboard de Campanha — Consórcio

Central de análise da campanha de tráfego pago do Instagram do head de consórcio.
Reúne, numa só ferramenta que todo o time acompanha: **orgânico do Instagram**,
**tráfego pago**, **comparação de criativos** e o **funil de leads até a reunião**.

North Star: **Custo por Reunião Agendada (CPR)**.
Funil: `Impressões → Cliques → Leads → Reuniões`.

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
**Importar / Config**.

Build de produção:

```bash
npm run build && npm start
```

## Estrutura

```
src/
  app/
    (dashboard)/            # grupo de rotas com o layout (sidebar + header)
      page.tsx              # Visão Geral (executiva)
      trafego/              # Tráfego Pago
      criativos/            # Comparação de criativos
      instagram/            # Orgânico do Instagram
      posts/                # Desempenho por post
      funil/                # Funil & Landing Page
      config/               # Importar CSV, entrada manual, metas
        actions.ts          # server actions (import, entradas manuais, reset)
    layout.tsx              # root: tema claro/escuro, fontes, metadados
    globals.css             # design tokens (paleta validada) + tema
  components/
    charts/                 # Recharts wrappers (linha/área, barras, funil)
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

Em **Importar / Config**, envie o CSV exportado do Gerenciador de Anúncios. As
linhas são mescladas por `data + anúncio` (reimportar atualiza). O parser
reconhece cabeçalhos em PT ou EN. Baixe o **modelo** na própria tela para ver o
formato exato. Colunas usadas:

`Dia, Nome do anúncio, ID do anúncio, Nome do conjunto de anúncios, Nome da campanha, Valor gasto, Impressões, Alcance, Cliques no link, Leads`

### Entrada manual

Na mesma tela: snapshot diário do Instagram (o histórico de seguidores se constrói
guardando esses snapshots — a API da Meta só retém ~90 dias), cadastro de leads /
reuniões, e edição das metas.

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

Na tela **Funil & LP**, mude o status do lead para *Agendou*. Isso dispara `Schedule`
para a CAPI e `schedule` para o GA4, usando os identificadores (`fbc`/`fbp`) que
guardamos no lead. O `event_id` é estável (`schedule-<leadId>`), então remarcar o
mesmo lead não conta duas reuniões.

### Aba Leads

A tela **Leads** lista todos os contatos da campanha (nome, telefone, e-mail),
com busca, filtro por status, status editável, link de WhatsApp/e-mail e
**exportação em CSV** para o time comercial.

Logo abaixo há o **Histórico de alterações** (log de auditoria): cada criação e
cada mudança de status registra **quem** fez, **de/para** qual status e **quando**.
O ator é o usuário logado (ou "Landing page" quando o lead entra pelo formulário).
Migration no Supabase: `supabase/migrations/0006_lead_events.sql`.

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
