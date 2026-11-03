"use client";

import { useActionState, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";
import { reclassifyAdsAction, setBrandMatchAction, type ActionState } from "@/app/(dashboard)/configuracoes/actions";
import { BRANDS } from "@/lib/brands";
import { formatCurrency0 } from "@/lib/format";
import { NAO_CLASSIFICADO, marcaDaCampanha, tokensDoCampo } from "@/lib/regra-de-marca";
import { DEFAULT_BRAND } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Field, Message, SubmitButton, inputCls } from "./form-primitives";

/** Marcas e atribuição (relatório §7.7, item 3): regra por campanha e reclassificação. */

interface CampanhaNaPrevia {
  name: string;
  id?: string;
  spend: number;
  /** Onde a campanha está HOJE (marca ou "não classificado"). */
  brand: string;
}

const nomeDaMarca = (slug: string) =>
  slug === NAO_CLASSIFICADO ? "não classificado" : (BRANDS.find((b) => b.slug === slug)?.label ?? slug);

export function BrandMatchForm({
  current,
  regraDoAmbiente,
  campanhas,
}: {
  current: Record<string, string>;
  /** A regra do servidor (env), que vale quando o campo da marca fica vazio. */
  regraDoAmbiente: Record<string, string[]>;
  campanhas: CampanhaNaPrevia[];
}) {
  const [state, action] = useActionState(setBrandMatchAction, null);
  const [campos, setCampos] = useState<Record<string, string>>(() =>
    Object.fromEntries(BRANDS.map((b) => [b.slug, current[b.slug] ?? ""])),
  );
  // Salvar reclassifica o histórico na hora: a prévia mostra ANTES o que vai mudar,
  // com a mesma função do servidor (marcaDaCampanha) e a regra como está digitada.
  const regras = BRANDS.map((b) => {
    const digitada = tokensDoCampo(campos[b.slug] ?? "");
    return { slug: b.slug, campaignMatch: digitada.length ? digitada : (regraDoAmbiente[b.slug] ?? []) };
  });
  const mudam = campanhas
    .map((c) => ({ ...c, destino: marcaDaCampanha(c.name, c.id, regras, DEFAULT_BRAND) }))
    .filter((c) => c.destino !== c.brand)
    .sort((a, b) => b.spend - a.spend);
  return (
    <form action={action} className="space-y-3">
      {BRANDS.map((b) => (
        <Field key={b.slug} label={`Campanhas de ${b.label} — trechos do nome ou IDs (separados por vírgula)`}>
          <input
            type="text"
            name={`match_${b.slug}`}
            value={campos[b.slug] ?? ""}
            onChange={(e) => setCampos((cur) => ({ ...cur, [b.slug]: e.target.value }))}
            placeholder={b.slug === DEFAULT_BRAND ? "[BRN]  ou  *  (o resto da conta)" : "[KRN]"}
            className={inputCls}
          />
        </Field>
      ))}
      <div
        className={cn(
          "rounded-lg border p-3 text-xs",
          mudam.length ? "border-[var(--warning)]/50 bg-[var(--warning)]/10" : "text-muted-foreground",
        )}
        aria-live="polite"
      >
        {mudam.length === 0 ? (
          <p>Ao salvar, nenhuma campanha muda de marca.</p>
        ) : (
          <>
            <p className="font-medium">
              Ao salvar, {mudam.length} {mudam.length === 1 ? "campanha muda" : "campanhas mudam"} de marca (
              {formatCurrency0(mudam.reduce((s, c) => s + c.spend, 0))} no histórico):
            </p>
            <ul className="mt-1.5 space-y-1">
              {mudam.slice(0, 12).map((c) => (
                <li key={`${c.brand}:${c.name}`} className="flex items-baseline justify-between gap-2">
                  <span className="min-w-0 truncate" title={c.name}>
                    {c.name} — de {nomeDaMarca(c.brand)} para <strong>{nomeDaMarca(c.destino)}</strong>
                  </span>
                  <span className="tabular shrink-0">{formatCurrency0(c.spend)}</span>
                </li>
              ))}
              {mudam.length > 12 ? <li>… e mais {mudam.length - 12}</li> : null}
            </ul>
          </>
        )}
      </div>
      <p className="text-xs text-muted-foreground">
        Com regra em todas as marcas, a campanha que não casar com nenhuma fica{" "}
        <strong>não classificada</strong>: fora de todos os números, com alerta, até você dizer de quem é.
        Para uma marca receber &ldquo;o resto&rdquo;, use <code className="font-mono">*</code>. Enquanto só
        uma marca estiver sem regra, ela continua recebendo o resto — confira a prévia acima antes de
        reclassificar.
      </p>
      <p className="text-xs text-muted-foreground">
        O token é um <strong>trecho</strong> do nome da campanha (maiúsculas, espaços e{" "}
        <code className="font-mono">[ KRN ]</code> com espaço não fazem diferença). Se as campanhas são
        marcadas com <code className="font-mono">[KRN]</code>, use <code className="font-mono">[KRN]</code>:
        escrever <code className="font-mono">krone</code> deixaria passar todos os posts impulsionados que só
        têm a sigla. Nome antigo que ainda aparece na prévia (ex.: <code className="font-mono">krn -</code>)
        entra na mesma lista, separado por vírgula.
      </p>
      <p className="text-xs text-muted-foreground">
        Salvar aplica a regra a <strong>todo o histórico</strong> na hora: as campanhas mudam de marca e os
        números das duas marcas mudam juntos (fica registrado em auditoria).
      </p>
      <SubmitButton>Salvar e aplicar</SubmitButton>
      <Message state={state} />
    </form>
  );
}

export function ReclassifyAdsButton() {
  const [pending, startTransition] = useTransition();
  const [state, setState] = useState<ActionState | null>(null);
  const router = useRouter();
  return (
    <div className="space-y-1.5 border-t pt-3">
      <button
        type="button"
        disabled={pending}
        onClick={() => {
          if (
            !window.confirm(
              "Reetiquetar todos os anúncios guardados pela regra de marca acima? Os números de cada marca mudam na hora.",
            )
          ) {
            return;
          }
          startTransition(async () => {
            const result = await reclassifyAdsAction();
            setState(result);
            router.refresh();
          });
        }}
        className="inline-flex h-9 items-center gap-2 rounded-lg border px-3 text-sm font-medium text-muted-foreground hover:text-foreground disabled:opacity-50"
      >
        <RefreshCw className={cn("size-4", pending && "animate-spin")} />
        {pending ? "Reclassificando…" : "Reclassificar anúncios por marca"}
      </button>
      <p className="text-xs text-muted-foreground">
        Salvar a regra já faz isto. Use quando a regra veio do servidor (variável de ambiente) ou quando a
        prévia acima mostrar campanha fora do lugar: re-etiqueta os anúncios já coletados e remove cópias
        duplicadas. Não precisa da API.
      </p>
      <Message state={state} />
    </div>
  );
}
