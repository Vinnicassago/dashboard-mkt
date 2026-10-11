import Link from "next/link";
import { AlertTriangle, Award, Radio, TrendingUp } from "lucide-react";
import { ResumoMidiaCard } from "@/components/midia/resumo-midia";
import { TendenciaSemanal } from "@/components/midia/tendencia-semanal";
import { ConjuntosTable } from "@/components/midia/conjuntos-table";
import { CreativesTable } from "@/components/tables/creatives-table";
import { BarrasDiarias } from "@/components/charts/barras-diarias";
import { ChartCard } from "@/components/ui/chart-card";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getData } from "@/lib/data/store";
import { activeBrandSlug } from "@/lib/active-brand";
import { pageRange } from "@/lib/page-range";
import { dailySeries, trechosSemDado, trechosSemVeiculacao } from "@/lib/metrics";
import { resolveMetaBrands } from "@/lib/meta/config";
import { custoExibivel, kpisDoPeriodo, reguaDoPeriodo } from "@/lib/kpis";
import {
  SEMANAS_DA_TENDENCIA,
  amostraDoRanking,
  conjuntosPorId,
  cplAlvoDaMidia,
  criativosAgregados,
  descobertaDaMidia,
  moedaOuTraco,
  rankingsDeCriativos,
  resumoDaMidia,
  tendenciaSemanalMidia,
  textoRegraSaude,
  VOLUME_MINIMO_RANKING,
  type NaoAtribuidos,
} from "@/lib/midia";
import { comPeriodo, hojeEmBrasilia } from "@/lib/range";
import { dica } from "@/lib/dicionario";
import { coberturaDeAnuncios } from "@/lib/sincronizacao";
import { alertasDeAtribuicao, alertasDeConfianca } from "@/lib/alertas";
import { RegistrarAlertas } from "@/components/layout/alertas";
import { MIN_REUNIOES } from "@/lib/trust";
import { formatCurrency0, formatInt, formatIntComSinal, formatPercent } from "@/lib/format";

export const dynamic = "force-dynamic";

/**
 * Mídia — "onde a verba vira reunião, e o que escalar ou pausar?" (relatório
 * §7.3). A ordem da página é a da pergunta: o resumo responde no primeiro
 * viewport; a tendência diz se está melhorando; campanhas → conjuntos dizem
 * ONDE; criativos dizem O QUÊ escalar ou pausar; descoberta e o gráfico diário
 * fecham. Toda conta mora em `lib/midia.ts` (puro) e lê `kpisDoPeriodo` — o
 * CPL daqui é o da Bússola.
 */
export default async function MidiaPage({ searchParams }: { searchParams: Promise<{ range?: string }> }) {
  const brand = await activeBrandSlug();
  const data = await getData(brand);
  const { range, rangeKey } = pageRange(data, (await searchParams).range);
  const [cobertura, brandRules] = await Promise.all([coberturaDeAnuncios(brand), resolveMetaBrands()]);
  const hoje = hojeEmBrasilia();
  const fim = range?.to ?? hoje;

  const kp = kpisDoPeriodo(data, range, { brandRules, cobertura, hoje });
  const regua = reguaDoPeriodo(kp, data, range, hoje);
  const resumo = resumoDaMidia(kp, regua);
  const cprExibivel = custoExibivel(kp.custoPorReuniao);

  const tendencia = tendenciaSemanalMidia(data, { fim, hoje, kpis: { brandRules, cobertura } });
  const conjuntos = conjuntosPorId(data, range, { custoPorReuniaoExibivel: cprExibivel });
  const cplAlvo = cplAlvoDaMidia(data, kp, fim);
  const criativos = criativosAgregados(data, range, { fim: range?.to, cplAlvo: cplAlvo.alvo, custoPorReuniaoExibivel: cprExibivel });
  const regraSaude = textoRegraSaude(cplAlvo);
  const ranking = rankingsDeCriativos(criativos.conversao);
  const fadigados = [...criativos.conversao, ...criativos.descoberta].filter((c) => c.saude.level === "fadigado");
  const semResultado = criativos.conversao.filter((c) => c.saude.level === "sem-resultado");
  const descoberta = descobertaDaMidia(kp);

  const serie = dailySeries(data, range, cobertura);
  const faixas = [
    ...trechosSemVeiculacao(serie).map((t) => ({ ...t, tom: "pausa" as const })),
    ...trechosSemDado(serie).map((t) => ({ ...t, tom: "falha" as const })),
  ];

  return (
    <div className="space-y-6">
      <RegistrarAlertas alertas={[...alertasDeConfianca(kp.trust.travas), ...alertasDeAtribuicao(data, range)]} />

      {/* 1. RESUMO — a resposta, no primeiro viewport. */}
      <ResumoMidiaCard resumo={resumo} rangeKey={rangeKey} />

      {/* 2. TENDÊNCIA SEMANAL — gasto, leads e CPL por semana. */}
      <ChartCard
        title="Tendência semanal"
        description={`Gasto (barras), leads do painel (linha) e CPL (tracejado, valor escrito) por semana de segunda a domingo, nas últimas ${SEMANAS_DA_TENDENCIA} semanas até o fim do período. A semana em curso sai vazada; o CPL some quando não se sustenta.`}
      >
        <TendenciaSemanal pontos={tendencia} />
      </ChartCard>

      {/* 3. CAMPANHAS → CONJUNTOS — conversão e descoberta em blocos separados. */}
      <Card id="conjuntos" className="scroll-mt-24">
        <CardHeader>
          <CardTitle>Campanhas e conjuntos de conversão</CardTitle>
          <CardDescription>
            Onde a verba vira reunião. Agrupado pelo id da Meta — dois conjuntos com o mesmo nome em campanhas diferentes são duas linhas.{" "}
            {cprExibivel
              ? `O custo por agendada aparece só com ${MIN_REUNIOES} reuniões ou mais na linha.`
              : `O custo por agendada fica em “—” até ${MIN_REUNIOES} reuniões de conversão no período (hoje ${formatInt(kp.reunioesConversao.valor)}).`}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <ConjuntosTable linhas={conjuntos.conversao} bucket="conversao" />
          <NotaNaoAtribuidos n={conjuntos.naoAtribuidos} rangeKey={rangeKey} />
        </CardContent>
      </Card>

      {conjuntos.descoberta.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Campanhas e conjuntos de descoberta</CardTitle>
            <CardDescription>
              Alcance, engajamento e seguidores: não geram lead, então não têm CPL nem custo por reunião. O alcance é somado por anúncio e por dia (conta a mesma pessoa mais de uma vez).
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ConjuntosTable linhas={conjuntos.descoberta} bucket="descoberta" />
          </CardContent>
        </Card>
      ) : null}

      {/* 4. CRIATIVOS — o que escalar e o que pausar. */}
      <section id="criativos" className="scroll-mt-24 space-y-4">
        <div className="space-y-1">
          <h2 className="text-base font-semibold">Criativos: o que escalar e o que pausar</h2>
          <p className="text-sm text-muted-foreground">
            Agregados por criativo (o mesmo criativo roda em vários conjuntos); expanda para ver anúncio a anúncio, CTR, CPC e o número do Pixel.
          </p>
        </div>

        {fadigados.length > 0 || semResultado.length > 0 ? (
          <div className="flex items-start gap-2.5 rounded-xl border border-[var(--status-fora)]/30 bg-[var(--status-fora)]/[0.04] px-4 py-3 text-sm">
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-[var(--status-fora-text)]" />
            <div className="space-y-0.5 text-muted-foreground">
              {fadigados.length > 0 ? (
                <p>
                  <span className="font-medium text-foreground">{fadigados.length === 1 ? "1 criativo fadigando:" : `${fadigados.length} criativos fadigando:`}</span>{" "}
                  {fadigados.map((c) => c.nome).join(", ")}. Renove a arte antes que o custo dispare.
                </p>
              ) : null}
              {semResultado.length > 0 ? (
                <p>
                  <span className="font-medium text-foreground">{semResultado.length === 1 ? "1 criativo sem resultado:" : `${semResultado.length} criativos sem resultado:`}</span>{" "}
                  {semResultado.map((c) => `${c.nome} (${formatCurrency0(c.spend)})`).join(", ")} — gasto de pelo menos 2 × o CPL alvo e nenhum lead do painel.
                </p>
              ) : null}
            </div>
          </div>
        ) : null}

        <div className="grid gap-4 sm:grid-cols-2">
          <Card>
            <CardContent className="flex items-center gap-4 p-5">
              <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-[var(--status-ok)]/12 text-[var(--status-ok-text)]">
                <Award className="size-5" />
              </div>
              <div className="min-w-0">
                <p className="text-xs text-muted-foreground" title={dica("cpl")}>
                  Melhor CPL (painel)
                </p>
                {ranking.melhorCpl ? (
                  <>
                    <p className="truncate font-semibold">{ranking.melhorCpl.nome}</p>
                    <p className="text-sm text-muted-foreground">
                      {moedaOuTraco(ranking.melhorCpl.cplPainel)} por lead · {formatInt(ranking.melhorCpl.agendadas)}{" "}
                      {ranking.melhorCpl.agendadas === 1 ? "agendada" : "agendadas"}
                    </p>
                    <p className="text-xs text-muted-foreground">{amostraDoRanking(ranking.melhorCpl)}</p>
                  </>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    Nenhum criativo com volume mínimo (≥ {VOLUME_MINIMO_RANKING.leads} leads do painel ou ≥ {formatCurrency0(VOLUME_MINIMO_RANKING.gasto)}) e lead no período.
                  </p>
                )}
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="flex items-center gap-4 p-5">
              <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <TrendingUp className="size-5" />
              </div>
              <div className="min-w-0">
                <p className="text-xs text-muted-foreground">Maior CTR</p>
                {ranking.maiorCtr ? (
                  <>
                    <p className="truncate font-semibold">{ranking.maiorCtr.nome}</p>
                    <p className="text-sm text-muted-foreground">{formatPercent(ranking.maiorCtr.ctr)} de cliques</p>
                    <p className="text-xs text-muted-foreground">{amostraDoRanking(ranking.maiorCtr)}</p>
                  </>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    Nenhum criativo com volume mínimo (≥ {VOLUME_MINIMO_RANKING.leads} leads do painel ou ≥ {formatCurrency0(VOLUME_MINIMO_RANKING.gasto)}).
                  </p>
                )}
                {ranking.descartados > 0 ? (
                  <p className="pt-0.5 text-xs text-muted-foreground">
                    {ranking.descartados === 1 ? "1 criativo fora dos rankings por volume baixo." : `${ranking.descartados} criativos fora dos rankings por volume baixo.`}
                  </p>
                ) : null}
              </div>
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Criativos de conversão</CardTitle>
            <CardDescription>
              Leads e reuniões só pelo id do anúncio (o link padrão traz “{"{{ad.id}}"}”); nome que existe em mais de um anúncio aparece como atribuição ambígua e não entra em ninguém. Passe o mouse em “Saúde” para ver a regra.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <CreativesTable linhas={criativos.conversao} bucket="conversao" regraSaude={regraSaude} />
          </CardContent>
        </Card>

        {criativos.descoberta.length > 0 ? (
          <Card>
            <CardHeader>
              <CardTitle>Criativos de descoberta</CardTitle>
              <CardDescription>Julgados por CPM, gancho e retenção — não por leads.</CardDescription>
            </CardHeader>
            <CardContent>
              <CreativesTable linhas={criativos.descoberta} bucket="descoberta" regraSaude={regraSaude} />
            </CardContent>
          </Card>
        ) : null}
      </section>

      {/* 5. DESCOBERTA — alcance, CPM, custo por mil alcançados, seguidores estimados. */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Radio className="size-4 text-muted-foreground" />
            Descoberta — alcance e seguidores
          </CardTitle>
        </CardHeader>
        <CardContent>
          {descoberta.temDescoberta ? (
            <div className="space-y-3">
              <dl className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3 lg:grid-cols-6">
                <Stat rotulo="Investimento" valor={formatCurrency0(descoberta.investimento)} dica={dica("investimento_descoberta")} />
                <Stat rotulo="Alcance somado por anúncio e por dia" valor={formatInt(descoberta.alcanceSomado)} dica="Soma do alcance diário de cada anúncio: conta a mesma pessoa mais de uma vez. Não é o alcance único do período." />
                <Stat rotulo="CPM" valor={moedaOuTraco(descoberta.cpm)} />
                <Stat rotulo="Custo / mil alcançados" valor={moedaOuTraco(descoberta.custoPorMilAlcancados)} dica="Gasto em descoberta ÷ alcance somado × 1.000 — como o alcance é somado, é um piso." />
                <Stat rotulo="Seguidores no período" valor={formatIntComSinal(descoberta.seguidores)} />
                <Stat rotulo="Custo / seguidor (est.)" valor={moedaOuTraco(descoberta.custoPorSeguidorEst)} destaque />
              </dl>
              <p className="text-xs text-muted-foreground">
                Estimativa: seguidores são da conta (orgânico + pago); a Meta não atribui seguidores por anúncio. O alcance acima é a soma diária por anúncio (conta a mesma pessoa mais de uma vez) — não é alcance único.
              </p>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">Nenhum anúncio de descoberta no período. Todo o orçamento foi para conversão.</p>
          )}
        </CardContent>
      </Card>

      {/* 6. GRÁFICO DIÁRIO — barras, eixo linear, lacunas e pausas marcadas (B12). */}
      <ChartCard
        title="Investimento por dia"
        description="Uma barra por dia, todo dia do período no eixo. Faixa cinza “pausado” = um sync confirmou que não houve veiculação. Hachura âmbar “sem dados” = nenhuma sincronização cobriu o dia: pode ter havido gasto que o painel não viu."
      >
        <BarrasDiarias
          dados={serie.map((p) => ({ date: p.date, valor: p.spend, semDado: p.semDado, semVeiculacao: p.semVeiculacao }))}
          faixas={faixas}
          valueFormat="currency"
          yFormat="currency0"
        />
      </ChartCard>
    </div>
  );
}

function Stat({ rotulo, valor, dica: titulo, destaque }: { rotulo: string; valor: string; dica?: string; destaque?: boolean }) {
  return (
    <div className="min-w-0" title={titulo}>
      <dt className="text-xs text-muted-foreground">{rotulo}</dt>
      <dd className={`tabular text-lg font-semibold ${destaque ? "text-primary" : ""}`}>{valor}</dd>
    </div>
  );
}

/** Leads do período que não entraram em nenhuma linha, e por quê. */
function NotaNaoAtribuidos({ n, rangeKey }: { n: NaoAtribuidos; rangeKey?: string }) {
  const partes: string[] = [];
  if (n.ambigua > 0) partes.push(`${formatInt(n.ambigua)} com nome ambíguo`);
  if (n.macro > 0) partes.push(`${formatInt(n.macro)} com macro {{…}} sem resolver`);
  if (n.desconhecida > 0) partes.push(`${formatInt(n.desconhecida)} com origem desconhecida`);
  if (n.semOrigem > 0) partes.push(`${formatInt(n.semOrigem)} sem origem (orgânico ou direto)`);
  if (n.semLinhaNoPeriodo > 0) partes.push(`${formatInt(n.semLinhaNoPeriodo)} de conjunto sem veiculação no período`);
  if (partes.length === 0) return null;
  return (
    <p className="text-xs text-muted-foreground">
      Fora das linhas: {partes.join(" · ")}. Esses leads contam no total, mas não no custo por conjunto.{" "}
      {n.ambigua > 0 || n.macro > 0 ? (
        <Link href={comPeriodo("/configuracoes/ferramentas#utm", rangeKey)} className="text-primary underline-offset-4 hover:underline">
          Gerar o link com {"{{ad.id}}"} →
        </Link>
      ) : null}
    </p>
  );
}
