"use client";

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { MessageCircle, Undo2 } from "lucide-react";
import { changeLeadStatus, desfazerTentativa, registrarResultadoDoContato } from "@/app/(dashboard)/leads/actions";
import { ClasseBadge } from "@/components/leads/classe-badge";
import { Card, CardContent } from "@/components/ui/card";
import { useComPeriodo } from "@/components/layout/use-periodo";
import { CANAL_LABEL, linkWhatsapp, type CanalContato } from "@/lib/contato";
import { ETAPA_DA_LIVE, tempoAtePrazo, type ItemDaFilaLive } from "@/lib/fila-live";
import { formatDateTime } from "@/lib/format";
import { HORARIOS, RESULTADOS_CONTATO, type ResultadoContato } from "@/lib/qualificacao";
import { cn } from "@/lib/utils";

/** Quanto tempo o "Desfazer" fica na tela depois de uma tentativa. */
const DESFAZER_MS = 10_000;

/**
 * A Fila da live: A e B, do prazo mais antigo para o mais novo. A atrasado em
 * vermelho, B atrasado em laranja — sempre com o texto "atrasado" junto (a cor
 * nunca é a única pista). Tentativa e resultado se registram no próprio cartão.
 */
export function FilaLive({
  itens,
  canEdit,
  mensagemWhatsapp,
}: {
  itens: ItemDaFilaLive[];
  canEdit: boolean;
  mensagemWhatsapp: string;
}) {
  if (itens.length === 0) {
    return (
      <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
        Nenhum A ou B esperando tentativa agora.
      </p>
    );
  }
  return (
    <div className="space-y-3">
      {itens.map((i) => (
        <CartaoLive key={i.leadId} item={i} canEdit={canEdit} mensagemWhatsapp={mensagemWhatsapp} />
      ))}
    </div>
  );
}

function CartaoLive({ item, canEdit, mensagemWhatsapp }: { item: ItemDaFilaLive; canEdit: boolean; mensagemWhatsapp: string }) {
  const router = useRouter();
  const comPeriodo = useComPeriodo();
  const [pending, start] = useTransition();
  const [canal, setCanal] = useState<CanalContato>("ligacao");
  const [nota, setNota] = useState("");
  const [agendando, setAgendando] = useState(false);
  const [reuniaoEm, setReuniaoEm] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [desfazivel, setDesfazivel] = useState<string | null>(null);

  useEffect(() => {
    if (!desfazivel) return;
    const t = setTimeout(() => setDesfazivel(null), DESFAZER_MS);
    return () => clearTimeout(t);
  }, [desfazivel]);

  const atrasoA = item.atrasado && item.classe === "A";
  const atrasoB = item.atrasado && item.classe === "B";

  function registrar(resultado: ResultadoContato) {
    if (resultado === "agendou" && !reuniaoEm) {
      setMsg({ ok: false, text: "Informe a data e a hora da reunião." });
      return;
    }
    start(async () => {
      const r = await registrarResultadoDoContato(item.leadId, {
        canal,
        resultado,
        nota,
        reuniaoEm: resultado === "agendou" ? new Date(reuniaoEm).toISOString() : undefined,
      });
      setMsg({ ok: r.ok, text: r.message });
      if (r.ok) {
        setNota("");
        setAgendando(false);
        setDesfazivel(r.eventoId ?? null);
        router.refresh();
      }
    });
  }

  function encerrar() {
    if (!window.confirm(`Encerrar ${item.nome} como “Sem resposta”?`)) return;
    start(async () => {
      const r = await changeLeadStatus(item.leadId, "sem_resposta", { confirmado: true });
      setMsg({ ok: r.ok, text: r.message });
      if (r.ok) router.refresh();
    });
  }

  function desfazer() {
    if (!desfazivel) return;
    const alvo = desfazivel;
    start(async () => {
      const r = await desfazerTentativa(item.leadId, alvo);
      setDesfazivel(null);
      setMsg({ ok: r.ok, text: r.message });
      router.refresh();
    });
  }

  const chip = (ativo: boolean) =>
    cn(
      "rounded-full border px-2.5 py-1 text-xs",
      ativo ? "border-primary text-primary" : "text-muted-foreground hover:text-foreground",
    );

  return (
    <Card
      className={cn(
        atrasoA && "border-[var(--status-fora)]/60 bg-[var(--status-fora)]/[0.06]",
        atrasoB && "border-[var(--status-perto)]/60 bg-[var(--status-perto)]/[0.08]",
      )}
    >
      <CardContent className="space-y-3 p-4">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0 space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <Link
                href={comPeriodo(`/leads/${encodeURIComponent(item.leadId)}`)}
                className="font-medium hover:underline"
              >
                {item.nome}
              </Link>
              <ClasseBadge classe={item.classe} />
              <span className="text-xs text-muted-foreground">{ETAPA_DA_LIVE[item.etapa].label}</span>
            </div>
            <p className="text-xs text-muted-foreground">
              {item.contato.tentativas} {item.contato.tentativas === 1 ? "tentativa" : "tentativas"}
              {item.contato.ultima ? ` · última ${formatDateTime(item.contato.ultima)}` : ""}
              {item.horarioPreferido ? ` · prefere ${HORARIOS[item.horarioPreferido].toLowerCase()}` : ""}
              {item.escaladoEm ? ` · escalado ${formatDateTime(item.escaladoEm)}` : ""}
            </p>
          </div>
          <div className="text-right">
            <p
              className={cn(
                "text-sm font-semibold tabular-nums",
                atrasoA ? "text-[var(--status-fora-text)]" : atrasoB ? "text-[var(--status-perto-text)]" : "text-[var(--success-text)]",
              )}
            >
              {tempoAtePrazo(item.minutosParaPrazo)}
            </p>
            <p className="text-xs text-muted-foreground">prazo {formatDateTime(item.prazo)}</p>
          </div>
        </div>

        {canEdit ? (
          item.etapa === "encerrar" ? (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs text-muted-foreground">
                Sem contato válido na janela de 48 h — a cadência acabou.
              </span>
              <button
                type="button"
                disabled={pending}
                onClick={encerrar}
                className="h-8 rounded-md border px-3 text-xs font-medium hover:bg-foreground/5 disabled:opacity-50"
              >
                {ETAPA_DA_LIVE.encerrar.acao}
              </button>
            </div>
          ) : (
            <div className="space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                {item.telefone ? (
                  <a
                    href={linkWhatsapp(item.telefone, mensagemWhatsapp, item.nome)}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={() => setCanal("whatsapp")}
                    className="inline-flex h-8 items-center gap-1.5 rounded-md border px-2.5 text-xs font-medium hover:bg-foreground/5"
                  >
                    <MessageCircle className="size-3.5 text-[var(--success-text)]" />
                    WhatsApp
                  </a>
                ) : null}
                {(Object.keys(CANAL_LABEL) as CanalContato[]).map((c) => (
                  <button key={c} type="button" onClick={() => setCanal(c)} className={chip(canal === c)}>
                    {CANAL_LABEL[c]}
                  </button>
                ))}
              </div>
              <input
                value={nota}
                onChange={(e) => setNota(e.target.value)}
                maxLength={2000}
                placeholder="Notas da ligação (opcional)"
                className="h-8 w-full rounded-md border bg-background px-2 text-xs outline-none focus:ring-2 focus:ring-ring/40"
              />
              <div className="flex flex-wrap items-center gap-2">
                {(["nao_atendeu", "falou"] as const).map((r) => (
                  <button
                    key={r}
                    type="button"
                    disabled={pending}
                    onClick={() => registrar(r)}
                    className={cn(
                      "h-8 rounded-md px-3 text-xs font-medium disabled:opacity-50",
                      r === "falou" ? "bg-primary text-primary-foreground" : "border hover:bg-foreground/5",
                    )}
                  >
                    {RESULTADOS_CONTATO[r]}
                  </button>
                ))}
                <button type="button" disabled={pending} onClick={() => setAgendando((v) => !v)} className={chip(agendando)}>
                  {RESULTADOS_CONTATO.agendou}…
                </button>
                {(["numero_invalido", "sem_interesse"] as const).map((r) => (
                  <button
                    key={r}
                    type="button"
                    disabled={pending}
                    onClick={() => {
                      if (window.confirm(`“${RESULTADOS_CONTATO[r]}” encerra o lead. Confirmar?`)) registrar(r);
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
                  <label className="text-xs text-muted-foreground" htmlFor={`reuniao-live-${item.leadId}`}>
                    Reunião em
                  </label>
                  <input
                    id={`reuniao-live-${item.leadId}`}
                    type="datetime-local"
                    value={reuniaoEm}
                    onChange={(e) => setReuniaoEm(e.target.value)}
                    className="h-8 rounded-md border bg-background px-2 text-xs"
                  />
                  <button
                    type="button"
                    disabled={pending || !reuniaoEm}
                    onClick={() => registrar("agendou")}
                    className="h-8 rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground disabled:opacity-50"
                  >
                    Registrar e agendar
                  </button>
                </div>
              ) : null}
            </div>
          )
        ) : null}
        {msg ? (
          <p className={cn("text-xs", msg.ok ? "text-muted-foreground" : "text-[var(--danger-text)]")}>{msg.text}</p>
        ) : null}
      </CardContent>
    </Card>
  );
}
