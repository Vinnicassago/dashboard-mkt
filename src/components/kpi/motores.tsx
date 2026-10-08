import { DollarSign, Target, UserPlus } from "lucide-react";
import { KpiCard } from "./kpi-card";
import { pctDelta } from "./delta";
import type { MetaExibida } from "./status-meta";
import type { KpisDoPeriodo, LinhaDaRegua } from "@/lib/kpis";
import { mostrar } from "@/lib/kpis";
import { formatarAlvo } from "@/lib/metas";
import { formatCurrency0, formatInt } from "@/lib/format";
import { dica } from "@/lib/dicionario";
import type { MetricaComMeta } from "@/lib/types";

/**
 * Os MOTORES — só os de dinheiro (§9 do plano): investimento no ritmo, CPL e
 * leads. As taxas (1º contato, lead → agendada) moram no funil, no bloco "Onde
 * trava" — repeti-las aqui era o que fazia o wireframe ter 20 números na dobra.
 * Cada cartão: valor, meta (cor + texto) e Δ contra o período anterior.
 */
export function Motores({ kpis, regua }: { kpis: KpisDoPeriodo; regua: Map<string, LinhaDaRegua> }) {
  const metaDe = (m: MetricaComMeta, rotulo: string): MetaExibida | undefined => {
    const l = regua.get(m);
    if (!l || l.alvo == null) return undefined;
    return { alvoTexto: `${rotulo} ${formatarAlvo(m, l.alvo)}`, avaliacao: l.avaliacao, provisoria: l.meta?.provisoria };
  };
  const inv = kpis.investimentoConversao;
  const cpl = kpis.cpl;
  const leads = kpis.leads;
  const delta = (m: { valor: number; anterior?: number }, lowerIsBetter = false) =>
    m.anterior !== undefined ? pctDelta(m.valor, m.anterior, { lowerIsBetter }) : undefined;

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-3" data-bloco="motores">
      <KpiCard
        label="Investimento em conversão"
        value={mostrar(inv, "moeda0")}
        Icon={DollarSign}
        delta={delta(inv)}
        hint={
          kpis.temDescoberta
            ? `de ${formatCurrency0(kpis.investimento.valor)} no total (o resto é descoberta)`
            : dica("investimento_conversao").split(": ")[1]
        }
        quarentena={inv.confianca?.nivel === "quarentena" ? inv.confianca : undefined}
        meta={metaDe("investimento_conversao", "previsto")}
      />
      <KpiCard
        label="CPL"
        value={mostrar(cpl, "moeda")}
        Icon={Target}
        delta={delta(cpl, true)}
        hint={`sobre ${formatInt(kpis.leadsConversao.valor)} leads de conversão`}
        quarentena={cpl.confianca?.nivel === "quarentena" ? cpl.confianca : undefined}
        meta={metaDe("cpl", "alvo")}
      />
      <KpiCard
        label="Leads"
        value={formatInt(leads.valor)}
        Icon={UserPlus}
        delta={delta(leads)}
        hint={
          kpis.leadsOrganicos.valor > 0
            ? `${formatInt(kpis.leadsConversao.valor)} de conversão · ${formatInt(kpis.leadsOrganicos.valor)} orgânicos`
            : "pessoas cadastradas no período"
        }
        meta={metaDe("leads", "meta")}
      />
    </div>
  );
}
