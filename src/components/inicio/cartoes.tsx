import { CalendarCheck, DollarSign, Target, UserPlus } from "lucide-react";
import { KpiCard, type KpiDelta } from "@/components/kpi/kpi-card";
import { pctDelta } from "@/components/kpi/delta";
import type { CartaoDoInicio, CartoesDoInicio } from "@/lib/inicio";

/**
 * Δ contra o período anterior, como os motores faziam (`pctDelta` sobre o valor e o
 * `anterior` da Medida), em forma CURTA: só a variação, com o "vs. período
 * anterior" no `title` e no ⓘ (orçamento de palavras do Início). Número que não se
 * sustenta ("—") não ganha seta: a comparação voltaria a parecer medição.
 */
export function deltaDoCartao(c: CartaoDoInicio, lowerIsBetter = false): KpiDelta | undefined {
  if (c.texto === "—" || c.anterior === undefined) return undefined;
  return pctDelta(c.valor, c.anterior, { lowerIsBetter, curto: true });
}

/** A quarentena do PRÓPRIO número do cartão (nunca a do custo por reunião no cartão de Reuniões). */
const quarentenaDe = (c: CartaoDoInicio) => (c.confianca?.nivel === "quarentena" ? c.confianca : undefined);

const COMPARA = " A seta compara com o período anterior, do mesmo tamanho.";

/**
 * O ⓘ do cartão: a dica e, SÓ quando há seta, contra o que ela compara — sem
 * anterior (Campanha, período que não começou), com o número em "—" ou com o
 * anterior zerado não há seta, e a frase descreveria algo que não está na tela.
 */
export function infoDoCartao(c: CartaoDoInicio, delta: KpiDelta | undefined): string {
  return delta ? c.dica + COMPARA : c.dica;
}

/**
 * Os 4 CARTÕES do Início (F7, C5): investimento em conversão (com o minigráfico
 * diário), CPL, leads e reuniões agendadas — o texto exibido é o `mostrar` de
 * `kpisDoPeriodo` (`cartoes.*.texto`), a explicação vai para o ⓘ (`dica`) e o
 * cartão de Reuniões leva UMA linha curta com o custo por reunião (o fato único,
 * `custoReuniao`). Sem status de meta (plano §8). Número em quarentena vira "—"
 * sem seta, e o motivo vai para o ⓘ (e para o ⚠ do cabeçalho), não para o corpo.
 */
export function CartoesDoInicio({ cartoes }: { cartoes: CartoesDoInicio }) {
  const { investimento, cpl, leads, reunioes } = cartoes;
  const d = {
    investimento: deltaDoCartao(investimento),
    cpl: deltaDoCartao(cpl, true),
    leads: deltaDoCartao(leads),
    reunioes: deltaDoCartao(reunioes),
  };
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4" data-bloco="cartoes">
      <KpiCard
        label="Investimento em conversão"
        value={investimento.texto}
        Icon={DollarSign}
        delta={d.investimento}
        quarentena={quarentenaDe(investimento)}
        ressalvaNoInfo
        spark={cartoes.sparkInvestimento ?? undefined}
        info={infoDoCartao(investimento, d.investimento)}
      />
      <KpiCard
        label="CPL"
        value={cpl.texto}
        Icon={Target}
        delta={d.cpl}
        quarentena={quarentenaDe(cpl)}
        ressalvaNoInfo
        info={infoDoCartao(cpl, d.cpl)}
      />
      <KpiCard
        label="Leads"
        value={leads.texto}
        Icon={UserPlus}
        delta={d.leads}
        quarentena={quarentenaDe(leads)}
        ressalvaNoInfo
        info={infoDoCartao(leads, d.leads)}
      />
      <KpiCard
        label="Reuniões agendadas"
        value={reunioes.texto}
        Icon={CalendarCheck}
        delta={d.reunioes}
        // Só a quarentena da CONTAGEM (fontes divergem); a do custo apagaria o Δ de uma contagem válida.
        quarentena={quarentenaDe(reunioes)}
        ressalvaNoInfo
        hint={cartoes.custoReuniao}
        info={infoDoCartao(reunioes, d.reunioes)}
        highlight
      />
    </div>
  );
}
