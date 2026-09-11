import Link from "next/link";
import { AlertTriangle, EyeOff, ShieldAlert } from "lucide-react";
import { Cascata } from "@/components/charts/cascata";
import { MotivosTable } from "@/components/robo/robo-tables";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { getData } from "@/lib/data/store";
import { activeBrandSlug } from "@/lib/active-brand";
import { pageRange } from "@/lib/page-range";
import { getCascataFontes, getRoboSnapshot } from "@/lib/robo/client";
import { montarCascata } from "@/lib/cascata";
import { FILA_ETAPAS } from "@/lib/fila";
import {
  cohortWeekly,
  filterLeads,
  lossBreakdown,
  lossByKind,
  objectiveBreakdown,
  overviewKpis,
} from "@/lib/metrics";
import {
  formatCurrency0,
  formatDecimal,
  formatInt,
  formatPercent,
  formatPercentValue,
} from "@/lib/format";

export const dynamic = "force-dynamic";

/** Média que pode não existir ainda (robô sem nenhuma transferência). */
function media(v: number | null | undefined): string {
  return v == null ? "—" : formatDecimal(v, 1);
}

/** Horas decimais em linguagem de gente: 0,4 → "24 min"; 5,25 → "5,3 h". */
function horas(n: number | null): string {
  if (n == null) return "—";
  if (n < 1) return `${Math.round(n * 60)} min`;
  return `${formatDecimal(n, 1)} h`;
}

/**
 * Jornada — onde exatamente o dinheiro vaza.
 *
 * Absorveu Funil & LP e Robô. As três desenhavam o mesmo funil em três recortes
 * (painel, robô, cascata) com números que não somavam entre si. Ficou a cascata
 * como funil único, e das outras só o que ela não diz: POR QUE as pessoas saem
 * (motivo de perda, onde a conversa com o robô parou), se as semanas recentes
 * ainda estão maturando, e o que volta em receita no fim.
 */
export default async function JornadaPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string }>;
}) {
  const data = await getData(await activeBrandSlug());
  const { range } = pageRange(data, (await searchParams).range);

  const obj = objectiveBreakdown(data, range);
  const k = overviewKpis(data, range);
  const [fontes, robo] = await Promise.all([getCascataFontes(), getRoboSnapshot(range?.from)]);

  const cascata = montarCascata({
    data,
    range,
    robo: fontes.robo,
    comercial: fontes.comercial,
    investimentoConversao: obj.conversao.spend,
  });

  const parcial = fontes.falha?.tipo === "erro";
  const semRobo = fontes.falha?.tipo === "desligado";

  // O degrau com mais gente parada agora — o que dá para recuperar sem gastar.
  const paradoMaisCaro = [...cascata.degraus]
    .filter((d) => d.parados)
    .sort((a, b) => (b.midiaParada ?? 0) - (a.midiaParada ?? 0))[0];

  // Perdas do período, pelo motivo registrado e somadas pela origem do problema.
  const leads = filterLeads(data.leads, range);
  const lossRows = lossBreakdown(leads).filter((r) => r.count > 0);
  const byKind = lossByKind(leads);
  const lossTotal = byKind.qualidade + byKind.decisao;
  const qualidadeShare = lossTotal > 0 ? byKind.qualidade / lossTotal : 0;

  const cohorts = cohortWeekly(data, range, new Date().toISOString());

  return (
    <div className="space-y-6">
      <p className="max-w-3xl text-sm text-muted-foreground">
        Cada degrau vem de um sistema diferente — Meta, landing page, painel, robô e
        atendimento. A junta <span className="font-medium text-foreground">tracejada</span> marca
        onde o dado troca de dono, que é onde os números costumam parar de bater. Percentuais
        têm duas âncoras: acima de Leads medem sobre as impressões; de Leads para baixo,
        Leads é 100%.
      </p>

      {parcial ? (
        <Card className="border-[var(--warning)]/40">
          <CardContent className="flex items-start gap-3 p-4">
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-[var(--warning-text)]" />
            <p className="text-sm text-muted-foreground">
              <span className="font-medium text-foreground">A cascata está truncada.</span> Não
              consegui ler o robô, então ela termina nos leads — o fundo do funil não está
              aqui, e não é porque não aconteceu.
            </p>
          </CardContent>
        </Card>
      ) : null}

      {paradoMaisCaro ? (
        <Card className="border-[var(--danger)]/40">
          <CardContent className="flex items-start gap-3 p-4">
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-[var(--danger-text)]" />
            <div className="space-y-1">
              <p className="text-sm font-medium">
                {formatInt(paradoMaisCaro.parados!)}{" "}
                {paradoMaisCaro.parados === 1 ? "pessoa" : "pessoas"} ·{" "}
                {paradoMaisCaro.etapaFila
                  ? FILA_ETAPAS[paradoMaisCaro.etapaFila].label.toLowerCase()
                  : paradoMaisCaro.label}
              </p>
              <p className="text-xs text-muted-foreground">
                A mídia já pagou {formatCurrency0(paradoMaisCaro.midiaParada ?? 0)}{" "}
                para trazer essas pessoas até aqui. Elas não custam nada a mais para avançar —
                só um contato.{" "}
                {/* O link abre a fila no recorte deste degrau: o número daqui é o de lá. */}
                <Link
                  href={
                    paradoMaisCaro.etapaFila
                      ? `/fila?etapa=${paradoMaisCaro.etapaFila}`
                      : "/fila"
                  }
                  className="text-primary underline-offset-4 hover:underline"
                >
                  Abrir a fila
                </Link>
              </p>
            </div>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Do anúncio à venda</CardTitle>
          <CardDescription>
            Custo por unidade acumulado sobre {formatCurrency0(cascata.investimentoConversao)} de
            verba de conversão. Cada degrau reparte o mesmo dinheiro — não some entre linhas.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Cascata degraus={cascata.degraus} />

          {semRobo ? (
            <p className="mt-4 border-t pt-4 text-xs text-muted-foreground">
              O robô de WhatsApp não está conectado, então a cascata usa o funil do painel do
              lead para baixo. Com ele ligado, aparecem as etapas de conversa, convite e
              transferência ao especialista.
            </p>
          ) : null}

          {cascata.conversoesPixel > 0 ? (
            <p className="mt-4 border-t pt-4 text-xs text-muted-foreground">
              <span className="font-medium text-foreground">
                Número-sombra: {formatInt(cascata.conversoesPixel)} conversões do Pixel.
              </span>{" "}
              É a janela de atribuição da Meta, carimbada na data do clique — serve para a Meta
              otimizar a entrega e não entra em nenhuma taxa desta cascata. Quando ele diverge
              da contagem de leads, os dois estão certos: contam coisas diferentes.
            </p>
          ) : null}
        </CardContent>
      </Card>

      {cascata.naoAgir.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <EyeOff className="size-4 text-muted-foreground" />
              Onde não agir
            </CardTitle>
            <CardDescription>
              Metade da resposta a “para onde olhar” é saber o que ignorar. Estas parecem as
              maiores perdas do funil e não são perdas.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {cascata.naoAgir.map((n) => (
              <div key={n.titulo} className="space-y-1">
                <p className="text-sm font-medium text-muted-foreground line-through decoration-1">
                  {n.titulo}
                </p>
                <p className="text-xs leading-relaxed text-muted-foreground">{n.detalhe}</p>
              </div>
            ))}
          </CardContent>
        </Card>
      ) : null}

      {/* Por que as pessoas saem — só faz sentido com perda registrada no período */}
      {lossTotal > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Por que perdemos</CardTitle>
            <CardDescription>
              Leads encerrados sem reunião no período, pelo motivo registrado.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <THead>
                <TR className="hover:bg-transparent">
                  <TH>Motivo</TH>
                  <TH>Onde está o problema</TH>
                  <TH className="text-right">Leads</TH>
                  <TH className="text-right">% das perdas</TH>
                </TR>
              </THead>
              <TBody>
                {lossRows.map((row) => (
                  <TR key={row.status}>
                    <TD className="font-medium">{row.label}</TD>
                    <TD>
                      <div className="flex items-center gap-2">
                        <span
                          aria-hidden
                          className="h-1.5 w-16 shrink-0 overflow-hidden rounded-full bg-foreground/10"
                        >
                          <span
                            className="block h-full rounded-full"
                            style={{
                              width: `${Math.round(row.share * 100)}%`,
                              background:
                                row.kind === "qualidade" ? "var(--warning)" : "var(--critical)",
                            }}
                          />
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {row.kind === "qualidade" ? "Mídia" : "Oferta / pitch"}
                        </span>
                      </div>
                    </TD>
                    <TD className="text-right tabular">{formatInt(row.count)}</TD>
                    <TD className="text-right tabular">{formatPercent(row.share)}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
            <p className="mt-3 text-xs text-muted-foreground">
              {formatInt(lossTotal)} {lossTotal === 1 ? "lead encerrado" : "leads encerrados"} sem
              reunião ·{" "}
              <strong className="font-medium text-foreground">
                {formatPercent(qualidadeShare)}
              </strong>{" "}
              por qualidade do lead (contato inválido, sem resposta) — isso se resolve na
              segmentação e no formulário, não no comercial. O restante chegou a falar com a
              equipe: é oferta e pitch.
            </p>
          </CardContent>
        </Card>
      ) : null}

      {/* Dentro do robô — o que a cascata não diz: por que a conversa parou */}
      {robo.kpis ? (
        <Card>
          <CardHeader>
            <CardTitle>Dentro do robô: onde cada conversa parou</CardTitle>
            <CardDescription>
              A decisão que o robô registrou no último turno de cada lead. Score baixo com
              muitos turnos costuma indicar pergunta que não gera sinal.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted-foreground">
              <span>
                Score médio {media(robo.kpis.score_medio)} ·{" "}
                {media(robo.kpis.score_medio_transferidos)} entre os transferidos
              </span>
              <span>
                Da saudação à transferência: {horas(robo.kpis.horas_medias_ate_transferir)},{" "}
                {media(robo.kpis.turnos_medios_ate_transferir)} turnos em média
              </span>
            </p>

            <MotivosTable rows={robo.motivos} />

            {robo.saude ? (
              <div className="space-y-3 border-t pt-4">
                <p className="flex items-center gap-2 text-sm font-medium">
                  <ShieldAlert className="size-4 text-muted-foreground" />
                  Saúde do robô
                </p>
                <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
                  <div>
                    <p className="text-xs text-muted-foreground">Respostas enviadas</p>
                    <p className="mt-1 text-xl font-semibold tabular">
                      {formatInt(robo.saude.respostas_robo)}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Corrigidas pelo filtro</p>
                    <p className="mt-1 text-xl font-semibold tabular">
                      {formatPercentValue(robo.saude.taxa_bloqueio)}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {formatInt(robo.saude.respostas_bloqueadas)} respostas
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Convite fora de hora</p>
                    <p className="mt-1 text-xl font-semibold tabular">
                      {formatInt(robo.saude.bloq_convite + robo.saude.convite_removido)}
                    </p>
                    <p className="text-xs text-muted-foreground">removido antes de enviar</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Sem identificação</p>
                    <p className="mt-1 text-xl font-semibold tabular">
                      {formatInt(robo.saude.pendencias_identidade)}
                    </p>
                    <p className="text-xs text-muted-foreground">leads a reconciliar</p>
                  </div>
                </div>
              </div>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      {/* Coorte semanal — maturação por semana de entrada */}
      {cohorts.length >= 2 ? (
        <Card>
          <CardHeader>
            <CardTitle>Coorte por semana de entrada</CardTitle>
            <CardDescription>
              Coortes recentes ainda estão maturando — não compare a conversão delas com as
              semanas mais antigas.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <THead>
                <TR className="hover:bg-transparent">
                  <TH>Semana</TH>
                  <TH className="text-right">Leads</TH>
                  <TH className="text-right">Reuniões</TH>
                  <TH className="text-right">Lead→Reunião</TH>
                  <TH className="text-right">Clientes</TH>
                  <TH className="text-right">Receita</TH>
                </TR>
              </THead>
              <TBody>
                {cohorts.map((c) => (
                  <TR key={c.week}>
                    <TD className="font-medium">
                      {c.label}
                      {c.immature ? (
                        <span className="ml-1.5 text-xs font-normal text-muted-foreground">
                          (maturando)
                        </span>
                      ) : null}
                    </TD>
                    <TD className="text-right tabular">{formatInt(c.leads)}</TD>
                    <TD className="text-right tabular">{formatInt(c.meetings)}</TD>
                    <TD className="text-right tabular">{formatPercent(c.leadToMeeting)}</TD>
                    <TD className="text-right tabular">{formatInt(c.clients)}</TD>
                    <TD className="text-right tabular">{formatCurrency0(c.revenue)}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </CardContent>
        </Card>
      ) : null}

      {/* Receita e retorno — o fim da jornada, só quando há cliente/receita */}
      {k.clients > 0 || k.revenue > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Receita e retorno</CardTitle>
            <CardDescription>
              CAC = gasto de conversão ÷ clientes · ROAS = receita ÷ investimento total.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
              {[
                { label: "Clientes", value: formatInt(k.clients) },
                { label: "Receita", value: formatCurrency0(k.revenue) },
                { label: "CAC", value: formatCurrency0(k.cac) },
                { label: "ROAS", value: `${formatDecimal(k.roas, 2)}×` },
                { label: "Ticket médio", value: formatCurrency0(k.ticket) },
                { label: "Valor / reunião", value: formatCurrency0(k.valuePerMeeting) },
              ].map((s) => (
                <div key={s.label}>
                  <p className="text-xs text-muted-foreground">{s.label}</p>
                  <p className="text-2xl font-semibold tabular">{s.value}</p>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
