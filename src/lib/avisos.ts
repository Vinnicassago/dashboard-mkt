import "server-only";
import { idCarregaTelefone } from "./lead-id";
import { MAX_ITENS_AVISO_RESGATE, type ItemResgate } from "./robo/aviso-resgate";
import type { Lead } from "./types";

/**
 * Avisos do painel para o n8n (F1 do relatório): o painel não manda e-mail nem
 * WhatsApp — o n8n da operação já faz isso. Aqui só batemos no webhook dele;
 * quem recebe e por qual canal fica configurado no fluxo do n8n.
 *
 * Dois webhooks, cada um com o seu fluxo (o de lead novo trata todo POST como
 * lead novo — um resgate ali viraria mensagem quebrada):
 *   • N8N_LEAD_WEBHOOK_URL — `lead_novo` e `lead_voltou` (`avisarLeadNovo`);
 *   • N8N_RESGATE_WEBHOOK_URL — `resgate` (`avisarResgate`), sem PII.
 * Os dois levam N8N_LEAD_WEBHOOK_SECRET no cabeçalho `x-painel-secret`, para o
 * fluxo recusar chamadas de fora. Sem a URL, não avisa. Falha no aviso nunca
 * derruba quem chama.
 */

/** Painel (para os links), sem a barra final. */
const painel = () => process.env.PAINEL_URL?.trim().replace(/\/$/, "") || null;

/**
 * POST JSON no n8n com o segredo e timeout de 3 s. Nunca lança: devolve se o n8n
 * aceitou (2xx). `rotulo` vai no log — nunca telefone, e-mail ou conversa.
 */
export async function postarNoN8n(url: string, corpo: unknown, rotulo: string): Promise<boolean> {
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(process.env.N8N_LEAD_WEBHOOK_SECRET ? { "x-painel-secret": process.env.N8N_LEAD_WEBHOOK_SECRET } : {}),
      },
      body: JSON.stringify(corpo),
      signal: AbortSignal.timeout(3_000),
    });
    if (!res.ok) {
      console.warn(`[aviso] n8n respondeu ${res.status} para ${rotulo}`);
      return false;
    }
    return true;
  } catch (e) {
    console.warn(`[aviso] não consegui avisar o n8n (${rotulo}):`, e instanceof Error ? e.message : e);
    return false;
  }
}

/**
 * Aviso de lead novo para quem atende. Com o robô LIGADO (11.13) o 1º contato é
 * dele: o link `fila` vira o da ficha e o payload ganha `robo: true` — o fluxo do
 * n8n decide se chama alguém. Com o robô desligado, o link da Fila em "Novos",
 * como sempre. O resto do payload não muda.
 */
export async function avisarLeadNovo(
  lead: Lead,
  /** `lead_voltou`: estava perdido e preencheu o formulário de novo. */
  evento: "lead_novo" | "lead_voltou" = "lead_novo",
  /** O robô está ligado para este lead (`estadoDoRoboAgora(...).ligado`, quem chama passa). */
  opts: { robo?: boolean } = {},
): Promise<void> {
  const url = process.env.N8N_LEAD_WEBHOOK_URL?.trim();
  if (!url) return;
  const p = painel();
  const ficha = p ? `${p}/leads/${encodeURIComponent(lead.id)}` : null;
  await postarNoN8n(
    url,
    {
      evento,
      id: lead.id,
      marca: lead.brand,
      nome: lead.name,
      telefone: lead.phone ?? null,
      email: lead.email ?? null,
      origem: lead.utmSource ?? null,
      campanha: lead.utmCampaign ?? null,
      criadoEm: lead.createdAt,
      fila: opts.robo ? ficha : p ? `${p}/fila?etapa=novo` : null,
      ficha,
      ...(opts.robo ? { robo: true } : {}),
    },
    `o lead ${lead.id}`,
  );
}

/** Há webhook do aviso de resgate? (Integrações diz "desligado" sem ele.) */
export function avisoDeResgateConfigurado(): boolean {
  return Boolean(process.env.N8N_RESGATE_WEBHOOK_URL?.trim());
}

/**
 * Aviso de resgate (§5): quem entrou no resgate desde o último aviso, agrupado.
 * Corpo SEM telefone, e-mail, classe ou conversa — só o primeiro nome, o motivo,
 * desde quando e o link da ficha (atrás do login). O lead que a API do n8n criou sem
 * event_id tem o WhatsApp no id (`idCarregaTelefone`): vai com `id` e `ficha` nulos —
 * a pessoa está no link `fila`. Até 20 pessoas; `total` = quantas
 * estão no grupo Resgate da Fila agora — o número da página que o link `fila` abre.
 * O link leva `?etapa=resgate` (a Fila abre no grupo) e a âncora `#resgate`. Devolve
 * se o n8n aceitou; sem a variável, `false` sem POST.
 */
export async function avisarResgate(r: {
  marca: string;
  itens: readonly ItemResgate[];
  total: number;
  agora: string;
  /** Pessoas no corpo (padrão `MAX_ITENS_AVISO_RESGATE`). */
  max?: number;
}): Promise<boolean> {
  const url = process.env.N8N_RESGATE_WEBHOOK_URL?.trim();
  if (!url) return false;
  const p = painel();
  return postarNoN8n(
    url,
    {
      evento: "resgate",
      marca: r.marca,
      geradoEm: r.agora,
      total: r.total,
      novos: r.itens.length,
      fila: p ? `${p}/fila?etapa=resgate#resgate` : null,
      itens: r.itens.slice(0, r.max ?? MAX_ITENS_AVISO_RESGATE).map((i) => {
        const comTelefone = idCarregaTelefone(i.id);
        return {
          id: comTelefone ? null : i.id,
          primeiroNome: i.primeiroNome,
          motivo: i.motivo,
          desde: i.desde,
          ficha: p && !comTelefone ? `${p}/leads/${encodeURIComponent(i.id)}` : null,
        };
      }),
    },
    `o resgate (${r.itens.length} novos)`,
  );
}
