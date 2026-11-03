import Link from "next/link";
import { CalendarClock, Coins, Gauge, Headset, Radio, ShieldCheck, Wallet } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { RitmoBar, RITMO_LABEL } from "@/components/live/ritmo-bar";
import { ManuaisForm, RelatoriosParaCopiar } from "@/components/live/live-forms";
import { getData, listLeadEvents } from "@/lib/data/store";
import { activeBrand } from "@/lib/active-brand";
import { can } from "@/lib/auth/guard";
import { expedienteAtual } from "@/lib/atendimento-server";
import { campanhaDaLive } from "@/lib/live-server";
import { montarPainelLive, relatoriosDaLive, type Ritmo, type Taxa } from "@/lib/live-painel";
import { dica } from "@/lib/dicionario";
import { formatCurrency0, formatDateShort, formatDateTime, formatInt } from "@/lib/format";
import { STATUS_REUNIAO, type StatusReuniao } from "@/lib/qualificacao";
import { hojeEmBrasilia, parseCustomRange } from "@/lib/range";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

const COR: Record<Ritmo, string> = {
  no_ritmo: "text-[var(--status-ok-text)]",
  perto: "text-[var(--status-perto-text)]",
  atras: "text-[var(--status-fora-text)]",
  sem_ritmo: "text-muted-foreground",
};

/** Uma taxa contra a meta, sempre com o texto do status e o n. */
function LinhaDeTaxa({ t }: { t: Taxa }) {
  const status = t.ok == null ? null : t.ok ? (t.teto ? "dentro do limite" : "na meta") : t.teto ? "acima do limite" : "abaixo da meta";
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-2 py-2 text-sm">
      <span title={t.nota}>{t.rotulo}</span>
      <span className="tabular-nums">
        <span className="font-semibold">{t.valor == null ? "—" : `${Math.round(t.valor * 100)}%`}</span>
        <span className="text-muted-foreground">
          {t.meta > 0 || t.teto ? ` · meta ${t.teto ? "até " : ""}${Math.round(t.meta * 100)}%` : ""} · n={formatInt(t.n)}
        </span>
        {status ? (
          <span className={cn("ml-2 text-xs font-medium", t.ok ? "text-[var(--status-ok-text)]" : "text-[var(--status-fora-text)]")}>
            {status}
          </span>
        ) : null}
      </span>
    </div>
  );
}

/**
 * Live 01/12 — vista da Bússola para a campanha da live (E3-02, E3-07, E3-13,
 * E5-08): metas × ritmo, atendimento, verba, custos, qualidade, os números que o
 * sistema não sabe e o resumo da semana para o ClickUp. Toda conta mora em
 * `lib/live-painel.ts`; a régua (metas, verba, períodos) em Configurações.
 */
export default async function LivePage({ searchParams }: { searchParams: Promise<{ range?: string }> }) {
  const brand = await activeBrand();
  if (brand.type === "awareness") {
    return <p className="text-sm text-muted-foreground">A live de 01/12 é da marca Consórcio — troque a marca no topo.</p>;
  }
  const [{ range: rangeParam }, cfg, expediente, data, eventos, podeManuais, podeLeads] = await Promise.all([
    searchParams,
    campanhaDaLive(),
    expedienteAtual(),
    getData(brand.slug),
    listLeadEvents({ brand: brand.slug, limit: 0 }),
    can("data:write"),
    can("leads:write"),
  ]);
  const agora = new Date().toISOString();
  const hoje = hojeEmBrasilia();

  const chaveDe = (i: { de: string; ate: string }) => `${i.de}..${i.ate}`;
  const atalhos = [
    { rotulo: "Campanha da live", chave: chaveDe(cfg.periodo) },
    { rotulo: "Captação", chave: chaveDe(cfg.captacao) },
    { rotulo: "Pós-live", chave: chaveDe(cfg.posLive) },
  ];
  const chave = rangeParam && parseCustomRange(rangeParam) ? rangeParam : atalhos[0].chave;
  const livre = parseCustomRange(chave)!;
  const de = livre.from ?? cfg.periodo.de;
  const ateBruto = livre.to ?? cfg.periodo.ate;
  const ate = ateBruto > hoje ? hoje : ateBruto;
  const naoComecou = de > hoje;
  const range = naoComecou ? { de, ate: de } : { de, ate };

  const p = montarPainelLive({ data, eventos, cfg, expediente, range, hoje, agora });
  const relatorios = relatoriosDaLive(p, cfg, hoje);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="space-y-0.5">
          <h2 className="flex items-center gap-2 text-lg font-semibold">
            <Radio className="size-4 text-primary" />
            {cfg.nome} — {formatDateTime(cfg.dataDaLive)}
          </h2>
          <p className="text-sm text-muted-foreground">
            {p.diasParaLive > 0 ? `Faltam ${p.diasParaLive} ${p.diasParaLive === 1 ? "dia" : "dias"} para a live. ` : "A live já aconteceu. "}
            {naoComecou
              ? `O período começa em ${formatDateShort(de)} — os números aparecem quando a captação começar.`
              : `Inscritos de ${formatDateShort(range.de)} a ${formatDateShort(range.ate)}: ${formatInt(p.inscritos)}.`}
          </p>
        </div>
        <nav aria-label="Período da live" className="inline-flex h-9 items-center gap-0.5 rounded-lg border bg-card p-0.5">
          {atalhos.map((a) => (
            <Link
              key={a.chave}
              href={`/live?range=${encodeURIComponent(a.chave)}`}
              aria-current={a.chave === chave ? "page" : undefined}
              className={cn(
                "rounded-md px-2.5 py-1 text-xs font-medium",
                a.chave === chave ? "bg-primary/15 text-foreground" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {a.rotulo}
            </Link>
          ))}
        </nav>
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Gauge className="size-4 text-primary" />
              Metas × realizado
            </CardTitle>
            <CardDescription>
              A marca na barra é onde deveria estar hoje: {Math.round(p.fracaoCaptacao * 100)}% dos dias de captação (
              {formatDateShort(cfg.captacao.de)}–{formatDateShort(cfg.captacao.ate)}) já passaram.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {p.metas.map((m) => (
              <RitmoBar key={m.id} linha={m} />
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Headset className="size-4 text-primary" />
              Atendimento
            </CardTitle>
            <CardDescription>
              Pelo turno de Configurações → Atendimento. A base de cada taxa é quem já teve a tentativa ou já passou do prazo.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="divide-y">
              {p.atendimento.map((t) => (
                <LinhaDeTaxa key={t.id} t={t} />
              ))}
              <div className="flex flex-wrap items-baseline justify-between gap-2 py-2 text-sm">
                <span>A sem nenhuma tentativa, prazo vencido</span>
                <span className="tabular-nums">
                  <span className="font-semibold">{formatInt(p.aSemTentativa)}</span>
                  <span className="text-muted-foreground"> · meta 0</span>
                  <span className={cn("ml-2 text-xs font-medium", p.aSemTentativa === 0 ? "text-[var(--status-ok-text)]" : "text-[var(--status-fora-text)]")}>
                    {p.aSemTentativa === 0 ? "na meta" : (
                      <Link href="/fila#live" className="underline-offset-4 hover:underline">
                        abrir a Fila
                      </Link>
                    )}
                  </span>
                </span>
              </div>
            </div>
            <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
              <CalendarClock className="size-3.5" />
              {(Object.keys(STATUS_REUNIAO) as StatusReuniao[]).map((s) => (
                <span key={s}>
                  {STATUS_REUNIAO[s]}: <span className="font-medium text-foreground">{formatInt(p.reunioes[s])}</span>
                </span>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Wallet className="size-4 text-primary" />
              Verba
            </CardTitle>
            <CardDescription>Gasto de cada linha do começo dela até hoje, contra a verba e o ritmo diário.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {p.semCampanhas ? (
              <p className="text-xs text-muted-foreground">
                Nenhuma campanha do Gerenciador casou ainda com os nomes da live (
                {cfg.linhas.map((l) => l.campanhas[0]).filter(Boolean).join(", ")}). Quando as campanhas existirem,
                confira os nomes em{" "}
                <Link href="/configuracoes#campanha-live" className="text-primary underline-offset-4 hover:underline">
                  Configurações → Metas e orçamento
                </Link>
                .
              </p>
            ) : null}
            <div className="divide-y">
              {p.verba.map((v) => (
                <div key={v.id} className="flex flex-wrap items-baseline justify-between gap-2 py-2 text-sm">
                  <span>
                    {v.rotulo}{" "}
                    <span className="text-xs text-muted-foreground">
                      ({formatDateShort(v.de)}–{formatDateShort(v.ate)} · {formatCurrency0(v.porDia)}/dia ·{" "}
                      {v.campanhasEncontradas} {v.campanhasEncontradas === 1 ? "campanha" : "campanhas"})
                    </span>
                  </span>
                  <span className="tabular-nums">
                    <span className="font-semibold">{formatCurrency0(v.gasto)}</span>
                    <span className="text-muted-foreground">
                      {" "}
                      / {formatCurrency0(v.verba)} · deveria {formatCurrency0(v.esperado)}
                    </span>
                    {v.ritmo !== "sem_ritmo" ? <span className={cn("ml-2 text-xs font-medium", COR[v.ritmo])}>{RITMO_LABEL[v.ritmo]}</span> : null}
                  </span>
                </div>
              ))}
            </div>
            {p.dias.length ? (
              <div className="space-y-1">
                <p className="text-xs font-medium text-muted-foreground">
                  Captação por dia contra {formatCurrency0(p.dias[0].alvo)}/dia · conjunto do carro contra{" "}
                  {formatCurrency0(cfg.carro.porDia)}/dia a partir de {formatDateShort(cfg.carro.desde)}
                </p>
                {p.dias.map((d) => {
                  const max = Math.max(d.alvo * 1.5, ...p.dias.map((x) => x.gasto), 1);
                  return (
                    <div key={d.date} className="grid grid-cols-[3.5rem_1fr_auto] items-center gap-2 text-xs">
                      <span className="tabular-nums text-muted-foreground">{formatDateShort(d.date)}</span>
                      <div className="relative h-3 rounded bg-foreground/[0.06]" title={`Gasto ${formatCurrency0(d.gasto)} · alvo ${formatCurrency0(d.alvo)}`}>
                        <div className="h-3 rounded bg-primary/70" style={{ width: `${(d.gasto / max) * 100}%` }} />
                        <span className="absolute -top-0.5 h-4 w-0.5 bg-foreground/70" style={{ left: `${(d.alvo / max) * 100}%` }} aria-hidden />
                      </div>
                      <span className="tabular-nums">
                        {formatCurrency0(d.gasto)}
                        {d.carro ? <span className="text-muted-foreground"> · carro {formatCurrency0(d.carro.gasto)}/{formatCurrency0(d.carro.alvo)}</span> : null}
                      </span>
                    </div>
                  );
                })}
              </div>
            ) : null}
          </CardContent>
        </Card>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Coins className="size-4 text-primary" />
                Custos
              </CardTitle>
              <CardDescription>
                No período escolhido. Inscrito e qualificado pela verba da captação; reunião pela verba de toda a live.
              </CardDescription>
            </CardHeader>
            <CardContent className="divide-y text-sm">
              <div className="flex flex-wrap justify-between gap-2 py-2" title={dica("custo_por_inscrito")}>
                <span>Custo por inscrito</span>
                <span className="tabular-nums">
                  <span className="font-semibold">{p.custos.porInscrito.texto}</span>
                  <span className="text-muted-foreground"> · meta {formatCurrency0(cfg.custos.porInscrito)}</span>
                </span>
              </div>
              <div className="flex flex-wrap justify-between gap-2 py-2" title={dica("custo_por_qualificado")}>
                <span>Custo por qualificado</span>
                <span className="tabular-nums">
                  <span className="font-semibold">{p.custos.porQualificado.texto}</span>
                  <span className="text-muted-foreground"> · meta até {formatCurrency0(cfg.custos.porQualificadoMax)}</span>
                  {p.custos.porQualificado.ok != null ? (
                    <span className={cn("ml-2 text-xs font-medium", p.custos.porQualificado.ok ? "text-[var(--status-ok-text)]" : "text-[var(--status-fora-text)]")}>
                      {p.custos.porQualificado.ok ? "dentro" : "acima da meta"}
                    </span>
                  ) : null}
                </span>
              </div>
              <div className="flex flex-wrap justify-between gap-2 py-2">
                <span>Custo por reunião agendada</span>
                <span className="tabular-nums font-semibold">{p.custos.porReuniao.texto}</span>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <ShieldCheck className="size-4 text-primary" />
                Qualidade do inscrito
              </CardTitle>
            </CardHeader>
            <CardContent className="divide-y">
              {p.qualidade.map((t) => (
                <LinhaDeTaxa key={t.id} t={t} />
              ))}
            </CardContent>
          </Card>
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Números da live (manuais)</CardTitle>
            <CardDescription>Presentes no YouTube e vendas fechadas — o painel não tem como saber sozinho.</CardDescription>
          </CardHeader>
          <CardContent>
            <ManuaisForm atual={cfg.manuais} podeEditar={podeManuais || podeLeads} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Relatórios para o ClickUp</CardTitle>
            <CardDescription>
              Os mesmos números desta tela, no formato que cada tarefa pede — acumulados do período escolhido. O que o
              painel não sabe fica “__” para você completar.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <RelatoriosParaCopiar relatorios={relatorios} />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
