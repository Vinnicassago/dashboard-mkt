/**
 * Depois da inscrição na live — o clique em "Entrar na comunidade" e o
 * Diagnóstico do Próximo Patrimônio. Puro, sem I/O: importável no client.
 *
 * Os dois chegam pelo `/api/track` (o mesmo envio text/plain do sendBeacon, a
 * mesma `ingestKey`), com dois tipos novos:
 *
 *   • `comunidade` — a página de obrigado, pelo `eventId` do lead (o MESMO do
 *     evento `lead`). Guardado em `comunidade_cliques` e, com o lead achado, o 1º
 *     clique vira `comunidadeEm` — o fato que o n8n mandava como
 *     `clicou_comunidade` (a ficha, o painel da live e a CAPI leem dali).
 *   • `diagnostico` — a página do diagnóstico, em três etapas (`inicio`,
 *     `resposta`, `resultado`), por tentativa. Cada tentativa guarda o estado do
 *     ÚLTIMO evento que chegou (`aplicarEventoDiagnostico`): a lista de respostas
 *     vem sempre completa, porque a pessoa pode voltar e mudar uma. Concluída é
 *     FATO: o 1º `resultado` grava `concluidoEm` e nada o desfaz (o beacon da 9ª
 *     resposta, mandado junto com o resultado, pode chegar depois dele).
 *
 * A ligação com o lead é pelo telefone, na LEITURA (`ligarDiagnosticos`): DDD +
 * os 8 últimos dígitos (`chaveDddMais8`, com e sem o nono dígito). Mais de um
 * lead com o número: o inscrito da live e, entre eles, o mais recente. Sem lead,
 * a tentativa vai para "Diagnóstico sem inscrição" — nunca se perde.
 */
import { diaDoLead } from "./horario-util";
import { idLeadLp } from "./lead-id";
import { ehInscritoDaLive, entradaNaLive, type CampanhaDaLive } from "./live";
import { chaveDddMais8 } from "./phone";
import { PERGUNTAS_DO_DIAGNOSTICO, type Diagnostico } from "./qualificacao";
import type {
  CliqueComunidade,
  DiagnosticoTentativa,
  EtapaDoDiagnostico,
  EventoDiagnostico,
  Lead,
  LeadEvent,
  RespostaDoDiagnostico,
} from "./types";

// ---------------------------------------------------------------- régua

/** Texto de pergunta, resposta, perfil e tentativa: até 200 caracteres. */
export const TEXTO_MAX = 200;
/** As conquistas vão de 0 a 12. */
export const CONQUISTAS_MAX = 12;
/** O corpo de um evento novo (9 respostas de 200 caracteres cabem com folga). */
export const CORPO_MAX_BYTES = 16_000;
/** O endereço da página é metadado: guardado cortado, nunca motivo de recusa. */
const URL_MAX = 500;

export const ETAPAS_DO_DIAGNOSTICO: readonly EtapaDoDiagnostico[] = ["inicio", "resposta", "resultado"];

/** As quatro notas do raio-x, na ordem da página. */
export const NOTAS_DO_RAIO_X = {
  reserva: "Reserva",
  lance: "Lance",
  conhecimento: "Conhecimento",
  plano: "Plano",
} as const;
export type NotaDoRaioX = keyof typeof NOTAS_DO_RAIO_X;
export const CHAVES_DO_RAIO_X = Object.keys(NOTAS_DO_RAIO_X) as NotaDoRaioX[];

/** Quem aparece no histórico do lead como autor do que estas páginas gravam. */
export const ATOR_OBRIGADO = "Página de obrigado";
export const ATOR_DIAGNOSTICO = "Página do diagnóstico";

// ---------------------------------------------------------------- leitura do que chega

export type Lido<T> = { ok: true; valor: T } | { ok: false; erros: string[] };

type Corpo = Record<string, unknown>;

const ehInteiro = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v);

/** Texto obrigatório até `max`; o erro diz o campo, nunca o conteúdo (pode ser PII). */
function textoObrigatorio(v: unknown, campo: string, erros: string[], max = TEXTO_MAX): string | undefined {
  if (typeof v !== "string" || !v.trim()) {
    erros.push(`${campo}: obrigatório (texto).`);
    return undefined;
  }
  const t = v.trim();
  if (t.length > max) {
    erros.push(`${campo}: mais de ${max} caracteres.`);
    return undefined;
  }
  return t;
}

function textoOpcional(v: unknown, campo: string, erros: string[], max = TEXTO_MAX): string | undefined {
  if (v === undefined || v === null || v === "") return undefined;
  return textoObrigatorio(v, campo, erros, max);
}

const urlDaPagina = (v: unknown): string | undefined =>
  typeof v === "string" && v.trim() ? v.trim().slice(0, URL_MAX) : undefined;

/** O evento `comunidade` da página de obrigado. */
export function lerEventoComunidade(body: Corpo): Lido<{ eventId: string; pageUrl?: string }> {
  const erros: string[] = [];
  const eventId = textoObrigatorio(body.eventId, "eventId", erros);
  if (erros.length) return { ok: false, erros };
  return { ok: true, valor: { eventId: eventId!, pageUrl: urlDaPagina(body.pageUrl) } };
}

function lerResposta(v: unknown, i: number, erros: string[]): RespostaDoDiagnostico | undefined {
  const campo = `respostas[${i}]`;
  if (!v || typeof v !== "object" || Array.isArray(v)) {
    erros.push(`${campo}: envie { n, pergunta, resposta }.`);
    return undefined;
  }
  const o = v as Corpo;
  const n = o.n;
  if (!ehInteiro(n) || n < 1 || n > PERGUNTAS_DO_DIAGNOSTICO) erros.push(`${campo}.n: inteiro de 1 a ${PERGUNTAS_DO_DIAGNOSTICO}.`);
  const pergunta = textoObrigatorio(o.pergunta, `${campo}.pergunta`, erros);
  const resposta = textoObrigatorio(o.resposta, `${campo}.resposta`, erros);
  if (o.acertou !== undefined && o.acertou !== null && typeof o.acertou !== "boolean") {
    erros.push(`${campo}.acertou: true ou false.`);
  }
  if (!ehInteiro(n) || pergunta === undefined || resposta === undefined) return undefined;
  return { n, pergunta, resposta, ...(typeof o.acertou === "boolean" ? { acertou: o.acertou } : {}) };
}

function lerNotas(v: unknown, erros: string[]): Record<string, number> | undefined {
  if (v === undefined || v === null) return undefined;
  if (typeof v !== "object" || Array.isArray(v)) {
    erros.push(`notas: envie { ${CHAVES_DO_RAIO_X.join(", ")} }.`);
    return undefined;
  }
  const out: Record<string, number> = {};
  for (const [k, nota] of Object.entries(v as Corpo)) {
    const chave = k.trim().toLowerCase();
    if (!(CHAVES_DO_RAIO_X as string[]).includes(chave)) {
      erros.push(`notas.${k.slice(0, 30)}: use ${CHAVES_DO_RAIO_X.join(", ")}.`);
      continue;
    }
    if (typeof nota !== "number" || !Number.isFinite(nota) || nota < 0 || nota > 100) {
      erros.push(`notas.${chave}: número de 0 a 100.`);
      continue;
    }
    out[chave] = nota;
  }
  return out;
}

/**
 * O evento `diagnostico`, conferido campo a campo. Qualquer erro recusa o evento
 * inteiro (400, nada gravado): etapa só com os três valores, respondidas de 0 a
 * 9, no máximo 9 respostas (sem repetir o número), textos de até 200
 * caracteres, notas de 0 a 100, conquistas de 0 a 12 e um WhatsApp com DDD.
 */
export function lerEventoDiagnostico(body: Corpo): Lido<EventoDiagnostico> {
  const erros: string[] = [];

  const tentativa = textoObrigatorio(body.tentativa, "tentativa", erros, 100);
  if (tentativa && !/^[A-Za-z0-9_-]+$/.test(tentativa)) erros.push("tentativa: só letras, números, - e _.");

  const etapa = body.etapa;
  if (typeof etapa !== "string" || !(ETAPAS_DO_DIAGNOSTICO as string[]).includes(etapa)) {
    erros.push(`etapa: use ${ETAPAS_DO_DIAGNOSTICO.join(", ")}.`);
  }

  const telefoneBruto = typeof body.phone === "number" ? String(body.phone) : body.phone;
  const telefone = typeof telefoneBruto === "string" ? telefoneBruto.replace(/\D/g, "") : "";
  if (typeof telefoneBruto !== "string" || telefoneBruto.length > 40 || !chaveDddMais8(telefone)) {
    erros.push("phone: WhatsApp com DDD (ex. 5511987654321).");
  }

  let respostas: RespostaDoDiagnostico[] = [];
  if (body.respostas !== undefined && body.respostas !== null) {
    if (!Array.isArray(body.respostas)) {
      erros.push("respostas: envie a lista.");
    } else if (body.respostas.length > PERGUNTAS_DO_DIAGNOSTICO) {
      erros.push(`respostas: no máximo ${PERGUNTAS_DO_DIAGNOSTICO}.`);
    } else {
      respostas = body.respostas
        .map((r, i) => lerResposta(r, i, erros))
        .filter((r): r is RespostaDoDiagnostico => Boolean(r));
      const numeros = respostas.map((r) => r.n);
      if (new Set(numeros).size !== numeros.length) erros.push("respostas: o mesmo n duas vezes.");
      respostas.sort((a, b) => a.n - b.n);
    }
  }

  let total = PERGUNTAS_DO_DIAGNOSTICO;
  if (body.total !== undefined && body.total !== null) {
    if (!ehInteiro(body.total) || body.total < 1 || body.total > PERGUNTAS_DO_DIAGNOSTICO) {
      erros.push(`total: inteiro de 1 a ${PERGUNTAS_DO_DIAGNOSTICO}.`);
    } else total = body.total;
  }

  let respondidas = respostas.length;
  if (body.respondidas !== undefined && body.respondidas !== null) {
    if (!ehInteiro(body.respondidas) || body.respondidas < 0 || body.respondidas > PERGUNTAS_DO_DIAGNOSTICO) {
      erros.push(`respondidas: inteiro de 0 a ${PERGUNTAS_DO_DIAGNOSTICO}.`);
    } else respondidas = body.respondidas;
  }
  if (respondidas > total) erros.push("respondidas: maior que o total.");

  const perfil = textoOpcional(body.perfil, "perfil", erros);
  const notas = lerNotas(body.notas, erros);

  let conquistasTotal: number | undefined;
  if (body.conquistas_total !== undefined && body.conquistas_total !== null) {
    if (!ehInteiro(body.conquistas_total) || body.conquistas_total < 1 || body.conquistas_total > CONQUISTAS_MAX) {
      erros.push(`conquistas_total: inteiro de 1 a ${CONQUISTAS_MAX}.`);
    } else conquistasTotal = body.conquistas_total;
  }
  let conquistas: number | undefined;
  if (body.conquistas !== undefined && body.conquistas !== null) {
    const teto = conquistasTotal ?? CONQUISTAS_MAX;
    if (!ehInteiro(body.conquistas) || body.conquistas < 0 || body.conquistas > teto) {
      erros.push(`conquistas: inteiro de 0 a ${teto}.`);
    } else conquistas = body.conquistas;
  }

  if (erros.length) return { ok: false, erros };
  const resultado = etapa === "resultado";
  return {
    ok: true,
    valor: {
      tentativa: tentativa!,
      etapa: etapa as EtapaDoDiagnostico,
      telefone,
      respondidas,
      total,
      respostas,
      // O resultado só vale na tela final: perfil e notas de uma etapa anterior são ignorados.
      ...(resultado && perfil ? { perfil } : {}),
      ...(resultado && notas && Object.keys(notas).length ? { notas } : {}),
      ...(resultado && conquistas !== undefined ? { conquistas, conquistasTotal: conquistasTotal ?? CONQUISTAS_MAX } : {}),
      pageUrl: urlDaPagina(body.pageUrl),
    },
  };
}

// ---------------------------------------------------------------- a tentativa

/**
 * O estado de uma tentativa depois de mais um evento — a régua que o JSON local
 * e o Supabase aplicam e que o `upsert` do Postgres repete em SQL (o teste de
 * contrato confere os dois): o ÚLTIMO evento que chegou vale (etapa, respostas,
 * quantas respondeu, telefone); o resultado (perfil, notas, conquistas) é o do
 * último `resultado`; `iniciadoEm` é o 1º evento e `concluidoEm`, o 1º resultado.
 */
export function aplicarEventoDiagnostico(
  atual: DiagnosticoTentativa | null | undefined,
  ev: EventoDiagnostico,
  em: string,
): DiagnosticoTentativa {
  const resultado = ev.etapa === "resultado";
  const t: DiagnosticoTentativa = {
    tentativa: ev.tentativa,
    telefone: ev.telefone,
    chaveTelefone: chaveDddMais8(ev.telefone),
    etapa: ev.etapa,
    respondidas: ev.respondidas,
    total: ev.total,
    respostas: ev.respostas.map((r) => ({ ...r })),
    iniciadoEm: atual?.iniciadoEm ?? em,
    atualizadoEm: em,
    eventos: (atual?.eventos ?? 0) + 1,
  };
  const perfil = resultado ? ev.perfil : atual?.perfil;
  const notas = resultado ? ev.notas : atual?.notas;
  const conquistas = resultado ? ev.conquistas : atual?.conquistas;
  const conquistasTotal = resultado ? ev.conquistasTotal : atual?.conquistasTotal;
  const concluidoEm = atual?.concluidoEm ?? (resultado ? em : undefined);
  const pageUrl = ev.pageUrl ?? atual?.pageUrl;
  if (perfil !== undefined) t.perfil = perfil;
  if (notas !== undefined) t.notas = { ...notas };
  if (conquistas !== undefined) t.conquistas = conquistas;
  if (conquistasTotal !== undefined) t.conquistasTotal = conquistasTotal;
  if (concluidoEm !== undefined) t.concluidoEm = concluidoEm;
  if (pageUrl !== undefined) t.pageUrl = pageUrl;
  return t;
}

/** O clique depois de mais um: o 1º horário fica, o lead achado não se perde. */
export function aplicarCliqueComunidade(
  atual: CliqueComunidade | null | undefined,
  c: { eventId: string; leadId?: string; pageUrl?: string; em: string },
): CliqueComunidade {
  const out: CliqueComunidade = {
    eventId: c.eventId,
    primeiroEm: atual?.primeiroEm ?? c.em,
    ultimoEm: c.em,
    cliques: (atual?.cliques ?? 0) + 1,
  };
  const leadId = c.leadId ?? atual?.leadId;
  const pageUrl = atual?.pageUrl ?? c.pageUrl;
  if (leadId) out.leadId = leadId;
  if (pageUrl) out.pageUrl = pageUrl;
  return out;
}

/** Não começou · começou e parou · concluiu. */
export type SituacaoDoDiagnostico = "nao" | "parcial" | "concluiu";

export const SITUACAO_DO_DIAGNOSTICO: Record<SituacaoDoDiagnostico, string> = {
  nao: "Não começou",
  parcial: "Começou, não concluiu",
  concluiu: "Concluiu",
};

export function situacaoDoDiagnostico(t: DiagnosticoTentativa | null | undefined): SituacaoDoDiagnostico {
  if (!t) return "nao";
  return t.concluidoEm ? "concluiu" : "parcial";
}

/**
 * A tentativa que a tela mostra: concluída vale mais que incompleta; entre
 * iguais, a mais recente (a concluída pelo resultado, a incompleta pelo último
 * evento).
 */
export function maisAvancada(ts: DiagnosticoTentativa[]): DiagnosticoTentativa | undefined {
  const quando = (t: DiagnosticoTentativa) => Date.parse(t.concluidoEm ?? t.atualizadoEm);
  return [...ts].sort((a, b) => {
    const ca = a.concluidoEm ? 1 : 0;
    const cb = b.concluidoEm ? 1 : 0;
    if (ca !== cb) return cb - ca;
    return quando(b) - quando(a) || b.tentativa.localeCompare(a.tentativa);
  })[0];
}

// ---------------------------------------------------------------- ligação com o lead

/** Os leads (não excluídos) por chave de telefone. */
export function leadsPorChave(leads: Lead[]): Map<string, Lead[]> {
  const m = new Map<string, Lead[]>();
  for (const l of leads) {
    if (l.deletedAt) continue;
    const k = chaveDddMais8(l.phone);
    if (!k) continue;
    const lista = m.get(k);
    if (lista) lista.push(l);
    else m.set(k, [l]);
  }
  return m;
}

/**
 * O lead de um telefone: com mais de um, o inscrito da live (`ehInscritoDaLive`)
 * e, entre eles, o mais recente (pela entrada na live; sem ela, a entrada).
 */
export function escolherLead(candidatos: Lead[], cfg: CampanhaDaLive): Lead | undefined {
  if (!candidatos.length) return undefined;
  const daLive = candidatos.filter((l) => ehInscritoDaLive(l, cfg));
  const base = daLive.length ? daLive : candidatos;
  return [...base].sort(
    (a, b) => Date.parse(entradaNaLive(b)) - Date.parse(entradaNaLive(a)) || b.id.localeCompare(a.id),
  )[0];
}

export function leadDoTelefone(phone: string | null | undefined, leads: Lead[] | Map<string, Lead[]>, cfg: CampanhaDaLive): Lead | undefined {
  const k = chaveDddMais8(phone);
  if (!k) return undefined;
  const porChave = leads instanceof Map ? leads : leadsPorChave(leads);
  return escolherLead(porChave.get(k) ?? [], cfg);
}

export interface DiagnosticosLigados {
  /** Por lead: todas as tentativas que caem nele. */
  porLead: Map<string, DiagnosticoTentativa[]>;
  /** Sem lead, por pessoa (a chave do telefone): "Diagnóstico sem inscrição". */
  semInscricao: DiagnosticoTentativa[][];
}

export function ligarDiagnosticos(tentativas: DiagnosticoTentativa[], leads: Lead[], cfg: CampanhaDaLive): DiagnosticosLigados {
  const porChave = leadsPorChave(leads);
  const escolhido = new Map<string, Lead | undefined>();
  const porLead = new Map<string, DiagnosticoTentativa[]>();
  const sem = new Map<string, DiagnosticoTentativa[]>();
  for (const t of tentativas) {
    const k = t.chaveTelefone ?? chaveDddMais8(t.telefone);
    let lead: Lead | undefined;
    if (k) {
      if (!escolhido.has(k)) escolhido.set(k, escolherLead(porChave.get(k) ?? [], cfg));
      lead = escolhido.get(k);
    }
    const [mapa, chave] = lead ? [porLead, lead.id] : [sem, k ?? `tentativa:${t.tentativa}`];
    const lista = mapa.get(chave);
    if (lista) lista.push(t);
    else mapa.set(chave, [t]);
  }
  return { porLead, semInscricao: [...sem.values()] };
}

/**
 * O `eventId` de cada entrada pela página (o `payload.eventId` dos eventos
 * `created` e `reenvio` do `/api/track`) → o lead. É o que liga o clique de quem
 * já era lead: o reenvio cai no cadastro antigo, cujo id não sai do eventId. Os
 * cadastros mesclados apontam para o principal.
 */
export function indiceDeEventIds(eventos: LeadEvent[]): Map<string, string> {
  const principal = new Map<string, string>();
  for (const e of eventos) {
    if (e.action === "mesclado" && e.payload?.duplicado) principal.set(e.payload.duplicado, e.leadId);
  }
  const m = new Map<string, { leadId: string; em: string }>();
  for (const e of eventos) {
    const id = e.payload?.eventId;
    if (!id || (e.action !== "created" && e.action !== "reenvio")) continue;
    const atual = m.get(id);
    if (!atual || e.createdAt > atual.em) m.set(id, { leadId: principal.get(e.leadId) ?? e.leadId, em: e.createdAt });
  }
  return new Map([...m].map(([k, v]) => [k, v.leadId]));
}

/** O lead de um clique: o da entrada com esse eventId; senão o id que o eventId gera. */
export function leadDoEventId(
  eventId: string,
  porId: Map<string, Lead>,
  indice: Map<string, string>,
): Lead | undefined {
  const pelaEntrada = indice.get(eventId);
  const l = (pelaEntrada && porId.get(pelaEntrada)) || porId.get(idLeadLp(eventId));
  return l && !l.deletedAt ? l : undefined;
}

/**
 * O 1º clique de cada lead, dos cliques guardados (o do lead achado na hora vence;
 * o que chegou antes do lead é ligado agora, pelo índice). Só para a TELA: o fato
 * gravado no lead (`comunidadeEm`) vem antes dele.
 */
export function cliquesPorLead(
  cliques: CliqueComunidade[],
  porId: Map<string, Lead>,
  indice: Map<string, string>,
): Map<string, string> {
  const out = new Map<string, string>();
  for (const c of cliques) {
    const l = (c.leadId && porId.get(c.leadId)) || leadDoEventId(c.eventId, porId, indice);
    if (!l || l.deletedAt) continue;
    const atual = out.get(l.id);
    if (!atual || c.primeiroEm < atual) out.set(l.id, c.primeiroEm);
  }
  return out;
}

// ---------------------------------------------------------------- leitura para a tela

/** A tentativa resumida para a linha de Leads (sem as respostas: elas moram na ficha). */
export interface ResumoDoDiagnostico {
  situacao: Exclude<SituacaoDoDiagnostico, "nao">;
  respondidas: number;
  total: number;
  perfil?: string;
  notas?: Record<string, number>;
  conquistas?: number;
  conquistasTotal?: number;
  iniciadoEm: string;
  concluidoEm?: string;
  /** Quantas tentativas a pessoa fez. */
  tentativas: number;
}

export function resumirDiagnostico(ts: DiagnosticoTentativa[]): ResumoDoDiagnostico | undefined {
  const t = maisAvancada(ts);
  if (!t) return undefined;
  const r: ResumoDoDiagnostico = {
    situacao: t.concluidoEm ? "concluiu" : "parcial",
    respondidas: t.respondidas,
    total: t.total,
    iniciadoEm: t.iniciadoEm,
    tentativas: ts.length,
  };
  if (t.perfil) r.perfil = t.perfil;
  if (t.notas) r.notas = { ...t.notas };
  if (t.conquistas !== undefined) r.conquistas = t.conquistas;
  if (t.conquistasTotal !== undefined) r.conquistasTotal = t.conquistasTotal;
  if (t.concluidoEm) r.concluidoEm = t.concluidoEm;
  return r;
}

/** A célula "Diagnóstico": "Não começou", "Respondeu 6 de 9" ou "Concluiu · Construtor de patrimônio". */
export function textoDoDiagnostico(r: ResumoDoDiagnostico | undefined): string {
  if (!r) return SITUACAO_DO_DIAGNOSTICO.nao;
  if (r.situacao === "concluiu") return r.perfil ? `Concluiu · ${r.perfil}` : "Concluiu";
  return `Respondeu ${r.respondidas} de ${r.total}`;
}

/** "Reserva 85 · Lance 40 · Conhecimento 65 · Plano 30" (só as que vieram). */
export function textoDoRaioX(notas: Record<string, number> | undefined): string {
  if (!notas) return "";
  return CHAVES_DO_RAIO_X.filter((k) => notas[k] !== undefined)
    .map((k) => `${NOTAS_DO_RAIO_X[k]} ${Math.round(notas[k])}`)
    .join(" · ");
}

/** "7 de 12" (vazio sem conquistas). */
export const textoDasConquistas = (r: { conquistas?: number; conquistasTotal?: number }) =>
  r.conquistas === undefined ? "" : `${r.conquistas} de ${r.conquistasTotal ?? CONQUISTAS_MAX}`;

/**
 * Chegou à pergunta `n`: começou e respondeu as `n − 1` anteriores (concluir é
 * chegar a todas). A pergunta 1 é de quem começou.
 */
export function chegouAPergunta(r: Pick<ResumoDoDiagnostico, "situacao" | "respondidas">, n: number): boolean {
  return r.situacao === "concluiu" || r.respondidas + 1 >= n;
}

/** O resumo do período: as pessoas da live na lista e até onde foram. */
export interface ResumoDepoisDaInscricao {
  inscritos: number;
  comunidade: number;
  comecaram: number;
  concluiram: number;
  /** Índice 0 = pergunta 1. */
  chegaram: number[];
}

export function resumoDepoisDaInscricao(
  linhas: { daLive: boolean; comunidadeEm?: string; diagnosticoResumo?: ResumoDoDiagnostico }[],
): ResumoDepoisDaInscricao {
  const daLive = linhas.filter((l) => l.daLive);
  const comDiag = daLive.map((l) => l.diagnosticoResumo).filter((d): d is ResumoDoDiagnostico => Boolean(d));
  return {
    inscritos: daLive.length,
    comunidade: daLive.filter((l) => l.comunidadeEm).length,
    comecaram: comDiag.length,
    concluiram: comDiag.filter((d) => d.situacao === "concluiu").length,
    chegaram: Array.from({ length: PERGUNTAS_DO_DIAGNOSTICO }, (_, i) => comDiag.filter((d) => chegouAPergunta(d, i + 1)).length),
  };
}

/** Uma linha de "Diagnóstico sem inscrição": a pessoa (pelo número) e a tentativa mais avançada. */
export interface LinhaSemInscricao {
  /** O número que a pessoa digitou no diagnóstico (só dígitos). PII: a página mascara para o Marketing. */
  telefone: string;
  resumo: ResumoDoDiagnostico;
  /** O último evento de qualquer tentativa da pessoa. */
  ultimoEm: string;
}

/**
 * Os diagnósticos sem lead, uma linha por número, no período (pelo dia de
 * Brasília em que a tentativa mais avançada começou), os mais recentes primeiro.
 */
export function diagnosticosSemInscricao(
  tentativas: DiagnosticoTentativa[],
  leads: Lead[],
  cfg: CampanhaDaLive,
  range?: { from: string; to: string },
): LinhaSemInscricao[] {
  const linhas: LinhaSemInscricao[] = [];
  for (const ts of ligarDiagnosticos(tentativas, leads, cfg).semInscricao) {
    const melhor = maisAvancada(ts);
    const resumo = resumirDiagnostico(ts);
    if (!melhor || !resumo) continue;
    const dia = diaDoLead(resumo.iniciadoEm);
    if (range && (dia < range.from || dia > range.to)) continue;
    const ultimoEm = ts.map((t) => t.atualizadoEm).sort().at(-1) ?? melhor.atualizadoEm;
    linhas.push({ telefone: melhor.telefone, resumo, ultimoEm });
  }
  return linhas.sort((a, b) => b.resumo.iniciadoEm.localeCompare(a.resumo.iniciadoEm));
}

/**
 * O diagnóstico concluído, no formato da ficha (`lead.diagnostico`, o que o n8n
 * mandava): o painel da live conta "diagnósticos feitos", a linha da véspera lê o
 * perfil e o n8n recebe no GET da ficha. Marcado `origem: "pagina"`.
 */
export function diagnosticoParaAFicha(t: DiagnosticoTentativa): Diagnostico {
  const d: Diagnostico = {
    origem: "pagina",
    respostas: t.respostas.map((r) => ({
      pergunta: `${r.n}. ${r.pergunta}`,
      resposta: r.acertou === undefined ? r.resposta : `${r.resposta} (${r.acertou ? "acertou" : "errou"})`,
    })),
    feitoEm: t.concluidoEm ?? t.atualizadoEm,
  };
  if (t.perfil) d.perfil = t.perfil;
  if (t.notas) d.notas = { ...t.notas };
  if (t.conquistas !== undefined) d.conquistas = t.conquistas;
  if (t.conquistasTotal !== undefined) d.conquistasTotal = t.conquistasTotal;
  return d;
}

/**
 * A página pode gravar o diagnóstico na ficha? Só por cima do vazio ou do que ela
 * mesma gravou — o que o n8n mandou (com os alertas da véspera) não é apagado.
 */
export const fichaAceitaDiagnosticoDaPagina = (atual: Diagnostico | undefined) => !atual || atual.origem === "pagina";
