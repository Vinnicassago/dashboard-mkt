"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { changeLeadStatus, reabrirLead } from "@/app/(dashboard)/pessoas/actions";
import {
  LEAD_STATUS_META,
  MOTIVOS_CONTATO_INVALIDO,
  TENTATIVAS_PARA_SEM_RESPOSTA,
  dadoExigido,
  destinosPermitidos,
  isLostStatus,
  type DadosDaTransicao,
  type EstadoParaTransicao,
} from "@/lib/lead-status";
import type { LeadStatus } from "@/lib/types";
import { cn } from "@/lib/utils";

/**
 * Rótulo e cor vêm da régua (`lib/lead-status.ts`) — este arquivo só desenha.
 * Reexportado porque metade da UI já importava daqui.
 */
export { LEAD_STATUS_META as statusMeta } from "@/lib/lead-status";

export function StatusBadge({ status }: { status: LeadStatus }) {
  const meta = LEAD_STATUS_META[status];
  return (
    <Badge variant={meta.variant} title={meta.hint}>
      {meta.label}
    </Badge>
  );
}

const campoCls =
  "h-7 rounded-md border bg-background px-1.5 text-xs focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:outline-none";

/** "250.000,00" / "250000" / "R$ 250 mil" não — só número, com vírgula ou ponto. */
function lerValor(raw: string): number | undefined {
  const n = Number(raw.replace(/[^\d,.-]/g, "").replace(/\./g, "").replace(",", "."));
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

/** Rótulo do botão quando o destino é o próprio status (remarcar). */
function rotuloDestino(atual: LeadStatus, para: LeadStatus): string {
  if (atual === "agendado" && para === "agendado") return "Remarcar";
  if (atual === "no_show" && para === "agendado") return "Remarcar";
  return LEAD_STATUS_META[para].label;
}

/**
 * Registrar o desfecho de um lead — o MESMO controle em Pessoas (`modo="select"`,
 * na linha da tabela) e na Fila (`modo="botoes"`). Só oferece destinos que a
 * máquina de estados permite (`destinosPermitidos`); pede o dado que a transição
 * exige (data, valor, motivo, confirmação) antes de gravar. O servidor confere
 * tudo de novo.
 */
export function RegistrarStatus({
  id,
  name,
  status,
  jaAgendou,
  tentativas,
  diasComTentativa,
  modo = "select",
  opcoes,
  podeReabrir = false,
  onDone,
}: {
  id: string;
  name: string;
  status: LeadStatus;
  /** O lead já teve reunião marcada (`everBooked`). */
  jaAgendou: boolean;
  /** Tentativas de contato já feitas — decidem se "Sem resposta" pede confirmação. */
  tentativas?: number;
  diasComTentativa?: number;
  modo?: "select" | "botoes";
  /** Restringe os destinos. */
  opcoes?: LeadStatus[];
  /** Administrador: lead encerrado ganha "Reabrir" (com motivo). */
  podeReabrir?: boolean;
  /** Depois de gravar. Sem isso, a página é recarregada. */
  onDone?: (message: string) => void;
}) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [escolhido, setEscolhido] = useState<LeadStatus | null>(null);
  const [data, setData] = useState("");
  const [valor, setValor] = useState("");
  const [motivo, setMotivo] = useState("");
  const router = useRouter();

  const estado: EstadoParaTransicao = { status, jaAgendou, tentativas, diasComTentativa };
  const destinos = destinosPermitidos(estado).filter((s) => !opcoes || opcoes.includes(s));
  const exigido = escolhido ? dadoExigido(escolhido, estado) : null;

  function enviar(para: LeadStatus, dados: DadosDaTransicao) {
    start(async () => {
      const r = await changeLeadStatus(id, para, dados);
      setMsg({ ok: r.ok, text: r.message });
      if (!r.ok) return;
      setEscolhido(null);
      setData("");
      setValor("");
      setMotivo("");
      if (onDone) onDone(r.message);
      else router.refresh();
    });
  }

  function escolher(para: LeadStatus) {
    setMsg(null);
    if (dadoExigido(para, estado)) setEscolhido(para);
    else enviar(para, {});
  }

  function confirmar() {
    if (!escolhido) return;
    if (exigido === "motivo") {
      if (!motivo) {
        setMsg({ ok: false, text: "Diga por que o contato é inválido." });
        return;
      }
      enviar(escolhido, { motivo });
      return;
    }
    if (exigido === "confirmacao") {
      enviar(escolhido, { confirmado: true });
      return;
    }
    if (escolhido === "agendado") {
      // datetime-local vem no horário do navegador; vira instante absoluto aqui.
      const t = data ? new Date(data) : null;
      if (!t || Number.isNaN(t.getTime())) {
        setMsg({ ok: false, text: "Informe a data e a hora da reunião." });
        return;
      }
      enviar("agendado", { meetingFor: t.toISOString() });
    } else if (escolhido === "cliente") {
      const v = lerValor(valor);
      if (!v) {
        setMsg({ ok: false, text: "Informe o valor da carta (R$)." });
        return;
      }
      enviar("cliente", { value: v });
    }
  }

  const abertos = destinos.filter((s) => !isLostStatus(s));
  const perdas = destinos.filter((s) => isLostStatus(s));

  return (
    <div className="flex flex-col gap-1.5">
      {modo === "select" ? (
        <div className="flex items-center gap-2">
          <StatusBadge status={status} />
          {destinos.length === 0 ? (
            podeReabrir ? (
              <button
                type="button"
                disabled={pending}
                onClick={() => {
                  const motivo = window.prompt(`Reabrir o lead "${name}"? Diga o motivo (ex.: retornou o contato):`);
                  if (!motivo?.trim()) return;
                  start(async () => {
                    const r = await reabrirLead(id, motivo);
                    setMsg({ ok: r.ok, text: r.message });
                    if (r.ok) {
                      if (onDone) onDone(r.message);
                      else router.refresh();
                    }
                  });
                }}
                className={cn(campoCls, "px-2 text-muted-foreground hover:text-foreground")}
              >
                Reabrir
              </button>
            ) : null
          ) : (
          <select
            aria-label={`Mudar status de ${name}`}
            value=""
            disabled={pending}
            onChange={(e) => e.target.value && escolher(e.target.value as LeadStatus)}
            className={cn(campoCls, pending && "opacity-50")}
          >
            <option value="">Mudar…</option>
            {/* Caminho feliz e motivos de perda separados — sem a divisão o
                comercial erra o clique. */}
            {abertos.length ? (
              <optgroup label="Em andamento">
                {abertos.map((s) => (
                  <option key={s} value={s} title={LEAD_STATUS_META[s].hint}>
                    {rotuloDestino(status, s)}
                  </option>
                ))}
              </optgroup>
            ) : null}
            {perdas.length ? (
              <optgroup label="Perdido — por quê">
                {perdas.map((s) => (
                  <option key={s} value={s} title={LEAD_STATUS_META[s].hint}>
                    {LEAD_STATUS_META[s].label}
                  </option>
                ))}
              </optgroup>
            ) : null}
          </select>
          )}
        </div>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {destinos.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => escolher(s)}
              disabled={pending}
              title={LEAD_STATUS_META[s].hint}
              className={cn(
                "rounded-md border px-2 py-1 text-xs hover:bg-foreground/5 disabled:opacity-50",
                escolhido === s && "border-primary text-primary",
              )}
            >
              {rotuloDestino(status, s)}
            </button>
          ))}
        </div>
      )}

      {escolhido ? (
        <div className="flex flex-wrap items-center gap-1.5">
          {exigido === "data" ? (
            <input
              type="datetime-local"
              aria-label="Data e hora da reunião"
              value={data}
              onChange={(e) => setData(e.target.value)}
              className={campoCls}
            />
          ) : exigido === "valor" ? (
            <input
              type="text"
              inputMode="decimal"
              aria-label="Valor da carta (R$)"
              placeholder="Valor da carta (R$)"
              value={valor}
              onChange={(e) => setValor(e.target.value)}
              className={cn(campoCls, "w-40")}
            />
          ) : exigido === "motivo" ? (
            <select
              aria-label="Por que o contato é inválido"
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              className={campoCls}
            >
              <option value="">Por quê?</option>
              {Object.entries(MOTIVOS_CONTATO_INVALIDO).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          ) : (
            <span className="text-[11px] text-[var(--warning-text)]">
              Só {tentativas ?? 0} tentativa(s) — a régua pede {TENTATIVAS_PARA_SEM_RESPOSTA} em 2 dias.
            </span>
          )}
          <button
            type="button"
            onClick={confirmar}
            disabled={pending}
            className="h-7 rounded-md bg-primary px-2.5 text-xs font-medium text-primary-foreground disabled:opacity-50"
          >
            {exigido === "data"
              ? status === "agendado" || status === "no_show"
                ? "Remarcar"
                : "Agendar"
              : exigido === "valor"
                ? "Registrar venda"
                : exigido === "confirmacao"
                  ? "Encerrar mesmo assim"
                  : "Confirmar"}
          </button>
          <button
            type="button"
            onClick={() => setEscolhido(null)}
            disabled={pending}
            className="h-7 rounded-md border px-2 text-xs text-muted-foreground hover:text-foreground"
          >
            Cancelar
          </button>
        </div>
      ) : null}

      {msg ? (
        <span className={cn("text-[11px]", msg.ok ? "text-muted-foreground" : "text-[var(--danger-text)]")}>
          {msg.text}
        </span>
      ) : null}
    </div>
  );
}
