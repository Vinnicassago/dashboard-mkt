"use client";

import { useMemo, useState } from "react";
import { Check, Copy } from "lucide-react";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { cn } from "@/lib/utils";

const inputCls =
  "h-9 w-full rounded-lg border bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring/40";
const labelCls = "text-xs font-medium text-muted-foreground";

export interface CreativeOption {
  adId: string;
  name: string;
}

function buildUrl(
  base: string,
  params: Record<string, string | undefined>,
): string {
  if (!base.trim()) return "";
  let url: URL;
  try {
    url = new URL(base.trim());
  } catch {
    return "URL base inválida";
  }
  for (const [k, v] of Object.entries(params)) {
    if (v && v.trim()) url.searchParams.set(k, v.trim());
  }
  return url.toString();
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

export function UtmBuilder({
  defaultBase,
  defaultCampaign,
  creatives,
}: {
  defaultBase: string;
  defaultCampaign: string;
  creatives: CreativeOption[];
}) {
  const [base, setBase] = useState(defaultBase);
  const [source, setSource] = useState("instagram");
  const [medium, setMedium] = useState("paid_social");
  const [campaign, setCampaign] = useState(defaultCampaign);

  const rows = useMemo(
    () =>
      creatives.map((c) => ({
        ...c,
        url: buildUrl(base, {
          utm_source: source,
          utm_medium: medium,
          utm_campaign: campaign,
          utm_content: c.adId,
        }),
      })),
    [base, source, medium, campaign, creatives],
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
        <label className="flex flex-col gap-1 sm:col-span-2">
          <span className={labelCls}>utm_campaign</span>
          <input
            value={campaign}
            onChange={(e) => setCampaign(e.target.value)}
            className={inputCls}
          />
        </label>
      </div>

      <div className="rounded-lg border bg-foreground/[0.03] p-3 text-xs text-muted-foreground">
        <strong className="text-foreground">utm_content = ID do anúncio.</strong> É esse
        campo que liga o lead de volta ao criativo no funil — se ele vier errado ou
        vazio, a origem do lead se perde e não dá para recuperar depois.
      </div>

      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Nenhum criativo cadastrado ainda. Importe o CSV do Ads Manager ou conecte a
          Marketing API para os links aparecerem aqui.
        </p>
      ) : (
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
                  <code className={cn("block max-w-[420px] truncate font-mono text-xs")}>
                    {r.url}
                  </code>
                </TD>
                <TD className="text-right">
                  <CopyButton value={r.url} />
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      )}
    </div>
  );
}
