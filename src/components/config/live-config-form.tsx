"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { salvarCampanhaDaLive } from "@/app/(dashboard)/configuracoes/live-actions";
import type { CampanhaDaLive, IdDaLinha, Intervalo } from "@/lib/live";
import { cn } from "@/lib/utils";

const inp = "h-8 rounded-md border bg-background px-2 text-xs disabled:opacity-70";
const numCls = `${inp} w-24 tabular-nums`;
const txtCls = `${inp} w-full min-w-[14rem]`;

/** Lista de trechos como o campo mostra ("[LIVE] Captação, [LIVE] Captacao"). */
const emTexto = (l: string[]) => l.join(", ");
const daTexto = (s: string) =>
  s
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);

function Linha({ rotulo, children, dica }: { rotulo: string; children: React.ReactNode; dica?: string }) {
  return (
    <div className="grid gap-1 py-1.5 sm:grid-cols-[13rem_1fr] sm:items-center">
      <span className="text-xs text-muted-foreground" title={dica}>
        {rotulo}
      </span>
      <div className="flex flex-wrap items-center gap-2">{children}</div>
    </div>
  );
}

/**
 * A régua da live, como o briefing mandou e editável: períodos, verba por linha,
 * o conjunto do carro, metas (do funil, do atendimento e de qualidade) e os
 * trechos de nome que dizem o que é da live no Gerenciador.
 */
export function LiveConfigForm({ atual, podeEditar }: { atual: CampanhaDaLive; podeEditar: boolean }) {
  const router = useRouter();
  const [c, setC] = useState<CampanhaDaLive>(() => structuredClone(atual));
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const travado = !podeEditar || pending;
  const mudou = JSON.stringify(c) !== JSON.stringify(atual);

  const setIntervalo = (k: "periodo" | "captacao" | "posLive", campo: keyof Intervalo, v: string) =>
    setC((cur) => ({ ...cur, [k]: { ...cur[k], [campo]: v } }));
  const setLinha = (id: IdDaLinha, patch: Partial<CampanhaDaLive["linhas"][number]>) =>
    setC((cur) => ({ ...cur, linhas: cur.linhas.map((l) => (l.id === id ? { ...l, ...patch } : l)) }));
  const setMeta = (k: keyof CampanhaDaLive["metas"], v: string) =>
    setC((cur) => ({ ...cur, metas: { ...cur.metas, [k]: v === "" ? null : Number(v) } }));
  const setPct = (grupo: "atendimento" | "qualidade", k: string, v: string) =>
    setC((cur) => ({ ...cur, [grupo]: { ...cur[grupo], [k]: Number(v) / 100 } }));
  const pct = (v: number) => Math.round(v * 1000) / 10;

  function salvar() {
    start(async () => {
      const r = await salvarCampanhaDaLive(c);
      setMsg({ ok: r.ok, text: r.message });
      if (r.ok) router.refresh();
    });
  }

  const intervalo = (k: "periodo" | "captacao" | "posLive") => (
    <>
      <input type="date" value={c[k].de} disabled={travado} onChange={(e) => setIntervalo(k, "de", e.target.value)} className={inp} aria-label="de" />
      <span className="text-xs text-muted-foreground">a</span>
      <input type="date" value={c[k].ate} disabled={travado} onChange={(e) => setIntervalo(k, "ate", e.target.value)} className={inp} aria-label="até" />
    </>
  );

  return (
    <div className="space-y-5">
      <section>
        <h3 className="text-sm font-semibold">Períodos</h3>
        <div className="divide-y">
          <Linha rotulo="Data e hora da live">
            <input
              type="datetime-local"
              value={new Date(Date.parse(c.dataDaLive) - 3 * 3_600_000).toISOString().slice(0, 16)}
              disabled={travado}
              onChange={(e) => e.target.value && setC((cur) => ({ ...cur, dataDaLive: new Date(`${e.target.value}:00-03:00`).toISOString() }))}
              className={inp}
              aria-label="Data e hora da live (Brasília)"
            />
          </Linha>
          <Linha rotulo="Campanha da live (período da aba)">{intervalo("periodo")}</Linha>
          <Linha rotulo="Captação">{intervalo("captacao")}</Linha>
          <Linha rotulo="Pós-live">{intervalo("posLive")}</Linha>
        </div>
      </section>

      <section>
        <h3 className="text-sm font-semibold">Verba por linha</h3>
        <div className="divide-y">
          {c.linhas.map((l) => (
            <Linha key={l.id} rotulo={l.rotulo} dica="Trechos do NOME da campanha no Gerenciador, separados por vírgula">
              <span className="text-xs text-muted-foreground">R$</span>
              <input type="number" min="0" step="50" value={l.verba} disabled={travado} onChange={(e) => setLinha(l.id, { verba: Number(e.target.value) })} className={numCls} aria-label={`Verba ${l.rotulo}`} />
              <input type="date" value={l.de} disabled={travado} onChange={(e) => setLinha(l.id, { de: e.target.value })} className={inp} aria-label={`${l.rotulo} de`} />
              <span className="text-xs text-muted-foreground">a</span>
              <input type="date" value={l.ate} disabled={travado} onChange={(e) => setLinha(l.id, { ate: e.target.value })} className={inp} aria-label={`${l.rotulo} até`} />
              <span className="text-xs text-muted-foreground">R$/dia</span>
              <input
                type="number"
                min="0"
                step="10"
                value={l.porDia ?? ""}
                placeholder="verba ÷ dias"
                disabled={travado}
                onChange={(e) => setLinha(l.id, { porDia: e.target.value === "" ? undefined : Number(e.target.value) })}
                className={numCls}
                aria-label={`${l.rotulo} por dia`}
              />
              <input
                value={emTexto(l.campanhas)}
                disabled={travado}
                onChange={(e) => setLinha(l.id, { campanhas: daTexto(e.target.value) })}
                className={txtCls}
                aria-label={`Campanhas de ${l.rotulo}`}
                placeholder="[LIVE] Captação"
              />
            </Linha>
          ))}
          <Linha rotulo="Conjunto do carro (criativo 9)" dica="Ritmo próprio a partir da data; trechos do nome do conjunto e do anúncio">
            <span className="text-xs text-muted-foreground">a partir de</span>
            <input type="date" value={c.carro.desde} disabled={travado} onChange={(e) => setC((cur) => ({ ...cur, carro: { ...cur.carro, desde: e.target.value } }))} className={inp} aria-label="Carro a partir de" />
            <span className="text-xs text-muted-foreground">R$/dia</span>
            <input type="number" min="0" step="5" value={c.carro.porDia} disabled={travado} onChange={(e) => setC((cur) => ({ ...cur, carro: { ...cur.carro, porDia: Number(e.target.value) } }))} className={numCls} aria-label="Carro por dia" />
            <span className="text-xs text-muted-foreground">conjunto</span>
            <input value={emTexto(c.carro.conjuntos)} disabled={travado} onChange={(e) => setC((cur) => ({ ...cur, carro: { ...cur.carro, conjuntos: daTexto(e.target.value) } }))} className={`${inp} w-28`} aria-label="Conjuntos do carro" />
            <span className="text-xs text-muted-foreground">anúncio</span>
            <input value={emTexto(c.carro.anuncios)} disabled={travado} onChange={(e) => setC((cur) => ({ ...cur, carro: { ...cur.carro, anuncios: daTexto(e.target.value) } }))} className={`${inp} w-28`} aria-label="Anúncios do carro" />
            <span className="text-xs text-muted-foreground">julgar a partir de</span>
            <input type="date" value={c.carro.julgarDesde} disabled={travado} onChange={(e) => setC((cur) => ({ ...cur, carro: { ...cur.carro, julgarDesde: e.target.value } }))} className={inp} aria-label="Julgar o carro a partir de" />
          </Linha>
        </div>
      </section>

      <section>
        <h3 className="text-sm font-semibold">Metas da campanha</h3>
        <div className="grid gap-x-6 sm:grid-cols-2">
          {(
            [
              ["inscricoes", "Inscrições"],
              ["qualificados", "Qualificados (A e B)"],
              ["comunidade", "Na comunidade"],
              ["presentes", "Presentes na live"],
              ["agendadas", "Reuniões agendadas"],
              ["realizadas", "Reuniões realizadas"],
              ["vendas", "Vendas (vazio = sem meta)"],
            ] as const
          ).map(([k, rotulo]) => (
            <Linha key={k} rotulo={rotulo}>
              <input type="number" min="0" value={c.metas[k] ?? ""} disabled={travado} onChange={(e) => setMeta(k, e.target.value)} className={numCls} aria-label={rotulo} />
            </Linha>
          ))}
          <Linha rotulo="Custo por inscrito (R$)">
            <input type="number" min="0" step="1" value={c.custos.porInscrito} disabled={travado} onChange={(e) => setC((cur) => ({ ...cur, custos: { ...cur.custos, porInscrito: Number(e.target.value) } }))} className={numCls} aria-label="Custo por inscrito" />
          </Linha>
          <Linha rotulo="Custo por qualificado — até (R$)">
            <input type="number" min="0" step="1" value={c.custos.porQualificadoMax} disabled={travado} onChange={(e) => setC((cur) => ({ ...cur, custos: { ...cur.custos, porQualificadoMax: Number(e.target.value) } }))} className={numCls} aria-label="Custo por qualificado" />
          </Linha>
        </div>
      </section>

      <section>
        <h3 className="text-sm font-semibold">Metas do atendimento e de qualidade (%)</h3>
        <div className="grid gap-x-6 sm:grid-cols-2">
          {(
            [
              ["atendimento", "msgAutomatica", "Com mensagem automática"],
              ["atendimento", "aNoPrazo", "A chamados em até 1 h útil"],
              ["atendimento", "bNoPrazo", "B chamados no mesmo dia"],
              ["atendimento", "contatoValido48h", "Contato válido em 48 h"],
              ["qualidade", "quitarDividasMax", "“Quitar dívidas” — no máximo"],
            ] as const
          ).map(([grupo, k, rotulo]) => (
            <Linha key={k} rotulo={rotulo}>
              <input
                type="number"
                min="0"
                max="100"
                step="1"
                value={pct((c[grupo] as Record<string, number>)[k])}
                disabled={travado}
                onChange={(e) => setPct(grupo, k, e.target.value)}
                className={numCls}
                aria-label={rotulo}
              />
              <span className="text-xs text-muted-foreground">%</span>
            </Linha>
          ))}
        </div>
      </section>

      <section>
        <h3 className="text-sm font-semibold">O que é da live</h3>
        <div className="divide-y">
          <Linha rotulo="Inscrito da live é quem" dica="Durante a live a campanha de sempre pode continuar: isto separa os dois">
            <select
              value={c.inscritos.criterio}
              disabled={travado}
              onChange={(e) => setC((cur) => ({ ...cur, inscritos: { ...cur.inscritos, criterio: e.target.value as "ficha" | "utm" } }))}
              className={inp}
              aria-label="Critério do inscrito"
            >
              <option value="ficha">veio com as respostas do formulário da live</option>
              <option value="utm">tem utm_campaign com um destes trechos</option>
            </select>
            {c.inscritos.criterio === "utm" ? (
              <input
                value={emTexto(c.inscritos.utmCampaign)}
                disabled={travado}
                onChange={(e) => setC((cur) => ({ ...cur, inscritos: { ...cur.inscritos, utmCampaign: daTexto(e.target.value) } }))}
                className={txtCls}
                placeholder="id ou trecho do utm_campaign"
                aria-label="Trechos do utm_campaign"
              />
            ) : null}
          </Linha>
          {(
            [
              ["testeA", "Teste A (anúncio)"],
              ["testeB", "Teste B (anúncio)"],
              ["persona", "Conjunto Persona"],
              ["aberto", "Conjunto Público aberto"],
              ["imovel", "Criativos de imóvel (anúncio)"],
            ] as const
          ).map(([k, rotulo]) => (
            <Linha key={k} rotulo={rotulo}>
              <input
                value={emTexto(c.comparacoes[k])}
                disabled={travado}
                onChange={(e) => setC((cur) => ({ ...cur, comparacoes: { ...cur.comparacoes, [k]: daTexto(e.target.value) } }))}
                className={txtCls}
                aria-label={rotulo}
              />
            </Linha>
          ))}
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          Trechos do nome no Gerenciador, separados por vírgula (maiúsculas e espaços não importam). Os de fábrica
          são uma proposta — troque pelos nomes reais assim que as campanhas existirem.
        </p>
      </section>

      <p className="text-xs text-muted-foreground">
        {atual.atualizadoEm
          ? `Última alteração: ${new Date(atual.atualizadoEm).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}${atual.atualizadoPor ? ` por ${atual.atualizadoPor}` : ""}.`
          : "Valendo os números do briefing de 03/11."}
      </p>
      {podeEditar ? (
        <button
          type="button"
          disabled={pending || !mudou}
          onClick={salvar}
          className="h-9 rounded-lg bg-primary px-3 text-sm font-medium text-primary-foreground disabled:opacity-50"
        >
          {pending ? "Salvando…" : "Salvar campanha da live"}
        </button>
      ) : null}
      {msg ? <p className={cn("text-xs", msg.ok ? "text-muted-foreground" : "text-[var(--danger-text)]")}>{msg.text}</p> : null}
    </div>
  );
}
