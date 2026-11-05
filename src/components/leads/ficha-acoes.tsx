"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { MessageCircle, Undo2 } from "lucide-react";
import {
  anotarLead,
  desfazerTentativa,
  marcarReuniao,
  registrarResultadoDoContato,
} from "@/app/(dashboard)/leads/actions";
import { RegistrarStatus } from "@/components/tables/lead-status";
import { CANAL_LABEL, linkWhatsapp, type CanalContato } from "@/lib/contato";
import { TRANSICOES, encerrado } from "@/lib/lead-status";
import { RESULTADOS_CONTATO, type ResultadoContato } from "@/lib/qualificacao";
import type { LeadStatus } from "@/lib/types";
import { cn } from "@/lib/utils";

/** Quanto tempo o "Desfazer" fica na tela depois de uma tentativa. */
const DESFAZER_MS = 10_000;

/**
 * As ações da ficha — as mesmas da Fila (tentativa, desfecho) mais a anotação.
 * Quem abre a ficha de alguém costuma estar com a pessoa na linha: registrar
 * tem de ser ali, não em outra tela.
 */
export function FichaAcoes({
  id,
  name,
  status,
  jaAgendou,
  tentativas,
  diasComTentativa,
  telefone,
  mensagemWhatsapp,
  canEdit,
  podeReabrir,
  optOut = false,
}: {
  id: string;
  name: string;
  status: LeadStatus;
  jaAgendou: boolean;
  tentativas: number;
  diasComTentativa: number;
  telefone?: string;
  mensagemWhatsapp: string;
  canEdit: boolean;
  podeReabrir: boolean;
  /** Pediu ao robô para não receber mensagens (LGPD): sem WhatsApp, nem no registro (o servidor também recusa). */
  optOut?: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [canalEscolhido, setCanal] = useState<CanalContato>(optOut ? "ligacao" : "whatsapp");
  // O opt-out pode chegar depois da montagem (`router.refresh` mantém o estado): o
  // canal bloqueado nunca fica escolhido nem vai para o servidor.
  const canal: CanalContato = optOut && canalEscolhido === "whatsapp" ? "ligacao" : canalEscolhido;
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [desfazivel, setDesfazivel] = useState<string | null>(null);
  const [nota, setNota] = useState("");
  const [notaDaLigacao, setNotaDaLigacao] = useState("");
  const [agendando, setAgendando] = useState(false);
  const [reuniaoEm, setReuniaoEm] = useState("");

  useEffect(() => {
    if (!desfazivel) return;
    const t = setTimeout(() => setDesfazivel(null), DESFAZER_MS);
    return () => clearTimeout(t);
  }, [desfazivel]);

  const fechado = encerrado(status);
  // "Agendou" só onde a régua deixa ir para "Agendado" (de Novo/Em contato; de Não compareceu é remarcar).
  const destinoAgendado = TRANSICOES[status === "lead" ? "em_contato" : status].includes("agendado");

  function tentativa(resultado: ResultadoContato) {
    if (resultado === "agendou" && !reuniaoEm) {
      setMsg({ ok: false, text: "Informe a data e a hora da reunião." });
      return;
    }
    start(async () => {
      const r = await registrarResultadoDoContato(id, {
        canal,
        resultado,
        nota: notaDaLigacao,
        reuniaoEm: resultado === "agendou" && reuniaoEm ? new Date(reuniaoEm).toISOString() : undefined,
      });
      setMsg({ ok: r.ok, text: r.message });
      if (r.ok) {
        setDesfazivel(r.eventoId ?? null);
        setNotaDaLigacao("");
        setAgendando(false);
        setReuniaoEm("");
        router.refresh();
      }
    });
  }

  function reuniao(o: "confirmada" | "remarcar") {
    start(async () => {
      const r = await marcarReuniao(id, o);
      setMsg({ ok: r.ok, text: r.message });
      if (r.ok) router.refresh();
    });
  }

  function desfazer() {
    if (!desfazivel) return;
    const alvo = desfazivel;
    start(async () => {
      const r = await desfazerTentativa(id, alvo);
      setDesfazivel(null);
      setMsg({ ok: r.ok, text: r.message });
      router.refresh();
    });
  }

  function salvarNota() {
    start(async () => {
      const r = await anotarLead(id, nota);
      setMsg({ ok: r.ok, text: r.message });
      if (r.ok) {
        setNota("");
        router.refresh();
      }
    });
  }

  const chip = (ativo: boolean) =>
    cn(
      "rounded-full border px-2.5 py-1 text-xs",
      ativo ? "border-primary text-primary" : "text-muted-foreground hover:text-foreground",
    );

  return (
    <div className="space-y-5">
      {telefone && !optOut ? (
        <a
          href={linkWhatsapp(telefone, mensagemWhatsapp, name)}
          target="_blank"
          rel="noopener noreferrer"
          onClick={() => setCanal("whatsapp")}
          className="inline-flex h-9 items-center gap-1.5 rounded-md border px-3 text-sm font-medium hover:bg-foreground/5"
        >
          <MessageCircle className="size-4 text-[var(--success-text)]" />
          Abrir o WhatsApp com a mensagem
        </a>
      ) : null}

      {canEdit && !fechado ? (
        <section className="space-y-2">
          <h3 className="text-sm font-semibold">Tentativa de contato</h3>
          <div className="flex flex-wrap items-center gap-2">
            {(Object.keys(CANAL_LABEL) as CanalContato[]).map((c) => {
              const bloqueado = c === "whatsapp" && optOut;
              return (
                <button
                  key={c}
                  type="button"
                  disabled={bloqueado}
                  title={bloqueado ? "Pediu para não receber mensagens" : undefined}
                  onClick={() => setCanal(c)}
                  className={cn(chip(canal === c), "disabled:cursor-not-allowed disabled:opacity-40")}
                >
                  {CANAL_LABEL[c]}
                </button>
              );
            })}
          </div>
          <textarea
            value={notaDaLigacao}
            onChange={(e) => setNotaDaLigacao(e.target.value)}
            rows={2}
            maxLength={2000}
            placeholder="Notas da ligação (opcional) — o que a pessoa disse"
            className="w-full rounded-lg border bg-background p-2 text-sm outline-none focus:ring-2 focus:ring-ring/40"
          />
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-muted-foreground">Resultado:</span>
            {(["nao_atendeu", "falou"] as const).map((r) => (
              <button
                key={r}
                type="button"
                disabled={pending}
                onClick={() => tentativa(r)}
                className={cn(
                  "h-8 rounded-md px-3 text-xs font-medium disabled:opacity-50",
                  r === "falou" ? "bg-primary text-primary-foreground" : "border hover:bg-foreground/5",
                )}
              >
                {RESULTADOS_CONTATO[r]}
              </button>
            ))}
            {destinoAgendado ? (
              <button
                type="button"
                disabled={pending}
                onClick={() => setAgendando((v) => !v)}
                className={chip(agendando)}
              >
                {RESULTADOS_CONTATO.agendou}…
              </button>
            ) : null}
            {(["numero_invalido", "sem_interesse"] as const).map((r) => (
              <button
                key={r}
                type="button"
                disabled={pending}
                onClick={() => {
                  if (window.confirm(`Registrar “${RESULTADOS_CONTATO[r]}” encerra o lead. Confirmar?`)) tentativa(r);
                }}
                className="h-8 rounded-md border px-3 text-xs font-medium text-muted-foreground hover:bg-foreground/5 disabled:opacity-50"
              >
                {RESULTADOS_CONTATO[r]}
              </button>
            ))}
            {desfazivel ? (
              <button
                type="button"
                disabled={pending}
                onClick={desfazer}
                className="inline-flex h-8 items-center gap-1 rounded-md border px-2 text-xs font-medium hover:bg-foreground/5 disabled:opacity-50"
              >
                <Undo2 className="size-3.5" />
                Desfazer
              </button>
            ) : null}
          </div>
          {agendando ? (
            <div className="flex flex-wrap items-center gap-2">
              <label className="text-xs text-muted-foreground" htmlFor={`reuniao-${id}`}>
                Reunião em
              </label>
              <input
                id={`reuniao-${id}`}
                type="datetime-local"
                value={reuniaoEm}
                onChange={(e) => setReuniaoEm(e.target.value)}
                className="h-8 rounded-md border bg-background px-2 text-xs"
              />
              <button
                type="button"
                disabled={pending || !reuniaoEm}
                onClick={() => tentativa("agendou")}
                className="h-8 rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground disabled:opacity-50"
              >
                Registrar e agendar
              </button>
            </div>
          ) : null}
        </section>
      ) : null}

      {canEdit && (status === "agendado" || status === "no_show") ? (
        <section className="space-y-2">
          <h3 className="text-sm font-semibold">Reunião</h3>
          <div className="flex flex-wrap items-center gap-2">
            {status === "agendado" ? (
              <button
                type="button"
                disabled={pending}
                onClick={() => reuniao("confirmada")}
                className="h-8 rounded-md border px-3 text-xs font-medium hover:bg-foreground/5 disabled:opacity-50"
              >
                Pessoa confirmou
              </button>
            ) : null}
            <button
              type="button"
              disabled={pending}
              onClick={() => reuniao("remarcar")}
              className="h-8 rounded-md border px-3 text-xs font-medium hover:bg-foreground/5 disabled:opacity-50"
            >
              Pediu para remarcar
            </button>
          </div>
        </section>
      ) : null}

      {canEdit ? (
        <section className="space-y-2">
          <h3 className="text-sm font-semibold">Desfecho</h3>
          <RegistrarStatus
            id={id}
            name={name}
            status={status}
            jaAgendou={jaAgendou}
            tentativas={tentativas}
            diasComTentativa={diasComTentativa}
            podeReabrir={podeReabrir}
            modo="botoes"
            onDone={(m) => {
              setMsg({ ok: true, text: m });
              router.refresh();
            }}
          />
        </section>
      ) : null}

      {canEdit ? (
        <section className="space-y-2">
          <h3 className="text-sm font-semibold">Anotação</h3>
          <textarea
            value={nota}
            onChange={(e) => setNota(e.target.value)}
            rows={3}
            maxLength={2000}
            placeholder="O que a pessoa disse, o que ficou combinado…"
            className="w-full rounded-lg border bg-background p-2 text-sm outline-none focus:ring-2 focus:ring-ring/40"
          />
          <button
            type="button"
            disabled={pending || !nota.trim()}
            onClick={salvarNota}
            className="h-8 rounded-md border px-3 text-xs font-medium hover:bg-foreground/5 disabled:opacity-50"
          >
            Salvar anotação
          </button>
        </section>
      ) : null}

      {msg ? (
        <p className={cn("text-xs", msg.ok ? "text-muted-foreground" : "text-[var(--danger-text)]")}>{msg.text}</p>
      ) : null}
    </div>
  );
}
