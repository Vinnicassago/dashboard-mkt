/**
 * Fase 3 (C0, §8.1 da spec) — o GOLDEN de paridade do Início.
 *
 * Gravado no código de master f664a7d (versão 2026-11-11a), ANTES de o funil do
 * Início virar um recorte do funil do processo (`recortarProcesso(funilDoProcesso(…))`,
 * §3.5). É a trava da regressão: o `.snap` NÃO se edita e este arquivo NUNCA roda
 * com `-u`. Diff aqui é bug — a única diferença aceita é a de F3-D10 (lead legado
 * com `attendedAt` sem `bookedAt`: a taxa de "Reuniões realizadas" acima de 100%
 * vira `null`), e nenhum caso daqui a produz (conferido abaixo: realizadas ≤
 * agendaram em todos).
 *
 * Três objetos por caso:
 *   • `funilDoAtendimento(e)`;
 *   • `montarInicio(e).atendimento`, SEM a chave `ondeTrava` (o dado novo da Fase 3,
 *     só para a IA — some se existir, para o teste valer hoje e depois);
 *   • `inicioParaIA(montarInicio(e))`, SEM `atendimento.ondeTrava`.
 *
 * Datas fixas: o AGORA dos fixtures (`src/test/fixtures-robo.ts`), nunca o relógio.
 */
import { describe, expect, it } from "vitest";
import { inicioParaIA } from "../ai/briefing";
import { ATOR_LP } from "../diagnostico-leads";
import { funilDoAtendimento, montarInicio, type EntradaInicio } from "../inicio";
import type { DateRange } from "../metrics";
import type { Lead, LeadEvent } from "../types";
import {
  ADS_DA_ANTERIOR,
  ADS_DA_SEMANA,
  ATRASADO,
  LEADS_DA_ANTERIOR,
  LEADS_DO_ROBO,
  NUNCA_LIDO,
  ONTEM,
  PARADO,
  ROBO,
  brt,
  entradaDoRobo,
  entradaDoSeed,
  lead,
  reaberto,
  saudado,
} from "@/test/fixtures-robo";

// ---------------------------------------------------------------- fixtures próprios dos casos
// Criados no carregamento do módulo (o telefone de cada um sai de um contador): o
// mesmo número em toda rodada, com ou sem filtro de teste.

/** Uma semana só de inscritos da live (com classe): o trecho do robô fica, "Com o robô" = 0. */
const INSCRITOS: Lead[] = (["A", "B", "C", "A"] as const).map((classe, i) =>
  lead(`insc${i}`, { createdAt: brt(ONTEM, `1${i}:00`), classe, bem: "imovel" }),
);

/** Saudado em 30/10, reaberto pela página em 03/11 09:00; o robô seguiu a MESMA conversa (não regravou a saudação). */
const CONTINUOU = lead("continuou", {
  ...saudado("2026-10-30"),
  roboUltimaInteracaoEm: brt(ONTEM, "10:00"),
  roboUltimaMsgClienteEm: brt(ONTEM, "10:05"),
  roboEtapa: "em_conversa",
});
const EVENTOS_DO_CONTINUOU: LeadEvent[] = [reaberto("continuou", brt(ONTEM, "09:00"), ATOR_LP)];

/** Reaberto pelo ADMIN (painel: nunca chega ao robô) e por uma inscrição nova (LP: os fatos de antes são da conversa antiga). */
const REABPAINEL = lead("reabpainel", {
  ...saudado("2026-10-30"),
  roboRespondeuEm: brt("2026-10-30", "09:10"),
  roboAceitouEm: brt("2026-10-30", "10:00"),
  roboUltimaInteracaoEm: brt("2026-10-30", "10:00"),
  roboEtapa: "transferido",
});
const REABLP = lead("reablp", {
  ...saudado("2026-10-30"),
  roboRespondeuEm: brt("2026-10-30", "09:10"),
  roboAceitouEm: brt("2026-10-30", "10:00"),
  roboUltimaInteracaoEm: brt("2026-10-30", "10:00"),
  roboEtapa: "transferido",
});
const EVENTOS_DOS_REABERTOS: LeadEvent[] = [reaberto("reabpainel", brt(ONTEM, "10:00"), "admin"), reaberto("reablp", brt(ONTEM, "09:00"), ATOR_LP)];

/** Só leads de antes do robô (29/10), um deles com reunião. */
const ANTES_DO_ROBO: DateRange = { from: "2026-10-20", to: "2026-10-28" };
const COM_A_ANTERIOR = { leads: [...LEADS_DO_ROBO, ...LEADS_DA_ANTERIOR], adDaily: [...ADS_DA_ANTERIOR, ...ADS_DA_SEMANA] };

// ---------------------------------------------------------------- casos

interface Caso {
  nome: string;
  entrada: () => EntradaInicio;
  /** O caminho que o caso exercita (também está no snapshot; aqui fica explícito). */
  comRobo: boolean;
  parada: boolean;
}

const CASOS: Caso[] = [
  // O seed da marca consorcio: robô desligado (o funil do painel).
  { nome: "seed consorcio · 7d", entrada: () => entradaDoSeed("7d"), comRobo: false, parada: false },
  { nome: "seed consorcio · 30d", entrada: () => entradaDoSeed("30d"), comRobo: false, parada: false },
  { nome: "seed consorcio · campanha", entrada: () => entradaDoSeed("all"), comRobo: false, parada: false },
  // O robô de fixture (colunas robo_*).
  { nome: "robô · semana", entrada: () => entradaDoRobo(), comRobo: true, parada: false },
  { nome: "robô · campanha", entrada: () => entradaDoRobo(ROBO, null), comRobo: true, parada: false },
  { nome: "robô parado (falhando)", entrada: () => entradaDoRobo(PARADO), comRobo: true, parada: true },
  { nome: "robô parado há 90 min, ainda 'confiável'", entrada: () => entradaDoRobo(ATRASADO), comRobo: true, parada: true },
  { nome: "robô nunca lido", entrada: () => entradaDoRobo(NUNCA_LIDO), comRobo: true, parada: true },
  { nome: "robô desligado", entrada: () => entradaDoRobo(null), comRobo: false, parada: false },
  {
    nome: "todo antes de 29/10 (o período termina antes do robô)",
    entrada: () => entradaDoRobo(ROBO, ANTES_DO_ROBO, COM_A_ANTERIOR),
    comRobo: false,
    parada: false,
  },
  {
    nome: "todo antes de 29/10 (a campanha só com leads de antes do robô)",
    entrada: () => entradaDoRobo(ROBO, null, { leads: LEADS_DA_ANTERIOR, adDaily: ADS_DA_ANTERIOR }),
    comRobo: false,
    parada: false,
  },
  { nome: "só inscritos da live", entrada: () => entradaDoRobo(ROBO, undefined, { leads: INSCRITOS }), comRobo: true, parada: false },
  {
    nome: "reaberto pela LP com a conversa continuada",
    entrada: () => entradaDoRobo(ROBO, undefined, { leads: [...LEADS_DO_ROBO, CONTINUOU], eventos: EVENTOS_DO_CONTINUOU }),
    comRobo: true,
    parada: false,
  },
  {
    nome: "reaberto no painel e reaberto pela LP com os fatos da conversa antiga",
    entrada: () => entradaDoRobo(ROBO, undefined, { leads: [...LEADS_DO_ROBO, REABPAINEL, REABLP], eventos: EVENTOS_DOS_REABERTOS }),
    comRobo: true,
    parada: false,
  },
];

/** O objeto sem `chave`, se ela existir: o golden vale hoje e depois de `ondeTrava` entrar. */
function semChave(o: object, chave: string): Record<string, unknown> {
  const copia: Record<string, unknown> = { ...(o as Record<string, unknown>) };
  delete copia[chave];
  return copia;
}

describe("paridade do Início — golden gravado antes da Fase 3 (§8.1)", () => {
  for (const c of CASOS) {
    it(c.nome, () => {
      const e = c.entrada();
      const funil = funilDoAtendimento(e);
      const ini = montarInicio(e);
      const ia = inicioParaIA(ini);

      // O caminho que o caso exercita.
      expect(funil.comRobo, "comRobo").toBe(c.comRobo);
      expect(funil.parada, "parada").toBe(c.parada);
      // Fora de F3-D10: nenhum caso tem mais reuniões realizadas que agendamentos.
      expect(e.kpis.overview.attended).toBeLessThanOrEqual(e.kpis.agendaram.valor);

      expect(funil).toMatchSnapshot("funilDoAtendimento");
      expect(semChave(ini.atendimento, "ondeTrava")).toMatchSnapshot("montarInicio.atendimento");
      expect({ ...ia, atendimento: semChave(ia.atendimento, "ondeTrava") }).toMatchSnapshot("inicioParaIA");
    });
  }
});
