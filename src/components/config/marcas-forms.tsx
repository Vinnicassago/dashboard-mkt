"use client";

import { useActionState, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";
import { reclassifyAdsAction, setBrandMatchAction, type ActionState } from "@/app/(dashboard)/configuracoes/actions";
import { BRANDS } from "@/lib/brands";
import { DEFAULT_BRAND } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Field, Message, SubmitButton, inputCls } from "./form-primitives";

/** Marcas e atribuição (relatório §7.7, item 3): regra por campanha e reclassificação. */

export function BrandMatchForm({ current }: { current: Record<string, string> }) {
  const [state, action] = useActionState(setBrandMatchAction, null);
  return (
    <form action={action} className="space-y-3">
      {BRANDS.map((b) => (
        <Field key={b.slug} label={`Campanhas de ${b.label} — fragmentos do nome ou IDs (separados por vírgula)`}>
          <input
            type="text"
            name={`match_${b.slug}`}
            defaultValue={current[b.slug] ?? ""}
            placeholder={b.slug === DEFAULT_BRAND ? "[BRN]  ou  *  (o resto da conta)" : "[KRN]"}
            className={inputCls}
          />
        </Field>
      ))}
      <p className="text-xs text-muted-foreground">
        Com regra em todas as marcas, a campanha que não casar com nenhuma fica{" "}
        <strong>não classificada</strong>: fora de todos os números, com alerta, até você dizer de quem é.
        Para uma marca receber &ldquo;o resto&rdquo;, use <code className="font-mono">*</code>. Enquanto só
        uma marca estiver sem regra, ela continua recebendo o resto — confira a prévia acima antes de
        reclassificar.
      </p>
      <p className="text-xs text-muted-foreground">
        O token é uma <strong>substring</strong> do nome da campanha, não um prefixo. Se as campanhas são
        marcadas com <code className="font-mono">[KRN]</code>, use <code className="font-mono">[KRN]</code>:
        escrever <code className="font-mono">krone</code> deixaria passar todos os posts impulsionados que só
        têm a sigla.
      </p>
      <SubmitButton>Salvar regra</SubmitButton>
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
        Re-etiqueta os anúncios já coletados pela campanha (aplica a regra acima aos dados atuais) e remove
        linhas duplicadas. Não precisa da API.
      </p>
      <Message state={state} />
    </div>
  );
}
