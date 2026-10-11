"use client";

import { useActionState, useState, useTransition, type ChangeEvent } from "react";
import { useRouter } from "next/navigation";
import { Download, Upload } from "lucide-react";
import { addLeadAction, importAdsCsv, importLeadsCsv, type ActionState } from "@/app/(dashboard)/configuracoes/actions";
import { LEAD_STATUS_META, LOST_STATUSES, OPEN_STATUSES, statusLabel } from "@/lib/lead-status";
import { previaLeadsCsv, type PreviaLeads } from "@/lib/leads-csv";
import { formatInt } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Field, Message, SubmitButton, baixarArquivo, hojeLocal, inputCls } from "./form-primitives";

/** Importar dados (relatório §7.7, item 5): anúncios, leads com prévia e lead à mão. */

const fileCls =
  "block w-full text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-primary/10 file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-primary";
const botaoSecundarioCls =
  "inline-flex h-9 items-center gap-2 rounded-lg border px-3 text-sm font-medium text-muted-foreground hover:text-foreground disabled:opacity-50";

// ---- anúncios (CSV do Ads Manager) ----------------------------------

export function ImportForm({ template }: { template: string }) {
  const [state, action] = useActionState(importAdsCsv, null);
  return (
    <form action={action} className="space-y-3">
      <input type="file" name="file" accept=".csv,text/csv" className={fileCls} />
      <div className="flex flex-wrap items-center gap-2">
        <SubmitButton>
          <Upload className="size-4" />
          Importar CSV
        </SubmitButton>
        <button type="button" onClick={() => baixarArquivo("modelo-anuncios.csv", template)} className={botaoSecundarioCls}>
          <Download className="size-4" />
          Baixar modelo
        </button>
      </div>
      <Message state={state} />
    </form>
  );
}

// ---- leads (CSV / planilha) com prévia --------------------------------

const LINHAS_NA_PREVIA = 100;

/**
 * Importação em dois passos: escolher o arquivo mostra a prévia (validação
 * linha a linha, feita no navegador pela mesma função pura que o servidor usa);
 * só então "Importar". O arquivo vai inteiro ao servidor, que refaz a leitura —
 * reimportar não move lead de marca nem mexe em status (S6).
 */
export function LeadsImportForm({ template }: { template: string }) {
  const [arquivo, setArquivo] = useState<{ nome: string; texto: string } | null>(null);
  const [previa, setPrevia] = useState<PreviaLeads | null>(null);
  const [lendo, setLendo] = useState(false);
  const [state, setState] = useState<ActionState | null>(null);
  // Troca a `key` do input para limpá-lo depois de importar.
  const [geracao, setGeracao] = useState(0);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  async function aoEscolher(e: ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    setState(null);
    if (!f) {
      setArquivo(null);
      setPrevia(null);
      return;
    }
    setLendo(true);
    try {
      const texto = await f.text();
      setArquivo({ nome: f.name, texto });
      setPrevia(previaLeadsCsv(texto));
    } finally {
      setLendo(false);
    }
  }

  function importar() {
    if (!arquivo || !previa || previa.validas === 0) return;
    startTransition(async () => {
      const fd = new FormData();
      fd.append("file", new File([arquivo.texto], arquivo.nome, { type: "text/csv" }));
      const r = await importLeadsCsv(null, fd);
      setState(r);
      if (r.ok) {
        setArquivo(null);
        setPrevia(null);
        setGeracao((g) => g + 1);
      }
      router.refresh();
    });
  }

  const podeImportar = Boolean(previa && previa.faltam.length === 0 && previa.validas > 0);

  return (
    <div className="space-y-3">
      <input key={geracao} type="file" accept=".csv,text/csv" onChange={aoEscolher} className={fileCls} />
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={!podeImportar || pending || lendo}
          onClick={importar}
          className="inline-flex h-9 items-center justify-center gap-2 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          <Upload className="size-4" />
          {pending ? "Importando…" : previa && podeImportar ? `Importar ${formatInt(previa.validas)} lead(s)` : "Importar leads"}
        </button>
        <button type="button" onClick={() => baixarArquivo("modelo-leads.csv", template)} className={botaoSecundarioCls}>
          <Download className="size-4" />
          Baixar modelo
        </button>
      </div>
      {lendo ? <p className="text-xs text-muted-foreground">Lendo o arquivo…</p> : null}
      {previa ? <PreviaDeLeads previa={previa} /> : null}
      <Message state={state} />
    </div>
  );
}

function PreviaDeLeads({ previa }: { previa: PreviaLeads }) {
  if (previa.faltam.length > 0) {
    return (
      <p className="text-sm text-[var(--danger-text)]">
        CSV não reconhecido: faltam as colunas {previa.faltam.join(" e ")}. Baixe o modelo para ver o formato.
      </p>
    );
  }
  const mostradas = previa.linhas.slice(0, LINHAS_NA_PREVIA);
  return (
    <div className="space-y-2">
      <p className="text-sm">
        <strong>{formatInt(previa.linhas.length)}</strong> linha(s) lida(s) ·{" "}
        <strong>{formatInt(previa.validas)}</strong> entra(m)
        {previa.comErro > 0 ? (
          <>
            {" "}
            · <span className="text-[var(--danger-text)]">{formatInt(previa.comErro)} com erro (ignoradas)</span>
          </>
        ) : null}
        {previa.comAviso > 0 ? <> · {formatInt(previa.comAviso)} com aviso</> : null}
        {previa.repetidas > 0 ? <> · {formatInt(previa.repetidas)} repetida(s)</> : null}
      </p>
      <div className="max-h-96 overflow-auto rounded-lg border">
        <table className="w-full min-w-[720px] text-xs">
          <thead className="sticky top-0 bg-card text-left text-muted-foreground">
            <tr>
              <th className="p-2 font-medium">Linha</th>
              <th className="p-2 font-medium">Nome</th>
              <th className="p-2 font-medium">Entrada</th>
              <th className="p-2 font-medium">Telefone</th>
              <th className="p-2 font-medium">E-mail</th>
              <th className="p-2 font-medium">Status</th>
              <th className="p-2 font-medium">Observações</th>
            </tr>
          </thead>
          <tbody>
            {mostradas.map((l) => (
              <tr key={l.linha} className={cn("border-t align-top", l.erros.length > 0 && "bg-[var(--critical)]/5")}>
                <td className="p-2 tabular-nums text-muted-foreground">{l.linha}</td>
                <td className="p-2 font-medium">{l.nome || "—"}</td>
                <td className="p-2 tabular-nums">{l.criadoEm || "—"}</td>
                {/* Telefone como texto, em fonte mono: o que entra é o que está escrito. */}
                <td className="p-2 font-mono">{l.telefone ?? "—"}</td>
                <td className="p-2">{l.email ?? "—"}</td>
                <td className="p-2">{l.erros.length > 0 ? "—" : statusLabel(l.status)}</td>
                <td className="p-2">
                  {l.erros.length === 0 && l.avisos.length === 0 ? (
                    <span className="text-[var(--success-text)]">ok</span>
                  ) : (
                    <ul className="space-y-0.5">
                      {l.erros.map((e) => (
                        <li key={e} className="text-[var(--danger-text)]">
                          {e}
                        </li>
                      ))}
                      {l.avisos.map((a) => (
                        <li key={a} className="text-muted-foreground">
                          {a}
                        </li>
                      ))}
                    </ul>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {previa.linhas.length > mostradas.length ? (
        <p className="text-xs text-muted-foreground">
          Mostrando as primeiras {formatInt(mostradas.length)} de {formatInt(previa.linhas.length)} linhas — a importação
          lê todas.
        </p>
      ) : null}
    </div>
  );
}

// ---- lead à mão -----------------------------------------------------

export function LeadForm({ creatives }: { creatives: { adId: string; name: string }[] }) {
  const [state, action] = useActionState(addLeadAction, null);
  return (
    <form action={action} className="space-y-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Nome">
          <input type="text" name="name" className={inputCls} required />
        </Field>
        <Field label="Data de entrada">
          <input type="date" name="date" defaultValue={hojeLocal()} className={inputCls} required />
        </Field>
        <Field label="Telefone / WhatsApp">
          <input type="tel" name="phone" placeholder="(11) 98765-4321" className={inputCls} />
        </Field>
        <Field label="E-mail">
          <input type="email" name="email" placeholder="nome@email.com" className={inputCls} />
        </Field>
        <Field label="Origem (criativo)">
          <select name="utmContent" className={inputCls} defaultValue="">
            <option value="">— não sei —</option>
            {creatives.map((c) => (
              <option key={c.adId} value={c.adId}>
                {c.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Status">
          <select name="status" className={inputCls} defaultValue="lead">
            <optgroup label="Em andamento">
              {OPEN_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {LEAD_STATUS_META[s].label}
                </option>
              ))}
            </optgroup>
            <optgroup label="Perdido — por quê">
              {LOST_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {LEAD_STATUS_META[s].label}
                </option>
              ))}
            </optgroup>
          </select>
        </Field>
        <Field label="Data e hora da reunião (obrigatória se agendado)">
          <input type="datetime-local" name="meetingFor" className={inputCls} />
        </Field>
        <Field label="Valor da carta (R$, se cliente)">
          <input type="number" name="value" min="0" step="0.01" placeholder="0,00" className={inputCls} />
        </Field>
      </div>
      <SubmitButton>Adicionar lead</SubmitButton>
      <Message state={state} />
    </form>
  );
}
