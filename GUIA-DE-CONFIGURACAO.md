# Guia de configuração — passo a passo (EasyPanel / Hostinger)

Feito para quem **não é técnico**. Cada fase deixa o app melhor e ele funciona
mesmo com fases pendentes. Faça na ordem. Quando travar, diga "travei no passo X".

O que você já tem: **VPS na Hostinger**, conta **GitHub** e **Google**, e é **admin
dos anúncios** na Meta.

Regra de ouro: **as senhas e tokens você mesmo gera e cola.** Nunca compartilhe
esses valores em prints públicos.

---

## Fase 1 — Publicar o app no EasyPanel (com banco e login)

No fim: um **link** (seu domínio) que o time abre com **usuário e senha**, e os
dados ficam **salvos** no banco do seu servidor. **Você não precisa rodar SQL** — o
app cria as tabelas sozinho na primeira vez.

### Passo 1 — Ter o EasyPanel rodando no VPS
- Se ainda **não instalou** o EasyPanel: no painel da Hostinger, no seu VPS, use o
  template **EasyPanel** (instala em 1 clique). Depois acesse o EasyPanel pelo
  endereço do servidor e crie a conta de administrador do painel.
- Se já está instalado, é só abrir.

### Passo 2 — Colocar o código no GitHub
- Instale o **GitHub Desktop** (desktop.github.com) e entre com sua conta.
- **File → Add local repository** → aponte para `C:\Dev\dashboard mkt` → **Add**.
- **Publish repository** → deixe **privado** → publicar.

### Passo 3 — Criar o banco (Postgres) no EasyPanel
1. No EasyPanel, **Create Project** (ex.: `dashboard`).
2. Dentro do projeto, **+ Service → Postgres**. Dê um nome (ex.: `db`), defina uma
   **senha** e crie.
3. Abra o serviço do Postgres e copie a **Connection URL interna** (algo como
   `postgres://postgres:SUASENHA@dashboard_db:5432/postgres`). **Guarde** — será o
   `DATABASE_URL`. (Não precisa rodar SQL: o app cria as tabelas ao subir.)

### Passo 4 — Criar o serviço do app
1. No mesmo projeto, **+ Service → App**.
2. **Source → GitHub**: conecte sua conta e escolha o repositório que você publicou
   (branch `master`). O EasyPanel detecta o **Dockerfile** automaticamente.
3. Em **Environment**, adicione as variáveis (nome à esquerda, valor à direita):

   | Name | Value |
   |---|---|
   | `DATABASE_URL` | a Connection URL interna do Postgres |
   | `AUTH_SECRET` | a chave que o Claude te passou |
   | `CRON_SECRET` | gere outra chave aleatória (usaremos na Fase 2) |

4. Em **Domains**, aponte um domínio ou subdomínio (ex.: `painel.seusite.com.br`)
   para o IP do VPS e ative o **HTTPS**. O EasyPanel encaminha para a porta 3000
   sozinho (não precisa mexer em porta).
5. Clique em **Deploy** e aguarde o build (~2–4 min).

### Passo 5 — Primeiro acesso
1. Abra seu domínio → **"Criar primeiro acesso"** → crie seu usuário e senha (você
   vira **administrador**).
2. Em **Importar / Config → Usuários do painel**, adicione o time e escolha o papel:
   - **Administrador** — controla tudo, inclusive usuários.
   - **Marketing** — vê tudo e mexe nos dados de marketing; **não altera leads**.
   - **Comercial** — **altera leads** (status, contato); não mexe em configs.

✅ **Pronto:** app no ar, no seu servidor, com login e banco. Ainda mostra dados de
exemplo — nas próximas fases entram os dados reais. Pode limpar o exemplo em
**Config → Dados**.

> Para atualizar o app depois: publique as mudanças pelo GitHub Desktop e clique em
> **Deploy** de novo no serviço do EasyPanel.

---

## Fase 2 — Ligar o tráfego pago (Meta Ads) — *detalhamos quando chegar aqui*

Objetivo: gasto, leads e performance dos criativos entrando sozinhos.
Resumo: criar um **app** em developers.facebook.com, gerar um **token de System
User** (`ads_read`), pegar o **ID da conta de anúncios**, e adicionar no serviço do
app (EasyPanel → Environment): `META_AD_ACCOUNT_ID` e `META_ADS_ACCESS_TOKEN`.
Depois é só clicar em **Sincronizar agora** na tela de Config.

**Sincronização diária automática:** como não usamos Vercel, agendamos com um
serviço gratuito (ex.: **cron-job.org**) que "visita" uma vez por dia o endereço
`https://SEU-DOMINIO/api/sync?secret=SUA_CRON_SECRET`. Eu te ajudo a configurar.

## Fase 3 — Ligar o Instagram — *depois da Fase 2*

Converter a conta para **Profissional**, conectar pelo **Instagram Login**, pegar
`IG_USER_ID` e `IG_ACCESS_TOKEN` e adicionar no Environment do app.

## Fase 4 — Ligar a landing page — *por último*

Padronizar **UTMs** (tela UTMs do painel), criar **GA4** e a **Conversions API** na
Meta, definir `TRACK_INGEST_KEY`, e instalar o arquivo `public/lp-tracking.js` na
sua landing page.

---

### Como pedir ajuda
Diga em que passo está e o que apareceu na tela (pode mandar print). A gente
desatravanca junto.
