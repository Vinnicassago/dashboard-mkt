"use client";

import { useMemo } from "react";
import { DataTable, type Column } from "@/components/ui/data-table";
import { Badge } from "@/components/ui/badge";
import { Info } from "@/components/ui/info";
import { MiniaturaDoCriativo } from "@/components/midia/miniatura";
import { ORDEM_DO_TOM, SeloDoSinal } from "@/components/midia/selo-do-sinal";
import type { FatigueLevel, ObjectiveBucket } from "@/lib/metrics";
import { MIN_REUNIOES } from "@/lib/trust";
import { formatCurrency, formatCurrency0, formatDateShort, formatDecimal, formatInt, formatPercent } from "@/lib/format";
import {
  COLUNAS_CRIATIVOS_CONVERSAO,
  COLUNAS_CRIATIVOS_DESCOBERTA,
  moedaOuTraco,
  prefixoDoPiso,
  textoDoCplDaLinha,
  tituloDoCabecalho,
  type ColunaMidia,
  type LinhaCriativo,
  type QualidadeDaLinha,
  type Veiculacao,
} from "@/lib/midia-tela";

/**
 * Criativos agregados por `creativeId` (um criativo roda em vários anúncios),
 * com miniatura, e o detalhe por anúncio/conjunto ao expandir. As colunas
 * primárias cabem no card a 1366 px; CTR, CPC, CPM e o Pixel vão para a linha
 * expandida (B13). Na conversão, a coluna é o SINAL (`sinalDoCriativo`): o selo e,
 * na célula, o ⓘ com o motivo e a regra (K40 — o `title` não abre no toque); a
 * régua inteira fica no ⓘ do cabeçalho. Na descoberta, a Saúde (fadiga) só para
 * quem está no ar; quem não está fica com "—" na Saúde — o estado já está na coluna
 * Veiculação da MESMA linha (F4-D29: um fato uma vez). A Veiculação diz se a linha
 * está no ar; as 3 colunas do robô só com `colunasDoRobo`. Com `piso` (dias sem dado
 * de gasto, K13), o Gasto, o CPL e o custo por agendada levam "≥".
 */

const FORMATO: Record<LinhaCriativo["formato"], string> = { video: "Vídeo", carrossel: "Carrossel", imagem: "Imagem" };

// Cor SEMPRE com texto (CLAUDE.md): os tokens --status-* e o rótulo ao lado.
const SAUDE: Record<FatigueLevel, { ponto: string; texto: string; rotulo: string; ordem: number; sufixo?: string }> = {
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
  const s = SAUDE[saude.level] ?? SAUDE.novo;
  return (
    <span className={`inline-flex items-center gap-1.5 whitespace-nowrap text-sm font-medium ${s.texto}`} title={saude.reason}>
      <span aria-hidden className="size-2 shrink-0 rounded-full" style={{ background: s.ponto }} />
      {s.rotulo}
      {s.sufixo ? <span className="text-xs font-normal text-muted-foreground">{s.sufixo}</span> : null}
    </span>
  );
}

const ouInfinito = (v: number | null | undefined) => (v == null ? Number.POSITIVE_INFINITY : v);

/** No ar primeiro; depois, o último gasto mais recente. */
const ORDEM_DA_VEICULACAO: Record<Veiculacao["estado"], number> = { "no-ar": 0, parou: 1, "sem-leitura": 2 };
const ordemDaVeiculacao = (v: Veiculacao) => ORDEM_DA_VEICULACAO[v.estado] * 1e9 - Number((v.ultimoDia ?? "0").replace(/-/g, ""));

function VeiculacaoCelula({ v }: { v: Veiculacao }) {
  return <span className={v.estado === "no-ar" ? "whitespace-nowrap" : "text-muted-foreground"}>{v.rotulo}</span>;
}

function Nome({ r }: { r: LinhaCriativo }) {
  return (
    <span className="flex min-w-0 items-center gap-2.5">
      {/* `<img>` simples: a URL da Meta muda a cada sync; sem o otimizador do Next (`MiniaturaDoCriativo`). */}
      {r.nivel === "criativo" ? <MiniaturaDoCriativo url={r.thumbnailUrl ?? null} formato={r.formato} pequena /> : null}
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

/** O sinal da linha: o selo e o ⓘ com a dica (motivo, regra e robô). Sem sinal (fora do ar, a live, o anúncio), "—". */
function SinalCelula({ r }: { r: LinhaCriativo }) {
  if (!r.sinal) return <span className="text-muted-foreground">—</span>;
  return (
    <span className="inline-flex items-center">
      <SeloDoSinal rotulo={r.sinal.rotulo} tom={r.sinal.tom} />
      <Info texto={r.sinal.dica} rotulo={`Sobre o sinal de ${r.nome}`} className="-my-1" />
    </span>
  );
}

/**
 * A fadiga só se lê para quem está no ar e com leitura nas janelas dela: "Parado" e
 * "Sem dados" da fadiga não aparecem na Mídia (F4-D29) — o "no ar" é o da Veiculação.
 */
const fadigaLegivel = (r: LinhaCriativo) => r.veiculacao.estado === "no-ar" && r.saude.level !== "parado" && r.saude.level !== "sem-dados";

/**
 * A Saúde (fadiga) só para quem está no ar e com leitura nas janelas dela; nos outros,
 * "—": quem não está no ar já tem o estado na coluna Veiculação da mesma linha (F4-D29).
 */
function SaudeCelula({ r }: { r: LinhaCriativo }) {
  if (fadigaLegivel(r)) return <SaudeBadge saude={r.saude} />;
  return <span className="text-muted-foreground">—</span>;
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

type Render = Record<string, Pick<Column<LinhaCriativo>, "render" | "sortValue" | "align" | "className">>;

/** Como cada chave é desenhada; `piso` = "≥" no que sai do gasto (Gasto, CPL, custo por agendada). */
const renderDe = (piso: boolean): Render => ({
  nome: { render: (r) => <Nome r={r} />, sortValue: (r) => r.nome, className: "max-w-[260px]" },
  veiculacao: { sortValue: (r) => ordemDaVeiculacao(r.veiculacao), render: (r) => <VeiculacaoCelula v={r.veiculacao} /> },
  spend: { align: "right", sortValue: (r) => r.spend, render: (r) => `${prefixoDoPiso(piso)}${formatCurrency0(r.spend)}` },
  impressions: { align: "right", sortValue: (r) => r.impressions, render: (r) => formatInt(r.impressions) },
  reach: { align: "right", sortValue: (r) => r.reach, render: (r) => formatInt(r.reach) },
  cpm: { align: "right", sortValue: (r) => ouInfinito(r.cpm), render: (r) => moedaOuTraco(r.cpm) },
  cpc: { align: "right", sortValue: (r) => ouInfinito(r.cpc), render: (r) => moedaOuTraco(r.cpc) },
  ctr: { align: "right", sortValue: (r) => r.ctr, render: (r) => formatPercent(r.ctr) },
  custoPorMilAlcancados: { align: "right", sortValue: (r) => ouInfinito(r.custoPorMilAlcancados), render: (r) => moedaOuTraco(r.custoPorMilAlcancados) },
  leadsPainel: { align: "right", sortValue: (r) => r.leadsPainel, render: (r) => formatInt(r.leadsPainel) },
  conversoesPixel: { align: "right", sortValue: (r) => r.conversoesPixel, render: (r) => <span className="text-muted-foreground">{formatInt(r.conversoesPixel)}</span> },
  cplPainel: {
    align: "right",
    // O CPL que a célula esconde ("— (n = 1)", F4-D23) também não ordena: vai para o fim.
    sortValue: (r) => ouInfinito(r.leadsPainel >= MIN_REUNIOES ? r.cplPainel : null),
    render: (r) => {
      const t = textoDoCplDaLinha(r.spend, r.leadsPainel, { piso });
      return r.leadsPainel >= MIN_REUNIOES ? t : <span className="whitespace-nowrap text-muted-foreground">{t}</span>;
    },
  },
  cplPixel: { align: "right", sortValue: (r) => ouInfinito(r.cplPixel), render: (r) => <span className="text-muted-foreground">{moedaOuTraco(r.cplPixel)}</span> },
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
  sinal: { sortValue: (r) => ouInfinito(r.sinal ? ORDEM_DO_TOM[r.sinal.tom] : null), render: (r) => <SinalCelula r={r} /> },
  saude: {
    sortValue: (r) => (fadigaLegivel(r) ? (SAUDE[r.saude.level]?.ordem ?? 0) : -1),
    render: (r) => <SaudeCelula r={r} />,
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

type Regras = { sinal: string; fadiga: string };

function colunas(defs: ColunaMidia[], regras: Regras, render: Render): Column<LinhaCriativo>[] {
  return defs
    .filter((d) => !d.secundaria)
    .map((d) => ({
      key: d.key,
      header: d.header,
      // O ⓘ no CABEÇALHO: a régua do sinal (conversão), a da fadiga (descoberta) ou a
      // definição do dicionário. O selo de cada linha traz o motivo no ⓘ da célula.
      headerTitle: tituloDoCabecalho(d, regras),
      sortable: true,
      // Cabeçalho quebra linha e célula mais estreita: cabe a 1366 px (B13).
      headerClassName: "whitespace-normal leading-tight",
      ...render[d.key],
      className: `px-2 ${render[d.key]?.className ?? ""}`.trim(),
    }));
}

/**
 * As colunas secundárias, na linha expandida, mais a fadiga (janelas e régua) de quem
 * está no ar. A veiculação não se repete aqui: a coluna Veiculação da linha já a diz.
 */
function Detalhe({ r, defs, regras, render }: { r: LinhaCriativo; defs: ColunaMidia[]; regras: Regras; render: Render }) {
  const secundarias = defs.filter((d) => d.secundaria);
  const j = r.saude.janelas;
  const comFadiga = fadigaLegivel(r);
  return (
    <div className="space-y-2 text-xs">
      <dl className="flex flex-wrap gap-x-6 gap-y-1">
        {secundarias.map((d) => (
          <div key={d.key} className="flex items-baseline gap-1.5" title={tituloDoCabecalho(d)}>
            <dt className="text-muted-foreground">{d.header}</dt>
            <dd className="tabular font-medium text-foreground">{render[d.key]?.render(r)}</dd>
          </div>
        ))}
      </dl>
      {comFadiga ? (
        <>
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
            <span className="font-medium text-foreground">Regra:</span> {regras.fadiga}
          </p>
        </>
      ) : null}
    </div>
  );
}

export function CreativesTable({
  linhas,
  bucket,
  colunasDoRobo = false,
  piso = false,
  regras,
}: {
  linhas: LinhaCriativo[];
  bucket: ObjectiveBucket;
  /** As 3 colunas "(robô)" — o MESMO valor em toda a página (`MidiaDaTela.colunasDoRobo`). */
  colunasDoRobo?: boolean;
  /** Dias sem dado de gasto (`MidiaDaTela.pisoDeGasto`, K13): "≥" no Gasto, no CPL e no custo por agendada. */
  piso?: boolean;
  /** As réguas em palavras: `sinal` (`textoDaReguaDoSinal`) no ⓘ do cabeçalho "Sinal"; `fadiga` (`textoDaReguaDaFadiga`) no da "Saúde" e na linha expandida. */
  regras: Regras;
}) {
  const defs = useMemo(() => {
    const base = bucket === "conversao" ? COLUNAS_CRIATIVOS_CONVERSAO : COLUNAS_CRIATIVOS_DESCOBERTA;
    return colunasDoRobo ? base : base.filter((d) => d.fonte !== "robo");
  }, [bucket, colunasDoRobo]);
  const render = useMemo(() => renderDe(piso), [piso]);
  const columns = useMemo(() => colunas(defs, regras, render), [defs, regras, render]);
  return (
    <DataTable
      columns={columns}
      rows={linhas}
      initialSortKey="spend"
      initialSortDir="desc"
      rowKey={(r) => r.chave}
      filhas={(r) => (r.nivel === "criativo" && (r.anunciosDetalhe?.length ?? 0) > 1 ? r.anunciosDetalhe : undefined)}
      detalhe={(r) => <Detalhe r={r} defs={defs} regras={regras} render={render} />}
      emptyTitle={bucket === "conversao" ? "Nenhum criativo de conversão no ar" : "Sem criativos de descoberta no período"}
      // Na conversão, o vazio é "nenhum no ar" (os que pararam estão em Pausados, e a nota
      // embaixo da tabela diz quanto) — nunca "sincronize": o dado existe.
      emptyHint={bucket === "conversao" ? undefined : "Sincronize ou importe o relatório de anúncios em Configurações → Importar."}
    />
  );
}
