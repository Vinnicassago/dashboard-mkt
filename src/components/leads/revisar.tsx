"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Merge, Trash2 } from "lucide-react";
import {
  corrigirDesistenciaSemReuniao,
  deleteLeadAction,
  mesclarLeads,
} from "@/app/(dashboard)/pessoas/actions";
import { StatusBadge } from "@/components/tables/lead-status";
import { statusLabel } from "@/lib/lead-status";
import { formatDateTime } from "@/lib/format";
import type { LeadStatus } from "@/lib/types";
import { cn } from "@/lib/utils";

export interface RevisarLead {
  id: string;
  name: string;
  status: LeadStatus;
  createdAt: string;
  phone?: string;
  email?: string;
  origem: string;
}

export interface RevisarDados {
  testes: (RevisarLead & { porque: string })[];
  duplicados: { principal: RevisarLead; duplicados: RevisarLead[]; conflito: boolean }[];
  desistencias: RevisarLead[];
  contatos: (RevisarLead & { problemas: string[] })[];
}

function Nome({ l }: { l: RevisarLead }) {
  return (
    <Link href={`/pessoas/${encodeURIComponent(l.id)}`} className="font-medium hover:underline">
      {l.name}
    </Link>
  );
}

function Contato({ l }: { l: RevisarLead }) {
  const partes = [l.phone, l.email].filter(Boolean).join(" · ");
  return <span className="text-muted-foreground">{partes || "sem contato"}</span>;
}

function Secao({ titulo, explica, children }: { titulo: string; explica: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <div>
        <h3 className="text-sm font-semibold">{titulo}</h3>
        <p className="text-xs text-muted-foreground">{explica}</p>
      </div>
      {children}
    </section>
  );
}

const botao =
  "inline-flex h-7 items-center gap-1.5 rounded-md border px-2 text-xs font-medium hover:bg-foreground/5 disabled:opacity-50";

function GrupoDuplicado({
  grupo,
  pending,
  executar,
}: {
  grupo: RevisarDados["duplicados"][number];
  pending: boolean;
  executar: (f: () => Promise<{ ok: boolean; message: string }>) => void;
}) {
  const todos = [grupo.principal, ...grupo.duplicados];
  const [fica, setFica] = useState(grupo.principal.id);
  const principal = todos.find((l) => l.id === fica) ?? grupo.principal;
  return (
    <li className="space-y-2 px-3 py-2.5">
      <ul className="space-y-1.5">
        {todos.map((l) => (
          <li key={l.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
            <label className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
              <input type="radio" name={`fica-${grupo.principal.id}`} checked={fica === l.id} onChange={() => setFica(l.id)} />
              fica
            </label>
            <Nome l={l} />
            <StatusBadge status={l.status} />
            <span className="text-xs text-muted-foreground">entrou {formatDateTime(l.createdAt)}</span>
            <span className="text-xs">
              <Contato l={l} />
            </span>
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={pending}
          className={botao}
          onClick={() =>
            executar(() =>
              mesclarLeads(
                principal.id,
                todos.filter((l) => l.id !== principal.id).map((l) => l.id),
              ),
            )
          }
        >
          <Merge className="size-3.5" />
          Mesclar em “{principal.name}”
        </button>
        {grupo.conflito ? (
          <span className="text-xs text-[var(--warning-text)]">
            Os status discordam — confira qual vale antes de mesclar (o que fica é o do cadastro escolhido).
          </span>
        ) : null}
      </div>
    </li>
  );
}

/**
 * Revisar — a higiene da base que a auditoria pediu (D2), feita por uma pessoa.
 * Teste confirmado é excluído (reversível) e sai de "Contato inválido", que é
 * perda de MÍDIA; duplicado é mesclado; desistência de quem nunca agendou é
 * corrigida. Nada disso acontece sozinho.
 */
export function Revisar({ dados, podeAgir }: { dados: RevisarDados; podeAgir: boolean }) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const router = useRouter();

  function executar(f: () => Promise<{ ok: boolean; message: string }>) {
    start(async () => {
      const r = await f();
      setMsg({ ok: r.ok, text: r.message });
      if (r.ok) router.refresh();
    });
  }

  return (
    <div className="space-y-6">
      {dados.testes.length ? (
        <Secao
          titulo={`Parecem teste (${dados.testes.length})`}
          explica="Contam como lead e, quando marcados como “Contato inválido”, como perda da mídia. Confirmando, o cadastro é excluído (dá para restaurar)."
        >
          <ul className="divide-y rounded-lg border">
            {dados.testes.map((t) => (
              <li key={t.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm">
                <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <Nome l={t} />
                  <StatusBadge status={t.status} />
                  <span className="text-xs text-muted-foreground">por causa do {t.porque}</span>
                </span>
                {podeAgir ? (
                  <button
                    type="button"
                    disabled={pending}
                    className={cn(botao, "hover:border-[var(--danger-text)] hover:text-[var(--danger-text)]")}
                    onClick={() => executar(() => deleteLeadAction(t.id, `teste (${t.porque})`))}
                  >
                    <Trash2 className="size-3.5" />
                    É teste — excluir
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        </Secao>
      ) : null}

      {dados.duplicados.length ? (
        <Secao
          titulo={`Mesma pessoa em mais de um cadastro (${dados.duplicados.length})`}
          explica="Mesmo telefone ou e-mail. Mesclar mantém um cadastro, traz o contato e os marcos que faltavam e exclui os outros (reversível) — a pessoa passa a contar uma vez."
        >
          <ul className="divide-y rounded-lg border">
            {dados.duplicados.map((g) =>
              podeAgir ? (
                <GrupoDuplicado key={g.principal.id} grupo={g} pending={pending} executar={executar} />
              ) : (
                <li key={g.principal.id} className="px-3 py-2 text-sm">
                  {[g.principal, ...g.duplicados].map((l) => l.name).join(" · ")}
                </li>
              ),
            )}
          </ul>
        </Secao>
      ) : null}

      {dados.desistencias.length ? (
        <Secao
          titulo={`“Desistência” de quem nunca agendou (${dados.desistencias.length})`}
          explica="Desistência é de quem marcou reunião. Sem reunião, a perda é de qualidade (mídia), não de decisão (oferta) — e o funil mostra a quebra errada."
        >
          <ul className="divide-y rounded-lg border">
            {dados.desistencias.map((l) => (
              <li key={l.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm">
                <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <Nome l={l} />
                  <span className="text-xs text-muted-foreground">entrou {formatDateTime(l.createdAt)}</span>
                </span>
                {podeAgir ? (
                  <span className="flex flex-wrap gap-2">
                    {(["sem_interesse", "sem_resposta"] as LeadStatus[]).map((s) => (
                      <button
                        key={s}
                        type="button"
                        disabled={pending}
                        className={botao}
                        onClick={() => executar(() => corrigirDesistenciaSemReuniao(l.id, s))}
                      >
                        Era “{statusLabel(s)}”
                      </button>
                    ))}
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        </Secao>
      ) : null}

      {dados.contatos.length ? (
        <Secao
          titulo={`Contato com problema (${dados.contatos.length})`}
          explica="Não dá para ligar ou escrever como está. Vale tentar pelo outro canal antes de encerrar como “Contato inválido”."
        >
          <ul className="divide-y rounded-lg border">
            {dados.contatos.map((l) => (
              <li key={l.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-sm">
                <Nome l={l} />
                <span className="text-xs">
                  <Contato l={l} />
                </span>
                <span className="text-xs text-[var(--warning-text)]">{l.problemas.join(" · ")}</span>
              </li>
            ))}
          </ul>
        </Secao>
      ) : null}

      {msg ? (
        <p className={cn("text-xs", msg.ok ? "text-muted-foreground" : "text-[var(--danger-text)]")}>{msg.text}</p>
      ) : null}
    </div>
  );
}
