/**
 * A aba "Live 01/12" da Bússola — tudo o que ela mostra sai daqui. Puro: a
 * página só carrega e renderiza.
 *
 * Escopo: os INSCRITOS da live (`ehInscritoDaLive`) que entraram no período
 * escolhido (a coorte). Verba por linha é sempre do começo da linha até hoje —
 * verba é da campanha, não do recorte.
 *
 * As regras de confiança valem aqui também: custo com denominador zero vira
 * "—" (nunca R$ 0,00), e o custo por reunião abaixo de `MIN_REUNIOES` entra como
 * FATO ("R$ X investidos · N reuniões"), não como razão.
 */
import { RESULTADOS_VALIDOS, classeDoLead, statusReuniao, type StatusReuniao } from "./qualificacao";
import { eventosPorLead, tentativasDoLead } from "./contato";
import { MIN_REUNIOES } from "./trust";
import { formatCurrency0, formatInt } from "./format";
import { fimDaJanelaDeContato, prazoDaPrimeiraTentativa, type Expediente } from "./turno";
import { ehDoCarro, ehInscritoDaLive, linhaDaCampanha, type CampanhaDaLive, type IdDaLinha } from "./live";
import type { AdDaily, DashboardData, Lead, LeadEvent } from "./types";

export interface EntradaPainelLive {
  data: DashboardData;
  eventos: LeadEvent[];
  cfg: CampanhaDaLive;
  expediente: Expediente;
  /** O recorte escolhido (AAAA-MM-DD, inclusivo) — já limitado a hoje. */
  range: { de: string; ate: string };
  hoje: string;
  agora: string;
}

export type Ritmo = "no_ritmo" | "perto" | "atras" | "sem_ritmo";

export interface LinhaDeMeta {
  id: string;
  rotulo: string;
  /** null = número manual ainda não digitado. */
  valor: number | null;
  meta: number | null;
  /** Onde deveria estar hoje (proporcional aos dias de captação); null = sem ritmo para este número. */
  esperado: number | null;
  ritmo: Ritmo;
  nota?: string;
}

export interface Taxa {
  id: string;
  rotulo: string;
  /** 0–1; null = sem base (n = 0). */
  valor: number | null;
  n: number;
  meta: number;
  /** Meta é teto (no máximo), não piso. */
  teto?: boolean;
  ok: boolean | null;
  nota?: string;
}

export interface LinhaDeVerbaNoPainel {
  id: IdDaLinha;
  rotulo: string;
  de: string;
  ate: string;
  verba: number;
  gasto: number;
  /** Quanto deveria ter saído até hoje (ritmo diário × dias decorridos, até a verba). */
  esperado: number;
  porDia: number;
  campanhas: string[];
  /** Quantas campanhas do Gerenciador casaram com os trechos. */
  campanhasEncontradas: number;
  ritmo: Ritmo;
}

export interface DiaDeVerba {
  date: string;
  gasto: number;
  alvo: number;
  carro?: { gasto: number; alvo: number };
}

export interface PainelLive {
  inscritos: number;
  /** Dias de captação decorridos ÷ totais (0–1) — a régua do ritmo. */
  fracaoCaptacao: number;
  diasParaLive: number;
  metas: LinhaDeMeta[];
  atendimento: Taxa[];
  /** A sem nenhuma tentativa com o prazo vencido — a meta é zero. */
  aSemTentativa: number;
  reunioes: Record<StatusReuniao, number>;
  verba: LinhaDeVerbaNoPainel[];
  dias: DiaDeVerba[];
  custos: {
    gastoCaptacao: number;
    gastoLive: number;
    porInscrito: { valor: number | null; texto: string };
    porQualificado: { valor: number | null; texto: string; ok: boolean | null };
    porReuniao: { valor: number | null; texto: string };
  };
  qualidade: Taxa[];
  diagnosticos: number;
  /** Nenhuma linha de anúncio casou com os trechos das campanhas da live. */
  semCampanhas: boolean;
}

const DIA_MS = 86_400_000;
const diasEntre = (de: string, ate: string) => Math.round((Date.parse(`${ate}T00:00:00Z`) - Date.parse(`${de}T00:00:00Z`)) / DIA_MS) + 1;
const somaDias = (dia: string, n: number) => new Date(Date.parse(`${dia}T00:00:00Z`) + n * DIA_MS).toISOString().slice(0, 10);
const dentro = (dia: string, de: string, ate: string) => dia >= de && dia <= ate;

/** Ritmo de uma contagem contra o esperado de hoje: no ritmo ≥ 100%, perto ≥ 80%, atrás abaixo. */
function ritmoDe(valor: number | null, esperado: number | null): Ritmo {
  if (valor == null || esperado == null || esperado <= 0) return "sem_ritmo";
  const r = valor / esperado;
  return r >= 1 ? "no_ritmo" : r >= 0.8 ? "perto" : "atras";
}

/** Verba: no ritmo dentro de ±10% do esperado, perto até ±25%, fora disso atrás (a mesma régua das metas de verba). */
function ritmoDaVerba(gasto: number, esperado: number): Ritmo {
  if (esperado <= 0) return "sem_ritmo";
  const d = Math.abs(gasto / esperado - 1);
  return d <= 0.1 ? "no_ritmo" : d <= 0.25 ? "perto" : "atras";
}

export function montarPainelLive(e: EntradaPainelLive): PainelLive {
  const { data, cfg, expediente, range, hoje, agora } = e;
  const porLead = eventosPorLead(e.eventos);
  const inscritos = data.leads.filter((l) => ehInscritoDaLive(l, cfg) && dentro(l.createdAt.slice(0, 10), range.de, range.ate));
  const classe = (l: Lead) => classeDoLead(l);
  const qualificados = inscritos.filter((l) => classe(l) === "A" || classe(l) === "B");

  // Ritmo: dias de captação decorridos ÷ dias da captação.
  const totalCaptacao = diasEntre(cfg.captacao.de, cfg.captacao.ate);
  const decorridos = hoje < cfg.captacao.de ? 0 : Math.min(totalCaptacao, diasEntre(cfg.captacao.de, hoje < cfg.captacao.ate ? hoje : cfg.captacao.ate));
  const fracao = totalCaptacao > 0 ? decorridos / totalCaptacao : 0;
  const esperado = (meta: number) => Math.round(meta * fracao * 10) / 10;

  const agendaram = inscritos.filter((l) => l.bookedAt || ["agendado", "no_show", "reuniao_realizada", "cliente"].includes(l.status));
  const realizaram = inscritos.filter((l) => l.attendedAt || l.status === "reuniao_realizada" || l.status === "cliente");
  const clientesNoPainel = inscritos.filter((l) => l.closedAt || l.status === "cliente").length;
  const m = cfg.manuais;

  const metas: LinhaDeMeta[] = [
    { id: "inscricoes", rotulo: "Inscrições", valor: inscritos.length, meta: cfg.metas.inscricoes, esperado: esperado(cfg.metas.inscricoes), ritmo: "sem_ritmo" },
    { id: "qualificados", rotulo: "Qualificados (A e B)", valor: qualificados.length, meta: cfg.metas.qualificados, esperado: esperado(cfg.metas.qualificados), ritmo: "sem_ritmo" },
    { id: "comunidade", rotulo: "Na comunidade", valor: inscritos.filter((l) => l.comunidadeEm).length, meta: cfg.metas.comunidade, esperado: esperado(cfg.metas.comunidade), ritmo: "sem_ritmo" },
    {
      id: "presentes",
      rotulo: "Presentes na live",
      valor: m.presentesTotal ?? null,
      meta: cfg.metas.presentes,
      esperado: null,
      ritmo: "sem_ritmo",
      nota: m.presentesPico != null ? `pico de ${formatInt(m.presentesPico)} ao mesmo tempo` : "digitado depois da live",
    },
    { id: "agendadas", rotulo: "Reuniões agendadas", valor: agendaram.length, meta: cfg.metas.agendadas, esperado: esperado(cfg.metas.agendadas), ritmo: "sem_ritmo", nota: "dos inscritos do período, em qualquer data" },
    { id: "realizadas", rotulo: "Reuniões realizadas", valor: realizaram.length, meta: cfg.metas.realizadas, esperado: esperado(cfg.metas.realizadas), ritmo: "sem_ritmo" },
    {
      id: "vendas",
      rotulo: "Vendas",
      valor: m.vendasQtd ?? null,
      meta: cfg.metas.vendas,
      esperado: null,
      ritmo: "sem_ritmo",
      nota: [
        m.vendasValor != null ? `${formatCurrency0(m.vendasValor)} em carta` : undefined,
        clientesNoPainel ? `${formatInt(clientesNoPainel)} marcado(s) como cliente no painel` : undefined,
      ]
        .filter(Boolean)
        .join(" · ") || "digitado à mão",
    },
  ];
  for (const l of metas) l.ritmo = ritmoDe(l.valor, l.esperado);

  // ---------------------------------------------------------------- atendimento
  const ms = Date.parse(agora);
  const daClasse = (c: "A" | "B") => inscritos.filter((l) => classe(l) === c);
  /** 1ª tentativa dentro do prazo da classe: base = quem já teve tentativa ou já passou do prazo. */
  const noPrazo = (c: "A" | "B") => {
    let base = 0;
    let ok = 0;
    for (const l of daClasse(c)) {
      const prazo = prazoDaPrimeiraTentativa({ createdAt: l.createdAt, classe: c, horarioPreferido: l.horarioPreferido }, expediente);
      if (!prazo) continue;
      if (l.firstContactAt) {
        base += 1;
        if (l.firstContactAt <= prazo) ok += 1;
      } else if (Date.parse(prazo) < ms) {
        base += 1;
      }
    }
    return { base, ok };
  };
  const a = noPrazo("A");
  const b = noPrazo("B");

  // Contato válido em 48 h (A e B): base = janela fechada ou contato já feito.
  let base48 = 0;
  let validos48 = 0;
  for (const l of qualificados) {
    const fim = fimDaJanelaDeContato(l.createdAt, expediente);
    const valido = tentativasDoLead(porLead.get(l.id) ?? []).some(
      (t) => (t.resultado ? RESULTADOS_VALIDOS.includes(t.resultado) : t.falou) && t.em <= fim,
    );
    if (valido) {
      base48 += 1;
      validos48 += 1;
    } else if (Date.parse(fim) < ms) {
      base48 += 1;
    }
  }

  const comMsg = inscritos.filter((l) => l.msg1EnviadaEm && l.msg1Status !== "falhou").length;
  const taxa = (id: string, rotulo: string, ok: number, n: number, meta: number, nota?: string): Taxa => {
    const valor = n > 0 ? ok / n : null;
    return { id, rotulo, valor, n, meta, ok: valor == null ? null : valor >= meta, nota };
  };
  const atendimento: Taxa[] = [
    taxa("msg", "Com mensagem automática", comMsg, inscritos.length, cfg.atendimento.msgAutomatica),
    taxa("a1h", "A chamados em até 1 h útil", a.ok, a.base, cfg.atendimento.aNoPrazo, "1ª tentativa até o prazo do A (1 h do turno, ou o horário escolhido)"),
    taxa("bdia", "B chamados no mesmo dia", b.ok, b.base, cfg.atendimento.bNoPrazo, "1ª tentativa até o fim do turno do dia"),
    taxa("c48", "Contato válido em 48 h", validos48, base48, cfg.atendimento.contatoValido48h, "A e B que falaram em até 48 h da inscrição"),
  ];

  const aSemTentativa = daClasse("A").filter((l) => {
    if (l.status !== "lead") return false;
    const prazo = prazoDaPrimeiraTentativa({ createdAt: l.createdAt, classe: "A", horarioPreferido: l.horarioPreferido }, expediente);
    return Boolean(prazo && Date.parse(prazo) < ms);
  }).length;

  const reunioes: Record<StatusReuniao, number> = { agendada: 0, confirmada: 0, realizada: 0, nao_compareceu: 0, remarcar: 0 };
  for (const l of inscritos) {
    const s = statusReuniao(l);
    if (s) reunioes[s] += 1;
  }

  // ---------------------------------------------------------------- verba
  const linhasDaLive = data.adDaily
    .map((r) => ({ r, linha: linhaDaCampanha(r, cfg) }))
    .filter((x): x is { r: AdDaily; linha: NonNullable<ReturnType<typeof linhaDaCampanha>> } => Boolean(x.linha));
  const verba: LinhaDeVerbaNoPainel[] = cfg.linhas.map((l) => {
    const rows = linhasDaLive.filter((x) => x.linha.id === l.id && dentro(x.r.date, l.de, l.ate) && x.r.date <= hoje);
    const dias = diasEntre(l.de, l.ate);
    const porDia = l.porDia ?? (dias > 0 ? l.verba / dias : 0);
    const passados = hoje < l.de ? 0 : Math.min(dias, diasEntre(l.de, hoje < l.ate ? hoje : l.ate));
    const esperadoAteHoje = Math.min(l.verba, porDia * passados);
    const gasto = rows.reduce((s, x) => s + x.r.spend, 0);
    return {
      id: l.id,
      rotulo: l.rotulo,
      de: l.de,
      ate: l.ate,
      verba: l.verba,
      gasto,
      esperado: esperadoAteHoje,
      porDia,
      campanhas: l.campanhas,
      campanhasEncontradas: new Set(rows.map((x) => x.r.campaignId ?? x.r.campaign)).size,
      ritmo: ritmoDaVerba(gasto, esperadoAteHoje),
    };
  });

  // Gasto por dia da captação contra o ritmo, e o conjunto do carro a partir da data dele.
  const captacao = cfg.linhas.find((l) => l.id === "captacao")!;
  const alvoCaptacao = verba.find((v) => v.id === "captacao")!.porDia;
  const dias: DiaDeVerba[] = [];
  for (let d = captacao.de; d <= captacao.ate && d <= hoje; d = somaDias(d, 1)) {
    const doDia = linhasDaLive.filter((x) => x.linha.id === "captacao" && x.r.date === d);
    const carro = d >= cfg.carro.desde ? doDia.filter((x) => ehDoCarro(x.r, cfg)) : [];
    dias.push({
      date: d,
      gasto: doDia.reduce((s, x) => s + x.r.spend, 0),
      alvo: alvoCaptacao,
      carro: d >= cfg.carro.desde ? { gasto: carro.reduce((s, x) => s + x.r.spend, 0), alvo: cfg.carro.porDia } : undefined,
    });
  }

  // ---------------------------------------------------------------- custos (no recorte)
  const noRecorte = linhasDaLive.filter((x) => dentro(x.r.date, range.de, range.ate));
  const gastoCaptacao = noRecorte.filter((x) => x.linha.id === "captacao").reduce((s, x) => s + x.r.spend, 0);
  const gastoLive = noRecorte.reduce((s, x) => s + x.r.spend, 0);
  const razao = (gasto: number, n: number) => (gasto > 0 && n > 0 ? gasto / n : null);
  const porInscrito = razao(gastoCaptacao, inscritos.length);
  const porQualificado = razao(gastoCaptacao, qualificados.length);
  const porReuniao = agendaram.length >= MIN_REUNIOES ? razao(gastoLive, agendaram.length) : null;
  const semGasto = "sem gasto das campanhas da live no período";
  const custos = {
    gastoCaptacao,
    gastoLive,
    porInscrito: {
      valor: porInscrito,
      texto: porInscrito != null ? formatCurrency0(porInscrito) : gastoCaptacao === 0 ? `— (${semGasto})` : "— (nenhuma inscrição)",
    },
    porQualificado: {
      valor: porQualificado,
      texto: porQualificado != null ? formatCurrency0(porQualificado) : gastoCaptacao === 0 ? `— (${semGasto})` : "— (nenhum qualificado)",
      ok: porQualificado == null ? null : porQualificado <= cfg.custos.porQualificadoMax,
    },
    porReuniao: {
      valor: porReuniao,
      // Abaixo da régua única, o custo por reunião é FATO, não razão (decisão 4.2).
      texto:
        porReuniao != null
          ? formatCurrency0(porReuniao)
          : `${formatCurrency0(gastoLive)} investidos · ${formatInt(agendaram.length)} ${agendaram.length === 1 ? "reunião" : "reuniões"}`,
    },
  };

  // ---------------------------------------------------------------- qualidade
  const comFinalidade = inscritos.filter((l) => l.finalidade);
  const quitar = comFinalidade.filter((l) => l.finalidade === "quitar_dividas").length;
  const carros = inscritos.filter((l) => l.bem === "carro" && l.faixaParcela);
  const carroParcela = carros.filter((l) => l.faixaParcela !== "ate_1500").length;
  const qtd = comFinalidade.length;
  const qualidade: Taxa[] = [
    {
      id: "quitar",
      rotulo: "Marcaram “quitar dívidas”",
      valor: qtd > 0 ? quitar / qtd : null,
      n: qtd,
      meta: cfg.qualidade.quitarDividasMax,
      teto: true,
      ok: qtd > 0 ? quitar / qtd <= cfg.qualidade.quitarDividasMax : null,
    },
    {
      id: "carro1500",
      rotulo: "Carro: parcela a partir de R$ 1.500",
      valor: carros.length > 0 ? carroParcela / carros.length : null,
      n: carros.length,
      meta: 0,
      ok: null,
      nota: "sem meta no briefing — só acompanha",
    },
  ];

  return {
    inscritos: inscritos.length,
    fracaoCaptacao: fracao,
    diasParaLive: Math.max(0, Math.ceil((Date.parse(cfg.dataDaLive) - ms) / DIA_MS)),
    metas,
    atendimento,
    aSemTentativa,
    reunioes,
    verba,
    dias,
    custos,
    qualidade,
    diagnosticos: inscritos.filter((l) => l.diagnostico).length,
    semCampanhas: linhasDaLive.length === 0,
  };
}

/** "87%" sem casas; sem base, "—". */
const pctTexto = (v: number | null) => (v == null ? "—" : `${Math.round(v * 100)}%`);

/**
 * O resumo da semana no formato que vai para o ClickUp — os mesmos números da
 * aba. `ate` é o dia do resumo (AAAA-MM-DD).
 */
export function resumoSemanalDaLive(p: PainelLive, cfg: CampanhaDaLive, ate: string): string {
  return montarResumo(p, cfg, ate).replace(/ /g, " ");
}

function montarResumo(p: PainelLive, cfg: CampanhaDaLive, ate: string): string {
  const [, mm, dd] = ate.split("-");
  const v = (id: string) => p.metas.find((m) => m.id === id)?.valor ?? 0;
  const t = (id: string) => pctTexto(p.atendimento.find((x) => x.id === id)?.valor ?? null);
  const pctMeta = (x: number) => `${Math.round(x * 100)}%`;
  const custoQ = p.custos.porQualificado.valor != null ? formatCurrency0(p.custos.porQualificado.valor) : "—";
  return [
    `Semana até ${dd}/${mm}:`,
    `Inscrições: ${formatInt(v("inscricoes"))} (meta ${formatInt(cfg.metas.inscricoes)}) · Qualificados: ${formatInt(v("qualificados"))} (meta ${formatInt(cfg.metas.qualificados)}) · Na comunidade: ${formatInt(v("comunidade"))} (meta ${formatInt(cfg.metas.comunidade)})`,
    `Diagnósticos feitos: ${formatInt(p.diagnosticos)} · Reuniões agendadas: ${formatInt(v("agendadas"))} (meta ${formatInt(cfg.metas.agendadas)})`,
    `Mensagem automática: ${t("msg")} (meta ${pctMeta(cfg.atendimento.msgAutomatica)}) · A em até 1 h útil: ${t("a1h")} (meta ${pctMeta(cfg.atendimento.aNoPrazo)}) · Contato válido 48 h: ${t("c48")} (meta ${pctMeta(cfg.atendimento.contatoValido48h)})`,
    `Gasto: ${formatCurrency0(p.custos.gastoLive)} · Custo por qualificado: ${custoQ} (meta até ${formatCurrency0(cfg.custos.porQualificadoMax)})`,
  ].join("\n");
}
