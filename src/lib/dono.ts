/**
 * Quem age, numa palavra que o time reconhece. Fonte única do rótulo: o chip das
 * ações, a cascata e a Fila escreviam "COMERCIAL", "comercial" e "COM" para a
 * mesma pessoa — três nomes para um dono só é o tipo de detalhe que faz as telas
 * parecerem desconexas.
 *
 * A Bússola (Fase 5) trouxe os donos que o relatório nomeia além dos três do
 * funil: a landing page, os dados (integrações) e a gestão (metas, orçamento) —
 * e o especialista, que conduz a reunião depois que o comercial a marca.
 */
export type Dono = "MKT" | "BOT" | "COM" | "ESP" | "LP" | "DADOS" | "GESTAO";

export const DONO_LABEL: Record<Dono, string> = {
  MKT: "marketing",
  BOT: "robô",
  COM: "comercial",
  ESP: "especialista",
  LP: "landing page",
  DADOS: "dados",
  GESTAO: "gestão",
};
