import { Target, Wallet } from "lucide-react";
import { BudgetForm, CalculadoraDeMetas, GoalsForm, MetaManualForm } from "@/components/config/metas-forms";
import { PendenciasCard } from "@/components/config/pendencias-card";
import { SemPermissao } from "@/components/config/sem-permissao";
import { StatusMetaBadge } from "@/components/kpi/status-meta";
import { RolarParaAncora } from "@/components/ui/rolar-para-ancora";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getData } from "@/lib/data/store";
import { resolveMetaBrands } from "@/lib/meta/config";
import { coberturaDeAnuncios } from "@/lib/sincronizacao";
import { kpisDoPeriodo, mostrar, reguaDoPeriodo, type LinhaDaRegua } from "@/lib/kpis";
import { META_DEF, formatarAlvo, precisaRecalibrar, taxasObservadas } from "@/lib/metas";
import { pendenciasDeConfiguracoes } from "@/lib/configuracoes";
import { dica } from "@/lib/dicionario";
import { formatDateTime } from "@/lib/format";
import { pageRange } from "@/lib/page-range";
import { hojeEmBrasilia } from "@/lib/range";
import { contextoDeConfiguracoes } from "./_carregar";

// Pendências e régua refletem o banco agora, nunca o build.
export const dynamic = "force-dynamic";

/**
 * Configurações → Metas e orçamento (vista padrão, relatório §7.7 item 1).
 * Primeiro o que falta (a mesma avaliação de confiança da home), depois a régua:
 * orçamento, metas do funil com vigência e calculadora, metas de conteúdo.
 */
export default async function MetasPage({ searchParams }: { searchParams: Promise<{ range?: string }> }) {
  const ctx = await contextoDeConfiguracoes(searchParams);
  const data = await getData(ctx.brand.slug);
  const { range } = pageRange(data, ctx.rangeKey);
  const kp = kpisDoPeriodo(data, range, {
    brandRules: await resolveMetaBrands(),
    cobertura: await coberturaDeAnuncios(ctx.brand.slug),
  });
  const pendencias = pendenciasDeConfiguracoes(kp.trust.travas, ctx.rangeKey);

  // A régua (Fase 4): metas com vigência, calculadora e histórico.
  const hoje = hojeEmBrasilia();
  const regua = reguaDoPeriodo(kp, data, range, hoje);
  const observadas = taxasObservadas(data, hoje, new Date().toISOString());
  const recalibrar = precisaRecalibrar(data.metas, observadas, hoje);
  const ultimaCalculadora = [...(data.metas ?? [])]
    .filter((m) => m.origem === "calculadora" && m.entradas)
    .sort((a, b) => b.criadaEm.localeCompare(a.criadaEm))[0]?.entradas;
  const historicoMetas = [...(data.metas ?? [])].sort((a, b) => b.criadaEm.localeCompare(a.criadaEm)).slice(0, 40);
  const temMetas = regua.some((l) => l.alvo != null);
  const valorDaLinha = (l: LinhaDaRegua) => {
    const f = META_DEF[l.metrica].formato;
    if (f === "moeda") return mostrar(l.medida, "moeda");
    if (f === "pct") return l.medida.n > 0 ? `${mostrar(l.medida, "pct")} (n=${l.medida.n})` : "—";
    return mostrar(l.medida, "int");
  };
  const currentGoals: Record<string, number> = {};
  for (const g of data.goals) currentGoals[g.metric] = g.target;

  return (
    <div className="max-w-3xl space-y-6">
      <RolarParaAncora />
      <p className="text-sm text-muted-foreground">
        A régua do painel: sem orçamento e metas, nenhum número fica verde ou vermelho — só se compara com
        a semana passada.
      </p>

      <PendenciasCard pendencias={pendencias} />

      {!ctx.papeis.dados ? (
        <SemPermissao quem="Administrador e Marketing" oque="cadastram orçamento e metas" />
      ) : (
        <>
          <Card id="orcamento" className="scroll-mt-24">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Wallet className="size-4 text-primary" />
                Orçamento da campanha
              </CardTitle>
              <CardDescription>
                Sem ele, o painel não mostra quanto da verba já foi consumido nem projeta se ela acaba antes do
                fim. Com a data de fim, o ritmo de gasto vira projeção.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <BudgetForm
                current={{
                  budgetTotal: data.campaign.budgetTotal || undefined,
                  dailyBudget: data.campaign.dailyBudget,
                  endDate: data.campaign.endDate,
                }}
              />
            </CardContent>
          </Card>

          <Card id="metas" className="scroll-mt-24">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Target className="size-4 text-primary" />
                Metas
              </CardTitle>
              <CardDescription>
                A régua do funil: o placar, as ações e as tabelas pintam cada número contra a meta que vale no
                período. Mudar uma meta não reescreve o passado — a nova vale a partir da data escolhida.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              {temMetas ? (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-xs text-muted-foreground">
                        <th className="pb-2 font-medium">Métrica</th>
                        <th className="pb-2 text-right font-medium">No período</th>
                        <th className="pb-2 pl-4 font-medium">Meta e status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {regua.map((l) => (
                        <tr key={l.metrica}>
                          {/* ⓘ: a definição do dicionário, a mesma do briefing e das outras telas. */}
                          <td className="py-1.5">
                            <span title={dica(l.metrica)} className="cursor-help underline decoration-dotted underline-offset-4">
                              {META_DEF[l.metrica].nome}
                            </span>
                          </td>
                          <td className="py-1.5 text-right tabular">{valorDaLinha(l)}</td>
                          <td className="py-1.5 pl-4">
                            {l.alvo != null ? (
                              <StatusMetaBadge
                                meta={{
                                  alvoTexto: `${formatarAlvo(l.metrica, l.alvo)}${l.parcial ? " (parte do período sem meta)" : ""}`,
                                  avaliacao: l.avaliacao,
                                  provisoria: l.meta?.provisoria,
                                }}
                              />
                            ) : (
                              <span className="text-xs text-muted-foreground">sem meta</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <p className="mt-2 text-xs text-muted-foreground">
                    Contagens e orçamento somam a meta semanal dia a dia no período escolhido no topo; custo e
                    taxa valem como estão. Sem status quando o número não se sustenta (custo por reunião com
                    menos de 3 reuniões, taxa sem ninguém na base).
                  </p>
                </div>
              ) : null}

              {recalibrar.length > 0 ? (
                <p className="rounded-lg border border-[var(--status-perto)]/50 p-3 text-sm">
                  Já há amostra (8 semanas): {recalibrar.map((m) => META_DEF[m].nome.toLowerCase()).join(" e ")}{" "}
                  {recalibrar.length === 1 ? "está" : "estão"} com meta provisória há mais de 8 semanas. Use a
                  calculadora com as taxas observadas para recalibrar.
                </p>
              ) : null}

              <details open={!temMetas} className="rounded-lg border p-3">
                <summary className="cursor-pointer text-sm font-medium">
                  Calculadora — as metas a partir do valor da carta
                </summary>
                <div className="pt-3">
                  <CalculadoraDeMetas
                    sugestao={{
                      ultimas: ultimaCalculadora,
                      observadas,
                      suficiente: observadas.suficiente,
                      amostra: { leads: observadas.amostra.leads, agendadas: observadas.amostra.agendadas },
                      hoje,
                    }}
                  />
                </div>
              </details>

              <details className="rounded-lg border p-3">
                <summary className="cursor-pointer text-sm font-medium">Ajustar ou limpar uma meta</summary>
                <div className="pt-3">
                  <MetaManualForm hoje={hoje} />
                </div>
              </details>

              {historicoMetas.length > 0 ? (
                <details className="rounded-lg border p-3">
                  <summary className="cursor-pointer text-sm font-medium">
                    Histórico ({historicoMetas.length}) — quem mudou o quê, e desde quando vale
                  </summary>
                  <ul className="divide-y pt-2 text-xs">
                    {historicoMetas.map((m) => (
                      <li key={m.id} className="flex flex-wrap gap-x-2 py-1.5">
                        <span className="font-medium">{META_DEF[m.metrica].nome}</span>
                        <span>
                          {m.alvo != null ? formatarAlvo(m.metrica, m.alvo) : "sem meta"}
                          {META_DEF[m.metrica].escala === "periodo" && m.alvo != null ? ` por ${m.periodo}` : ""}
                        </span>
                        <span className="text-muted-foreground">
                          · vale desde {m.vigenteDesde} · {m.origem}
                          {m.provisoria ? " · provisória" : ""} · {m.criadaPor || "—"} em {formatDateTime(m.criadaEm)}
                        </span>
                      </li>
                    ))}
                  </ul>
                </details>
              ) : null}
            </CardContent>
          </Card>

          <Card id="metas-conteudo" className="scroll-mt-24">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Target className="size-4 text-primary" />
                Metas de conteúdo
              </CardTitle>
              <CardDescription>
                Seguidores e o plano de 90 dias do diagnóstico (retenção 40%, salvos/1k 8+, 4 posts/semana…) —
                lidas pela tela Conteúdo.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <GoalsForm current={currentGoals} />
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
