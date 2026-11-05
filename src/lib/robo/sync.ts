import "server-only";
import { randomUUID } from "node:crypto";
import {
  addSyncRun,
  getState,
  listLeadEvents,
  listLeads,
  listSyncRuns,
  setState,
  updateLeadsRobo,
} from "../data/store";
import { STATE_KEYS, emFilaNoProcesso } from "../data/backend";
import { DEFAULT_BRAND, type Lead, type SyncRun } from "../types";
import { mensagemHumana } from "../erros";
import { diaBrt } from "../horario-util";
import { chaveTelefoneValida } from "../phone";
import type { SourceOutcome, SyncReport } from "../meta/sync";
import { lerLeadsDoRobo, roboLigado } from "./client";
import { casarLeadsDoRobo, type ResumoLeituraRobo } from "./casar";
import { ROBO_INICIO } from "./etapa";
import { reabertosPorLead } from "./situacao";
import { avisarResgateSePreciso } from "./avisar-resgate";

/**
 * Sync do robô de WhatsApp → leads do painel (decisão 4.1: o painel NUNCA lê o
 * banco do robô ao desenhar uma página; só este sync lê, as telas leem o store).
 *
 * Lê "Leads WhatsApp" (colunas explícitas, `lerLeadsDoRobo`), casa pelo telefone
 * com `listLeads(DEFAULT_BRAND)` (`casarLeadsDoRobo`, puro) e grava só as colunas
 * `robo_*` (`updateLeadsRobo`). Nada muda de status; o robô não é tentativa.
 * Toda execução vai para `sync_runs` (fonte "robo", marca padrão, `rows` =
 * conversas que casaram), dê certo ou não — menos com o robô DESLIGADO, que não
 * é erro e não grava nada.
 *
 * Origem: `cron` (`/api/sync?source=robo`, a cada 15 min, e o "all" diário),
 * `manual` (Integrações → Sincronizar agora) e `carona` (abrir a Fila, em
 * `after()`). Serializado no processo (`emFilaNoProcesso("robo-sync")`).
 * Nunca loga linha nem telefone; nunca lança.
 */

export type OrigemSyncRobo = "cron" | "manual" | "carona";

export interface ResultadoSyncRobo {
  ok: boolean;
  origem: OrigemSyncRobo;
  /** Robô desligado (sem credencial ou desativado): nada lido, nada gravado. */
  desligado?: true;
  /** As contagens da leitura (só no sucesso). */
  leitura?: ResumoLeituraRobo;
  /** Leads que receberam fatos novos nesta leitura. */
  atualizados?: number;
  /** Frase humana (`mensagemHumana`) — nunca o erro cru. */
  erro?: string;
}

/**
 * Zero linhas com lead recente da marca é FALHA, não "o robô não recebeu
 * ninguém": com RLS e uma chave sem permissão, a tabela volta vazia sem erro.
 */
export const ZERO_INESPERADO = "O robô devolveu 0 linhas — a chave tem permissão de leitura?";
/** O lead precisa ter entrado há mais disso para o zero ser suspeito (o robô leva um tempo). */
const FOLGA_DO_ZERO_MS = 3_600_000;
/** A carona só roda se a última tentativa (ok ou não) terminou há mais disso. */
export const CARONA_INTERVALO_MIN = 15;

/** Erro cuja mensagem já é a frase da tela. */
class FalhaHumana extends Error {}

// ---------------------------------------------------------------- em andamento

/**
 * Sync do robô em andamento NESTE processo (inclui quem espera na fila). Em
 * `globalThis` para sobreviver ao recarregamento de módulo do dev. A carona olha
 * daqui: sem isso, cada aba aberta na Fila (que se recarrega a cada minuto)
 * enfileiraria um sync atrás do outro enquanto a leitura estivesse lenta.
 */
const marca = globalThis as typeof globalThis & { __roboSyncEmAndamento?: number };

export function syncDoRoboEmAndamento(): boolean {
  return (marca.__roboSyncEmAndamento ?? 0) > 0;
}

async function comMarca<T>(fn: () => Promise<T>): Promise<T> {
  marca.__roboSyncEmAndamento = (marca.__roboSyncEmAndamento ?? 0) + 1;
  try {
    return await fn();
  } finally {
    marca.__roboSyncEmAndamento = Math.max(0, (marca.__roboSyncEmAndamento ?? 1) - 1);
  }
}

// ---------------------------------------------------------------- utilitários

/** Para o log: corta sequências de dígitos (um telefone nunca vai ao log). */
function semDigitos(t: string): string {
  return t.replace(/\d[\d\s().-]{6,}\d/g, "…");
}

function textoDoErro(e: unknown): string {
  return semDigitos(e instanceof Error ? `${e.name}: ${e.message}` : String(e));
}

/** Registrar a execução nunca derruba o sync (o molde de `meta/sync.ts`). */
async function registrar(run: Omit<SyncRun, "id">): Promise<void> {
  try {
    await addSyncRun({ ...run, id: `SYNC-${randomUUID()}` });
  } catch (e) {
    console.error("[robo] não consegui registrar a execução:", textoDoErro(e));
  }
}

/** Há lead da marca, de depois do corte, com telefone, entrado há mais de 1 h? */
function esperavaLinhas(leads: Lead[], agora: string): boolean {
  const limite = Date.parse(agora) - FOLGA_DO_ZERO_MS;
  return leads.some(
    (l) =>
      !l.deletedAt &&
      diaBrt(l.createdAt) >= ROBO_INICIO &&
      Date.parse(l.createdAt) <= limite &&
      chaveTelefoneValida(l.phone) != null,
  );
}

// ---------------------------------------------------------------- o sync

/** Lê, casa e grava. Serializado no processo; nunca lança. */
export async function sincronizarRobo(opts: { agora?: string; origem: OrigemSyncRobo }): Promise<ResultadoSyncRobo> {
  return comMarca(() => emFilaNoProcesso("robo-sync", () => executar(opts)));
}

async function executar({ agora, origem }: { agora?: string; origem: OrigemSyncRobo }): Promise<ResultadoSyncRobo> {
  const relogio = () => agora ?? new Date().toISOString();

  // Desligado não é erro: sem leitura, sem execução gravada, sem alerta.
  try {
    if (!(await roboLigado())) return { ok: true, origem, desligado: true };
  } catch (e) {
    console.error("[robo] não consegui ler a chave do robô:", textoDoErro(e));
    return { ok: false, origem, erro: mensagemHumana("banco de dados", e) };
  }

  const inicio = relogio();
  let fonte: "robô" | "banco de dados" = "robô";
  try {
    const linhas = await lerLeadsDoRobo();
    fonte = "banco de dados";
    const leads = await listLeads(DEFAULT_BRAND);
    if (linhas.length === 0 && esperavaLinhas(leads, inicio)) throw new FalhaHumana(ZERO_INESPERADO);
    // O último `reaberto` de cada lead: os fatos de antes dele recomeçam (11.3).
    const reabertos = reabertosPorLead(await listLeadEvents({ brand: DEFAULT_BRAND, action: "reaberto", limit: 0 }));

    const casamento = casarLeadsDoRobo(linhas, leads, inicio, reabertos);
    const atualizados = casamento.itens.length ? await updateLeadsRobo(casamento.itens) : 0;
    const fim = relogio();
    const leitura: ResumoLeituraRobo = {
      em: fim,
      lidos: casamento.lidos,
      casaram: casamento.casaram,
      semLeadNoPainel: casamento.semLeadNoPainel,
      semTelefone: casamento.semTelefone,
      transferidosSemLead: casamento.transferidosSemLead,
    };
    await registrar({
      source: "robo",
      brand: DEFAULT_BRAND,
      startedAt: inicio,
      finishedAt: fim,
      ok: true,
      rows: casamento.casaram,
    });
    // O "falhando desde" some PRIMEIRO e sozinho: se o resumo abaixo falhar, a
    // próxima falha abre um episódio novo (e um id novo da B1). Limpa com "", não
    // null — `app_state.value` é `jsonb not null` e o Supabase recusaria.
    try {
      if (await getState<string>(STATE_KEYS.roboFalhaDesde)) await setState(STATE_KEYS.roboFalhaDesde, "");
    } catch (e) {
      console.error("[robo] não consegui limpar o início da falha:", textoDoErro(e));
    }
    try {
      await setState(STATE_KEYS.roboUltimaLeitura, leitura);
    } catch (e) {
      console.error("[robo] não consegui gravar o resumo da leitura:", textoDoErro(e));
    }

    if (origem === "cron" || origem === "manual") {
      // O aviso de resgate ao n8n (§5, 11.1, 11.14): só depois de uma leitura OK
      // — os fatos e o sync_runs acima já gravados —, só nas origens cron e
      // manual (a CARONA nunca avisa) e sem try: a função nunca lança.
      await avisarResgateSePreciso(fim);
    }

    return { ok: true, origem, leitura, atualizados };
  } catch (e) {
    const fim = relogio();
    const erro = e instanceof FalhaHumana ? e.message : mensagemHumana(fonte, e);
    console.error(`[robo] a leitura falhou (${origem}):`, textoDoErro(e));
    await registrar({ source: "robo", brand: DEFAULT_BRAND, startedAt: inicio, finishedAt: fim, ok: false, error: erro });
    try {
      // A 1ª falha depois do último ok: o "falhando desde" (e o id da B1) não anda.
      if (!(await getState<string>(STATE_KEYS.roboFalhaDesde))) await setState(STATE_KEYS.roboFalhaDesde, fim);
    } catch (e2) {
      console.error("[robo] não consegui gravar o início da falha:", textoDoErro(e2));
    }
    return { ok: false, origem, erro };
  }
}

/** O resultado no formato do relatório do sync (rota e "Sincronizar agora"). Desligado = null. */
export function resumoDoSyncRobo(r: ResultadoSyncRobo): SourceOutcome | null {
  if (r.desligado) return null;
  if (!r.ok || !r.leitura) return { ok: false, detail: r.erro ?? "a leitura do robô falhou" };
  const l = r.leitura;
  return {
    ok: true,
    detail: `${l.lidos} lidas · ${l.casaram} casaram · ${l.semLeadNoPainel} sem lead no painel · ${r.atualizados ?? 0} leads atualizados`,
  };
}

/**
 * Roda a leitura e a junta ao relatório do sync (a rota do cron e o
 * "Sincronizar agora" usam o mesmo caminho). Desligado vai para `skipped`.
 */
export async function incluirRoboNoRelatorio(report: SyncReport, origem: OrigemSyncRobo): Promise<ResultadoSyncRobo> {
  const r = await sincronizarRobo({ origem });
  const resumo = resumoDoSyncRobo(r);
  if (resumo) report.robo = resumo;
  else report.skipped.push("robô (desligado)");
  return r;
}

// ---------------------------------------------------------------- carona

/**
 * Ao abrir a Fila (`after()`, a página não espera): roda a leitura se o robô está
 * ligado, a marca é a do robô, não há sync do robô em andamento no processo e a
 * última TENTATIVA (ok ou não) terminou há mais de `CARONA_INTERVALO_MIN` — contar
 * só o último ok faria cada recarga disparar outra leitura enquanto falha. Job de
 * SISTEMA, como o `after` da CAPI: sem `can()`; não dispara o aviso de resgate.
 * Nunca lança. Devolve se disparou.
 */
export async function dispararCaronaDoRobo(brand: string = DEFAULT_BRAND, agora: Date = new Date()): Promise<boolean> {
  if (brand !== DEFAULT_BRAND || syncDoRoboEmAndamento()) return false;
  return comMarca(async () => {
    try {
      if (!(await roboLigado())) return false;
      const [ultima] = await listSyncRuns({ source: "robo", brand: DEFAULT_BRAND, limit: 1 });
      if (ultima && agora.getTime() - Date.parse(ultima.finishedAt) <= CARONA_INTERVALO_MIN * 60_000) return false;
      await emFilaNoProcesso("robo-sync", () => executar({ origem: "carona" }));
      return true;
    } catch (e) {
      console.warn("[robo] carona falhou:", textoDoErro(e));
      return false;
    }
  });
}
