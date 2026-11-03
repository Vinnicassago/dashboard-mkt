import { NextResponse } from "next/server";
import { lerInscricao } from "@/lib/n8n/entrada";
import { falhaInterna, invalido, lerJson, semAutorizacao } from "@/lib/n8n/resposta";
import { inscrever } from "@/lib/n8n/servico";

export const dynamic = "force-dynamic";

/**
 * POST /api/n8n/leads — a inscrição que o n8n recebeu da página. Cria o lead ou,
 * se o WhatsApp já é de alguém, atualiza a ficha dessa pessoa (nunca duplica).
 * 201 = criado, 200 = atualizado. Ver docs/api-n8n.md.
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
    return NextResponse.json({ ok: true, criado: r.criado, lead: r.ficha }, { status: r.criado ? 201 : 200 });
  } catch (e) {
    return falhaInterna("POST leads", e);
  }
}
