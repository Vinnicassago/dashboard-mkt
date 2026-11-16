/*
 * scripts/medir-texto.js — a régua de texto medida na TELA (T5 do plano de nov/26, seção 5)
 * ===========================================================================================
 *
 * QUEM USA: quem desenvolve o painel. Cole SÓ este arquivo, do repositório, no commit que está
 * no ar — nunca uma cópia que chegou por chat, e-mail ou link: o console de um painel com dados de
 * pessoas não é lugar de código de terceiros. Prefira `npm run dev` (dados de exemplo).
 *
 * COMO USAR
 *   1. Abra a página do painel (`npm run dev` ou produção) no período padrão dela, do jeito que
 *      ela abre: sem #âncora na URL, nenhum ⓘ aberto, recolhidos fechados. Anote a janela: a
 *      rolagem depende dela (referência do plano: o notebook, 1440 × 900).
 *   2. Copie este arquivo INTEIRO, cole no console do DevTools (F12 → Console) e dê Enter.
 *   3. Sai uma tabela, a lista das frases longas (recolhida) e a LINHA DA NOTA, pronta para a
 *      nota de entrega da fase. No localhost, os trechos ficam contornados na tela (vermelho =
 *      pior trecho e os > 25 palavras; âmbar tracejado = frase longa) e a página rola até o
 *      pior; fora dele, já a 1ª execução (a da colagem) não contorna nem rola. Depois de colado:
 *        medirTexto()                        mede de novo (ex.: depois de abrir um recolhido)
 *        medirTexto({ escopo: "tela" })      o <body> inteiro, com menu lateral e cabeçalho
 *        medirTexto({ texto: false })        nenhum começo de trecho no console (o padrão fora
 *                                            do localhost: em produção, só contagens)
 *        medirTexto({ marcar: false })       sem contorno e sem rolar até o pior trecho (o
 *                                            padrão fora do localhost; `true` contorna)
 *        medirTexto({ comparar: true })      também a conta dos testes sobre o HTML (validação)
 *        medirTexto.limpar()                 tira os contornos
 *
 * O QUE MEDE (as colunas da tabela da seção 5 do plano)
 *   - Rolagem (em telas): altura do que rola ÷ altura da janela; 1,0 = cabe sem rolar. O painel
 *     rola o DOCUMENTO (<main> sem overflow, cabeçalho sticky); se um dia rolar por dentro de
 *     <main>, o script mede esse contêiner e diz qual.
 *   - Palavras fora de tabela: as que se LEEM na área da página — <main> sem as abas de vista
 *     do layout (nav "Vistas de …"), o mesmo recorte dos testes de tela, que renderizam só a
 *     página. O menu lateral e o cabeçalho são iguais em toda tela e nenhuma fase os corta.
 *   - Frases longas: trechos com 7+ palavras (explicação, ressalva, instrução). Rótulo e número
 *     ficam abaixo de 7 e não entram. Palavras nelas e quantos trechos.
 *   - Pior trecho: o trecho com mais palavras, em qualquer elemento — MAIS ESTRITO que os testes.
 *     A régua "nenhuma frase > 25" dos testes (`blocos()` em src/test/tela.ts) só vê texto dentro
 *     de <p>, <li>, <h1>–<h6>, <summary>, <dt> e <dd>; por isso a tabela também mostra o pior
 *     trecho "em bloco" (o que o teste vê) e o "fora de bloco" (texto solto numa <div>, num
 *     botão, num chip), que o teste não vê. Maior frase: o maior pedaço entre . ! ? — se ela
 *     cabe em 25 e o trecho não, quebrar o bloco ou mandar parte para o ⓘ resolve.
 *
 * AS REGRAS (as de src/test/tela.ts, lidas na tela de verdade)
 *   - Palavra = pedaço separado por espaço com ao menos uma letra ou um algarismo: número conta;
 *     "·", "→", "—" e "≥" sozinhos, não.
 *   - NÃO contam: <table> (e role=table/grid); o que é aria-hidden; o miolo de <details>
 *     fechado (o <summary> conta); o ⓘ fechado (só tem o símbolo, aria-hidden; aberto, a caixa
 *     vai para o <body>, fora do recorte, e é ignorada também no escopo "tela"); atributos
 *     (title=, aria-label, alt, placeholder); campos (input, textarea — do <select>, só a opção
 *     que aparece); e o que o CSS esconde nesta largura (display:none, visibility, opacidade 0,
 *     o 1 px do sr-only). Esse último sai à parte, "ocultas por CSS": o teste, que lê o HTML,
 *     contaria. Também fora: o que o código marcou com `data-medir-texto-ignorar` — o texto
 *     DIGITADO por gente (notas e anotações do comercial, respostas do diagnóstico), que a
 *     régua não governa.
 *   - CONTA, à parte, "no gráfico": o texto que o gráfico desenha (<svg><text> do Recharts). É o
 *     que o teste do Início soma às palavras (as datas do eixo, `datasNoEixo`).
 *   - Trecho = o bloco do texto: o <p>, <li>, <h1>–<h6>, <summary>, <dt> ou <dd> mais interno
 *     (a régua de `blocos()`); fora deles, o ancestral mais próximo que não é inline (um botão,
 *     um chip, uma <div>). No gráfico, cada <text> é um trecho.
 *
 * LGPD (Leads, ficha e Fila mostram nome, telefone, e-mail e notas)
 *   - Fora do localhost (produção), o padrão é `texto: false` e `marcar: false`: o console leva
 *     SÓ contagens e a marca que o código pôs no elemento, e a página não rola até a pessoa.
 *   - No localhost, sai também o "começo" do pior trecho e das frases longas (6 palavras), com
 *     algarismo trocado por # e e-mail por •@•. NUNCA sai: na ficha (/leads/<id>); de linha com
 *     link de ficha, tel:, mailto: ou wa.me, em qualquer tela; e, nas telas de pessoas, de nada
 *     que não seja título (<h1>–<h6>), <summary>, botão ou bloco marcado pelo código
 *     (data-titulo, data-parte) — e nunca de item de lista ou de linha (li, tr, dd,
 *     role=row/listitem). Tela de pessoas é TODA rota fora da lista das que não mostram gente
 *     fora de tabela (Início, Funil, Mídia, Conteúdo, Metas, Marcas, Integrações, Atendimento):
 *     Leads, Fila, Usuários, Zona de perigo, Ferramentas e Importar — e qualquer rota nova. É
 *     uma lista do que PODE sair: a faixa "Nome: tentativa registrada" da Fila, numa <div>, fica
 *     de fora. No lugar, "(texto omitido)" — o contorno mostra o trecho na tela, para quem já o
 *     está vendo.
 *   - "onde" é só o que o CÓDIGO escreveu (data-parte, data-titulo, data-bloco, id sem
 *     algarismo), nunca texto da tela. A rota sai sem o id da ficha; da URL, só o ?range=.
 *   - Mesmo no localhost, confira antes de colar a saída fora daqui: o repositório é público.
 *
 * Sem dependência e sem build: ES2020, Chrome 105+ (checkVisibility; sem ele, uma aproximação).
 * Fora do navegador (src/lib/__tests__/medir-texto.test.ts) não toca no DOM: só expõe o núcleo
 * puro em `module.exports`.
 */
(function () {
  "use strict";

  // ---------------------------------------------------------------- a régua (pura)

  /** Trecho com essa quantidade de palavras ou mais é "frase longa" (plano, seção 5). */
  const FRASE_LONGA = 7;
  /** "Nenhuma frase com mais de 25 palavras" (CLAUDE.md, Texto na tela). */
  const LIMITE_DA_FRASE = 25;
  /** Quantas palavras do começo de um trecho saem no console. */
  const PALAVRAS_DO_COMECO = 6;

  /** As palavras de um texto: a régua de `palavras()` (src/test/tela.ts). */
  function palavrasDe(texto) {
    return String(texto)
      .split(/\s+/)
      .filter((p) => /[\p{L}\p{N}]/u.test(p));
  }

  /** As frases de um texto, cortado depois de . ! ? (a régua dos ⓘ nos testes de tela). */
  function frasesDe(texto) {
    return String(texto)
      .split(/(?<=[.!?])\s+/)
      .filter((f) => f.trim() !== "");
  }

  /** Algarismo vira #, e-mail vira •@• (telefone, data de nascimento, e-mail). */
  function mascarar(palavras) {
    return palavras.map((p) => (p.includes("@") ? "•@•" : p.replace(/\d/g, "#")));
  }

  /** O começo de um trecho, mascarado, com " …" quando há mais. */
  function comecoDe(palavras, n) {
    const k = n == null ? PALAVRAS_DO_COMECO : n;
    return mascarar(palavras.slice(0, k)).join(" ") + (palavras.length > k ? " …" : "");
  }

  /** A ficha de um lead: ali tudo é da pessoa. */
  function ehFicha(rota) {
    return /^\/leads\/[^/]+\/?$/.test(String(rota));
  }

  /**
   * As telas que NÃO mostram gente fora de tabela: Início, Funil, Mídia, Conteúdo (com as
   * subrotas) e, em Configurações, Metas, Marcas, Integrações e Atendimento.
   */
  const TELAS_SEM_PESSOAS = /^\/$|^\/(funil|midia|conteudo)(\/|$)|^\/configuracoes(\/(marcas|integracoes|atendimento))?\/?$/;

  /**
   * Tela de pessoas (só título sai no console): toda rota FORA da lista das que não mostram
   * gente — Leads, ficha, Fila, Usuários, Zona de perigo (a auditoria), Ferramentas (registros
   * em lote, colisões de id), Importar ("Lead "Fulano" adicionado") e qualquer rota nova. Uma
   * lista do que PODE, também para as rotas.
   */
  function ehTelaDePessoas(rota) {
    return !TELAS_SEM_PESSOAS.test(String(rota));
  }

  /** O padrão de `texto`: o começo dos trechos só sai no localhost (dados de exemplo). */
  function textoPadrao(hostname) {
    return /^(localhost|127\.0\.0\.1|\[::1\])$|\.localhost$/.test(String(hostname));
  }

  /**
   * As opções da 1ª medição (a da colagem) e de `medirTexto()` sem opções: no localhost, o
   * começo dos trechos e o contorno; fora dele, só contagens, sem contornar nem rolar a página.
   */
  function opcoesPadrao(hostname) {
    const local = textoPadrao(hostname);
    return { escopo: "pagina", texto: local, marcar: local, comparar: false };
  }

  /** Numa tela de pessoas, só o começo destes blocos pode sair (mais os marcados pelo código). */
  const TAGS_QUE_PODEM_SAIR = new Set(["h1", "h2", "h3", "h4", "h5", "h6", "summary", "button"]);

  /**
   * O começo deste trecho pode sair no console? (LGPD — ver o cabeçalho.) Pura: recebe os
   * fatos do bloco — `ficha`, `telaDePessoas`, `tag` (do bloco), `marcado` (data-titulo ou
   * data-parte), `emLinha` (dentro de li, tr, dd, role=row/listitem) e `comLinkDePessoa`.
   * Uma lista do que PODE sair, não do que bloqueia: o que ninguém previu fica de fora.
   */
  function podeImprimirComeco(f) {
    if (f.ficha || f.comLinkDePessoa) return false;
    if (!f.telaDePessoas) return true;
    if (f.emLinha) return false;
    return TAGS_QUE_PODEM_SAIR.has(String(f.tag)) || Boolean(f.marcado);
  }

  /** A rota sem o id da ficha. */
  function rotaParaImprimir(rota) {
    return String(rota).replace(/^\/leads\/[^/]+/, "/leads/:id");
  }

  /** "28,7" — uma casa, vírgula. */
  function formatarTelas(x) {
    return x.toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  }

  /**
   * O resumo dos trechos (na ordem da tela; cada um `{ palavras: string[], grafico?: boolean,
   * emBloco?: boolean }`): o total, o que é do gráfico, as frases longas, o pior trecho (o 1º,
   * no empate), o pior EM BLOCO (o que `blocos()` dos testes vê) e o pior FORA de bloco (texto
   * solto, que o teste não vê; o gráfico não entra em nenhum dos dois), a maior frase e quantos
   * passam do limite.
   */
  function resumir(trechos) {
    let total = 0;
    let noGrafico = 0;
    let emLongas = 0;
    let maiorFrase = 0;
    let trechosAcima = 0;
    let frasesAcima = 0;
    let piorEmBloco = 0;
    let piorForaDeBloco = 0;
    let pior = null;
    const longas = [];
    for (const t of trechos) {
      const n = t.palavras.length;
      total += n;
      if (t.grafico) noGrafico += n;
      else if (t.emBloco) piorEmBloco = Math.max(piorEmBloco, n);
      else piorForaDeBloco = Math.max(piorForaDeBloco, n);
      if (n >= FRASE_LONGA) {
        emLongas += n;
        longas.push(t);
      }
      if (n > LIMITE_DA_FRASE) trechosAcima += 1;
      if (n > 0 && (!pior || n > pior.palavras.length)) pior = t;
      for (const f of frasesDe(t.palavras.join(" "))) {
        const k = palavrasDe(f).length;
        if (k > maiorFrase) maiorFrase = k;
        if (k > LIMITE_DA_FRASE) frasesAcima += 1;
      }
    }
    return { total, noGrafico, emLongas, longas, pior, piorEmBloco, piorForaDeBloco, maiorFrase, trechosAcima, frasesAcima };
  }

  // ---------------------------------------------------------------- a régua do HTML (= os testes)

  const VAZIOS = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "track", "wbr"]);
  const TAGS_DE_BLOCO = new Set(["p", "li", "h1", "h2", "h3", "h4", "h5", "h6", "summary", "dt", "dd"]);

  function decodificar(texto) {
    return texto
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#x27;|&#39;/g, "'");
  }

  /**
   * `palavras()` e `blocos()` de src/test/tela.ts, transcritas numa passada só (o teste do
   * script confere que dão o mesmo resultado): a conta dos testes sobre um HTML — aqui, o da
   * tela, para comparar com a conta da tela (`comparar: true`).
   */
  function reguaDoHtml(html) {
    const pilha = [];
    const palavras = [];
    const blocos = [];
    const re = /<(\/?)([a-zA-Z][a-zA-Z0-9]*)([^>]*?)(\/?)>|([^<]+)/g;
    for (let m = re.exec(html); m; m = re.exec(html)) {
      const fecha = m[1];
      const attrs = m[3];
      const autoFecha = m[4];
      const texto = m[5];
      const topo = pilha.length ? pilha[pilha.length - 1] : null;
      if (texto !== undefined) {
        if (topo && topo.oculto) continue;
        const ps = palavrasDe(decodificar(texto));
        palavras.push(...ps);
        if (topo && topo.bloco !== null) blocos[topo.bloco].push(...ps);
        continue;
      }
      const tag = m[2].toLowerCase();
      if (fecha) {
        while (pilha.length && pilha.pop().tag !== tag) {
          /* desempilha até a tag */
        }
        continue;
      }
      if (autoFecha || VAZIOS.has(tag)) continue;
      const dentroDeDetalheFechado = Boolean(topo && topo.detalhesFechado) && tag !== "summary";
      const oculto =
        Boolean(topo && topo.oculto) || dentroDeDetalheFechado || tag === "table" || tag === "svg" || /aria-hidden="true"/.test(attrs);
      let bloco = topo ? topo.bloco : null;
      if (!oculto && TAGS_DE_BLOCO.has(tag)) {
        bloco = blocos.length;
        blocos.push([]);
      }
      pilha.push({ tag, oculto, detalhesFechado: tag === "details" && !/\sopen(=|\s|$)/.test(attrs), bloco });
    }
    return { palavras, blocos };
  }

  const nucleo = {
    FRASE_LONGA,
    LIMITE_DA_FRASE,
    palavrasDe,
    frasesDe,
    mascarar,
    comecoDe,
    ehFicha,
    ehTelaDePessoas,
    textoPadrao,
    opcoesPadrao,
    podeImprimirComeco,
    rotaParaImprimir,
    formatarTelas,
    resumir,
    reguaDoHtml,
  };

  // Fora do navegador (o teste): só o núcleo, nada de DOM.
  if (typeof window === "undefined" || typeof document === "undefined") {
    if (typeof module === "object" && module && module.exports) module.exports = nucleo;
    return undefined;
  }

  // ---------------------------------------------------------------- a tela (DOM)

  /** O bloco de um texto, como em `blocos()`: o seletor sai do MESMO conjunto da régua do HTML. */
  const BLOCO = Array.from(TAGS_DE_BLOCO).join(", ");
  /** Elementos que não contam, com tudo o que está dentro. */
  const FORA = new Set(["table", "script", "style", "template", "noscript", "textarea", "input", "option", "optgroup", "datalist", "iframe", "canvas", "video", "audio"]);
  /** Também fora: tabela por ARIA, o ⓘ aberto e o que alguém marcar para ignorar. */
  const IGNORAR = '[role="table"], [role="grid"], [role="tooltip"], [data-medir-texto-ignorar]';
  /** As abas de vista do layout (SubNav): fora do recorte da página. */
  const ABAS_DE_VISTA = 'nav[aria-label^="Vistas de"]';
  /** Uma linha com isto é de uma pessoa. */
  const LINK_DE_PESSOA = 'a[href*="/leads/"], a[href^="tel:"], a[href^="mailto:"], a[href*="wa.me/"]';
  const LINHA = 'li, tr, dd, [role="row"], [role="listitem"]';
  const ATRIBUTO = "data-medir-texto";

  /** Os trechos visíveis de `raiz`, na ordem da tela, e as palavras que o CSS esconde. */
  function coletar(raiz, ignorar) {
    const trechos = [];
    const porBloco = new Map();
    const cache = new Map();
    let ocultas = 0;

    const visivel = (el) => {
      if (!el) return false;
      if (cache.has(el)) return cache.get(el);
      const cs = getComputedStyle(el);
      let v;
      if (cs.display === "contents") {
        // Sem caixa própria: vale a do pai (e a visibilidade, que herda).
        v = cs.visibility === "visible" && visivel(el.parentElement);
      } else {
        v =
          typeof el.checkVisibility === "function"
            ? el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })
            : el.getClientRects().length > 0 && cs.visibility === "visible" && Number(cs.opacity) > 0;
        if (v) {
          const r = el.getBoundingClientRect();
          // sr-only (1 × 1 px recortado), caixa sem altura ou largura, ou fora da página
          // (como a régua de medida do Recharts, a -20000 px).
          if (r.width <= 1 || r.height <= 1) v = false;
          else if (r.bottom + window.scrollY <= 0 || r.right + window.scrollX <= 0) v = false;
        }
      }
      cache.set(el, v);
      return v;
    };

    const blocoDe = (el) => {
      if (el.closest("svg")) return { el: el.closest("text") || el, grafico: true, emBloco: false };
      const b = el.closest(BLOCO);
      if (b && raiz.contains(b)) return { el: b, grafico: false, emBloco: true };
      for (let e = el; e && e !== raiz; e = e.parentElement) {
        const d = getComputedStyle(e).display;
        if (d !== "inline" && d !== "contents") return { el: e, grafico: false, emBloco: false };
      }
      return { el: raiz, grafico: false, emBloco: false };
    };

    const anotar = (el, ps) => {
      const b = blocoDe(el);
      let t = porBloco.get(b.el);
      if (!t) {
        t = { el: b.el, grafico: b.grafico, emBloco: b.emBloco, palavras: [] };
        porBloco.set(b.el, t);
        trechos.push(t);
      }
      t.palavras.push(...ps);
    };

    const visitar = (no) => {
      for (const filho of no.childNodes) {
        if (filho.nodeType === Node.TEXT_NODE) {
          const ps = palavrasDe(filho.data);
          if (!ps.length) continue;
          const el = filho.parentElement;
          if (!visivel(el)) {
            // O teste (HTML) contaria; o <svg> ele não lê, então não entra na diferença.
            if (!el || !el.closest("svg")) ocultas += ps.length;
            continue;
          }
          anotar(el, ps);
          continue;
        }
        if (filho.nodeType !== Node.ELEMENT_NODE) continue;
        const tag = filho.localName;
        if (filho.getAttribute("aria-hidden") === "true" || filho.matches(ignorar)) continue;
        if (tag === "select") {
          // Do <select> só se lê a opção que aparece.
          const op = filho.selectedOptions && filho.selectedOptions[0];
          const ps = op && visivel(filho) ? palavrasDe(op.text) : [];
          if (ps.length) trechos.push({ el: filho, grafico: false, emBloco: false, palavras: ps });
          continue;
        }
        if (FORA.has(tag)) continue;
        if (tag === "details" && !filho.open) {
          const resumo = Array.prototype.find.call(filho.children, (c) => c.localName === "summary");
          if (resumo) visitar(resumo);
          continue;
        }
        visitar(filho);
      }
    };

    visitar(raiz);
    return { trechos, ocultas };
  }

  /** Quanto a tela rola, em telas, e o quê rola. */
  function rolagem(raiz) {
    const janela = window.innerHeight;
    const doc = document.scrollingElement || document.documentElement;
    if (doc.scrollHeight > janela + 1) return { telas: doc.scrollHeight / janela, em: "documento" };
    for (let e = raiz; e && e !== document.body && e !== document.documentElement; e = e.parentElement) {
      const oy = getComputedStyle(e).overflowY;
      if ((oy === "auto" || oy === "scroll") && e.scrollHeight > e.clientHeight + 1) {
        return { telas: e.scrollHeight / janela, em: e.localName + (e.id ? "#" + e.id : "") };
      }
    }
    return { telas: Math.max(1, doc.scrollHeight / janela), em: "documento" };
  }

  /** A marca que o código pôs num elemento (nunca o texto da tela). */
  function marcaDe(e) {
    for (const a of ["data-parte", "data-bloco"]) {
      const v = e.getAttribute(a);
      if (v && /^[a-z][a-z-]{0,30}$/i.test(v)) return `${e.localName}[${a}=${v}]`;
    }
    if (e.hasAttribute("data-titulo")) return `${e.localName}[data-titulo]`;
    if (e.id && /^[a-z][a-z-]{0,30}$/i.test(e.id)) return `${e.localName}#${e.id}`;
    return null;
  }

  /** Onde o trecho está: até duas marcas dos ancestrais e a do próprio (ou a tag). */
  function ondeDe(el) {
    const marcas = [];
    for (let e = el.parentElement; e && e !== document.body && e.localName !== "main" && marcas.length < 2; e = e.parentElement) {
      const m = marcaDe(e);
      if (m) marcas.unshift(m);
    }
    marcas.push(marcaDe(el) || el.localName);
    return marcas.join(" › ");
  }

  /** Os fatos do bloco para `podeImprimirComeco` (a regra pura, no núcleo). */
  function podeImprimir(el, rota) {
    const linha = el.closest(LINHA);
    return podeImprimirComeco({
      ficha: ehFicha(rota),
      telaDePessoas: ehTelaDePessoas(rota),
      tag: el.localName,
      marcado: el.hasAttribute("data-titulo") || el.hasAttribute("data-parte"),
      emLinha: Boolean(linha),
      comLinkDePessoa: Boolean(
        el.closest(LINK_DE_PESSOA) || el.querySelector(LINK_DE_PESSOA) || (linha && linha.querySelector(LINK_DE_PESSOA)),
      ),
    });
  }

  function nomeDaTela(rota) {
    if (ehFicha(rota)) return "Ficha";
    const h1 = document.querySelector("header h1");
    const nome = h1 ? h1.textContent.trim() : "Tela";
    const vista = document.querySelector(`${ABAS_DE_VISTA} [aria-current="page"]`);
    return vista ? `${nome} › ${vista.textContent.trim()}` : nome;
  }

  function contornar(el, estilo) {
    if (!el.hasAttribute(ATRIBUTO)) el.setAttribute(ATRIBUTO, el.style.outline || "-");
    el.style.outline = estilo;
    el.style.outlineOffset = "2px";
  }

  function limpar() {
    for (const el of document.querySelectorAll(`[${ATRIBUTO}]`)) {
      const antes = el.getAttribute(ATRIBUTO);
      el.style.outline = antes === "-" ? "" : antes;
      el.style.outlineOffset = "";
      el.removeAttribute(ATRIBUTO);
    }
  }

  function medirTexto(opcoes) {
    const o = Object.assign(opcoesPadrao(location.hostname), opcoes || {});
    limpar();
    // Aba em segundo plano (ou o painel de preview oculto): sem janela não há layout, e tudo
    // sairia "oculto por CSS" com rolagem infinita.
    if (!window.innerHeight || !window.innerWidth) {
      console.warn("A janela está sem tamanho (aba em segundo plano ou painel oculto): traga a aba para a frente e meça de novo.");
      return { erro: "janela sem tamanho" };
    }
    const rota = location.pathname;
    const avisos = [];
    let raiz = o.escopo === "tela" ? document.body : document.querySelector("main");
    if (!raiz) {
      raiz = document.body;
      avisos.push("Sem <main>: medi o <body> inteiro.");
    }
    const ignorar = o.escopo === "tela" ? IGNORAR : `${IGNORAR}, ${ABAS_DE_VISTA}`;
    const semTexto = !o.texto || ehFicha(rota);

    const { trechos, ocultas } = coletar(raiz, ignorar);
    const r = resumir(trechos);
    const rol = rolagem(raiz);
    const comecoDoTrecho = (t) => (semTexto || !podeImprimir(t.el, rota) ? "(texto omitido)" : comecoDe(t.palavras));
    const pior = r.pior ? { palavras: r.pior.palavras.length, onde: ondeDe(r.pior.el), comeco: comecoDoTrecho(r.pior) } : null;

    let html = null;
    if (o.comparar) {
      const copia = raiz.cloneNode(true);
      if (o.escopo !== "tela") for (const n of copia.querySelectorAll(ABAS_DE_VISTA)) n.remove();
      // O texto digitado (marcado pelo código) fica fora dos dois lados, como os testes de tela o tiram.
      for (const n of copia.querySelectorAll("[data-medir-texto-ignorar]")) n.remove();
      const h = reguaDoHtml(copia.outerHTML);
      const esperado = r.total - r.noGrafico + ocultas;
      const piorBloco = Math.max(0, ...h.blocos.map((b) => b.length));
      html = {
        palavras: h.palavras.length,
        piorBloco,
        naTela: esperado,
        confere: h.palavras.length === esperado,
        confereBloco: piorBloco === r.piorEmBloco,
      };
    }

    const abertos = raiz.querySelectorAll("details[open]").length;
    if (abertos) avisos.push(`${abertos === 1 ? "1 recolhido aberto" : `${abertos} recolhidos abertos`}: o miolo entrou na conta. A medição padrão é como a página abre.`);
    if (document.querySelector('[role="tooltip"]')) avisos.push("Um ⓘ está aberto: ele não conta, mas feche-o (Esc) para a medição padrão.");
    if (raiz.querySelector('.animate-pulse, [aria-busy="true"]')) avisos.push("A página ainda está carregando: meça de novo quando terminar.");
    if (location.hash) avisos.push("A URL tem #âncora: a página pode ter aberto um recolhido sozinha.");
    if (ehFicha(rota) && o.texto) avisos.push("Ficha: nenhum texto sai no console (LGPD); o contorno mostra onde está.");
    if (!o.texto && !(opcoes && "texto" in opcoes)) avisos.push("Fora do localhost: só contagens no console, sem contorno (o padrão em produção).");

    const tela = nomeDaTela(rota);
    const periodo = new URLSearchParams(location.search).get("range") || "padrão da página";
    const marca = document.documentElement.getAttribute("data-brand") || "—";
    const janela = `${window.innerWidth} × ${window.innerHeight}`;
    const quando = new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" });
    const telas = formatarTelas(rol.telas);
    const nota =
      `${tela} · ${telas} telas · ${r.total} palavras fora de tabela · ` +
      `${r.emLongas} em ${r.longas.length} frases longas · pior trecho: ${pior ? pior.palavras : 0} palavras` +
      (pior && pior.comeco !== "(texto omitido)" ? ` ("${pior.comeco}")` : "");

    const tabela = {
      "Rolagem (telas)": telas + (rol.em === "documento" ? "" : ` (rola em ${rol.em})`),
      "Palavras fora de tabela": r.total,
      "· delas, no gráfico": r.noGrafico,
      "Ocultas por CSS (fora da conta)": ocultas,
      "Em frases longas (7+)": `${r.emLongas} em ${r.longas.length} trechos`,
      "Pior trecho": pior ? `${pior.palavras} palavras · ${pior.onde} · ${pior.comeco}` : "—",
      "· pior em bloco (o que o teste vê)": r.piorEmBloco,
      "· pior fora de bloco (o teste não vê)": r.piorForaDeBloco,
      "Maior frase (entre . ! ?)": r.maiorFrase,
      [`Trechos > ${LIMITE_DA_FRASE} palavras`]: r.trechosAcima,
      [`Frases > ${LIMITE_DA_FRASE} palavras`]: r.frasesAcima,
    };
    if (html) {
      tabela["HTML, régua dos testes (palavras · pior bloco)"] = `${html.palavras} · ${html.piorBloco}`;
      tabela["Confere (tela − gráfico + ocultas = HTML)"] = html.confere ? "sim" : `não: ${html.naTela} × ${html.palavras}`;
      tabela["Confere o pior bloco (tela = HTML)"] = html.confereBloco ? "sim" : `não: ${r.piorEmBloco} × ${html.piorBloco}`;
    }

    console.log(`%cMedição de texto — ${tela}`, "font-weight:bold", `\n${rotaParaImprimir(rota)} · período ${periodo} · marca ${marca} · janela ${janela} · ${quando} · escopo ${o.escopo}`);
    console.table(tabela);
    if (r.longas.length) {
      console.groupCollapsed(`Frases longas (${r.longas.length})`);
      console.table(r.longas.map((t) => ({ palavras: t.palavras.length, onde: ondeDe(t.el), começo: comecoDoTrecho(t) })));
      console.groupEnd();
    }
    if (avisos.length) console.warn(avisos.join("\n"));
    console.log(`Linha da nota:\n${nota}`);

    if (o.marcar) {
      for (const t of r.longas) contornar(t.el, t.palavras.length > LIMITE_DA_FRASE ? "2px solid #d93025" : "2px dashed #e8a200");
      if (r.pior) {
        contornar(r.pior.el, "3px solid #d93025");
        r.pior.el.scrollIntoView({ block: "center" });
      }
    }

    return {
      tela,
      rota: rotaParaImprimir(rota),
      periodo,
      marca,
      janela,
      escopo: o.escopo,
      rolagem: Number(rol.telas.toFixed(1)),
      rolaEm: rol.em,
      palavras: r.total,
      noGrafico: r.noGrafico,
      ocultasPorCss: ocultas,
      frasesLongas: { palavras: r.emLongas, trechos: r.longas.length },
      piorTrecho: pior,
      piorEmBloco: r.piorEmBloco,
      piorForaDeBloco: r.piorForaDeBloco,
      maiorFrase: r.maiorFrase,
      trechosAcimaDoLimite: r.trechosAcima,
      frasesAcimaDoLimite: r.frasesAcima,
      html,
      avisos,
      nota,
    };
  }

  medirTexto.limpar = limpar;
  medirTexto.nucleo = nucleo;
  window.medirTexto = medirTexto;
  return medirTexto();
})();
