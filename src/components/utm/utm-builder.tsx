"use client";

import { useMemo, useState } from "react";
import { Check, Copy } from "lucide-react";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { UTM_PADRAO, urlComUtm } from "@/lib/utm";
import { cn } from "@/lib/utils";

const inputCls =
  "h-9 w-full rounded-lg border bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring/40";
const labelCls = "text-xs font-medium text-muted-foreground";

export interface CreativeOption {
  adId: string;
  name: string;
}

function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch {
          /* clipboard blocked — user can still select the text */
        }
      }}
      className="inline-flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-xs font-medium text-muted-foreground hover:text-foreground"
    >
      {copied ? <Check className="size-3.5 text-[var(--success-text)]" /> : <Copy className="size-3.5" />}
      {copied ? "Copiado" : "Copiar"}
    </button>
  );
}

/**
 * Gerador de UTM no padrão D6: UM link com as macros da Meta
 * (`{{campaign.id}}`, `{{adset.id}}`, `{{ad.id}}`), que a própria Meta
 * preenche na hora do clique — serve para todos os anúncios da conta. O painel
 * grava os ids na entrada e resolve os nomes pelas linhas de anúncio.
 *
 * Os links por anúncio (id fixo) ficam como alternativa recolhida, para quem
 * cola o link num lugar sem macro.
 */
export function UtmBuilder({
  defaultBase,
  creatives,
}: {
  defaultBase: string;
  creatives: CreativeOption[];
}) {
  const [base, setBase] = useState(defaultBase);
  const [source, setSource] = useState<string>(UTM_PADRAO.utm_source);
  const [medium, setMedium] = useState<string>(UTM_PADRAO.utm_medium);

  const universal = useMemo(
    () =>
      urlComUtm(base, {
        utm_source: source,
        utm_medium: medium,
        utm_campaign: UTM_PADRAO.utm_campaign,
        utm_term: UTM_PADRAO.utm_term,
        utm_content: UTM_PADRAO.utm_content,
      }),
    [base, source, medium],
  );
  const rows = useMemo(
    () =>
      creatives.map((c) => ({
        ...c,
        url: urlComUtm(base, { utm_source: source, utm_medium: medium, utm_content: c.adId }),
      })),
    [base, source, medium, creatives],
  );

  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1 sm:col-span-2">
          <span className={labelCls}>URL da landing page</span>
          <input
            value={base}
            onChange={(e) => setBase(e.target.value)}
            placeholder="https://seusite.com.br/consorcio"
            className={inputCls}
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className={labelCls}>utm_source</span>
          <input value={source} onChange={(e) => setSource(e.target.value)} className={inputCls} />
        </label>
        <label className="flex flex-col gap-1">
          <span className={labelCls}>utm_medium</span>
          <input value={medium} onChange={(e) => setMedium(e.target.value)} className={inputCls} />
        </label>
      </div>

      <div className="space-y-2 rounded-lg border bg-foreground/[0.03] p-3">
        <p className="text-xs text-muted-foreground">
          <strong className="text-foreground">Um link para todos os anúncios.</strong> Cole-o no campo
          “Parâmetros de URL” da campanha (ou do anúncio) no Ads Manager: a Meta troca{" "}
          <code className="font-mono">{"{{campaign.id}}"}</code>, <code className="font-mono">{"{{adset.id}}"}</code> e{" "}
          <code className="font-mono">{"{{ad.id}}"}</code> pelos ids reais a cada clique, e o lead chega com
          campanha › conjunto › anúncio resolvidos. Macro que chegar sem resolver vira “Desconhecida” com alerta.
        </p>
        {universal ? (
          <div className="flex flex-wrap items-center gap-2">
            <code className="block min-w-0 flex-1 truncate font-mono text-xs">{universal}</code>
            <CopyButton value={universal} />
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">Preencha a URL da landing page.</p>
        )}
      </div>

      <details>
        <summary className="cursor-pointer text-xs font-medium text-muted-foreground hover:text-foreground">
          links por anúncio, com id fixo ({rows.length}) — para onde a macro não funciona
        </summary>
        {rows.length === 0 ? (
          <p className="pt-3 text-sm text-muted-foreground">
            Nenhum criativo cadastrado ainda. Importe o CSV do Ads Manager ou conecte a Marketing API
            para os links aparecerem aqui.
          </p>
        ) : (
          <div className="pt-3">
            <Table>
              <THead>
                <TR className="hover:bg-transparent">
                  <TH>Criativo</TH>
                  <TH>Link com UTM</TH>
                  <TH className="text-right">Ação</TH>
                </TR>
              </THead>
              <TBody>
                {rows.map((r) => (
                  <TR key={r.adId}>
                    <TD>
                      <span className="font-medium">{r.name}</span>
                      <span className="block text-xs text-muted-foreground">{r.adId}</span>
                    </TD>
                    <TD>
                      <code className={cn("block max-w-[420px] truncate font-mono text-xs")}>{r.url}</code>
                    </TD>
                    <TD className="text-right">
                      <CopyButton value={r.url} />
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </div>
        )}
      </details>
    </div>
  );
}
