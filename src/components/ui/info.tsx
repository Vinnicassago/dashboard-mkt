"use client";

import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { dica, type MetricaId } from "@/lib/dicionario";
import { cn } from "@/lib/utils";

/** Distância mínima da borda da tela e entre o botão e a caixa (px). */
const MARGEM = 8;
const AFASTAMENTO = 6;
/** Largura máxima da caixa (px) — a 375 px de tela ela encolhe para caber. */
const LARGURA_MAX = 288;

/**
 * O ⓘ da régua de texto (T1): a explicação sai de baixo do título e vai para
 * cá. Abre ao clicar ou tocar (no celular não existe "passar o mouse"), fecha ao
 * clicar fora, com Esc ou clicando de novo. O texto vem pronto (`texto`) ou do
 * dicionário de métricas (`metrica` → `dica(id)`), que é a fonte única das
 * definições.
 *
 * A caixa vai para o `<body>` (portal) com posição fixa calculada do botão e
 * presa à tela: nunca sai pela borda, nem a 375 px; sem espaço embaixo, abre em
 * cima. Acessível: `<button>` com `aria-expanded`/`aria-controls`, a caixa ligada
 * por `aria-describedby`, o foco volta ao botão no Esc.
 */
export function Info({
  texto,
  metrica,
  rotulo = "O que é isto?",
  className,
}: {
  /** A explicação, pronta. Tem precedência sobre `metrica`. */
  texto?: string;
  /** Ou: a métrica do dicionário (`lib/dicionario.ts`). */
  metrica?: MetricaId;
  /** O nome do botão para leitor de tela. */
  rotulo?: string;
  className?: string;
}) {
  const conteudo = texto ?? (metrica ? dica(metrica) : "");
  const [aberto, setAberto] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number; width: number } | null>(null);
  const botao = useRef<HTMLButtonElement>(null);
  const caixa = useRef<HTMLDivElement>(null);
  const id = useId();

  const posicionar = useCallback(() => {
    const b = botao.current;
    if (!b) return;
    const r = b.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const width = Math.min(LARGURA_MAX, vw - 2 * MARGEM);
    const left = Math.min(Math.max(MARGEM, r.left + r.width / 2 - width / 2), vw - width - MARGEM);
    const altura = caixa.current?.offsetHeight ?? 0;
    const embaixo = r.bottom + AFASTAMENTO;
    const emCima = r.top - AFASTAMENTO - altura;
    const top = embaixo + altura > vh - MARGEM && emCima >= MARGEM ? emCima : embaixo;
    setPos({ top, left, width });
  }, []);

  // Fechar zera a posição junto: a próxima abertura mede de novo, escondida.
  const fechar = useCallback(() => {
    setAberto(false);
    setPos(null);
  }, []);

  // Antes de pintar: mede a caixa já montada e a põe no lugar (sem piscar).
  useLayoutEffect(() => {
    if (aberto) posicionar();
  }, [aberto, posicionar]);

  useEffect(() => {
    if (!aberto) return;
    const fora = (e: PointerEvent) => {
      const alvo = e.target as Node | null;
      if (alvo && (botao.current?.contains(alvo) || caixa.current?.contains(alvo))) return;
      fechar();
    };
    const tecla = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      fechar();
      botao.current?.focus();
    };
    const mover = () => posicionar();
    document.addEventListener("pointerdown", fora);
    document.addEventListener("keydown", tecla);
    window.addEventListener("resize", mover);
    window.addEventListener("scroll", mover, true);
    return () => {
      document.removeEventListener("pointerdown", fora);
      document.removeEventListener("keydown", tecla);
      window.removeEventListener("resize", mover);
      window.removeEventListener("scroll", mover, true);
    };
  }, [aberto, posicionar, fechar]);

  if (!conteudo) return null;

  return (
    <>
      <button
        ref={botao}
        type="button"
        aria-label={rotulo}
        aria-expanded={aberto}
        aria-controls={aberto ? id : undefined}
        aria-describedby={aberto ? id : undefined}
        onClick={() => (aberto ? fechar() : setAberto(true))}
        className={cn(
          // 24 px de alvo (toque), o símbolo pequeno dentro.
          "inline-flex size-6 shrink-0 items-center justify-center rounded-full align-middle text-sm leading-none font-normal text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:outline-none",
          aberto && "text-foreground",
          className,
        )}
      >
        <span aria-hidden>ⓘ</span>
      </button>
      {aberto
        ? createPortal(
            <div
              ref={caixa}
              id={id}
              role="tooltip"
              style={
                pos
                  ? { position: "fixed", top: pos.top, left: pos.left, width: pos.width }
                  : { position: "fixed", top: 0, left: 0, width: LARGURA_MAX, visibility: "hidden" }
              }
              className="z-50 rounded-lg border bg-card p-3 text-xs leading-relaxed font-normal text-card-foreground shadow-lg"
            >
              {conteudo}
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
