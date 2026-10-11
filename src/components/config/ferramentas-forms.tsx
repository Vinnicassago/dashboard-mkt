"use client";

import { useActionState, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Download, Stethoscope } from "lucide-react";
import {
  diagnosticoLeadsAction,
  repararLeadsAction,
  setMensagemWhatsappAction,
  type ActionState,
} from "@/app/(dashboard)/configuracoes/actions";
import type { DiagnosticoLeads } from "@/lib/diagnostico-leads";
import { statusLabel } from "@/lib/lead-status";
import { formatDateTime } from "@/lib/format";
import { Message, SubmitButton, baixarArquivo } from "./form-primitives";

/** Ferramentas (relatório §7.7, item 6): mensagem da Fila e diagnóstico dos leads. */

// ---- mensagem do WhatsApp (Fila) -------------------------------------

/** Texto que o botão de WhatsApp da Fila já deixa escrito. */
export function MensagemWhatsappForm({ atual, padrao }: { atual: string; padrao: string }) {
  const [state, action] = useActionState(setMensagemWhatsappAction, null);
  return (
    <form action={action} className="space-y-2">
      <textarea
        name="mensagem"
        defaultValue={atual === padrao ? "" : atual}
        placeholder={padrao}
        rows={3}
        maxLength={600}
        className="w-full rounded-lg border bg-background p-3 text-sm outline-none focus:ring-2 focus:ring-ring/40"
      />
      <p className="text-xs text-muted-foreground">
        Use <code className="font-mono">{"{nome}"}</code> para o primeiro nome. Em branco = a mensagem padrão
        (mostrada acima, apagada).
      </p>
      <SubmitButton>Salvar mensagem</SubmitButton>
      <Message state={state} />
    </form>
  );
}

// ---- diagnóstico dos leads (D8) ------------------------------------

function Numero({ label, valor, hint }: { label: string; valor: number; hint?: string }) {
  return (
    <div className="rounded-lg border px-3 py-2" title={hint}>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-lg font-semibold tabular-nums">{valor}</p>
    </div>
  );
}

/**
 * Um id em que várias pessoas caíram: cada cadastro sobrescreveu o anterior e
 * só o último ficou no banco. O histórico guardou nome e data de quem sumiu —
 * telefone e e-mail não. O CSV serve para cruzar com o outro destino da LP
 * (planilha / n8n) e reimportar quem faltar.
 */
function ColisaoCard({ colisao }: { colisao: DiagnosticoLeads["colisoes"][number] }) {
  const exportar = () => {
    const linhas = [
      ["Nome", "Primeiro envio", "Envios", "Id compartilhado"].join(";"),
      ...colisao.sobrescritos.map((p) =>
        [p.nome.replace(/;/g, ","), formatDateTime(p.primeiraVez), String(p.envios), colisao.leadId].join(";"),
      ),
    ];
    baixarArquivo("leads-sobrescritos.csv", "﻿" + linhas.join("\r\n"));
  };
  return (
    <div className="space-y-2 rounded-lg border border-[var(--danger-text)]/30 p-3">
      <p className="text-sm">
        <strong>{colisao.sobrescritos.length} pessoa(s) sumiram</strong> num único id (
        <code className="font-mono text-xs">{colisao.leadId}</code>): {colisao.criacoes} cadastros caíram nele,
        cada um apagando o anterior. Hoje só existe <strong>{colisao.nomeAtual}</strong>. Nomes e datas estão
        abaixo; telefone e e-mail se perderam aqui — procure-os no outro destino da landing page (planilha /
        n8n) e reimporte pelo CSV de leads. A causa foi corrigida: cadastros novos não se sobrescrevem mais.
      </p>
      <div className="max-h-60 overflow-auto rounded-md border">
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-card text-left text-muted-foreground">
            <tr>
              <th className="p-2">Nome</th>
              <th className="p-2">Primeiro envio</th>
              <th className="p-2 text-right">Envios</th>
            </tr>
          </thead>
          <tbody>
            {colisao.sobrescritos.map((p) => (
              <tr key={`${p.nome}-${p.primeiraVez}`} className="border-t">
                <td className="p-2">{p.nome}</td>
                <td className="p-2">{formatDateTime(p.primeiraVez)}</td>
                <td className="p-2 text-right tabular-nums">{p.envios}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <button
        type="button"
        onClick={exportar}
        className="inline-flex h-8 items-center gap-2 rounded-lg border px-3 text-xs font-medium text-muted-foreground hover:text-foreground"
      >
        <Download className="size-3.5" />
        Exportar lista (CSV)
      </button>
    </div>
  );
}

/**
 * Lê o histórico e mostra o que os reenvios da LP fizeram com os leads. Nada é
 * alterado até alguém marcar os leads e clicar em "Aplicar".
 */
export function DiagnosticoLeadsPanel() {
  const [pending, startTransition] = useTransition();
  const [diag, setDiag] = useState<DiagnosticoLeads | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [marcados, setMarcados] = useState<Set<string>>(new Set());
  const [state, setState] = useState<ActionState | null>(null);
  const router = useRouter();

  const rodar = () =>
    startTransition(async () => {
      const r = await diagnosticoLeadsAction();
      if (!r.ok) {
        setErro(r.message);
        return;
      }
      setErro(null);
      setDiag(r.diagnostico);
      setMarcados(new Set(r.diagnostico.reparos.map((x) => x.leadId)));
    });

  return (
    <div className="space-y-4">
      <button
        type="button"
        disabled={pending}
        onClick={rodar}
        className="inline-flex h-9 items-center gap-2 rounded-lg border px-3 text-sm font-medium text-muted-foreground hover:text-foreground disabled:opacity-50"
      >
        <Stethoscope className="size-4" />
        {pending ? "Lendo o histórico…" : diag ? "Rodar de novo" : "Rodar diagnóstico"}
      </button>
      {erro ? <p className="text-sm text-[var(--danger-text)]">{erro}</p> : null}

      {diag ? (
        <>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Numero label="Criações pela LP" valor={diag.criacoesLp} hint="Eventos de criação vindos da landing page" />
            <Numero label="Leads da LP" valor={diag.leadsLp} hint="Leads que entraram pela landing page (pelo histórico), inclusive excluídos" />
            <Numero label="Leads com reenvio" valor={diag.reenvios.length} hint="Mesmo id, mais de uma criação, mesmo nome" />
            <Numero label="Colisões de id" valor={diag.colisoes.length} hint="Mesmo id, nomes diferentes: duas pessoas" />
            <Numero label="Criações sem lead" valor={diag.orfaos} hint="Lead apagado fora do painel" />
            <Numero label="Em outra marca" valor={diag.foraDaMarcaPadrao} hint="Leads da LP fora da marca padrão" />
            <Numero label="Excluídos" valor={diag.excluidos} />
            <Numero label="Registros em lote" valor={diag.rajadas.length} hint="10+ mudanças de status do mesmo usuário em 15 min" />
          </div>

          {diag.rajadas.length ? (
            <p className="text-xs text-muted-foreground">
              Registros em lote:{" "}
              {diag.rajadas
                .slice(0, 5)
                .map((r) => `${r.actor} · ${r.eventos} em ${formatDateTime(r.inicio)}`)
                .join(" · ")}
              . Status registrado em lote, dias depois, não mede velocidade de contato.
            </p>
          ) : null}

          {diag.colisoes.map((c) => (
            <ColisaoCard key={c.leadId} colisao={c} />
          ))}

          {diag.reparos.length === 0 ? (
            <p className="text-sm text-[var(--success-text)]">Nenhum lead com status ou data de entrada para reparar.</p>
          ) : (
            <div className="space-y-2">
              <p className="text-sm">
                <strong>{diag.reparos.length}</strong> lead(s) com algo que o histórico permite consertar. Confira e
                desmarque o que não quiser aplicar.
              </p>
              <div className="max-h-80 overflow-auto rounded-lg border">
                <table className="w-full text-xs">
                  <thead className="sticky top-0 bg-card text-left text-muted-foreground">
                    <tr>
                      <th className="p-2"></th>
                      <th className="p-2">Lead</th>
                      <th className="p-2">Status</th>
                      <th className="p-2">Entrada</th>
                      <th className="p-2">Marcos</th>
                    </tr>
                  </thead>
                  <tbody>
                    {diag.reparos.map((r) => (
                      <tr key={r.leadId} className="border-t">
                        <td className="p-2">
                          <input
                            type="checkbox"
                            aria-label={`Reparar ${r.nome}`}
                            checked={marcados.has(r.leadId)}
                            onChange={(e) => {
                              const next = new Set(marcados);
                              if (e.target.checked) next.add(r.leadId);
                              else next.delete(r.leadId);
                              setMarcados(next);
                            }}
                          />
                        </td>
                        <td className="p-2 font-medium">{r.nome}</td>
                        <td className="p-2">
                          {r.statusProposto ? `${statusLabel(r.statusAtual)} → ${statusLabel(r.statusProposto)}` : "—"}
                        </td>
                        <td className="p-2">
                          {r.entradaProposta ? `${formatDateTime(r.entradaAtual)} → ${formatDateTime(r.entradaProposta)}` : "—"}
                        </td>
                        <td className="p-2 text-muted-foreground">
                          {[r.bookedAt && "agendou", r.attendedAt && "compareceu", r.closedAt && "fechou"]
                            .filter(Boolean)
                            .join(", ") || "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <button
                type="button"
                disabled={pending || marcados.size === 0}
                onClick={() => {
                  if (!window.confirm(`Aplicar o reparo em ${marcados.size} lead(s)? Cada mudança de status entra no histórico.`)) return;
                  startTransition(async () => {
                    const r = await repararLeadsAction([...marcados]);
                    setState(r);
                    router.refresh();
                    if (r.ok) setDiag(null);
                  });
                }}
                className="inline-flex h-9 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
              >
                Aplicar reparo ({marcados.size})
              </button>
            </div>
          )}
        </>
      ) : null}
      <Message state={state} />
    </div>
  );
}
