"use client";

import { DataTable, type Column } from "@/components/ui/data-table";
import { Badge } from "@/components/ui/badge";
import type { FatigueLevel, ObjectiveBucket } from "@/lib/metrics";
import { MIN_REUNIOES } from "@/lib/trust";
import { formatCurrency, formatCurrency0, formatDateShort, formatDecimal, formatInt, formatPercent } from "@/lib/format";
import {
  COLUNAS_CRIATIVOS_CONVERSAO,
  COLUNAS_CRIATIVOS_DESCOBERTA,
  moedaOuTraco,
  pctOuTraco,
  tituloDoCabecalho,
  type ColunaMidia,
  type LinhaCriativo,
} from "@/lib/midia";

/**
 * Criativos agregados por `creativeId` (um criativo roda em vários anúncios),
 * com miniatura, e o detalhe por anúncio/conjunto ao expandir. As colunas
 * primárias cabem no card a 1366 px; CTR, CPC, CPM, Pixel e retenção vão para
 * a linha expandida (B13). A Saúde segue a regra explícita de `computeFatigue`:
 * a REGRA fica no ⓘ do cabeçalho (`headerTitle` = `regraSaude`) e na linha
 * expandida; o selo de cada linha carrega só o MOTIVO — um `title` em volta do
 * selo seria engolido pelo título mais interno e a regra não apareceria nunca.
 */

const FORMATO: Record<LinhaCriativo["formato"], string> = { video: "Vídeo", carrossel: "Carrossel", imagem: "Imagem" };

// Cor SEMPRE com texto (CLAUDE.md): os tokens --status-* e o rótulo ao lado.
const SAUDE: Record<FatigueLevel, { ponto: string; texto: string; rotulo: string; ordem: number; sufixo?: string }> = {
  "sem-resultado": { ponto: "var(--status-fora)", texto: "text-[var(--status-fora-text)]", rotulo: "Sem resultado", ordem: 6 },
  fadigado: { ponto: "var(--status-fora)", texto: "text-[var(--status-fora-text)]", rotulo: "Fadigando", ordem: 5 },
  atencao: { ponto: "var(--status-perto)", texto: "text-[var(--status-perto-text)]", rotulo: "Atenção", ordem: 4 },
  saudavel: { ponto: "var(--status-ok)", texto: "text-[var(--status-ok-text)]", rotulo: "Saudável", ordem: 3 },
  novo: { ponto: "var(--muted)", texto: "text-muted-foreground", rotulo: "Novo", ordem: 2, sufixo: "(amostra insuficiente)" },
  // Janela vazia que nenhum sync bem-sucedido cobriu (ADR-06): não se afirma
  // "sem veiculação" — pode ter havido gasto que o painel não viu.
  "sem-dados": { ponto: "var(--muted)", texto: "text-muted-foreground", rotulo: "Sem dados", ordem: 1, sufixo: "(sincronização sem cobertura)" },
  // Pausado: não é "Novo" — teve veiculação e um sync confirmou que não tem mais.
  parado: { ponto: "var(--muted)", texto: "text-muted-foreground", rotulo: "Parado", ordem: 0, sufixo: "(sem veiculação)" },
};

export function SaudeBadge({ saude }: { saude: LinhaCriativo["saude"] }) {
  const s = SAUDE[saude.level];
  return (
    <span className={`inline-flex items-center gap-1.5 whitespace-nowrap text-sm font-medium ${s.texto}`} title={saude.reason}>
      <span aria-hidden className="size-2 shrink-0 rounded-full" style={{ background: s.ponto }} />
      {s.rotulo}
      {s.sufixo ? <span className="text-xs font-normal text-muted-foreground">{s.sufixo}</span> : null}
    </span>
  );
}

const ouInfinito = (v: number | null | undefined) => (v == null ? Number.POSITIVE_INFINITY : v);
const ouMenosUm = (v: number | null | undefined) => (v == null ? -1 : v);

function Miniatura({ r }: { r: LinhaCriativo }) {
  if (r.thumbnailUrl) {
    // Miniatura da Meta (URL externa, muda a cada sync): <img> simples, sem o
    // otimizador do Next — remotePatterns moram em next.config.ts.
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={r.thumbnailUrl} alt="" loading="lazy" className="size-10 shrink-0 rounded-md border object-cover" />;
  }
  return (
    <span className="flex size-10 shrink-0 items-center justify-center rounded-md border bg-foreground/[0.03] text-[10px] uppercase text-muted-foreground" aria-hidden>
      {FORMATO[r.formato].slice(0, 3)}
    </span>
  );
}

function Nome({ r }: { r: LinhaCriativo }) {
  return (
    <span className="flex min-w-0 items-center gap-2.5">
      {r.nivel === "criativo" ? <Miniatura r={r} /> : null}
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className="truncate font-medium" title={r.nome}>
          {r.nome}
        </span>
        <span className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
          <Badge variant="muted">{FORMATO[r.formato]}</Badge>
          {r.nivel === "criativo" ? (
            <span className="truncate">
              {r.anuncios === 1 ? "1 anúncio" : `${r.anuncios} anúncios`}
              {r.creativeId ? "" : " · sem id de criativo"}
            </span>
          ) : (
            <span className="truncate" title={`${r.campanha ?? ""} › ${r.conjunto ?? ""}`}>
              {r.conjunto}
            </span>
          )}
          {r.ambiguos > 0 ? (
            <span
              className="whitespace-nowrap text-[var(--warning-text)]"
              title={`${formatInt(r.ambiguos)} ${r.ambiguos === 1 ? "lead do período chegou" : "leads do período chegaram"} com um NOME que existe em mais de um anúncio — sem o id não dá para saber qual trouxe; não entram em nenhum criativo.`}
            >
              atribuição ambígua ({formatInt(r.ambiguos)})
            </span>
          ) : null}
        </span>
      </span>
    </span>
  );
}

const RENDER: Record<string, Pick<Column<LinhaCriativo>, "render" | "sortValue" | "align" | "className">> = {
  nome: { render: (r) => <Nome r={r} />, sortValue: (r) => r.nome, className: "max-w-[260px]" },
  spend: { align: "right", sortValue: (r) => r.spend, render: (r) => formatCurrency0(r.spend) },
  impressions: { align: "right", sortValue: (r) => r.impressions, render: (r) => formatInt(r.impressions) },
  reach: { align: "right", sortValue: (r) => r.reach, render: (r) => formatInt(r.reach) },
  cpm: { align: "right", sortValue: (r) => ouInfinito(r.cpm), render: (r) => moedaOuTraco(r.cpm) },
  cpc: { align: "right", sortValue: (r) => ouInfinito(r.cpc), render: (r) => moedaOuTraco(r.cpc) },
  ctr: { align: "right", sortValue: (r) => r.ctr, render: (r) => formatPercent(r.ctr) },
  custoPorMilAlcancados: { align: "right", sortValue: (r) => ouInfinito(r.custoPorMilAlcancados), render: (r) => moedaOuTraco(r.custoPorMilAlcancados) },
  leadsPainel: { align: "right", sortValue: (r) => r.leadsPainel, render: (r) => formatInt(r.leadsPainel) },
  conversoesPixel: { align: "right", sortValue: (r) => r.conversoesPixel, render: (r) => <span className="text-muted-foreground">{formatInt(r.conversoesPixel)}</span> },
  cplPainel: { align: "right", sortValue: (r) => ouInfinito(r.cplPainel), render: (r) => moedaOuTraco(r.cplPainel) },
  cplPixel: { align: "right", sortValue: (r) => ouInfinito(r.cplPixel), render: (r) => <span className="text-muted-foreground">{moedaOuTraco(r.cplPixel)}</span> },
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
  hookRate: { align: "right", sortValue: (r) => ouMenosUm(r.hookRate), render: (r) => pctOuTraco(r.hookRate) },
  holdRate: { align: "right", sortValue: (r) => ouMenosUm(r.holdRate), render: (r) => pctOuTraco(r.holdRate) },
  saude: { sortValue: (r) => SAUDE[r.saude.level].ordem, render: (r) => <SaudeBadge saude={r.saude} /> },
};

function colunas(defs: ColunaMidia[], regraSaude: string): Column<LinhaCriativo>[] {
  return defs
    .filter((d) => !d.secundaria)
    .map((d) => ({
      key: d.key,
      header: d.header,
      // O ⓘ no CABEÇALHO: a regra da saúde ou a definição do dicionário. A
      // célula não ganha `title` por cima — o selo já traz o motivo, e o custo
      // por agendada traz o "n de 3"; um título externo seria engolido por eles.
      headerTitle: tituloDoCabecalho(d, regraSaude),
      sortable: true,
      // Cabeçalho quebra linha e célula mais estreita: cabe a 1366 px (B13).
      headerClassName: "whitespace-normal leading-tight",
      ...RENDER[d.key],
      className: `px-2 ${RENDER[d.key].className ?? ""}`.trim(),
    }));
}

/** As colunas secundárias, na linha expandida, mais as janelas e a regra da saúde. */
function Detalhe({ r, defs, regraSaude }: { r: LinhaCriativo; defs: ColunaMidia[]; regraSaude: string }) {
  const secundarias = defs.filter((d) => d.secundaria);
  const j = r.saude.janelas;
  return (
    <div className="space-y-2 text-xs">
      <dl className="flex flex-wrap gap-x-6 gap-y-1">
        {secundarias.map((d) => (
          <div key={d.key} className="flex items-baseline gap-1.5" title={tituloDoCabecalho(d)}>
            <dt className="text-muted-foreground">{d.header}</dt>
            <dd className="tabular font-medium text-foreground">{RENDER[d.key].render(r)}</dd>
          </div>
        ))}
      </dl>
      <p className="text-muted-foreground">
        <span className="font-medium text-foreground">Saúde:</span> {r.saude.reason}
        {j ? (
          <>
            {" "}
            · janelas {formatDateShort(j.recente.from)}–{formatDateShort(j.recente.to)} ({formatInt(j.recente.impressions)} impr., CTR {formatPercent(j.recente.ctr)}, freq.{" "}
            {formatDecimal(j.recente.frequency, 1)}) vs {formatDateShort(j.anterior.from)}–{formatDateShort(j.anterior.to)} ({formatInt(j.anterior.impressions)} impr., CTR{" "}
            {formatPercent(j.anterior.ctr)})
          </>
        ) : null}
      </p>
      {/* A régua inteira, para quem não passa o mouse no cabeçalho (B17). */}
      <p className="text-muted-foreground">
        <span className="font-medium text-foreground">Regra:</span> {regraSaude}
      </p>
    </div>
  );
}

export function CreativesTable({
  linhas,
  bucket,
  regraSaude,
}: {
  linhas: LinhaCriativo[];
  bucket: ObjectiveBucket;
  /** A regra da saúde em palavras (`textoRegraSaude`) — o ⓘ do cabeçalho “Saúde” e a linha expandida. */
  regraSaude: string;
}) {
  const defs = bucket === "conversao" ? COLUNAS_CRIATIVOS_CONVERSAO : COLUNAS_CRIATIVOS_DESCOBERTA;
  return (
    <DataTable
      columns={colunas(defs, regraSaude)}
      rows={linhas}
      initialSortKey="spend"
      initialSortDir="desc"
      rowKey={(r) => r.chave}
      filhas={(r) => (r.nivel === "criativo" && (r.anunciosDetalhe?.length ?? 0) > 1 ? r.anunciosDetalhe : undefined)}
      detalhe={(r) => <Detalhe r={r} defs={defs} regraSaude={regraSaude} />}
      emptyTitle="Sem criativos no período"
      emptyHint="Sincronize ou importe o relatório de anúncios em Configurações → Importar."
    />
  );
}
