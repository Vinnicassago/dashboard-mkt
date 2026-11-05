/**
 * Qual fonte o pedido de sincronização quer — PURO. A mesma regra na rota do
 * cron (`/api/sync?source=`) e no "Sincronizar agora" de Integrações.
 *
 * Sem `source` = "all" (como sempre foi). Fonte DESCONHECIDA é erro de uso,
 * nunca "all": um cron com erro de digitação (ex.: `source=robô`, com acento)
 * rodaria Meta e Instagram a cada 15 min e esbarraria no limite de chamadas do
 * Instagram (~200/h).
 */

export const FONTES_DO_SYNC = ["all", "ads", "instagram", "robo"] as const;
export type FonteDoSync = (typeof FONTES_DO_SYNC)[number];

export const ERRO_FONTE_DESCONHECIDA =
  "Fonte de sincronização desconhecida. Use all, ads, instagram ou robo.";

/** `null` = fonte desconhecida (responda 400 / mensagem de uso). Vazio ou ausente = "all". */
export function lerFonteDoSync(raw: unknown): FonteDoSync | null {
  const v = typeof raw === "string" ? raw.trim() : "";
  if (!v) return "all";
  return (FONTES_DO_SYNC as readonly string[]).includes(v) ? (v as FonteDoSync) : null;
}
