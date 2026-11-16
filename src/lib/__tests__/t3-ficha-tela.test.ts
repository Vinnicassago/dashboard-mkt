/**
 * T3 (plano de nov/26, seção 5) — a FICHA do lead (`app/(dashboard)/leads/[id]/page.tsx`)
 * com menos texto, renderizada de verdade com o store trocado por uma fixture sintética
 * (nada real: "Fulano-…-zq", @exemplo.com.br, 55119888…). Régua de `src/test/tela.ts`.
 *
 *   • TEXTO DO PAINEL: o que a pessoa digitou (notas, anotações, respostas e perfil longo do
 *     diagnóstico) mora num elemento só de texto marcado com `data-medir-texto-ignorar` e sai
 *     da conta (`semIgnorados`). Por caso, ≤ o orçamento medido (tetos 250 e 310), nenhuma
 *     frase > 25 — também dentro dos ⓘ —, nenhuma descrição embaixo de título, só o "Entrou
 *     em" com data por extenso.
 *   • Os ⓘ por card ("Sobre …"); vazio = uma linha no título, com o botão de hoje
 *     ("Corrigir respostas") só para quem edita; a classe divergente = "≠ n8n (X)" + o porquê
 *     no ⓘ; o perfil do diagnóstico no título só até 6 palavras; o resultado da reunião com ⓘ
 *     só para quem registra; "Dá para mesclar" só para quem mescla.
 *   • LGPD e fronteira: o Marketing vê o contato mascarado (ⓘ "Sobre o contato mascarado"),
 *     sem o card "Registrar"; só a `FichaAcoes` do comercial recebe o telefone; nenhuma
 *     função cruza; os clients formam uma lista FECHADA.
 */
import fs from "node:fs";
import path from "node:path";
import type { ReactElement, ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { blocos, componentesClient, contatosDe, inspecionar, palavras, type Fronteira } from "@/test/tela";
import { ROBO, base, brt, lead } from "@/test/fixtures-robo";
import { SOBRE_A_MASCARA } from "@/lib/lgpd";
import { SOBRE_O_RESULTADO_DA_REUNIAO } from "@/lib/reuniao";
import type { CapiEnvio, Lead, LeadEvent } from "@/lib/types";

// ---------------------------------------------------------------- dublês da página

const h = vi.hoisted(() => ({
  lead: null as unknown,
  eventos: [] as unknown[],
  envios: [] as unknown[],
  leads: [] as unknown[],
  user: { role: "comercial" } as null | { role: string },
  pode: { "leads:write": true, "leads:delete": false } as Record<string, boolean>,
  robo: null as unknown,
}));

vi.mock("next/navigation", () => ({
  usePathname: () => "/leads/x",
  useSearchParams: () => new URLSearchParams("range=7d"),
  useRouter: () => ({ refresh: () => {}, push: () => {}, replace: () => {} }),
  notFound: () => {
    throw new Error("notFound");
  },
}));
vi.mock("next/link", async () => {
  const { createElement: el } = await import("react");
  return {
    default: function Link({ href, children, ...resto }: { href: string; children?: ReactNode }) {
      return el("a", { href, ...resto }, children);
    },
  };
});
vi.mock("@/components/layout/alertas", () => ({ RegistrarAlertas: () => null }));
vi.mock("@/app/(dashboard)/leads/actions", () => ({
  anotarLead: vi.fn(),
  changeLeadStatus: vi.fn(),
  deleteLeadAction: vi.fn(),
  restoreLeadAction: vi.fn(),
  desfazerTentativa: vi.fn(),
  marcarReuniao: vi.fn(),
  registrarResultadoDoContato: vi.fn(),
  registrarResultadoDaReuniao: vi.fn(),
  registrarTentativa: vi.fn(),
  reabrirLead: vi.fn(),
  salvarRespostas: vi.fn(),
  mesclarLeads: vi.fn(),
  corrigirDesistenciaSemReuniao: vi.fn(),
}));
vi.mock("@/app/(dashboard)/configuracoes/live-actions", () => ({ salvarManuaisDaLive: vi.fn(), salvarCampanhaDaLive: vi.fn() }));
vi.mock("@/app/(dashboard)/ai-actions", () => ({ gerarResumoSemanalAction: vi.fn() }));
vi.mock("@/app/(dashboard)/configuracoes/conferencia-actions", () => ({ registrarConferencia: vi.fn() }));
vi.mock("@/lib/auth/guard", () => ({ can: async (cap: string) => h.pode[cap] ?? false }));
vi.mock("@/lib/auth/current-user", () => ({ getCurrentUser: async () => h.user }));
vi.mock("@/lib/integracoes", () => ({ mensagemWhatsapp: async () => "Oi {nome}" }));
vi.mock("@/lib/atendimento-server", async () => {
  const { EXPEDIENTE_PADRAO } = await import("@/lib/turno");
  return { expedienteAtual: async () => EXPEDIENTE_PADRAO };
});
vi.mock("@/lib/robo/estado", () => ({ estadoDoRoboAgora: async () => h.robo }));
vi.mock("@/lib/data/store", () => ({
  getLead: async (id: string) => ((h.lead as Lead | null)?.id === id ? h.lead : null),
  getData: async () => ({ ...(base() as object), leads: h.leads }),
  listLeadEvents: async ({ leadId }: { leadId: string }) => (h.eventos as LeadEvent[]).filter((e) => e.leadId === leadId),
  listCapiEnvios: async ({ leadId }: { leadId: string }) => (h.envios as CapiEnvio[]).filter((e) => e.leadId === leadId),
  getState: async () => null,
}));

// ---------------------------------------------------------------- fixture (sintética)

const HOJE = "2026-11-16";
const ONTEM = "2026-11-13"; // sexta
const AGORA = brt(HOJE, "15:00");
const ROBO_HOJE = { ...ROBO, lidoAte: brt(HOJE, "14:55"), sync: { ultimoOk: brt(HOJE, "14:55"), falha: null } };
const ROBO_DESLIGADO = { ligado: false, lidoAte: null, confiavel: false, sync: { ultimoOk: null, falha: null } };

const ev = (id: string, leadId: string, action: LeadEvent["action"], em: string, extra: Partial<LeadEvent> = {}): LeadEvent => ({
  id,
  leadId,
  leadName: `Fulano-${leadId}-zq`,
  actor: "ana",
  action,
  createdAt: em,
  ...extra,
});
const envio = (leadId: string, em: string): CapiEnvio => ({
  id: `Lead:${leadId}`,
  brand: "consorcio",
  leadId,
  eventName: "Lead",
  eventId: leadId,
  eventTime: em,
  status: "enviado",
  tentativas: 1,
  enviadoEm: em,
  teste: false,
  criadoEm: em,
  atualizadoEm: em,
});

type Caso = { l: Lead; eventos: LeadEvent[] };

/** Lead típico de conversão com o robô: aceitou o convite, o comercial tentou 2 vezes e anotou. */
function tipico(): Caso {
  const l = lead("tipico", {
    createdAt: brt(ONTEM, "10:00"),
    phone: "5511988800001",
    email: "pessoa.tipico@exemplo.com.br",
    status: "em_contato",
    firstContactAt: brt(HOJE, "09:30"),
    utmSource: "meta",
    utmCampaign: "123",
    utmContent: "Carrossel imóvel__ad_456",
    adId: "456",
    fbc: "fb.1.x",
    roboVistoEm: brt(ONTEM, "10:05"),
    roboRecebidoEm: brt(ONTEM, "10:00"),
    roboSaudacaoEm: brt(ONTEM, "10:01"),
    roboRespondeuEm: brt(ONTEM, "10:20"),
    roboUltimaMsgClienteEm: brt(HOJE, "11:00"),
    roboUltimaInteracaoEm: brt(HOJE, "11:00"),
    roboConviteEm: brt(HOJE, "10:40"),
    roboAceitouEm: brt(HOJE, "11:00"),
    roboEtapa: "transferido",
  });
  const eventos = [
    ev("e1", l.id, "created", l.createdAt, { actor: "Landing page", toStatus: "lead" }),
    ev("e2", l.id, "tentativa", brt(HOJE, "09:30"), { payload: { canal: "ligacao", falou: "nao", resultado: "nao_atendeu" } }),
    ev("e3", l.id, "status_changed", brt(HOJE, "09:30"), { fromStatus: "lead", toStatus: "em_contato" }),
    ev("e4", l.id, "tentativa", brt(HOJE, "13:10"), {
      payload: { canal: "whatsapp", falou: "sim", resultado: "falou", nota: "Quer imóvel até 300 mil, pediu retorno amanhã" },
    }),
    ev("e5", l.id, "nota", brt(HOJE, "13:12"), { payload: { texto: "Prefere falar depois das 18h." } }),
  ];
  return { l, eventos };
}

/** Inscrito da live: respostas, classe A, fatos do n8n. */
function daLive(): Caso {
  const { l, eventos } = tipico();
  return {
    l: {
      ...l,
      bem: "imovel",
      faixaValor: "150k_300k",
      finalidade: "morar",
      faixaParcela: "1500_3000",
      prazoCompra: "ate_1_ano",
      horarioPreferido: "noite",
      aceiteMensagens: true,
      classe: "A",
      msg1EnviadaEm: brt(ONTEM, "10:01"),
      msg1Status: "lida",
      atendimentoAvisadoEm: brt(ONTEM, "10:02"),
      comunidadeEm: brt(ONTEM, "10:30"),
    } as Lead,
    eventos,
  };
}

/** A classe do painel (A) diferente da do n8n (B). */
function divergente(): Caso {
  const c = daLive();
  return { ...c, l: { ...c.l, classe: "A", classeN8n: "B" } };
}

/** Com o diagnóstico do n8n: perfil curto (vai ao título), uma resposta. */
function comDiagnostico(): Caso {
  const c = daLive();
  return {
    ...c,
    l: {
      ...c.l,
      diagnostico: {
        feitoEm: brt(ONTEM, "11:00"),
        perfil: "Perfil de exemplo",
        respostas: [{ pergunta: "Pergunta de exemplo", resposta: "Resposta de exemplo" }],
      },
    },
  };
}

/** O perfil com 13 palavras: texto do n8n, fica no corpo (marcado), nunca no título. */
function comPerfilLongo(): Caso {
  const c = comDiagnostico();
  return {
    ...c,
    l: {
      ...c.l,
      diagnostico: { ...c.l.diagnostico!, perfil: "Perfil de exemplo com bastante texto para passar das seis palavras do título" },
    },
  };
}

/** Reunião realizada; a linha do tempo desenha "reunião …", "· próxima …" e "· feita em …". */
function realizada(): Caso {
  const { l, eventos } = tipico();
  return {
    l: {
      ...l,
      status: "reuniao_realizada",
      bookedAt: brt(ONTEM, "12:00"),
      meetingFor: brt(HOJE, "10:00"),
      attendedAt: brt(HOJE, "11:00"),
    },
    eventos: [
      ...eventos,
      ev("e6", l.id, "status_changed", brt(ONTEM, "12:00"), {
        fromStatus: "em_contato",
        toStatus: "agendado",
        payload: { reuniao: brt(HOJE, "10:00") },
      }),
      // occurredAt 3 h antes do registro: mais que os 15 min de `DescricaoEvento`.
      ev("e7", l.id, "tentativa", brt(HOJE, "12:00"), {
        occurredAt: brt(HOJE, "09:00"),
        payload: { canal: "ligacao", falou: "nao", proxima: brt(HOJE, "16:00") },
      }),
    ],
  };
}

async function ficha(c: Caso, papel: string, robo = ROBO_HOJE as unknown, outros: Lead[] = []) {
  h.lead = c.l;
  h.eventos = c.eventos;
  h.envios = [envio(c.l.id, brt(c.l.createdAt.slice(0, 10), "10:01"))];
  h.leads = [c.l, ...outros];
  h.user = { role: papel };
  h.pode =
    papel === "marketing" ? { "leads:write": false, "leads:delete": false } : { "leads:write": true, "leads:delete": papel === "admin" };
  h.robo = robo;
  const { default: FichaDoLead } = await import("@/app/(dashboard)/leads/[id]/page");
  return (await FichaDoLead({ params: Promise.resolve({ id: c.l.id }), searchParams: Promise.resolve({ range: "7d" }) } as never)) as ReactElement;
}

/** A ficha renderizada (HTML) e a fronteira server → client da MESMA árvore. */
async function render(c: Caso, papel: string, robo: unknown = ROBO_HOJE, outros: Lead[] = []) {
  const el = await ficha(c, papel, robo, outros);
  const html = renderToStaticMarkup(el);
  const fr = await inspecionar(el, await componentesClient());
  return { html, fr };
}

// ---------------------------------------------------------------- helpers

const texto = (html: string) =>
  html
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ");
const frases = (t: string) => t.split(/(?<=[.!?])\s+/).filter(Boolean);
/** O texto do PAINEL: tira os elementos marcados com data-medir-texto-ignorar (notas, respostas — §2.0). */
const semIgnorados = (html: string) => html.replace(/<(\w+)\b[^>]*\sdata-medir-texto-ignorar="true"[^>]*>[^<]*<\/\1>/g, "");
const porExtenso = (html: string) => (html.match(/de \d{4},/g) ?? []).length;

type PropsDoInfo = { texto?: unknown; rotulo?: unknown; className?: unknown };
const infos = (fr: Fronteira) => fr.clients.filter((c) => c.nome === "ui/info.tsx:Info").map((c) => c.props as PropsDoInfo);
const infoDe = (fr: Fronteira, rotulo: string) => infos(fr).find((i) => i.rotulo === rotulo);
const maiorFrase = (t: string) => Math.max(0, ...frases(t).map((f) => palavras(`<i>${f}</i>`).length));

/**
 * Orçamento = o MEDIDO depois do T3 (16/11), arredondado para cima à dezena, sem passar dos
 * tetos da spec (250 no lead típico, 310 no inscrito da live). Medido no texto do PAINEL
 * (`semIgnorados`): 223 · 188 · 184 · 279 (com o digitado, 244 · 209 · 205 · 300; antes do
 * T3, 426 · 403 · 363 · 480). Os 200 da régua esperam o redesenho da ficha (U7).
 */
const ORCAMENTO = {
  comercialRoboLigado: 230,
  marketing: 190,
  comercialRoboDesligado: 190,
  inscritoDaLive: 280,
};

const CASOS: { nome: string; caso: () => Caso; papel: string; robo: unknown; orcamento: number }[] = [
  { nome: "comercial · típico · robô ligado", caso: tipico, papel: "comercial", robo: ROBO_HOJE, orcamento: ORCAMENTO.comercialRoboLigado },
  { nome: "marketing · típico · robô ligado", caso: tipico, papel: "marketing", robo: ROBO_HOJE, orcamento: ORCAMENTO.marketing },
  {
    nome: "comercial · típico · robô desligado",
    caso: tipico,
    papel: "comercial",
    robo: ROBO_DESLIGADO,
    orcamento: ORCAMENTO.comercialRoboDesligado,
  },
  { nome: "comercial · inscrito da live", caso: daLive, papel: "comercial", robo: ROBO_HOJE, orcamento: ORCAMENTO.inscritoDaLive },
];

/** O que saiu da ficha: as descrições sob os títulos, a caixa da divergência e a instrução da reunião. */
const SAIRAM = [
  "As respostas do formulário",
  "Cada tentativa com o resultado",
  "O que o fluxo do n8n registrou",
  "Gravados uma vez",
  "pela junção única",
  "Cada entrada, tentativa, mudança",
  "Mascarado para o papel",
  "O n8n classificou",
  "Vendeu: registre",
  'title="Etapa máxima',
];

const CLIENTS_PERMITIDOS = [
  "next/link",
  "tables/lead-status.tsx:StatusBadge",
  "leads/reuniao-ficha.tsx:ReuniaoNaFicha",
  "ui/info.tsx:Info",
  "leads/ficha-qualificacao.tsx:FichaQualificacao",
  "leads/ficha-acoes.tsx:FichaAcoes",
  "leads/lead-activity.tsx:DescricaoEvento",
  "leads/leads-directory.tsx:DeletedLeads",
];

const RAIZ = path.resolve(__dirname, "../../..");
const fonte = (rel: string) => fs.readFileSync(path.join(RAIZ, rel), "utf8");

beforeAll(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(AGORA));
});
afterAll(() => vi.useRealTimers());

// ---------------------------------------------------------------- 1. por caso, com teto

describe("T3 · a ficha com menos texto, por caso (texto do painel)", () => {
  it.each(CASOS)("$nome", async ({ caso, papel, robo, orcamento }) => {
    const { html, fr } = await render(caso(), papel, robo);
    const p = semIgnorados(html);

    expect(palavras(p).length).toBeLessThanOrEqual(orcamento);
    expect(Math.max(...blocos(p).map((b) => b.length))).toBeLessThanOrEqual(25);

    const lista = infos(fr);
    expect(lista.length).toBeGreaterThan(0);
    for (const i of lista) {
      expect(typeof i.rotulo).toBe("string");
      expect(String(i.rotulo).startsWith("Sobre "), String(i.rotulo)).toBe(true);
      expect(typeof i.texto).toBe("string");
      expect(maiorFrase(String(i.texto)), String(i.rotulo)).toBeLessThanOrEqual(25);
    }

    for (const s of SAIRAM) expect(html, s).not.toContain(s);
    // Só o "Entrou em" guarda o ano (o envio à Meta do fixture é "enviado", sem data no texto).
    expect(porExtenso(html)).toBe(1);
    expect(html).toContain('aria-label="Sobre “chegou a”"');
  });
});

// ---------------------------------------------------------------- 2 a 8b

describe("T3 · a ficha: ⓘ, vazios, divergência, diagnóstico e reunião", () => {
  it("2. um ⓘ por card (comercial típico) e o texto digitado marcado", async () => {
    const { html, fr } = await render(tipico(), "comercial");
    const rotulos = new Set(infos(fr).map((i) => i.rotulo));
    for (const r of [
      "Sobre “chegou a”",
      "Sobre a qualificação",
      "Sobre o atendimento",
      "Sobre o robô de WhatsApp",
      "Sobre os marcos",
      "Sobre a origem",
      "Sobre a linha do tempo",
    ]) {
      expect(rotulos.has(r), r).toBe(true);
    }
    expect(rotulos.has("Sobre o contato mascarado")).toBe(false);

    // A nota da tentativa aparece no Atendimento e na linha do tempo: as duas marcadas, e a anotação também.
    const p = semIgnorados(html);
    expect(p).not.toBe(html);
    expect(texto(html)).toContain("Quer imóvel até 300 mil");
    expect(texto(p)).not.toContain("Quer imóvel até 300 mil");
    expect(texto(p)).not.toContain("Prefere falar depois das 18h");
  });

  it("3. Marketing: contato mascarado com o ⓘ, sem Registrar, sem contato no payload", async () => {
    const c = tipico();
    const { html, fr } = await render(c, "marketing");
    expect(infoDe(fr, "Sobre o contato mascarado")?.texto).toBe(SOBRE_A_MASCARA);
    expect(html).not.toMatch(/<h3[^>]*>Registrar<\/h3>/);
    expect(html).not.toContain("5511988800001");
    expect(html).not.toContain("pessoa.tipico@exemplo.com.br");
    expect(/"(phone|email|telefone)"/.test(JSON.stringify(fr.clients))).toBe(false);
    const arvore = JSON.stringify(fr.arvore).toLowerCase();
    for (const k of contatosDe([c.l])) expect(arvore.includes(k.toLowerCase()), k).toBe(false);
  });

  it("4. Comercial: só a FichaAcoes recebe o telefone, como antes", async () => {
    const { html, fr } = await render(tipico(), "comercial");
    expect(html).toMatch(/<h3[^>]*>Registrar<\/h3>/);
    const comTelefone = fr.clients.filter((c) => JSON.stringify(c.props).includes("5511988800001")).map((c) => c.nome);
    expect(comTelefone).toEqual(["leads/ficha-acoes.tsx:FichaAcoes"]);
  });

  it("5. vazios em uma linha, com o MESMO botão de hoje (nenhum chamado novo)", async () => {
    const com = await render(tipico(), "comercial");
    const t = texto(com.html);
    expect(t).toContain("Qualificação · sem respostas");
    expect(t).toContain("Corrigir respostas");
    expect(t).toContain("Automação (n8n) · nada registrado");
    expect(t).not.toContain("Preencher respostas");
    expect(t).not.toContain("Parcela que cabe");
    expect(t).not.toContain("Mensagem automática");
    expect(String(infoDe(com.fr, "Sobre a qualificação")?.texto)).toContain("Salvar recalcula a classe");

    const live = texto((await render(daLive(), "comercial")).html);
    expect(live).toContain("Parcela que cabe");
    expect(live).toContain("Corrigir respostas");
    expect(live).toContain("Mensagem automática");
    expect(live).not.toContain("sem respostas");
    expect(live).not.toContain("nada registrado");

    const mkt = await render(tipico(), "marketing");
    const tm = texto(mkt.html);
    expect(tm).toContain("Qualificação · sem respostas");
    expect(tm).not.toContain("Corrigir respostas");
    expect(tm).not.toContain("Preencher respostas");
    expect(String(infoDe(mkt.fr, "Sobre a qualificação")?.texto)).not.toContain("Salvar recalcula");
  });

  it("6. classe divergente: \"≠ n8n (B)\" no título e o porquê no ⓘ, sem a caixa", async () => {
    const { html, fr } = await render(divergente(), "comercial");
    expect(texto(html)).toContain("≠ n8n (B)");
    const dica = String(infoDe(fr, "Sobre a qualificação")?.texto);
    expect(dica).toContain("O n8n mandou B; o painel calcula A com as mesmas respostas.");
    expect(dica).toContain("Configurações → Atendimento e classe");
    expect(html).not.toContain("O n8n classificou");
  });

  it("7. diagnóstico: o perfil no título só até 6 palavras", async () => {
    const curto = texto((await render(comDiagnostico(), "comercial")).html);
    expect(curto).toContain("Diagnóstico · Perfil de exemplo");
    expect(curto).toContain("Feito em");

    const { html } = await render(comPerfilLongo(), "comercial");
    expect(html).toMatch(/<h3[^>]*>Diagnóstico<\/h3>/);
    // O rótulo "Perfil" é do PAINEL (o perfil do fixture também começa com "Perfil", e sai marcado).
    expect(texto(semIgnorados(html))).toContain("Perfil");
    for (const h3 of html.match(/<h3[^>]*>[\s\S]*?<\/h3>/g) ?? []) expect(h3).not.toContain("bastante texto");
    expect(texto(semIgnorados(html))).not.toContain("bastante texto");
  });

  it("7b. a linha da véspera é texto para COPIAR (3ª exceção da régua): leva o perfil do n8n, e só ela", async () => {
    // Reunião marcada pela frente: a ficha desenha a linha para o Brunno (`mensagemDaVespera`,
    // num <pre> do `CopiarResumo`), que mistura o texto do painel com o perfil livre do n8n —
    // não dá para marcar só o perfil. Fora dela, o perfil longo só aparece marcado.
    const c = comPerfilLongo();
    const agendado: Caso = {
      ...c,
      l: { ...c.l, status: "agendado", bookedAt: brt(HOJE, "09:00"), meetingFor: brt("2026-11-17", "10:00") },
    };
    const { html } = await render(agendado, "comercial");
    const pres = html.match(/<pre[^>]*>[\s\S]*?<\/pre>/g) ?? [];
    expect(pres).toHaveLength(1);
    expect(texto(pres.join(""))).toContain("perfil do diagnóstico: Perfil de exemplo com bastante texto");
    const semVespera = semIgnorados(html).replace(/<pre[^>]*>[\s\S]*?<\/pre>/g, "");
    expect(texto(semVespera)).not.toContain("bastante texto");
    expect(Math.max(...blocos(semVespera).map((b) => b.length))).toBeLessThanOrEqual(25);
  });

  it("7c. a ficha de um EXCLUÍDO tem 2 datas por extenso: o \"Entrou em\" e a do card de excluído", async () => {
    const c = tipico();
    const excluido: Caso = { ...c, l: { ...c.l, deletedAt: brt(HOJE, "12:00"), deletedBy: "ana", deletedReason: "duplicado" } };
    const { html } = await render(excluido, "admin");
    expect(porExtenso(html)).toBe(2);
    expect(texto(html)).toMatch(/excluído em \d{1,2} de \S+ de \d{4},/);
  });

  it("8. resultado da reunião com ⓘ só para quem registra; as datas da linha do tempo curtas", async () => {
    const { html } = await render(realizada(), "comercial");
    expect(html).toContain('aria-label="Sobre o resultado da reunião"');
    expect(html).not.toContain("Vendeu: registre");
    // "reunião …", "· próxima …" e "· feita em …" de `DescricaoEvento` também são curtas.
    expect(porExtenso(html)).toBe(1);
    expect(texto(html)).toContain("próxima 16/11 16:00");
    expect(texto(html)).toContain("feita em 16/11 09:00");

    const mkt = await render(realizada(), "marketing");
    expect(mkt.html).not.toContain('aria-label="Sobre o resultado da reunião"');

    expect(maiorFrase(SOBRE_O_RESULTADO_DA_REUNIAO)).toBeLessThanOrEqual(25);
  });

  it("8b. \"Dá para mesclar\" só para quem mescla (leads:delete)", async () => {
    const gemeo = lead("tipico-2", { phone: "5511988800001", createdAt: brt(ONTEM, "09:00") });
    const admin = texto((await render(tipico(), "admin", ROBO_HOJE, [gemeo])).html);
    expect(admin).toContain("A mesma pessoa tem outro cadastro");
    expect(admin).toContain("Dá para mesclar em Leads → Revisar");
    for (const papel of ["comercial", "marketing"]) {
      const t = texto((await render(tipico(), papel, ROBO_HOJE, [gemeo])).html);
      expect(t, papel).toContain("A mesma pessoa tem outro cadastro");
      expect(t, papel).not.toContain("Dá para mesclar");
    }
  });
});

// ---------------------------------------------------------------- 9 e 10

describe("T3 · a ficha: fronteira e estático", () => {
  it("9. nenhuma função cruza e os clients formam uma lista fechada", async () => {
    const casos: [Caso, string][] = [
      [tipico(), "comercial"],
      [tipico(), "marketing"],
      [daLive(), "comercial"],
      [divergente(), "admin"],
      [comPerfilLongo(), "comercial"],
      [realizada(), "comercial"],
    ];
    for (const [c, papel] of casos) {
      const { fr } = await render(c, papel);
      expect(fr.funcoes).toEqual([]);
      const nomes = [...new Set(fr.clients.map((x) => x.nome))];
      for (const n of nomes) expect(CLIENTS_PERMITIDOS, `${papel}: ${n}`).toContain(n);
    }
  });

  it("10. sem descrição sob título, sem title= no \"chegou a\", a instrução da reunião na lib", () => {
    for (const rel of [
      "src/app/(dashboard)/leads/[id]/page.tsx",
      "src/components/leads/ficha-acoes.tsx",
      "src/components/leads/ficha-qualificacao.tsx",
      "src/components/leads/reuniao-ficha.tsx",
    ]) {
      const f = fonte(rel);
      expect(f, rel).not.toContain("CardDescription");
      expect(f, rel).not.toContain("description=");
    }
    expect(fonte("src/app/(dashboard)/leads/[id]/page.tsx")).not.toContain('title="Etapa máxima');
    expect(fonte("src/components/leads/reuniao-ficha.tsx")).not.toContain("Vendeu: registre");
  });
});
