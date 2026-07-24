# Guia de configuração — passo a passo

Feito para quem **não é técnico**. Cada fase deixa o app melhor e ele funciona
mesmo com fases pendentes. Faça na ordem. Quando travar em algum passo, é só
dizer "travei no passo X" que a gente resolve.

O que você já tem: conta **Google** e **GitHub**, e é **admin dos anúncios** na Meta.

Regra de ouro: **as senhas e tokens você mesmo gera e cola.** Nunca compartilhe
esses valores em prints públicos.

---

## Fase 1 — Publicar o app (banco + login)

No fim desta fase: um **link** que o time abre com **usuário e senha**, e os dados
ficam **salvos de verdade**. Você vai coletar 3 valores pelo caminho e colar todos
na Vercel no final.

### Passo 1 — Criar o banco de dados (Supabase)

1. Acesse **supabase.com** → **Start your project** → entre com o **GitHub**.
2. **New project**. Dê um nome (ex.: `dashboard-consorcio`), crie uma senha de banco
   (pode ser qualquer uma forte — **guarde**), escolha a região **South America (São
   Paulo)** e clique em **Create new project**. Espere ~2 minutos.
3. No menu à esquerda, abra o **SQL Editor** → **New query**.
4. Abra o arquivo **`supabase/setup.sql`** deste projeto, **copie todo o conteúdo**,
   cole no editor e clique em **Run**. Deve aparecer "Success".
5. Menu **Project Settings** (engrenagem) → **API**. Copie e guarde dois valores:
   - **Project URL** → vai virar `SUPABASE_URL`
   - **service_role** (na seção "Project API keys", clique em *Reveal*) → vai virar
     `SUPABASE_SERVICE_ROLE_KEY`. **Esse é secreto**, não mostre a ninguém.

### Passo 2 — Sua chave de login (AUTH_SECRET)

Use a chave que o Claude te passou no chat (um texto longo de letras e números).
Ela protege as sessões de login. Guarde para colar na Vercel. (Se preferir gerar
outra, é só pedir.)

### Passo 3 — Colocar o código no GitHub

O jeito mais simples sem terminal é pelo **GitHub Desktop**:

1. Baixe em **desktop.github.com**, instale e entre com sua conta do GitHub.
2. **File → Add local repository** → escolha a pasta do projeto
   (`C:\Dev\dashboard mkt`) → **Add repository**.
3. Clique em **Publish repository**. **Deixe marcado "Keep this code private"** e
   publique.

> Alternativa: se preferir, me avise que eu te passo os comandos para publicar pelo
> terminal.

### Passo 4 — Publicar na Vercel

1. Acesse **vercel.com** → **Sign Up** → entre com o **GitHub**.
2. **Add New… → Project** → **Import** no repositório que você acabou de publicar.
3. Antes de clicar em Deploy, abra **Environment Variables** e adicione estas 3
   (nome exato à esquerda, valor à direita):

   | Name | Value |
   |---|---|
   | `SUPABASE_URL` | o Project URL do Supabase |
   | `SUPABASE_SERVICE_ROLE_KEY` | a chave service_role do Supabase |
   | `AUTH_SECRET` | a chave que o Claude te passou |

4. Clique em **Deploy** e espere ~2 minutos. No fim, você recebe um **link**
   (ex.: `https://seu-projeto.vercel.app`).

### Passo 5 — Primeiro acesso

1. Abra o link. Vai aparecer **"Criar primeiro acesso"** → crie o **seu** usuário e
   senha (você vira **administrador**).
2. Vá em **Importar / Config → Usuários do painel** e adicione o time, escolhendo o
   papel de cada um:
   - **Administrador** — controla tudo, inclusive usuários.
   - **Marketing** — vê tudo e mexe nos dados de marketing; **não altera leads**.
   - **Comercial** — **altera leads** (status, contato); não mexe em configs.

✅ **Pronto:** app no ar, com login e banco. Ainda mostra dados de exemplo — nas
próximas fases entram os dados reais. Pode restaurar/limpar o exemplo em
**Config → Dados**.

---

## Fase 2 — Ligar o tráfego pago (Meta Ads) — *detalhamos quando você chegar aqui*

Objetivo: gasto, leads e performance dos criativos entrando sozinhos.
Resumo: criar um **app** em developers.facebook.com, gerar um **token de System
User** com permissão `ads_read`, pegar o **ID da conta de anúncios**, e adicionar
na Vercel `META_AD_ACCOUNT_ID`, `META_ADS_ACCESS_TOKEN` e `CRON_SECRET`. Depois é só
clicar em **Sincronizar agora** na tela de Config.

## Fase 3 — Ligar o Instagram — *depois da Fase 2*

Objetivo: seguidores, alcance e posts reais.
Resumo: converter a conta para **Profissional**, conectar pelo **Instagram Login**,
pegar `IG_USER_ID` e `IG_ACCESS_TOKEN` e adicionar na Vercel.

## Fase 4 — Ligar a landing page — *por último*

Objetivo: funil completo do anúncio até a reunião.
Resumo: padronizar **UTMs** (tela UTMs do painel), criar **GA4** e a **Conversions
API** na Meta, definir `TRACK_INGEST_KEY`, e instalar o arquivo
`public/lp-tracking.js` na sua landing page.

---

### Como pedir ajuda
Diga em que passo está e o que apareceu na tela (pode mandar print). A gente
desatravanca junto.
