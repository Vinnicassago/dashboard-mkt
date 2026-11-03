import { NextResponse } from "next/server";
import { lerAtualizacao } from "@/lib/n8n/entrada";
import { falhaInterna, invalido, lerJson, semAutorizacao } from "@/lib/n8n/resposta";
import { atualizar, buscarPorChave, fichaDoLead } from "@/lib/n8n/servico";

export const dynamic = "force-dynamic";

type Contexto = { params: Promise<{ chave: string }> };

const naoEncontrado = () =>
  NextResponse.json({ ok: false, erro: "Lead não encontrado por esse WhatsApp (ou id)." }, { status: 404 });

/** GET /api/n8n/leads/{whatsapp ou id} — a ficha do lead. */
export async function GET(request: Request, { params }: Contexto) {
  const negado = semAutorizacao(request);
  if (negado) return negado;
  try {
    const lead = await buscarPorChave((await params).chave);
    if (!lead) return naoEncontrado();
    return NextResponse.json({ ok: true, lead: await fichaDoLead(lead) });
  } catch (e) {
    return falhaInterna("GET lead", e);
  }
}

/**
 * PATCH /api/n8n/leads/{whatsapp ou id} — os fatos que o fluxo registra:
 * mensagem automática, horário, aviso, escalonamento, comunidade, diagnóstico,
 * tentativa com resultado, reunião e "Sem resposta". 409 = a régua não deixa
 * (o corpo diz o que já foi gravado antes do passo que parou).
 */
export async function PATCH(request: Request, { params }: Contexto) {
  const negado = semAutorizacao(request);
  if (negado) return negado;
  const json = await lerJson(request);
  if (!json.ok) return json.resposta;
  const lido = lerAtualizacao(json.corpo, new Date().toISOString());
  if (!lido.ok) return invalido(lido.erros);
  try {
    const lead = await buscarPorChave((await params).chave);
    if (!lead) return naoEncontrado();
    const r = await atualizar(lead, lido.valor);
    return NextResponse.json(
      { ok: r.ok, ...(r.erro ? { erro: r.erro } : {}), aplicado: r.aplicado, lead: r.ficha },
      { status: r.status },
    );
  } catch (e) {
    return falhaInterna("PATCH lead", e);
  }
}
