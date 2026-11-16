/**
 * T5 (plano de nov/26, seção 5) — `scripts/medir-texto.js`, o script de COLAR no console.
 *
 * O projeto não tem jsdom nem happy-dom (e não ganha dependência por isto); um DOM falso
 * também não calcularia layout (rolagem, `checkVisibility`, o que o CSS esconde). A parte
 * de DOM se confere no navegador, com `medirTexto({ comparar: true })` (o cabeçalho do
 * script). Aqui, o que dá para travar sem navegador:
 *   • é um script de colar: compila como script clássico, sem import/export/require, sem
 *     sintaxe depois do ES2020;
 *   • fora do navegador não toca no DOM e expõe o núcleo puro em `module.exports`;
 *   • o núcleo é a MESMA régua de `src/test/tela.ts` (palavra, `palavras()`, `blocos()`):
 *     se um lado mudar, o outro quebra aqui;
 *   • frase longa a partir de 7, o pior trecho, os > 25; e a LGPD do que sai no console.
 *
 * Os dados são de mentira (repositório público).
 */
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { describe, expect, it } from "vitest";
import { blocos, palavras } from "@/test/tela";

const ARQUIVO = path.resolve(__dirname, "../../../scripts/medir-texto.js");
const FONTE = fs.readFileSync(ARQUIVO, "utf8");

interface Trecho {
  palavras: string[];
  grafico?: boolean;
  emBloco?: boolean;
}
interface FatosDoBloco {
  ficha: boolean;
  telaDePessoas: boolean;
  tag: string;
  marcado: boolean;
  emLinha: boolean;
  comLinkDePessoa: boolean;
}
interface Nucleo {
  FRASE_LONGA: number;
  LIMITE_DA_FRASE: number;
  palavrasDe(t: string): string[];
  frasesDe(t: string): string[];
  mascarar(p: string[]): string[];
  comecoDe(p: string[], n?: number): string;
  ehFicha(rota: string): boolean;
  ehTelaDePessoas(rota: string): boolean;
  textoPadrao(hostname: string): boolean;
  opcoesPadrao(hostname: string): { escopo: string; texto: boolean; marcar: boolean; comparar: boolean };
  podeImprimirComeco(f: FatosDoBloco): boolean;
  rotaParaImprimir(rota: string): string;
  formatarTelas(x: number): string;
  resumir(t: Trecho[]): {
    total: number;
    noGrafico: number;
    emLongas: number;
    longas: Trecho[];
    pior: Trecho | null;
    piorEmBloco: number;
    piorForaDeBloco: number;
    maiorFrase: number;
    trechosAcima: number;
    frasesAcima: number;
  };
  reguaDoHtml(html: string): { palavras: string[]; blocos: string[][] };
}

/** Roda o arquivo como o console rodaria, num contexto sem DOM. */
function carregar(contexto: Record<string, unknown> = { module: { exports: {} } }): Nucleo {
  new vm.Script(FONTE, { filename: "medir-texto.js" }).runInNewContext(contexto);
  return (contexto.module as { exports: Nucleo }).exports;
}

/** Atravessa o contexto do vm (arrays de outro realm) para o do teste. */
const json = <T>(x: T): T => JSON.parse(JSON.stringify(x));
const escapar = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const n = (k: number, palavra = "palavra") => Array.from({ length: k }, () => palavra);

describe("scripts/medir-texto.js — um script de colar", () => {
  it("compila como script clássico: sem import, export nem require", () => {
    expect(() => new vm.Script(FONTE, { filename: "medir-texto.js" })).not.toThrow();
    expect(FONTE).not.toMatch(/^\s*(import|export)\s/m);
    expect(FONTE).not.toMatch(/\brequire\(/);
  });

  it("nada depois do ES2020 (o Chrome de qualquer notebook roda)", () => {
    for (const re of [/\?\?=/, /\|\|=/, /&&=/, /\.at\(/, /\.replaceAll\(/, /Object\.hasOwn\(/, /structuredClone\(/]) {
      expect(FONTE, String(re)).not.toMatch(re);
    }
  });

  it("fora do navegador não toca no DOM: expõe o núcleo e, sem `module`, não faz nada", () => {
    const nucleo = carregar();
    expect(typeof nucleo.resumir).toBe("function");
    expect(typeof nucleo.reguaDoHtml).toBe("function");
    expect(nucleo.FRASE_LONGA).toBe(7);
    expect(nucleo.LIMITE_DA_FRASE).toBe(25);
    expect(() => new vm.Script(FONTE).runInNewContext({})).not.toThrow();
  });

  it("o cabeçalho diz quem usa, como usar e o que não sai no console", () => {
    const cabecalho = FONTE.slice(0, FONTE.indexOf("(function"));
    for (const s of ["QUEM USA", "COMO USAR", "O QUE MEDE", "AS REGRAS", "LGPD", "src/test/tela.ts", "data-medir-texto-ignorar"]) {
      expect(cabecalho, s).toContain(s);
    }
    // Não ensina a desligar a proteção do Chrome contra colagem de código — nem com outras palavras.
    expect(cabecalho).not.toContain("allow pasting");
    expect(cabecalho).not.toMatch(/\blibere\b|\bliberar\b|desbloque|bloquear a colagem/i);
  });

  it("o texto marcado com data-medir-texto-ignorar sai da tela E da cópia do HTML (`comparar`)", () => {
    expect(FONTE).toContain("[data-medir-texto-ignorar]'");
    expect(FONTE).toContain('copia.querySelectorAll("[data-medir-texto-ignorar]")');
  });
});

describe("a régua é a de src/test/tela.ts", () => {
  const nucleo = carregar();

  it("palavra: um pedaço com letra ou algarismo (número conta; ·, →, —, ≥ sozinhos não)", () => {
    for (const t of [
      "Resgate · 5 · 2 fora do prazo",
      "5 no resgate há mais de 24 h → Fila",
      "R$ 1.200 — ≥ 3 leads",
      "1º contato e-mail (12)",
      "  ",
      "— · → ≥ ≤",
      "Leads (n = 1) ainda sem reunião",
    ]) {
      expect(json(nucleo.palavrasDe(t)), t).toEqual(palavras(`<i>${escapar(t)}</i>`));
    }
  });

  it("o HTML: tabela, svg, aria-hidden e o miolo do <details> fechado não contam; o bloco mais interno", () => {
    const casos = [
      "<main><h3 data-titulo>Resgate · 5 <button aria-label=\"Sobre o resgate\"><span aria-hidden=\"true\">ⓘ</span></button></h3>" +
        "<p>Uma descrição embaixo do título, que sai na T3.</p></main>",
      "<div><table><tr><td>Pessoa Exemplo</td><td>00 90000-0000</td></tr></table><p>fora da tabela</p></div>",
      '<details data-parte="recolhido"><summary>Semana a semana</summary><p>o miolo não conta</p></details>' +
        "<details open=\"\"><summary>Aberto</summary><p>este conta</p></details>",
      '<svg viewBox="0 0 10 10"><text>16/11</text></svg><p>depois do gráfico</p>',
      "<ul><li>item com <p>parágrafo dentro</p> e resto</li><li>outro &amp; mais&nbsp;um</li></ul>",
      "<div>texto solto <span>sem bloco</span><br>nenhum</div><dl><dt>Origem</dt><dd>Carrossel imóvel</dd></dl>",
      "<p>com <!-- --> comentário do React e <img alt=\"não conta\"> imagem</p>",
    ];
    for (const html of casos) {
      expect(json(nucleo.reguaDoHtml(html)), html).toEqual({ palavras: palavras(html), blocos: blocos(html) });
    }
  });

  it("as constantes são as de tela.ts (lidas da FONTE dos dois), e o seletor do DOM sai do mesmo conjunto", () => {
    const TELA = fs.readFileSync(path.resolve(__dirname, "../../test/tela.ts"), "utf8");
    const conjunto = (fonte: string, nome: string) => {
      const m = fonte.match(new RegExp(`const ${nome} = new Set\\(\\[([^\\]]*)\\]\\)`));
      expect(m, `${nome} não achado`).not.toBeNull();
      return [...m![1].matchAll(/"([^"]+)"/g)].map((x) => x[1]).sort();
    };
    for (const nome of ["TAGS_DE_BLOCO", "VAZIOS"]) expect(conjunto(FONTE, nome), nome).toEqual(conjunto(TELA, nome));
    // As trocas de `decodificar` (entidade → caractere), na mesma ordem.
    const trocas = (fonte: string) => {
      const i = fonte.indexOf("function decodificar");
      const corpo = fonte.slice(i, fonte.indexOf("\n}", fonte.indexOf("return", i)));
      return [...corpo.matchAll(/\.replace\((\/[^/]+\/g), ("[^"]*"|'[^']*')\)/g)].map((m) => `${m[1]} → ${m[2]}`);
    };
    expect(trocas(FONTE).length).toBeGreaterThan(0);
    expect(trocas(FONTE)).toEqual(trocas(TELA));
    // O "pior em bloco" da tela usa o seletor `BLOCO`: uma 2ª lista escrita à mão divergiria em silêncio.
    expect(FONTE).toContain('const BLOCO = Array.from(TAGS_DE_BLOCO).join(", ");');
  });

  it("toda tag, de bloco ou não, e as entidades de espaço dão o mesmo resultado nos dois lados", () => {
    const tags = [
      ...["p", "li", "h1", "h2", "h3", "h4", "h5", "h6", "summary", "dt", "dd"],
      ...["div", "span", "pre", "blockquote", "figcaption", "caption", "label", "legend", "section", "article", "button", "code", "strong"],
    ];
    for (const tag of tags) {
      const html = `<div>antes <${tag}>uma frase de cinco palavras</${tag}> depois</div>`;
      expect(json(nucleo.reguaDoHtml(html)), tag).toEqual({ palavras: palavras(html), blocos: blocos(html) });
    }
    for (const ent of ["&nbsp;", "&#160;", "&#xa0;", "&#xA0;", "&ensp;", "&emsp;", "&thinsp;", "&#10;", "&#9;", "&amp;", "&quot;", "&#39;", "&#x27;"]) {
      const html = `<p>um${ent}dois</p>`;
      expect(json(nucleo.reguaDoHtml(html)), ent).toEqual({ palavras: palavras(html), blocos: blocos(html) });
    }
  });

  it("frase: cortada depois de . ! ? (a régua dos ⓘ)", () => {
    expect(json(nucleo.frasesDe("Um. Dois! Três? Quatro"))).toEqual(["Um.", "Dois!", "Três?", "Quatro"]);
  });
});

describe("o resumo", () => {
  const { resumir } = carregar();

  it("frase longa a partir de 7; o pior trecho é o maior (o 1º no empate); os > 25", () => {
    const seis = { palavras: n(6) };
    const sete = { palavras: n(7) };
    const vinteSeis = { palavras: n(26) };
    const duasFrases = { palavras: [...n(14), "fim.", ...n(15)] }; // 30 palavras, frases de 15 e 15
    const outroDeTrinta = { palavras: n(30) };
    const grafico = { palavras: ["10/11", "12/11"], grafico: true };
    const r = json(resumir([seis, sete, vinteSeis, duasFrases, outroDeTrinta, grafico]));
    expect(r.total).toBe(6 + 7 + 26 + 30 + 30 + 2);
    expect(r.noGrafico).toBe(2);
    expect(r.emLongas).toBe(7 + 26 + 30 + 30);
    expect(r.longas).toHaveLength(4);
    expect(r.pior).toEqual(duasFrases);
    expect(r.trechosAcima).toBe(3);
    expect(r.maiorFrase).toBe(30);
    expect(r.frasesAcima).toBe(2);
  });

  it("o pior EM bloco (o que `blocos()` vê) e o pior FORA de bloco saem à parte; o gráfico não entra", () => {
    const r = json(
      resumir([
        { palavras: n(12), emBloco: true },
        { palavras: n(20), emBloco: false }, // texto solto numa <div>: o teste não vê
        { palavras: n(9), emBloco: true },
        { palavras: n(40), grafico: true },
      ]),
    );
    expect(r.piorEmBloco).toBe(12);
    expect(r.piorForaDeBloco).toBe(20);
    expect(r.pior?.palavras).toHaveLength(40);
  });

  it("sem trecho nenhum: zero e sem pior", () => {
    const r = json(resumir([]));
    expect(r).toMatchObject({ total: 0, emLongas: 0, pior: null, piorEmBloco: 0, piorForaDeBloco: 0, maiorFrase: 0 });
  });
});

describe("LGPD: o que sai no console", () => {
  const nucleo = carregar();

  it("algarismo vira #, e-mail vira •@•; o começo tem 6 palavras", () => {
    expect(json(nucleo.mascarar(["Pessoa", "(00)", "90000-0000", "pessoa@exemplo.invalid"]))).toEqual(["Pessoa", "(##)", "#####-####", "•@•"]);
    expect(nucleo.comecoDe(["A", "ficha", "de", "cada", "pessoa", "que", "a", "campanha"])).toBe("A ficha de cada pessoa que …");
    expect(nucleo.comecoDe(["Leads", "(12)"])).toBe("Leads (##)");
  });

  it("as telas de pessoas: toda rota fora da lista das que não mostram gente (uma lista do que PODE)", () => {
    expect(nucleo.ehFicha("/leads/1700000000000")).toBe(true);
    expect(nucleo.ehFicha("/leads/")).toBe(false);
    expect(nucleo.ehFicha("/leads")).toBe(false);
    for (const r of [
      "/leads",
      "/leads/1700000000000",
      "/fila",
      "/configuracoes/usuarios",
      "/configuracoes/perigo",
      // Ferramentas ("Registros em lote: <usuário> · …", colisões de id com o nome) e Importar
      // ("Lead "Fulano-zq" adicionado.") mostram gente num <p>.
      "/configuracoes/ferramentas",
      "/configuracoes/importar",
      // Rota que ninguém previu também é de pessoas; e o prefixo não engana.
      "/rota-nova",
      "/filas",
      "/funilx",
      "/configuracoes/marcasx",
    ]) {
      expect(nucleo.ehTelaDePessoas(r), r).toBe(true);
    }
    for (const r of [
      "/",
      "/funil",
      "/midia",
      "/conteudo",
      "/conteudo/producao",
      "/conteudo/registros",
      "/configuracoes",
      "/configuracoes/marcas",
      "/configuracoes/integracoes",
      "/configuracoes/atendimento",
    ])
      expect(nucleo.ehTelaDePessoas(r), r).toBe(false);
    expect(nucleo.rotaParaImprimir("/leads/1700000000000")).toBe("/leads/:id");
    expect(nucleo.rotaParaImprimir("/funil")).toBe("/funil");
  });

  it("o começo só sai no localhost, por padrão: em produção, só contagens", () => {
    for (const h of ["localhost", "127.0.0.1", "[::1]", "painel.localhost"]) expect(nucleo.textoPadrao(h), h).toBe(true);
    for (const h of ["painel.exemplo.com.br", "localhost.exemplo.com", "10.0.0.5", ""]) expect(nucleo.textoPadrao(h), h).toBe(false);
  });

  it("a 1ª medição (a da colagem) fora do localhost não contorna nem rola: o padrão vale também para ela", () => {
    expect(json(nucleo.opcoesPadrao("painel.exemplo.com.br"))).toEqual({ escopo: "pagina", texto: false, marcar: false, comparar: false });
    expect(json(nucleo.opcoesPadrao("localhost"))).toEqual({ escopo: "pagina", texto: true, marcar: true, comparar: false });
    // `medirTexto()` (sem opções) é a execução automática da colagem: parte do mesmo padrão.
    expect(FONTE).toContain("Object.assign(opcoesPadrao(location.hostname), opcoes || {})");
    expect(FONTE).toMatch(/return medirTexto\(\);\r?\n\}\)\(\);\s*$/);
  });

  it("numa tela de pessoas, só sai o que está na lista: título, resumo, botão ou bloco marcado", () => {
    const fatos = (f: Partial<FatosDoBloco>): FatosDoBloco => ({
      ficha: false,
      telaDePessoas: true,
      tag: "div",
      marcado: false,
      emLinha: false,
      comLinkDePessoa: false,
      ...f,
    });
    const pode = (f: Partial<FatosDoBloco>) => nucleo.podeImprimirComeco(fatos(f));
    // Sai: o título do grupo da Fila, o resumo do recolhido, o botão "Mostrar mais", o título marcado.
    expect(pode({ tag: "h2" })).toBe(true);
    expect(pode({ tag: "summary" })).toBe(true);
    expect(pode({ tag: "button" })).toBe(true);
    expect(pode({ tag: "div", marcado: true })).toBe(true);
    // Não sai: a faixa "Fulano-zq: Tentativa 1 sem resposta registrada…" da Fila (uma <div> solta),
    // a mensagem "Lead "Fulano-zq" excluído…" do Revisar (um <p>), a linha da auditoria (um <li>).
    expect(pode({ tag: "div" })).toBe(false);
    expect(pode({ tag: "p" })).toBe(false);
    expect(pode({ tag: "li", emLinha: true })).toBe(false);
    // Botão dentro de linha ("Mesclar em “Fulano-zq”", num <li>) também não.
    expect(pode({ tag: "button", emLinha: true })).toBe(false);
    // Na ficha e com link de pessoa, nada — nem título.
    expect(pode({ tag: "h3", ficha: true })).toBe(false);
    expect(pode({ tag: "h2", comLinkDePessoa: true, telaDePessoas: false })).toBe(false);
    // Fora das telas de pessoas, o começo sai (sem link de pessoa).
    expect(pode({ tag: "p", telaDePessoas: false })).toBe(true);
    expect(pode({ tag: "li", emLinha: true, telaDePessoas: false })).toBe(true);
  });

  it("a rolagem sai com uma casa e vírgula", () => {
    expect(nucleo.formatarTelas(28.66)).toBe("28,7");
    expect(nucleo.formatarTelas(1)).toBe("1,0");
  });
});
