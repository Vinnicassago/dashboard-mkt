/**
 * Quem age, numa palavra que o time reconhece. Fonte única do rótulo: o chip das
 * ações, a cascata e a Fila escreviam "COMERCIAL", "comercial" e "COM" para a
 * mesma pessoa — três nomes para um dono só é o tipo de detalhe que faz as telas
 * parecerem desconexas.
 */
export type Dono = "MKT" | "BOT" | "COM";

export const DONO_LABEL: Record<Dono, string> = {
  MKT: "marketing",
  BOT: "robô",
  COM: "comercial",
};
