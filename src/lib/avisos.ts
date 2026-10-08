import "server-only";
import type { Lead } from "./types";

/**
 * Aviso de lead novo para quem atende (F1 do relatório): "um lead novo aparece
 * em até 60 s, com aviso ao dono". O painel não manda e-mail nem WhatsApp — o
 * n8n da operação já faz isso. Aqui só batemos no webhook dele; quem recebe e
 * por qual canal fica configurado no fluxo do n8n.
 *
 * Env: N8N_LEAD_WEBHOOK_URL (obrigatória para avisar) e N8N_LEAD_WEBHOOK_SECRET
 * (vai no cabeçalho `x-painel-secret`, para o fluxo recusar chamadas de fora).
 * Falha no aviso nunca derruba a entrada do lead.
 */
export async function avisarLeadNovo(
  lead: Lead,
  /** `lead_voltou`: estava perdido e preencheu o formulário de novo. */
  evento: "lead_novo" | "lead_voltou" = "lead_novo",
): Promise<void> {
  const url = process.env.N8N_LEAD_WEBHOOK_URL?.trim();
  if (!url) return;
  const painel = process.env.PAINEL_URL?.trim().replace(/\/$/, "");
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(process.env.N8N_LEAD_WEBHOOK_SECRET
          ? { "x-painel-secret": process.env.N8N_LEAD_WEBHOOK_SECRET }
          : {}),
      },
      body: JSON.stringify({
        evento,
        id: lead.id,
        marca: lead.brand,
        nome: lead.name,
        telefone: lead.phone ?? null,
        email: lead.email ?? null,
        origem: lead.utmSource ?? null,
        campanha: lead.utmCampaign ?? null,
        criadoEm: lead.createdAt,
        fila: painel ? `${painel}/fila?etapa=novo` : null,
        ficha: painel ? `${painel}/pessoas/${encodeURIComponent(lead.id)}` : null,
      }),
      signal: AbortSignal.timeout(3_000),
    });
    if (!res.ok) console.warn(`[aviso] n8n respondeu ${res.status} para o lead ${lead.id}`);
  } catch (e) {
    console.warn(`[aviso] não consegui avisar o n8n do lead ${lead.id}:`, e);
  }
}
