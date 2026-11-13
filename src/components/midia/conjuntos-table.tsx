"use client";

import { useMemo } from "react";
import { DataTable, type Column } from "@/components/ui/data-table";
import { formatCurrency, formatCurrency0, formatInt, formatPercent } from "@/lib/format";
import {
  COLUNAS_CONJUNTOS_CONVERSAO,
  COLUNAS_CONJUNTOS_DESCOBERTA,
  moedaOuTraco,
  prefixoDoPiso,
  textoDoCplDaLinha,
  tituloDoCabecalho,
  type ColunaMidia,
  type LinhaMidia,
  type QualidadeDaLinha,
  type Veiculacao,
} from "@/lib/midia-tela";
import { MIN_REUNIOES } from "@/lib/trust";
import type { ObjectiveBucket } from "@/lib/metrics";

/**
 * Campanhas → conjuntos (linhas expansíveis), agrupados por ID (S20). As
 * colunas vêm de `lib/midia-tela.ts` — os rótulos "Leads (painel)" e "Conversões
 * Meta (Pixel)" são definidos lá e conferidos pelo teste; aqui só se decide
 * como cada chave é desenhada. A Veiculação diz se a linha está no ar ("No ar",
 * "Último gasto em dd/mm", "Sem leitura depois de dd/mm"); as 3 colunas do robô só
 * existem com `colunasDoRobo` (a página decide, UM valor para todas as tabelas). O
 * CPL da linha só sai com 3+ leads (`textoDoCplDaLinha`, F4-D23). Com `piso` (dias
 * sem dado de gasto, K13), o Gasto, o CPL e o custo por agendada levam "≥".
 */

/** Ordenação que manda os "—" (sem denominador) para o fim. */
const ouInfinito = (v: number | null | undefined) => (v == null ? Number.POSITIVE_INFINITY : v);

/** No ar primeiro; depois, o último gasto mais recente. */
const ORDEM_DA_VEICULACAO: Record<Veiculacao["estado"], number> = { "no-ar": 0, parou: 1, "sem-leitura": 2 };
const ordemDaVeiculacao = (v: Veiculacao) => ORDEM_DA_VEICULACAO[v.estado] * 1e9 - Number((v.ultimoDia ?? "0").replace(/-/g, ""));

function Nome({ r }: { r: LinhaMidia }) {
  if (r.nivel === "campanha") {
    return (
      <span className="flex min-w-0 flex-col">
        <span className="truncate font-medium" title={r.nome}>
          {r.nome}
        </span>
        <span className="text-xs text-muted-foreground">
          {r.conjuntos?.length ?? 0} {r.conjuntos?.length === 1 ? "conjunto" : "conjuntos"}
          {r.campaignId ? "" : " · sem id (CSV)"}
        </span>
      </span>
    );
  }
  return (
    <span className="block truncate" title={`${r.campanha} › ${r.nome}${r.adsetId ? ` · id ${r.adsetId}` : ""}`}>
      {r.nome}
      {r.adsetId ? null : <span className="text-xs text-muted-foreground"> · sem id</span>}
    </span>
  );
}

function VeiculacaoCelula({ v }: { v: Veiculacao }) {
  return <span className={v.estado === "no-ar" ? "whitespace-nowrap" : "text-muted-foreground"}>{v.rotulo}</span>;
}

/** Uma célula do robô: o texto pronto ("6 de 9 · 67%"), com a dica da linha no `title` (dentro da tabela). */
function RoboCelula({ q, campo }: { q: QualidadeDaLinha | null; campo: "responderam" | "aceitaram" | "semWhatsapp" }) {
  if (!q) return <span className="text-muted-foreground">—</span>;
  return (
    <span className="whitespace-nowrap" title={q.dica}>
      {q[campo]}
    </span>
  );
}

type Render = Record<string, Pick<Column<LinhaMidia>, "render" | "sortValue" | "align" | "className">>;

/** Como cada chave é desenhada; `piso` = "≥" no que sai do gasto (Gasto, CPL, custo por agendada). */
const renderDe = (piso: boolean): Render => ({
  nome: { render: (r) => <Nome r={r} />, sortValue: (r) => r.nome, className: "max-w-[240px]" },
  veiculacao: { sortValue: (r) => ordemDaVeiculacao(r.veiculacao), render: (r) => <VeiculacaoCelula v={r.veiculacao} /> },
  spend: { align: "right", sortValue: (r) => r.spend, render: (r) => `${prefixoDoPiso(piso)}${formatCurrency0(r.spend)}` },
  impressions: { align: "right", sortValue: (r) => r.impressions, render: (r) => formatInt(r.impressions) },
  reach: { align: "right", sortValue: (r) => r.reach, render: (r) => formatInt(r.reach) },
  cpm: { align: "right", sortValue: (r) => ouInfinito(r.cpm), render: (r) => moedaOuTraco(r.cpm) },
  custoPorMilAlcancados: { align: "right", sortValue: (r) => ouInfinito(r.custoPorMilAlcancados), render: (r) => moedaOuTraco(r.custoPorMilAlcancados) },
  ctr: { align: "right", sortValue: (r) => r.ctr, render: (r) => formatPercent(r.ctr) },
  leadsPainel: { align: "right", sortValue: (r) => r.leadsPainel, render: (r) => formatInt(r.leadsPainel) },
  conversoesPixel: {
    align: "right",
    sortValue: (r) => r.conversoesPixel,
    render: (r) => <span className="text-muted-foreground">{formatInt(r.conversoesPixel)}</span>,
  },
  cplPainel: {
    align: "right",
    // O CPL que a célula esconde ("— (n = 1)") também não ordena: vai para o fim.
    sortValue: (r) => ouInfinito(r.leadsPainel >= MIN_REUNIOES ? r.cplPainel : null),
    render: (r) => {
      const t = textoDoCplDaLinha(r.spend, r.leadsPainel, { piso });
      return r.leadsPainel >= MIN_REUNIOES ? t : <span className="whitespace-nowrap text-muted-foreground">{t}</span>;
    },
  },
  agendadas: { align: "right", sortValue: (r) => r.agendadas, render: (r) => formatInt(r.agendadas) },
  custoPorAgendada: {
    align: "right",
    sortValue: (r) => ouInfinito(r.custoPorAgendada),
    render: (r) =>
      r.custoPorAgendada != null ? (
        `${prefixoDoPiso(piso)}${formatCurrency(r.custoPorAgendada)}`
      ) : (
        <span className="text-muted-foreground" title={r.agendadas > 0 ? `${formatInt(r.agendadas)} de ${MIN_REUNIOES} reuniões para virar custo` : "sem reunião agendada"}>
          — <span className="text-xs">(n = {formatInt(r.agendadas)})</span>
        </span>
      ),
  },
  pctContatoInvalido: {
    align: "right",
    sortValue: (r) => (r.pctContatoInvalido == null ? -1 : r.pctContatoInvalido),
    render: (r) => (r.pctContatoInvalido == null ? <span className="text-muted-foreground">—</span> : formatPercent(r.pctContatoInvalido)),
  },
  roboResponderam: {
    align: "right",
    sortValue: (r) => ouInfinito(r.qualidade?.valores.responderam),
    render: (r) => <RoboCelula q={r.qualidade} campo="responderam" />,
  },
  roboAceitaram: {
    align: "right",
    sortValue: (r) => ouInfinito(r.qualidade?.valores.aceitaram),
    render: (r) => <RoboCelula q={r.qualidade} campo="aceitaram" />,
  },
  roboSemWhatsapp: {
    align: "right",
    sortValue: (r) => ouInfinito(r.qualidade?.valores.semWhatsapp),
    render: (r) => <RoboCelula q={r.qualidade} campo="semWhatsapp" />,
  },
});

function colunas(defs: ColunaMidia[], render: Render): Column<LinhaMidia>[] {
  return defs
    .filter((d) => !d.secundaria)
    .map((d) => ({
      key: d.key,
      header: d.header,
      // O ⓘ do dicionário no CABEÇALHO, quando a métrica tem definição — a
      // célula fica com o título dela ("n de 3 reuniões…"), sem sobreposição.
      headerTitle: tituloDoCabecalho(d),
      sortable: true,
      // Cabeçalho quebra linha e célula mais estreita: é o que faz a tabela
      // caber no card a 1366 px sem rolagem horizontal (B13).
      headerClassName: "whitespace-normal leading-tight",
      ...render[d.key],
      className: `px-2 ${render[d.key]?.className ?? ""}`.trim(),
    }));
}

const DEFS: Record<ObjectiveBucket, ColunaMidia[]> = { conversao: COLUNAS_CONJUNTOS_CONVERSAO, descoberta: COLUNAS_CONJUNTOS_DESCOBERTA };

export function ConjuntosTable({
  linhas,
  bucket,
  colunasDoRobo = false,
  piso = false,
}: {
  linhas: LinhaMidia[];
  bucket: ObjectiveBucket;
  /** As 3 colunas "(robô)" — o MESMO valor em toda a página (`MidiaDaTela.colunasDoRobo`). */
  colunasDoRobo?: boolean;
  /** Dias sem dado de gasto (`MidiaDaTela.pisoDeGasto`, K13): "≥" no Gasto, no CPL e no custo por agendada. */
  piso?: boolean;
}) {
  const columns = useMemo(() => {
    const defs = colunasDoRobo ? DEFS[bucket] : DEFS[bucket].filter((d) => d.fonte !== "robo");
    return colunas(defs, renderDe(piso));
  }, [bucket, colunasDoRobo, piso]);
  return (
    <DataTable
      columns={columns}
      rows={linhas}
      initialSortKey="spend"
      initialSortDir="desc"
      rowKey={(r) => r.chave}
      filhas={(r) => r.conjuntos}
      expandidoInicial={linhas.length === 1 ? [linhas[0].chave] : []}
      emptyTitle={bucket === "conversao" ? "Nenhum conjunto de conversão no ar" : "Nenhuma campanha de descoberta no período"}
    />
  );
}
