"use client";

import { createContext, useCallback, useContext, useEffect, useId, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { AlertTriangle, Info, Settings2, TrendingDown, TrendingUp, WifiOff, X } from "lucide-react";
import { ordenarAlertas, type Alerta, type NivelAlerta } from "@/lib/alertas";
import { comPeriodo } from "@/lib/range";
import { periodoPadraoDe } from "./nav-items";
import { cn } from "@/lib/utils";

/**
 * O indicador "⚠ N alertas" do cabeçalho e o painel lateral (3.6).
 *
 * Os alertas GLOBAIS chegam do layout pelo provider; cada página soma os do
 * próprio período com `<RegistrarAlertas>` (que some quando a página sai). Assim
 * o aviso fica a um clique em qualquer tela, sem empurrar o conteúdo para baixo
 * — e sem quatro lugares diferentes dizendo coisas parecidas.
 */

interface CtxAlertas {
  globais: Alerta[];
  daPagina: Record<string, Alerta[]>;
  registrar: (chave: string, alertas: Alerta[]) => void;
  remover: (chave: string) => void;
}

const Ctx = createContext<CtxAlertas | null>(null);

export function AlertasProvider({ globais, children }: { globais: Alerta[]; children: React.ReactNode }) {
  const [daPagina, setDaPagina] = useState<Record<string, Alerta[]>>({});
  const registrar = useCallback((chave: string, alertas: Alerta[]) => {
    setDaPagina((d) => ({ ...d, [chave]: alertas }));
  }, []);
  const remover = useCallback((chave: string) => {
    setDaPagina((d) => {
      const resto = { ...d };
      delete resto[chave];
      return resto;
    });
  }, []);
  const valor = useMemo(() => ({ globais, daPagina, registrar, remover }), [globais, daPagina, registrar, remover]);
  return <Ctx.Provider value={valor}>{children}</Ctx.Provider>;
}

/** Soma os alertas desta página aos globais enquanto ela estiver na tela. */
export function RegistrarAlertas({ alertas }: { alertas: Alerta[] }) {
  const ctx = useContext(Ctx);
  const chave = useId();
  const assinatura = JSON.stringify(alertas);
  useEffect(() => {
    if (!ctx) return;
    ctx.registrar(chave, JSON.parse(assinatura) as Alerta[]);
    return () => ctx.remover(chave);
    // `ctx` muda a cada registro; a assinatura é o que importa.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chave, assinatura]);
  return null;
}

const ESTILO: Record<NivelAlerta, { Icon: typeof AlertTriangle; cor: string; tag: string }> = {
  falha: { Icon: WifiOff, cor: "text-[var(--danger-text)]", tag: "integração falhando" },
  quarentena: { Icon: AlertTriangle, cor: "text-[var(--danger-text)]", tag: "não dá para decidir com isto" },
  teto: { Icon: TrendingDown, cor: "text-[var(--warning-text)]", tag: "o valor real é menor" },
  piso: { Icon: TrendingUp, cor: "text-[var(--warning-text)]", tag: "o valor real é maior" },
  aviso: { Icon: Info, cor: "text-[var(--warning-text)]", tag: "confira" },
  config: { Icon: Settings2, cor: "text-muted-foreground", tag: "falta configurar" },
};

export function IndicadorAlertas() {
  const ctx = useContext(Ctx);
  const [aberto, setAberto] = useState(false);
  // Sem `?range=`, o link leva o período que a página está mostrando (a Bússola: 7 dias).
  const pathname = usePathname();
  const rangeKey = useSearchParams().get("range") ?? periodoPadraoDe(pathname);
  const alertas = useMemo(
    () => (ctx ? ordenarAlertas([ctx.globais, ...Object.values(ctx.daPagina)]) : []),
    [ctx],
  );

  useEffect(() => {
    if (!aberto) return;
    const fechar = (e: KeyboardEvent) => e.key === "Escape" && setAberto(false);
    window.addEventListener("keydown", fechar);
    return () => window.removeEventListener("keydown", fechar);
  }, [aberto]);

  if (alertas.length === 0) return null;
  const grave = alertas.some((a) => a.nivel === "falha" || a.nivel === "quarentena");
  const so_config = alertas.every((a) => a.nivel === "config");

  return (
    <>
      <button
        type="button"
        onClick={() => setAberto(true)}
        title="Alertas sobre os dados e os números desta tela"
        className={cn(
          "inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg border px-2.5 text-xs font-medium",
          grave
            ? "border-[var(--danger)]/40 text-[var(--danger-text)]"
            : so_config
              ? "text-muted-foreground"
              : "border-[var(--warning)]/40 text-[var(--warning-text)]",
        )}
      >
        <AlertTriangle className="size-3.5" />
        <span className="tabular">{alertas.length}</span>
        <span className="hidden lg:inline">{alertas.length === 1 ? "alerta" : "alertas"}</span>
      </button>

      {/* Portal no <body>: o cabeçalho tem backdrop-blur, que prende qualquer
          `position: fixed` dentro dele — o painel ficava com a altura do header. */}
      {aberto ? createPortal(
        <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-modal="true" aria-label="Alertas">
          <button
            type="button"
            aria-label="Fechar"
            className="absolute inset-0 bg-black/30"
            onClick={() => setAberto(false)}
          />
          <aside className="relative flex h-full w-full max-w-md flex-col border-l bg-background shadow-xl">
            <div className="flex items-center justify-between gap-2 border-b px-4 py-3">
              <p className="text-sm font-semibold">
                {alertas.length} {alertas.length === 1 ? "alerta" : "alertas"}
                <span className="ml-1.5 font-normal text-muted-foreground">sobre os dados desta tela</span>
              </p>
              <button
                type="button"
                onClick={() => setAberto(false)}
                className="inline-flex size-8 items-center justify-center rounded-md hover:bg-foreground/5"
                aria-label="Fechar"
              >
                <X className="size-4" />
              </button>
            </div>
            <ul className="flex-1 divide-y overflow-y-auto">
              {alertas.map((a) => {
                const e = ESTILO[a.nivel];
                return (
                  <li key={a.id} className="flex gap-3 px-4 py-3">
                    <e.Icon className={cn("mt-0.5 size-4 shrink-0", e.cor)} />
                    <div className="min-w-0 space-y-1">
                      <p className="text-sm font-medium">
                        {a.titulo} <span className="font-normal text-muted-foreground">— {e.tag}</span>
                      </p>
                      <p className="text-xs leading-relaxed text-muted-foreground">{a.detalhe}</p>
                      {a.cta ? (
                        <Link
                          href={comPeriodo(a.cta.href, rangeKey)}
                          onClick={() => setAberto(false)}
                          className="inline-block pt-0.5 text-xs font-medium text-primary underline-offset-4 hover:underline"
                        >
                          {a.cta.label} →
                        </Link>
                      ) : null}
                    </div>
                  </li>
                );
              })}
            </ul>
          </aside>
        </div>,
        document.body,
      ) : null}
    </>
  );
}
