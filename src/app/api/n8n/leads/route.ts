import { NextResponse, after } from "next/server";
import { getLead } from "@/lib/data/store";
import { lerInscricao } from "@/lib/n8n/entrada";
import { falhaInterna, invalido, lerJson, semAutorizacao } from "@/lib/n8n/resposta";
import { inscrever } from "@/lib/n8n/servico";
import { avisarLeadPorPush } from "@/lib/push/enviar";

export const dynamic = "force-dynamic";

/**
 * POST /api/n8n/leads — a inscrição que o n8n recebeu da página. Cria o lead ou,
 * se o WhatsApp já é de alguém, atualiza a ficha dessa pessoa (nunca duplica).
 * 201 = criado, 200 = atualizado; `lead.reinscricao` = já era lead antes desta
 * inscrição. Ver docs/api-n8n.md.
 *
 * Lead criado aqui (ou que estava perdido e voltou) avisa os aparelhos com o sino
 * ligado, DEPOIS da resposta. A página manda a mesma inscrição ao /api/track: só
 * quem CRIA (ou reabre) avisa — a trava da pessoa garante que é um caminho só.
 */
export async function POST(request: Request) {
  const negado = semAutorizacao(request);
  if (negado) return negado;
  const json = await lerJson(request);
  if (!json.ok) return json.resposta;
  const lido = lerInscricao(json.corpo, new Date().toISOString());
  if (!lido.ok) return invalido(lido.erros);
  try {
    const r = await inscrever(lido.valor);
    if (r.criado || r.reaberto) {
      after(async () => {
        const lead = await getLead(r.leadId);
        if (lead) await avisarLeadPorPush(lead, r.criado ? "lead_novo" : "lead_voltou");
      });
    }
    return NextResponse.json(
      { ok: true, criado: r.criado, lead: { ...r.ficha, reinscricao: r.reinscricao } },
      { status: r.criado ? 201 : 200 },
    );
  } catch (e) {
    return falhaInterna("POST leads", e);
  }
}
