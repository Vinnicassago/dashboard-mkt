/**
 * Validador da paleta (Fase 4.4) — lê os tokens de src/app/globals.css.
 *
 * Regra do CLAUDE.md: cor nova só depois de passar pelo validador. Ele confere
 * três coisas, nos dois temas e nas duas marcas:
 *   1. texto de status legível sobre o card (contraste WCAG ≥ 4,5:1);
 *   2. o status "perto da meta" não se confunde com o accent da marca (matiz a
 *      ≥ 20° — o âmbar do Consórcio e o âmbar de alerta tinham 1° de diferença);
 *   3. os três status se distinguem entre si (matiz a ≥ 15°), e mesmo assim nunca
 *      aparecem sem texto (StatusMetaBadge).
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(path.join(process.cwd(), "src/app/globals.css"), "utf8");

function bloco(seletor: string): Record<string, string> {
  const i = css.indexOf(`${seletor} {`);
  if (i < 0) throw new Error(`bloco ${seletor} não encontrado`);
  const corpo = css.slice(i, css.indexOf("\n}", i));
  const out: Record<string, string> = {};
  for (const m of corpo.matchAll(/--([\w-]+):\s*(#[0-9a-fA-F]{6})/g)) out[m[1]] = m[2].toLowerCase();
  return out;
}

const claro = bloco(":root");
const escuro = { ...claro, ...bloco(':root[data-theme="dark"]') };
const krone = bloco(':root[data-brand="krone"]');

function luminancia(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const f = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}
function contraste(a: string, b: string): number {
  const [x, y] = [luminancia(a), luminancia(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}
function matiz(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  if (d === 0) return 0;
  const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return (h * 60 + 360) % 360;
}
const distancia = (a: string, b: string) => {
  const d = Math.abs(matiz(a) - matiz(b)) % 360;
  return Math.min(d, 360 - d);
};

const temas = [
  ["claro", claro],
  ["escuro", escuro],
] as const;

describe("paleta: status contra meta", () => {
  for (const [nome, t] of temas) {
    it(`texto de status legível no tema ${nome}`, () => {
      for (const k of ["status-ok-text", "status-perto-text", "status-fora-text"]) {
        expect(contraste(t[k], t.card), `${k} ${t[k]} sobre ${t.card}`).toBeGreaterThanOrEqual(4.5);
      }
    });
    it(`"perto da meta" longe do accent da marca no tema ${nome}`, () => {
      for (const primaria of [t.primary, krone.primary]) {
        for (const k of ["status-ok", "status-perto", "status-fora"]) {
          expect(distancia(t[k], primaria), `${k} × primary ${primaria}`).toBeGreaterThanOrEqual(20);
        }
      }
    });
  }
  it("os três status se distinguem entre si", () => {
    const [ok, perto, fora] = [claro["status-ok"], claro["status-perto"], claro["status-fora"]];
    expect(distancia(ok, perto)).toBeGreaterThanOrEqual(15);
    expect(distancia(perto, fora)).toBeGreaterThanOrEqual(15);
    expect(distancia(ok, fora)).toBeGreaterThanOrEqual(15);
  });
});
