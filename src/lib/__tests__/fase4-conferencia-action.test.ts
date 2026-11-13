/**
 * Fase 4 (§5.8 da spec, K25) — a action da conferência com o Gerenciador, agora em
 * Configurações → Integrações (`configuracoes/conferencia-actions.ts`). Antes não tinha
 * teste. A permissão é conferida NO SERVIDOR, antes de tudo; o gasto do painel é
 * RECALCULADO aqui (`gastoDoPeriodoParaConferir`: o gasto TOTAL do período, K5), nunca
 * o que o navegador diz; uma chave inválida cai na campanha inteira; valor negativo ou
 * que não é número não grava.
 *
 * O store, a sessão, a marca, o ator, o cache do Next e o registro de syncs são dublês;
 * o relógio é fixo em 12/11/2026 15:00 (Brasília).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { registrarConferencia } from "@/app/(dashboard)/configuracoes/conferencia-actions";
import { gastoDoPeriodoParaConferir } from "../conferencia-periodo";
import { AGORA, HOJE, producaoSemana } from "@/test/fixtures-midia";

const h = vi.hoisted(() => ({ pode: true, data: null as unknown }));
const addConferencia = vi.hoisted(() => vi.fn<(c: unknown) => Promise<void>>(async () => {}));
const getData = vi.hoisted(() => vi.fn(async () => h.data));
const revalidatePath = vi.hoisted(() => vi.fn());
const can = vi.hoisted(() => vi.fn<(cap: string) => Promise<boolean>>(async () => h.pode));

vi.mock("@/lib/auth/guard", () => ({ can }));
vi.mock("@/lib/active-brand", () => ({ activeBrandSlug: async () => "consorcio" }));
vi.mock("@/lib/auth/actor", () => ({ currentActor: async () => "ana" }));
vi.mock("next/cache", () => ({ revalidatePath }));
vi.mock("@/lib/data/store", () => ({ getData, addConferencia }));
vi.mock("@/lib/sincronizacao", () => ({ estadoDaFonte: async () => ({ ultimoOk: "2026-11-12T09:02:00Z", falha: null }) }));

const DATA = producaoSemana().data;

beforeEach(() => {
  h.pode = true;
  h.data = DATA;
  addConferencia.mockClear();
  getData.mockClear();
  revalidatePath.mockClear();
  can.mockClear();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(AGORA));
});

afterEach(() => {
  vi.useRealTimers();
});

/** O que foi gravado na última conferência. */
const gravada = () => addConferencia.mock.calls.at(-1)![0] as { gastoPainel: number; gastoGerenciador: number; periodoDe: string; periodoAte: string; brand: string; criadaPor: string; diferenca: number | null; ultimoSync?: string };

describe("registrarConferencia (Configurações → Integrações)", () => {
  it("sem `data:write`: { ok: false } e nada é gravado — a permissão vem antes de tudo", async () => {
    h.pode = false;
    const r = await registrarConferencia("7d", 700);
    expect(r.ok).toBe(false);
    expect(can).toHaveBeenCalledWith("data:write");
    expect(addConferencia).not.toHaveBeenCalled();
    expect(getData).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("com `data:write`: grava o gasto TOTAL do período recalculado no servidor, o período da chave, e revalida Integrações", async () => {
    for (const rk of ["7d", "30d", "all"]) {
      const r = await registrarConferencia(rk, 700);
      expect(r.ok, rk).toBe(true);
      const c = gastoDoPeriodoParaConferir(DATA, rk, HOJE);
      expect(gravada()).toMatchObject({ brand: "consorcio", gastoPainel: c.gasto, gastoGerenciador: 700, periodoDe: c.de, periodoAte: c.ate, criadaPor: "ana" });
      expect(gravada().ultimoSync).toBe("2026-11-12T09:02:00Z");
      expect(revalidatePath).toHaveBeenLastCalledWith("/configuracoes/integracoes");
    }
    // 7 dias = 06/11 a 12/11, e o gasto é o total (conversão + descoberta).
    await registrarConferencia("7d", 733);
    expect(gravada()).toMatchObject({ periodoDe: "2026-11-06", periodoAte: "2026-11-12" });
    expect(gravada().gastoPainel).toBe(gastoDoPeriodoParaConferir(DATA, "7d", HOJE).gasto);
    expect(revalidatePath).not.toHaveBeenCalledWith("/midia");
  });

  it("chave inválida (ou nenhuma) → a campanha inteira", async () => {
    const all = gastoDoPeriodoParaConferir(DATA, "all", HOJE);
    for (const rk of ["lixo", undefined]) {
      const r = await registrarConferencia(rk, 700);
      expect(r.ok, String(rk)).toBe(true);
      expect(gravada()).toMatchObject({ gastoPainel: all.gasto, periodoDe: all.de, periodoAte: all.ate });
    }
  });

  it("valor negativo ou que não é número → { ok: false } sem gravar", async () => {
    for (const v of [-1, Number.NaN, Number.POSITIVE_INFINITY]) {
      const r = await registrarConferencia("7d", v);
      expect(r.ok, String(v)).toBe(false);
    }
    expect(addConferencia).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
    // Zero é um valor válido (o Gerenciador pode mostrar R$ 0).
    expect((await registrarConferencia("7d", 0)).ok).toBe(true);
  });

  it("a mensagem diz o painel, o Gerenciador e se bate (até 5%)", async () => {
    const gasto = gastoDoPeriodoParaConferir(DATA, "7d", HOJE).gasto;
    const bate = await registrarConferencia("7d", gasto * 1.02);
    expect(bate).toMatchObject({ ok: true, bate: true });
    expect(bate.message).toMatch(/dentro de 5%/);
    const naoBate = await registrarConferencia("7d", gasto * 1.5);
    expect(naoBate).toMatchObject({ ok: true, bate: false });
    expect(naoBate.message).toMatch(/acima de 5%/);
  });
});
