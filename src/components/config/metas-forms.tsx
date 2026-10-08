"use client";

import { useActionState, useMemo, useState } from "react";
import { salvarMetaManualAction, salvarMetasDaCalculadoraAction } from "@/app/(dashboard)/config/metas-actions";
import { Field, Message, SubmitButton, inputCls } from "./config-forms";
import { META_DEF, METRICAS_COM_META, calcularMetas, errosDaCalculadora, formatarAlvo } from "@/lib/metas";
import type { EntradasCalculadora, MetricaComMeta } from "@/lib/types";
import { formatPercent } from "@/lib/format";
import { cn } from "@/lib/utils";

/** O que a página já sabe para sugerir (taxas observadas, últimas entradas). */
export interface SugestaoCalculadora {
  /** Entradas da última vez que a calculadora foi usada (para não redigitar). */
  ultimas?: EntradasCalculadora;
  /** Taxas observadas nas últimas 8 semanas (frações) — só se houver amostra. */
  observadas?: { a: number | null; s: number | null; f: number | null; V: number | null };
  suficiente: boolean;
  amostra: { leads: number; agendadas: number };
  hoje: string;
}

const CAMPOS: { k: keyof EntradasCalculadora; rotulo: string; pct: boolean; exemplo: number; ajuda: string }[] = [
  { k: "V", rotulo: "Valor médio da carta (R$)", pct: false, exemplo: 200000, ajuda: "quanto vale a carta vendida, em média" },
  { k: "c", rotulo: "Receita por venda (% da carta)", pct: true, exemplo: 2, ajuda: "o que a empresa ganha por carta" },
  { k: "m", rotulo: "Fatia aceitável como custo de aquisição (%)", pct: true, exemplo: 30, ajuda: "da receita, quanto pode virar mídia" },
  { k: "f", rotulo: "Fechamento: reunião realizada → venda (%)", pct: true, exemplo: 20, ajuda: "" },
  { k: "s", rotulo: "Comparecimento: agendada → realizada (%)", pct: true, exemplo: 70, ajuda: "" },
  { k: "a", rotulo: "Lead → reunião agendada (%)", pct: true, exemplo: 10, ajuda: "" },
  { k: "N", rotulo: "Vendas desejadas por mês", pct: false, exemplo: 4, ajuda: "" },
];

const inicial = (s: SugestaoCalculadora, k: keyof EntradasCalculadora, pct: boolean): string => {
  const v = s.ultimas?.[k];
  if (v == null) return "";
  return String(pct ? Math.round(v * 10000) / 100 : v);
};

/**
 * A calculadora da seção 9 do relatório: de trás para frente, do valor da carta
 * ao CPL. A prévia é calculada aqui mesmo (mesma função pura do servidor); o
 * servidor recalcula ao gravar.
 */
export function CalculadoraDeMetas({ sugestao }: { sugestao: SugestaoCalculadora }) {
  const [state, action] = useActionState(salvarMetasDaCalculadoraAction, null);
  const [valores, setValores] = useState<Record<string, string>>(() =>
    Object.fromEntries(CAMPOS.map((c) => [c.k, inicial(sugestao, c.k, c.pct)])),
  );
  const entradas: EntradasCalculadora = useMemo(() => {
    const ler = (k: keyof EntradasCalculadora, pct: boolean) => {
      const v = Number(valores[k]);
      return valores[k]?.trim() ? (pct ? v / 100 : v) : NaN;
    };
    return Object.fromEntries(CAMPOS.map((c) => [c.k, ler(c.k, c.pct)])) as unknown as EntradasCalculadora;
  }, [valores]);
  const valido = errosDaCalculadora(entradas).length === 0;
  const saida = valido ? calcularMetas(entradas) : null;

  const obs = sugestao.observadas;
  const sugerido: Partial<Record<keyof EntradasCalculadora, number | null>> = {
    a: obs?.a ?? null,
    s: obs?.s ?? null,
    f: obs?.f ?? null,
    V: obs?.V ?? null,
  };

  return (
    <form action={action} className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        {CAMPOS.map((c) => {
          const sug = sugerido[c.k];
          return (
            <Field key={c.k} label={`${c.k} · ${c.rotulo}`}>
              <input
                type="number"
                name={c.k}
                min="0"
                step="any"
                value={valores[c.k] ?? ""}
                onChange={(e) => setValores((v) => ({ ...v, [c.k]: e.target.value }))}
                placeholder={`ex.: ${c.exemplo.toLocaleString("pt-BR")}`}
                className={inputCls}
              />
              {sug != null ? (
                <button
                  type="button"
                  onClick={() =>
                    setValores((v) => ({ ...v, [c.k]: String(c.pct ? Math.round(sug * 10000) / 100 : Math.round(sug)) }))
                  }
                  className="self-start text-xs text-primary underline-offset-4 hover:underline"
                >
                  usar o observado: {c.pct ? formatPercent(sug, 1) : sug.toLocaleString("pt-BR", { maximumFractionDigits: 0 })}
                  {sugestao.suficiente ? "" : " (amostra pequena)"}
                </button>
              ) : c.ajuda ? (
                <span className="text-xs text-muted-foreground">{c.ajuda}</span>
              ) : null}
            </Field>
          );
        })}
        <Field label="1º contato no prazo — meta (%)">
          <input type="number" name="primeiroContato" min="0" max="100" step="any" defaultValue="90" className={inputCls} />
          <span className="text-xs text-muted-foreground">leads com a 1ª tentativa em até 1 hora útil</span>
        </Field>
        <Field label="Vale a partir de">
          <input type="date" name="vigenteDesde" defaultValue={sugestao.hoje} className={inputCls} />
          <span className="text-xs text-muted-foreground">o passado continua julgado pela meta antiga</span>
        </Field>
      </div>

      <div className={cn("rounded-lg border p-3 text-sm", !saida && "text-muted-foreground")}>
        {saida ? (
          <ul className="grid gap-x-6 gap-y-1 sm:grid-cols-2">
            <li>CAC máximo: <strong className="tabular">{formatarAlvo("cpl", saida.cacMax)}</strong></li>
            <li>Custo máximo por reunião: <strong className="tabular">{formatarAlvo("custo_por_reuniao", saida.custoPorReuniaoMax)}</strong></li>
            <li>CPL máximo: <strong className="tabular">{formatarAlvo("cpl", saida.cplMax)}</strong></li>
            <li>Reuniões agendadas por semana: <strong className="tabular">{formatarAlvo("reunioes_agendadas", saida.reunioesPorSemana)}</strong></li>
            <li>Leads por semana: <strong className="tabular">{formatarAlvo("leads", saida.leadsPorSemana)}</strong></li>
            <li>Orçamento de conversão por semana: <strong className="tabular">{formatarAlvo("investimento_conversao", saida.orcamentoConversaoPorSemana)}</strong></li>
          </ul>
        ) : (
          "Preencha as sete entradas para ver as metas."
        )}
      </div>
      {!sugestao.suficiente ? (
        <p className="text-xs text-muted-foreground">
          Nas últimas 8 semanas: {sugestao.amostra.leads} leads e {sugestao.amostra.agendadas} reuniões agendadas —
          abaixo de 20 e 5, as metas de taxa ficam marcadas como <strong>provisórias</strong> até haver amostra.
        </p>
      ) : null}
      <SubmitButton>Gravar as metas</SubmitButton>
      <Message state={state} />
    </form>
  );
}

/** Ajusta (ou limpa, deixando o alvo em branco) uma meta à mão. */
export function MetaManualForm({ hoje }: { hoje: string }) {
  const [state, action] = useActionState(salvarMetaManualAction, null);
  const [metrica, setMetrica] = useState<MetricaComMeta>("reunioes_agendadas");
  const def = META_DEF[metrica];
  return (
    <form action={action} className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-4">
        <Field label="Métrica">
          <select
            name="metrica"
            value={metrica}
            onChange={(e) => setMetrica(e.target.value as MetricaComMeta)}
            className={inputCls}
          >
            {METRICAS_COM_META.map((m) => (
              <option key={m} value={m}>
                {META_DEF[m].nome}
              </option>
            ))}
          </select>
        </Field>
        <Field label={def.formato === "pct" ? "Alvo (%)" : def.formato === "moeda" ? "Alvo (R$)" : "Alvo"}>
          <input type="number" name="alvo" min="0" step="any" placeholder="vazio = sem meta" className={inputCls} />
        </Field>
        <Field label="Período">
          <select name="periodo" defaultValue="semana" className={inputCls} disabled={def.escala === "razao"}>
            <option value="semana">por semana</option>
            <option value="mes">por mês</option>
          </select>
        </Field>
        <Field label="Vale a partir de">
          <input type="date" name="vigenteDesde" defaultValue={hoje} className={inputCls} />
        </Field>
      </div>
      <SubmitButton>Gravar</SubmitButton>
      <Message state={state} />
    </form>
  );
}
