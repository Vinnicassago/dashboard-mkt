"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Pencil } from "lucide-react";
import { salvarRespostas } from "@/app/(dashboard)/leads/actions";
import {
  BENS,
  FAIXAS_PARCELA,
  FAIXAS_VALOR,
  FINALIDADES,
  HORARIOS,
  PRAZOS_COMPRA,
  type Bem,
  type FaixaParcela,
  type FaixaValor,
  type Finalidade,
  type HorarioPreferido,
  type PrazoCompra,
} from "@/lib/qualificacao";
import { cn } from "@/lib/utils";

export interface RespostasAtuais {
  bem?: Bem;
  faixaValor?: FaixaValor;
  finalidade?: Finalidade;
  faixaParcela?: FaixaParcela;
  prazoCompra?: PrazoCompra;
  horarioPreferido?: HorarioPreferido;
  aceiteMensagens?: boolean;
}

const CAMPOS = [
  { key: "bem", rotulo: "Bem", vocab: BENS },
  { key: "faixaValor", rotulo: "Valor", vocab: FAIXAS_VALOR },
  { key: "finalidade", rotulo: "Finalidade", vocab: FINALIDADES },
  { key: "faixaParcela", rotulo: "Parcela que cabe", vocab: FAIXAS_PARCELA },
  { key: "prazoCompra", rotulo: "Prazo", vocab: PRAZOS_COMPRA },
  { key: "horarioPreferido", rotulo: "Horário preferido", vocab: HORARIOS },
] as const;

/**
 * As respostas do formulário na ficha — lidas do jeito que a pessoa respondeu e,
 * para quem pode alterar leads, corrigíveis ali mesmo (a classe do painel é
 * recalculada no servidor).
 */
export function FichaQualificacao({ id, atuais, canEdit }: { id: string; atuais: RespostasAtuais; canEdit: boolean }) {
  const router = useRouter();
  const [editando, setEditando] = useState(false);
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [valores, setValores] = useState<Record<string, string>>(() =>
    Object.fromEntries(CAMPOS.map((c) => [c.key, (atuais[c.key] as string | undefined) ?? ""])),
  );
  const [aceite, setAceite] = useState<string>(atuais.aceiteMensagens == null ? "" : atuais.aceiteMensagens ? "sim" : "nao");

  function salvar() {
    start(async () => {
      const r = await salvarRespostas(id, {
        ...valores,
        aceiteMensagens: aceite === "" ? null : aceite === "sim",
      });
      setMsg({ ok: r.ok, text: r.message });
      if (r.ok) {
        setEditando(false);
        router.refresh();
      }
    });
  }

  return (
    <div className="space-y-2">
      <dl className="divide-y">
        {CAMPOS.map((c) => {
          const atual = atuais[c.key] as string | undefined;
          return (
            <div key={c.key} className="flex items-center justify-between gap-4 py-1.5 text-sm">
              <dt className="text-muted-foreground">{c.rotulo}</dt>
              <dd className="text-right">
                {editando ? (
                  <select
                    value={valores[c.key]}
                    onChange={(e) => setValores((v) => ({ ...v, [c.key]: e.target.value }))}
                    className="h-8 max-w-[16rem] rounded-md border bg-background px-2 text-xs"
                    aria-label={c.rotulo}
                  >
                    <option value="">—</option>
                    {Object.entries(c.vocab).map(([k, rotulo]) => (
                      <option key={k} value={k}>
                        {rotulo}
                      </option>
                    ))}
                  </select>
                ) : atual ? (
                  (c.vocab as Record<string, string>)[atual]
                ) : (
                  "—"
                )}
              </dd>
            </div>
          );
        })}
        <div className="flex items-center justify-between gap-4 py-1.5 text-sm">
          <dt className="text-muted-foreground">Aceita mensagens</dt>
          <dd className="text-right">
            {editando ? (
              <select
                value={aceite}
                onChange={(e) => setAceite(e.target.value)}
                className="h-8 rounded-md border bg-background px-2 text-xs"
                aria-label="Aceita mensagens"
              >
                <option value="">—</option>
                <option value="sim">Sim</option>
                <option value="nao">Não</option>
              </select>
            ) : atuais.aceiteMensagens == null ? (
              "—"
            ) : atuais.aceiteMensagens ? (
              "Sim"
            ) : (
              "Não"
            )}
          </dd>
        </div>
      </dl>
      {canEdit ? (
        <div className="flex flex-wrap items-center gap-2 pt-1">
          {editando ? (
            <>
              <button
                type="button"
                disabled={pending}
                onClick={salvar}
                className="h-8 rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground disabled:opacity-50"
              >
                {pending ? "Salvando…" : "Salvar respostas"}
              </button>
              <button
                type="button"
                disabled={pending}
                onClick={() => setEditando(false)}
                className="h-8 rounded-md border px-3 text-xs font-medium hover:bg-foreground/5 disabled:opacity-50"
              >
                Cancelar
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={() => setEditando(true)}
              className="inline-flex h-8 items-center gap-1.5 rounded-md border px-3 text-xs font-medium text-muted-foreground hover:text-foreground"
            >
              <Pencil className="size-3.5" />
              Corrigir respostas
            </button>
          )}
        </div>
      ) : null}
      {msg ? (
        <p className={cn("text-xs", msg.ok ? "text-muted-foreground" : "text-[var(--danger-text)]")}>{msg.text}</p>
      ) : null}
    </div>
  );
}
