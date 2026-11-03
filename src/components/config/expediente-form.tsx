"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Plus, X } from "lucide-react";
import { salvarExpediente } from "@/app/(dashboard)/configuracoes/atendimento-actions";
import { HORARIOS, type HorarioPreferido } from "@/lib/qualificacao";
import { DIAS_DA_SEMANA, DIA_LABEL, faixasForaDoTurno, type DiaDaSemana, type Expediente } from "@/lib/turno";
import { cn } from "@/lib/utils";

const horaCls = "h-8 rounded-md border bg-background px-2 text-xs disabled:opacity-70";
const numCls = "h-8 w-16 rounded-md border bg-background px-2 text-xs tabular-nums disabled:opacity-70";
const dataBr = (iso: string) => iso.split("-").reverse().join("/");

/**
 * O turno do atendimento (por dia da semana), os feriados, as faixas que o
 * inscrito escolhe e os prazos da Fila da live. Os prazos são calculados na hora
 * — salvar aqui muda o prazo de quem já está na Fila.
 */
export function ExpedienteForm({ atual, podeEditar }: { atual: Expediente; podeEditar: boolean }) {
  const router = useRouter();
  const [e, setE] = useState<Expediente>(() => structuredClone(atual));
  const [novoFeriado, setNovoFeriado] = useState("");
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const travado = !podeEditar || pending;
  const foraDoTurno = faixasForaDoTurno(e);

  const setDia = (d: DiaDaSemana, v: Expediente["dias"][DiaDaSemana]) =>
    setE((cur) => {
      const dias = { ...cur.dias };
      if (v) dias[d] = v;
      else delete dias[d];
      return { ...cur, dias };
    });
  const setFaixa = (f: HorarioPreferido, campo: "inicio" | "fim", v: string) =>
    setE((cur) => ({ ...cur, faixas: { ...cur.faixas, [f]: { ...cur.faixas[f], [campo]: v } } }));
  const setNum = (campo: "prazoAHoras" | "folgaDoHorarioHoras", v: string) => setE((cur) => ({ ...cur, [campo]: Number(v) }));
  const setCad = (campo: keyof Expediente["cadencia"], v: string) =>
    setE((cur) => ({ ...cur, cadencia: { ...cur.cadencia, [campo]: Number(v) } }));

  function salvar() {
    start(async () => {
      const r = await salvarExpediente(e);
      setMsg({ ok: r.ok, text: r.message });
      if (r.ok) router.refresh();
    });
  }

  return (
    <div className="space-y-5">
      <section className="space-y-2" id="turno">
        <h3 className="text-sm font-semibold">Turno de quem liga</h3>
        <div className="grid gap-1.5">
          {DIAS_DA_SEMANA.map((d) => {
            const j = e.dias[d];
            return (
              <div key={d} className="flex flex-wrap items-center gap-2 text-sm">
                <label className="flex w-28 items-center gap-2">
                  <input
                    type="checkbox"
                    checked={Boolean(j)}
                    disabled={travado}
                    onChange={(ev) => setDia(d, ev.target.checked ? { inicio: "16:00", fim: "22:00" } : undefined)}
                  />
                  {DIA_LABEL[d]}
                </label>
                {j ? (
                  <>
                    <input type="time" value={j.inicio} disabled={travado} onChange={(ev) => setDia(d, { ...j, inicio: ev.target.value })} className={horaCls} aria-label={`${DIA_LABEL[d]}, início`} />
                    <span className="text-xs text-muted-foreground">às</span>
                    <input type="time" value={j.fim} disabled={travado} onChange={(ev) => setDia(d, { ...j, fim: ev.target.value })} className={horaCls} aria-label={`${DIA_LABEL[d]}, fim`} />
                  </>
                ) : (
                  <span className="text-xs text-muted-foreground">sem expediente</span>
                )}
              </div>
            );
          })}
        </div>
      </section>

      <section className="space-y-2" id="feriados">
        <h3 className="text-sm font-semibold">Feriados (sem expediente)</h3>
        <div className="flex flex-wrap items-center gap-2">
          {e.feriados.length === 0 ? <span className="text-xs text-muted-foreground">nenhum</span> : null}
          {e.feriados.map((f) => (
            <span key={f} className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs">
              {dataBr(f)}
              {podeEditar ? (
                <button
                  type="button"
                  disabled={pending}
                  aria-label={`Tirar ${dataBr(f)}`}
                  onClick={() => setE((cur) => ({ ...cur, feriados: cur.feriados.filter((x) => x !== f) }))}
                  className="text-muted-foreground hover:text-foreground"
                >
                  <X className="size-3" />
                </button>
              ) : null}
            </span>
          ))}
          {podeEditar ? (
            <span className="inline-flex items-center gap-1">
              <input type="date" value={novoFeriado} disabled={pending} onChange={(ev) => setNovoFeriado(ev.target.value)} className={horaCls} aria-label="Novo feriado" />
              <button
                type="button"
                disabled={pending || !novoFeriado}
                onClick={() => {
                  setE((cur) => ({ ...cur, feriados: [...new Set([...cur.feriados, novoFeriado])].sort() }));
                  setNovoFeriado("");
                }}
                className="inline-flex h-8 items-center gap-1 rounded-md border px-2 text-xs font-medium hover:bg-foreground/5 disabled:opacity-50"
              >
                <Plus className="size-3.5" />
                Adicionar
              </button>
            </span>
          ) : null}
        </div>
      </section>

      <section className="space-y-2" id="faixas-horario">
        <h3 className="text-sm font-semibold">Faixas que o inscrito escolhe</h3>
        <div className="grid gap-1.5">
          {(Object.keys(HORARIOS) as HorarioPreferido[]).map((f) => (
            <div key={f} className="flex flex-wrap items-center gap-2 text-sm">
              <span className="w-28">{HORARIOS[f]}</span>
              <input type="time" value={e.faixas[f].inicio} disabled={travado} onChange={(ev) => setFaixa(f, "inicio", ev.target.value)} className={horaCls} aria-label={`${HORARIOS[f]}, início`} />
              <span className="text-xs text-muted-foreground">às</span>
              <input type="time" value={e.faixas[f].fim} disabled={travado} onChange={(ev) => setFaixa(f, "fim", ev.target.value)} className={horaCls} aria-label={`${HORARIOS[f]}, fim`} />
            </div>
          ))}
        </div>
        {foraDoTurno.length ? (
          <p className="flex items-start gap-2 rounded-lg border border-[var(--warning)]/50 bg-[var(--warning)]/10 p-2.5 text-xs">
            <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-[var(--warning-text)]" />
            <span>
              {foraDoTurno.map((f) => HORARIOS[f]).join(" e ")} não {foraDoTurno.length === 1 ? "cruza" : "cruzam"} nenhum turno:
              quem escolher {foraDoTurno.length === 1 ? "essa faixa" : "essas faixas"} fica com o prazo da 1ª tentativa fora do
              turno e aparece atrasado na Fila. Ajuste a faixa ou o turno.
            </span>
          </p>
        ) : null}
      </section>

      <section className="space-y-2">
        <h3 className="text-sm font-semibold">Prazos e cadência</h3>
        <div className="grid gap-1.5 text-sm">
          <label className="flex flex-wrap items-center gap-2">
            Classe A: 1ª tentativa em até
            <input type="number" step="0.25" min="0.25" max="24" value={e.prazoAHoras} disabled={travado} onChange={(ev) => setNum("prazoAHoras", ev.target.value)} className={numCls} />
            hora(s) do turno
          </label>
          <label className="flex flex-wrap items-center gap-2">
            Com horário escolhido: início da faixa +
            <input type="number" step="0.25" min="0" max="12" value={e.folgaDoHorarioHoras} disabled={travado} onChange={(ev) => setNum("folgaDoHorarioHoras", ev.target.value)} className={numCls} />
            hora(s)
          </label>
          <p className="text-xs text-muted-foreground">Classe B: até o fim do turno do dia (ou do próximo dia útil).</p>
          <label className="flex flex-wrap items-center gap-2">
            2ª tentativa (áudio):
            <input type="number" step="0.25" min="0.25" max="72" value={e.cadencia.segundaHorasDoTurno} disabled={travado} onChange={(ev) => setCad("segundaHorasDoTurno", ev.target.value)} className={numCls} />
            hora(s) do turno depois da 1ª
          </label>
          <label className="flex flex-wrap items-center gap-2">
            3ª tentativa (ligação):
            <input type="number" step="1" min="1" max="168" value={e.cadencia.terceiraHoras} disabled={travado} onChange={(ev) => setCad("terceiraHoras", ev.target.value)} className={numCls} />
            hora(s) depois da 2ª
          </label>
          <label className="flex flex-wrap items-center gap-2">
            Sem contato válido depois de
            <input type="number" step="1" min="1" max="336" value={e.cadencia.semRespostaHoras} disabled={travado} onChange={(ev) => setCad("semRespostaHoras", ev.target.value)} className={numCls} />
            h da inscrição → “Sem resposta”
          </label>
        </div>
      </section>

      <p className="text-xs text-muted-foreground">
        {atual.atualizadoEm
          ? `Última alteração: ${new Date(atual.atualizadoEm).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}${atual.atualizadoPor ? ` por ${atual.atualizadoPor}` : ""}.`
          : "Valendo o padrão do briefing: seg–sex 16h–22h, sem expediente em 20/11 — ajuste quando o turno for definido."}
      </p>
      {podeEditar ? (
        <button
          type="button"
          disabled={pending}
          onClick={salvar}
          className="h-9 rounded-lg bg-primary px-3 text-sm font-medium text-primary-foreground disabled:opacity-50"
        >
          {pending ? "Salvando…" : "Salvar turno"}
        </button>
      ) : null}
      {msg ? (
        <p className={cn("text-xs", msg.ok ? "text-muted-foreground" : "text-[var(--danger-text)]")}>{msg.text}</p>
      ) : null}
    </div>
  );
}
