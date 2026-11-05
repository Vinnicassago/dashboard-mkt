"use client";

import { useEffect, useId, useRef, useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { CalendarRange, Check, ChevronDown } from "lucide-react";
import { buildCustomKey, hojeEmBrasilia } from "@/lib/range";
import { periodoPadraoDe } from "./nav-items";
import { estadoDoSeletor, type AtalhoDoSeletor, type OpcaoDoSeletor } from "./periodo-do-seletor";
import { cn } from "@/lib/utils";

/**
 * O seletor de período do cabeçalho. As regras (qual botão acende, quando o
 * "Escolher" acende, com que datas o popover abre, o rótulo do botão do celular)
 * moram em `estadoDoSeletor` (`periodo-do-seletor.ts`, puro e testado); aqui só
 * a tela e o teclado.
 *
 * De `2xl` (1536 px) para cima, em linha (o atalho da live ao lado de "Campanha",
 * truncado em 8rem com o nome inteiro no `title`); abaixo, UM botão com o rótulo
 * atual ("Live 01/12 ▾", "7 dias ▾") abrindo a lista vertical. Os sete botões em
 * linha medem ~500 px: com a barra lateral (240 px), as marcas, o ⚠, o menu do
 * usuário e o "Atualizar" o grupo da direita passa de 950 px — a 1.024 e a 1.280 px
 * (logado) o título do cabeçalho ia a 0 px e a página rolava na horizontal, e até
 * ~1.500 px a data do dado (`frescor`, ~330 px) ficava por baixo dos botões.
 */
export function PeriodSelector({
  atalho = null,
  chavesDaLive = [],
}: {
  /** O atalho da live (`atalhoDaLive`), do layout; `null` sem régua ou em marca awareness. */
  atalho?: AtalhoDoSeletor | null;
  /** As três chaves da régua (campanha, captação, pós-live): com elas o popover abre vazio. */
  chavesDaLive?: string[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  // Sem `?range=`, cada página tem o seu padrão (o Início olha a semana): o
  // preset marcado é o que a página está mostrando, não "Campanha" por reflexo.
  const padrao = periodoPadraoDe(pathname);
  const current = params.get("range") ?? padrao;
  const estado = estadoDoSeletor(current, atalho, chavesDaLive);

  /** O popover das datas ("Escolher"). */
  const [aberto, setAberto] = useState(false);
  /** A lista do botão único (celular). */
  const [listaAberta, setListaAberta] = useState(false);
  // A página inteira é recalculada no servidor; sem isto o clique parecia não ter efeito.
  const [carregando, startTransition] = useTransition();
  const [de, setDe] = useState("");
  const [ate, setAte] = useState("");
  const caixa = useRef<HTMLDivElement>(null);
  const gatilho = useRef<HTMLButtonElement>(null);
  const itens = useRef<(HTMLButtonElement | null)[]>([]);
  const campoDe = useRef<HTMLInputElement>(null);
  const idLista = useId();

  // Fecha ao clicar fora ou apertar Esc — nem a lista nem o popover têm overlay.
  useEffect(() => {
    if (!aberto && !listaAberta) return;
    function fora(e: MouseEvent) {
      if (caixa.current && !caixa.current.contains(e.target as Node)) {
        setAberto(false);
        setListaAberta(false);
      }
    }
    function esc(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      if (listaAberta) gatilho.current?.focus();
      setAberto(false);
      setListaAberta(false);
    }
    document.addEventListener("mousedown", fora);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", fora);
      document.removeEventListener("keydown", esc);
    };
  }, [aberto, listaAberta]);

  // Lista aberta: o foco vai para o período atual (ou o primeiro).
  useEffect(() => {
    if (!listaAberta) return;
    const i = Math.max(0, estado.lista.findIndex((o) => o.ativo));
    itens.current[i]?.focus();
    // Só ao abrir: o estado muda a cada navegação, a lista fecha antes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listaAberta]);

  // Popover aberto: o foco vai para o "De".
  useEffect(() => {
    if (aberto) campoDe.current?.focus();
  }, [aberto]);

  function irPara(key: string | null) {
    const next = new URLSearchParams(params.toString());
    // "Campanha" numa página cujo padrão é outro precisa ir explícito na URL —
    // sem o parâmetro, a página voltaria ao padrão dela.
    if (!key || key === "all") {
      if (padrao === "all") next.delete("range");
      else next.set("range", "all");
    } else if (key === padrao) next.delete("range");
    else next.set("range", key);
    const qs = next.toString();
    startTransition(() => router.push(qs ? `${pathname}?${qs}` : pathname, { scroll: false }));
  }

  /** Abre o popover das datas com as do período atual — vazio nas chaves da live. */
  function abrirEscolher() {
    setDe(estado.popover.de);
    setAte(estado.popover.ate);
    setListaAberta(false);
    setAberto(true);
  }

  function escolherOpcao(op: OpcaoDoSeletor) {
    if (op.tipo === "escolher") {
      if (aberto) setAberto(false);
      else abrirEscolher();
      return;
    }
    // Escolhido na lista do celular: o foco volta ao botão (a lista some).
    if (listaAberta) gatilho.current?.focus();
    setAberto(false);
    setListaAberta(false);
    irPara(op.chave ?? null);
  }

  function aplicar() {
    if (!de && !ate) return;
    irPara(buildCustomKey(de, ate));
    setAberto(false);
  }

  /** Setas, Home e End andam pela lista; Tab fecha. */
  function teclaNaLista(e: React.KeyboardEvent, i: number) {
    const n = estado.lista.length;
    const ir = (j: number) => itens.current[(j + n) % n]?.focus();
    if (e.key === "ArrowDown") ir(i + 1);
    else if (e.key === "ArrowUp") ir(i - 1);
    else if (e.key === "Home") ir(0);
    else if (e.key === "End") ir(n - 1);
    else if (e.key === "Tab") {
      setListaAberta(false);
      return;
    } else return;
    e.preventDefault();
  }

  function teclaNoGatilho(e: React.KeyboardEvent) {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    setAberto(false);
    setListaAberta(true);
  }

  const hoje = hojeEmBrasilia();

  return (
    <div className="relative inline-flex" ref={caixa} aria-busy={carregando}>
      {/* Abaixo de 2xl: um botão só, com o período atual. */}
      <button
        ref={gatilho}
        type="button"
        aria-haspopup="menu"
        aria-expanded={listaAberta}
        aria-controls={listaAberta ? idLista : undefined}
        aria-label={`Período: ${estado.rotuloAtual}`}
        disabled={carregando}
        onClick={() => {
          setAberto(false);
          setListaAberta((v) => !v);
        }}
        onKeyDown={teclaNoGatilho}
        className={cn(
          "inline-flex h-9 max-w-[8rem] items-center gap-1 rounded-lg border bg-card px-2.5 text-xs font-medium text-primary transition-opacity 2xl:hidden",
          carregando && "pointer-events-none animate-pulse opacity-60",
        )}
      >
        <span className="truncate">{estado.rotuloAtual}</span>
        <ChevronDown className="size-3.5 shrink-0" aria-hidden />
      </button>

      {/* De 2xl para cima: em linha. */}
      <div
        role="group"
        aria-label="Período"
        className={cn(
          "hidden h-9 items-center gap-0.5 rounded-lg border bg-card p-0.5 transition-opacity 2xl:inline-flex",
          carregando && "pointer-events-none animate-pulse opacity-60",
        )}
      >
        {estado.emLinha.map((op) =>
          op.tipo === "escolher" ? (
            <button
              key={op.id}
              type="button"
              aria-haspopup="dialog"
              aria-expanded={aberto}
              onClick={() => escolherOpcao(op)}
              className={cn(
                "flex h-full items-center gap-1 rounded-md px-2.5 text-xs font-medium whitespace-nowrap transition-colors",
                op.ativo
                  ? "bg-primary/10 text-primary"
                  : "text-muted-foreground hover:bg-foreground/[0.05] hover:text-foreground",
              )}
            >
              <CalendarRange className="size-3.5" />
              {op.rotulo}
            </button>
          ) : (
            <button
              key={op.id}
              type="button"
              aria-pressed={op.ativo}
              title={op.titulo}
              disabled={carregando}
              onClick={() => escolherOpcao(op)}
              className={cn(
                "flex h-full items-center rounded-md px-2.5 text-xs font-medium whitespace-nowrap transition-colors",
                op.tipo === "live" && "max-w-[8rem]",
                op.ativo
                  ? "bg-primary/10 text-primary"
                  : "text-muted-foreground hover:bg-foreground/[0.05] hover:text-foreground",
              )}
            >
              {op.tipo === "live" ? <span className="truncate">{op.rotulo}</span> : op.rotulo}
            </button>
          ),
        )}
      </div>

      {listaAberta ? (
        <div
          id={idLista}
          role="menu"
          aria-label="Período"
          className="absolute right-0 top-11 z-50 flex w-48 flex-col rounded-xl border bg-card p-1 shadow-lg 2xl:hidden"
        >
          {estado.lista.map((op, i) => (
            <button
              key={op.id}
              ref={(el) => {
                itens.current[i] = el;
              }}
              type="button"
              role={op.tipo === "escolher" ? "menuitem" : "menuitemradio"}
              aria-checked={op.tipo === "escolher" ? undefined : op.ativo}
              aria-haspopup={op.tipo === "escolher" ? "dialog" : undefined}
              title={op.titulo}
              onClick={() => escolherOpcao(op)}
              onKeyDown={(e) => teclaNaLista(e, i)}
              className={cn(
                "flex h-9 w-full items-center justify-between gap-2 rounded-md px-3 text-left text-sm transition-colors focus-visible:bg-foreground/[0.05] focus-visible:outline-none",
                op.ativo ? "font-medium text-primary" : "text-foreground hover:bg-foreground/[0.05]",
              )}
            >
              <span className="truncate">{op.rotulo}</span>
              {op.ativo ? <Check className="size-3.5 shrink-0" aria-hidden /> : null}
            </button>
          ))}
        </div>
      ) : null}

      {aberto ? (
        <div
          role="dialog"
          aria-label="Escolher período"
          className="absolute right-0 top-11 z-50 w-64 rounded-xl border bg-card p-4 shadow-lg"
        >
          <div className="flex flex-col gap-3">
            <label className="flex flex-col gap-1 text-xs">
              <span className="text-muted-foreground">De</span>
              <input
                ref={campoDe}
                type="date"
                value={de}
                max={ate || hoje}
                onChange={(e) => setDe(e.target.value)}
                className="h-8 rounded-md border bg-background px-2 text-xs focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:outline-none"
              />
            </label>
            <label className="flex flex-col gap-1 text-xs">
              <span className="text-muted-foreground">Até</span>
              <input
                type="date"
                value={ate}
                min={de || undefined}
                max={hoje}
                onChange={(e) => setAte(e.target.value)}
                className="h-8 rounded-md border bg-background px-2 text-xs focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:outline-none"
              />
            </label>

            <p className="text-[11px] text-muted-foreground">
              Preencha só o &ldquo;De&rdquo; para ver daquela data em diante.
            </p>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={aplicar}
                disabled={!de && !ate}
                className="h-8 flex-1 rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground disabled:opacity-40"
              >
                Aplicar
              </button>
              {estado.escolherAceso ? (
                <button
                  type="button"
                  onClick={() => {
                    setDe("");
                    setAte("");
                    irPara(null);
                    setAberto(false);
                  }}
                  className="h-8 rounded-md border px-3 text-xs text-muted-foreground hover:text-foreground"
                >
                  Limpar
                </button>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
