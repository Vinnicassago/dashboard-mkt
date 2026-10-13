"use client";

import { DataTable, type Column } from "@/components/ui/data-table";
import { formatCurrency, formatCurrency0, formatInt, formatPercent } from "@/lib/format";
import {
  COLUNAS_CONJUNTOS_CONVERSAO,
  COLUNAS_CONJUNTOS_DESCOBERTA,
  moedaOuTraco,
  tituloDoCabecalho,
  type ColunaMidia,
  type LinhaMidia,
} from "@/lib/midia";
import { MIN_REUNIOES } from "@/lib/trust";
import type { ObjectiveBucket } from "@/lib/metrics";

/**
 * Campanhas → conjuntos (linhas expansíveis), agrupados por ID (S20). As
 * colunas vêm de `lib/midia.ts` — os rótulos "Leads (painel)" e "Conversões
 * Meta (Pixel)" são definidos lá e conferidos pelo teste; aqui só se decide
 * como cada chave é desenhada.
 */

/** Ordenação que manda os "—" (sem denominador) para o fim. */
const ouInfinito = (v: number | null) => (v == null ? Number.POSITIVE_INFINITY : v);

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

const RENDER: Record<string, Pick<Column<LinhaMidia>, "render" | "sortValue" | "align" | "className">> = {
  nome: { render: (r) => <Nome r={r} />, sortValue: (r) => r.nome, className: "max-w-[240px]" },
  spend: { align: "right", sortValue: (r) => r.spend, render: (r) => formatCurrency0(r.spend) },
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
  cplPainel: { align: "right", sortValue: (r) => ouInfinito(r.cplPainel), render: (r) => moedaOuTraco(r.cplPainel) },
  agendadas: { align: "right", sortValue: (r) => r.agendadas, render: (r) => formatInt(r.agendadas) },
  custoPorAgendada: {
    align: "right",
    sortValue: (r) => ouInfinito(r.custoPorAgendada),
    render: (r) =>
      r.custoPorAgendada != null ? (
        formatCurrency(r.custoPorAgendada)
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
};

function colunas(defs: ColunaMidia[]): Column<LinhaMidia>[] {
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
      ...RENDER[d.key],
      className: `px-2 ${RENDER[d.key].className ?? ""}`.trim(),
    }));
}

const COLUNAS: Record<ObjectiveBucket, Column<LinhaMidia>[]> = {
  conversao: colunas(COLUNAS_CONJUNTOS_CONVERSAO),
  descoberta: colunas(COLUNAS_CONJUNTOS_DESCOBERTA),
};

export function ConjuntosTable({ linhas, bucket }: { linhas: LinhaMidia[]; bucket: ObjectiveBucket }) {
  return (
    <DataTable
      columns={COLUNAS[bucket]}
      rows={linhas}
      initialSortKey="spend"
      initialSortDir="desc"
      rowKey={(r) => r.chave}
      filhas={(r) => r.conjuntos}
      expandidoInicial={linhas.length === 1 ? [linhas[0].chave] : []}
      emptyTitle={bucket === "conversao" ? "Nenhuma campanha de conversão no período" : "Nenhuma campanha de descoberta no período"}
    />
  );
}
