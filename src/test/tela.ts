/**
 * Helpers de TELA dos testes (fora da coleta do vitest, que só pega `*.test.ts`).
 * Movidos de `fase2-inicio-tela.test.ts` (Fase 3, §8.0) para o Início e o Funil
 * medirem com a MESMA régua:
 *
 *   • a fronteira server → client: `componentesClient` (todo export de arquivo
 *     "use client" de `src/components`, com as subpastas) e `inspecionar` (expande
 *     os server components e para nos clients — as props deles são o payload RSC);
 *   • a LGPD do payload: `conferirLgpd` (nenhuma função cruza, nenhum telefone ou
 *     e-mail de lead — e, com `semNomes`, nenhum NOME —, nenhuma chave proibida);
 *   • o texto que se LÊ: `palavras`, `trechos` e `blocos` (palavras por frase).
 */
import fs from "node:fs";
import path from "node:path";
import { createElement, Fragment, isValidElement, type ReactElement, type ReactNode } from "react";
import { expect } from "vitest";
import type { Lead } from "@/lib/types";

// ---------------------------------------------------------------- contatos

/** Telefones (crus e só dígitos) e e-mails de TODOS os leads da base. */
export function contatosDe(leads: readonly Lead[]): string[] {
  const out = new Set<string>();
  for (const l of leads) {
    if (l.email) out.add(l.email.toLowerCase());
    if (l.phone) {
      out.add(l.phone);
      const d = l.phone.replace(/\D/g, "");
      if (d.length >= 8) out.add(d);
    }
  }
  return [...out];
}

/** Os nomes (em minúsculas) de todos os leads da base — para a régua "nem o nome" (`semNomes`). */
function nomesDe(leads: readonly Lead[]): string[] {
  const out = new Set<string>();
  for (const l of leads) {
    const n = (l.name ?? "").trim().toLowerCase();
    if (n.length >= 3 && n !== "lead sem nome") out.add(n);
  }
  return [...out];
}

// ---------------------------------------------------------------- a fronteira server → client

const RAIZ_DOS_COMPONENTES = path.resolve(__dirname, "../components");

/** Os arquivos `.ts`/`.tsx` de uma pasta, com as subpastas, em ordem estável. */
function arquivosDe(dir: string): string[] {
  const out: string[] = [];
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) out.push(...arquivosDe(p));
    else if (/\.tsx?$/.test(ent.name) && !ent.name.endsWith(".d.ts")) out.push(p);
  }
  return out.sort();
}

/**
 * Os componentes client que a tela pode usar: todo export de um arquivo "use
 * client" de `src/components` INTEIRO (com as subpastas) — ou só de `dirs`, se
 * passadas —, mais os dublês (`next/link`, `RegistrarAlertas`). Um client que
 * faltasse aqui seria CHAMADO como server pelo inspetor e quebraria no 1º hook; com
 * a pasta inteira, um client novo de qualquer lugar é reconhecido e entra na lista
 * que o teste confere.
 *
 * O nome é `${caminho relativo a src/components}:${export}` (ex.: "ui/info.tsx:Info"),
 * mais "next/link" e "layout/alertas:RegistrarAlertas".
 */
export async function componentesClient(dirs?: readonly string[]): Promise<Map<unknown, string>> {
  const raiz = RAIZ_DOS_COMPONENTES;
  const pastas = dirs ? dirs.map((d) => path.join(raiz, d)) : [raiz];
  const out = new Map<unknown, string>();
  for (const pasta of pastas) {
    for (const arq of arquivosDe(pasta)) {
      const fonte = fs.readFileSync(arq, "utf8");
      if (!/^\s*["']use client["']/.test(fonte)) continue;
      const mod = (await import(arq)) as Record<string, unknown>;
      const rel = path.relative(raiz, arq).split(path.sep).join("/");
      // O 1º arquivo que exporta a função dá o nome (um re-export não rebatiza o original).
      for (const [nome, v] of Object.entries(mod)) if (typeof v === "function" && !out.has(v)) out.set(v, `${rel}:${nome}`);
    }
  }
  out.set((await import("next/link")).default, "next/link");
  out.set((await import("@/components/layout/alertas")).RegistrarAlertas, "layout/alertas:RegistrarAlertas");
  return out;
}

export interface Fronteira {
  /** A árvore como o servidor a manda: tags, props e, para cada client, as props serializadas. */
  arvore: unknown;
  /** Cada componente client encontrado, com as props que ele recebe (sem `children`). */
  clients: { nome: string; props: Record<string, unknown> }[];
  /** Funções em props (Server Components não passam função para Client Components). */
  funcoes: string[];
}

const FORWARD_REF = Symbol.for("react.forward_ref");
const MEMO = Symbol.for("react.memo");

/**
 * Expande os server components (chamando-os) até chegar em tags e em componentes
 * client — que NÃO são chamados: as props deles são o que cruza a fronteira.
 */
export async function inspecionar(raizDaTela: ReactNode, clientes: Map<unknown, string>): Promise<Fronteira> {
  const clients: Fronteira["clients"] = [];
  const funcoes: string[] = [];

  async function valor(v: unknown, onde: string): Promise<unknown> {
    if (v == null) return null;
    if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") return v;
    if (typeof v === "function") {
      funcoes.push(onde);
      return "[função]";
    }
    if (isValidElement(v)) return no(v);
    if (Array.isArray(v)) return Promise.all(v.map((x, i) => valor(x, `${onde}[${i}]`)));
    if (v instanceof Date) return v.toISOString();
    if (typeof v === "object") {
      const out: Record<string, unknown> = {};
      for (const [k, x] of Object.entries(v as Record<string, unknown>)) out[k] = await valor(x, `${onde}.${k}`);
      return out;
    }
    return String(v);
  }

  async function no(n: ReactNode): Promise<unknown> {
    if (n == null || typeof n === "boolean") return null;
    if (typeof n === "string" || typeof n === "number") return n;
    if (Array.isArray(n)) return Promise.all(n.map(no));
    if (!isValidElement(n)) return valor(n, "?");
    const el = n as ReactElement<Record<string, unknown>>;
    const { children, ...props } = el.props;
    if (el.type === Fragment) return no(children as ReactNode);
    if (typeof el.type === "string") return { tag: el.type, props: await valor(props, el.type), filhos: await no(children as ReactNode) };
    const tipo = el.type as unknown as { $$typeof?: symbol; type?: unknown; displayName?: string; name?: string };
    if (clientes.has(el.type)) {
      const nome = clientes.get(el.type)!;
      const p = (await valor(props, nome)) as Record<string, unknown>;
      clients.push({ nome, props: p });
      return { client: nome, props: p, filhos: await no(children as ReactNode) };
    }
    if (tipo.$$typeof === FORWARD_REF) return { icone: tipo.displayName ?? "forwardRef", props: await valor(props, "icone") };
    if (tipo.$$typeof === MEMO) return no(createElement(tipo.type as never, el.props));
    if (typeof el.type === "function") {
      const saida = await (el.type as (p: unknown) => ReactNode | Promise<ReactNode>)(el.props);
      return no(saida);
    }
    throw new Error(`tipo de elemento desconhecido: ${String(tipo.displayName ?? tipo.name ?? tipo.$$typeof?.toString())}`);
  }

  return { arvore: await no(raizDaTela), clients, funcoes };
}

/** Chaves que nenhum client pode receber: contato, a base, os eventos, a Fila e a linha de Leads. */
export const CHAVES_PROIBIDAS = [
  "phone",
  "email",
  "telefone",
  "adDaily",
  "igPosts",
  "lpDaily",
  "eventos",
  "grupos",
  "itens",
  "sinalizadores",
  "atendimentoAgora",
  "kpis",
  "inicio",
  "live",
  "painel",
];

export function chavesDe(v: unknown, out = new Set<string>()): Set<string> {
  if (Array.isArray(v)) v.forEach((x) => chavesDe(x, out));
  else if (v && typeof v === "object") {
    for (const [k, x] of Object.entries(v)) {
      out.add(k);
      chavesDe(x, out);
    }
  }
  return out;
}

/**
 * A LGPD do payload: nenhuma função cruza; o JSON da árvore inteira não tem
 * telefone (cru ou só dígitos) nem e-mail de NENHUM lead da base — com `semNomes`,
 * nem o nome —; nenhum client recebe chave proibida (`proibidas`, padrão
 * `CHAVES_PROIBIDAS`).
 */
export function conferirLgpd(
  f: Fronteira,
  leads: readonly Lead[],
  opts: { semNomes?: boolean; proibidas?: readonly string[] } = {},
) {
  expect(f.funcoes, "função passada de server para client").toEqual([]);
  const payload = JSON.stringify(f.arvore).toLowerCase();
  for (const c of contatosDe(leads)) expect(payload.includes(c.toLowerCase()), `contato no payload: ${c}`).toBe(false);
  if (opts.semNomes) for (const n of nomesDe(leads)) expect(payload.includes(n), `nome no payload: ${n}`).toBe(false);
  const proibidas = opts.proibidas ?? CHAVES_PROIBIDAS;
  for (const c of f.clients) {
    const chaves = chavesDe(c.props);
    for (const k of proibidas) expect(chaves.has(k), `${c.nome} recebe "${k}"`).toBe(false);
  }
  expect(/"(phone|email|telefone)"/.test(JSON.stringify(f.clients))).toBe(false);
}

// ---------------------------------------------------------------- palavras visíveis

const VAZIOS = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "track", "wbr"]);

function decodificar(texto: string): string {
  return texto
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;/g, "'");
}

/**
 * As palavras que se LEEM no HTML: fora de `<table>`, de `<svg>`, do que é
 * `aria-hidden` e do miolo de `<details>` fechado (só o `<summary>` aparece). O ⓘ
 * fechado não tem texto no HTML (a caixa só existe aberta). Palavra = pedaço
 * separado por espaço com pelo menos uma letra ou um algarismo (número conta;
 * "·", "→", "—" e "≥" sozinhos, não).
 */
export function palavras(html: string): string[] {
  const pilha: { tag: string; oculto: boolean; detalhesFechado: boolean }[] = [];
  const out: string[] = [];
  const re = /<(\/?)([a-zA-Z][a-zA-Z0-9]*)([^>]*?)(\/?)>|([^<]+)/g;
  for (let m = re.exec(html); m; m = re.exec(html)) {
    const [, fecha, tagBruta, attrs, autoFecha, texto] = m;
    const topo = pilha.at(-1);
    if (texto !== undefined) {
      if (topo?.oculto) continue;
      out.push(...decodificar(texto).split(/\s+/).filter((p) => /[\p{L}\p{N}]/u.test(p)));
      continue;
    }
    const tag = tagBruta.toLowerCase();
    if (fecha) {
      while (pilha.length && pilha.pop()!.tag !== tag) {
        /* desempilha até a tag */
      }
      continue;
    }
    if (autoFecha || VAZIOS.has(tag)) continue;
    const pai = topo;
    const dentroDeDetalheFechado = pai?.detalhesFechado && tag !== "summary";
    const oculto =
      Boolean(pai?.oculto) ||
      Boolean(dentroDeDetalheFechado) ||
      tag === "table" ||
      tag === "svg" ||
      /aria-hidden="true"/.test(attrs);
    pilha.push({ tag, oculto, detalhesFechado: tag === "details" && !/\sopen(=|\s|$)/.test(attrs) });
  }
  return out;
}

/** O trecho do HTML de cada elemento que casa (sem aninhamento da mesma tag). */
export function trechos(html: string, tag: string, attr: string): string[] {
  const re = new RegExp(`<${tag}[^>]*${attr}[^>]*>[\\s\\S]*?</${tag}>`, "g");
  return html.match(re) ?? [];
}

const TAGS_DE_BLOCO = new Set(["p", "li", "h1", "h2", "h3", "h4", "h5", "h6", "summary", "dt", "dd"]);

/**
 * As palavras de cada FRASE: um item por `p`, `li`, `h1`–`h6`, `summary`, `dt` e
 * `dd` visível, na ordem do HTML, com a MESMA régua de `palavras` (fora de tabela,
 * svg, `aria-hidden` e do miolo de `<details>` fechado). Cada palavra conta só no
 * bloco MAIS INTERNO que a contém (uma `li` com um `p` dentro não conta o `p` duas
 * vezes); texto fora de bloco não entra. Para "nenhuma frase passa de N":
 * `Math.max(...blocos(html).map((b) => b.length))`.
 */
export function blocos(html: string): string[][] {
  const pilha: { tag: string; oculto: boolean; detalhesFechado: boolean; bloco: number | null }[] = [];
  const out: string[][] = [];
  const re = /<(\/?)([a-zA-Z][a-zA-Z0-9]*)([^>]*?)(\/?)>|([^<]+)/g;
  for (let m = re.exec(html); m; m = re.exec(html)) {
    const [, fecha, tagBruta, attrs, autoFecha, texto] = m;
    const topo = pilha.at(-1);
    if (texto !== undefined) {
      if (topo?.oculto) continue;
      const bloco = topo?.bloco ?? null;
      if (bloco === null) continue;
      out[bloco].push(...decodificar(texto).split(/\s+/).filter((p) => /[\p{L}\p{N}]/u.test(p)));
      continue;
    }
    const tag = tagBruta.toLowerCase();
    if (fecha) {
      while (pilha.length && pilha.pop()!.tag !== tag) {
        /* desempilha até a tag */
      }
      continue;
    }
    if (autoFecha || VAZIOS.has(tag)) continue;
    const pai = topo;
    const dentroDeDetalheFechado = pai?.detalhesFechado && tag !== "summary";
    const oculto =
      Boolean(pai?.oculto) ||
      Boolean(dentroDeDetalheFechado) ||
      tag === "table" ||
      tag === "svg" ||
      /aria-hidden="true"/.test(attrs);
    let bloco = pai?.bloco ?? null;
    if (!oculto && TAGS_DE_BLOCO.has(tag)) {
      bloco = out.length;
      out.push([]);
    }
    pilha.push({ tag, oculto, detalhesFechado: tag === "details" && !/\sopen(=|\s|$)/.test(attrs), bloco });
  }
  return out;
}
