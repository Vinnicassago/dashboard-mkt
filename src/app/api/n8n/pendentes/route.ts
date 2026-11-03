import { NextResponse } from "next/server";
import { falhaInterna, semAutorizacao } from "@/lib/n8n/resposta";
import { classesDaQuery, pendentes } from "@/lib/n8n/servico";

export const dynamic = "force-dynamic";

/**
 * GET /api/n8n/pendentes — a Fila da live: A e B esperando tentativa, do prazo
 * mais antigo para o mais novo. `?vencidos=1` só os atrasados (a checagem de 10
 * em 10 minutos); `?classe=A` só uma classe; `?ate=<ISO>` prazo até lá (a fila
 * do início do turno).
 */
export async function GET(request: Request) {
  const negado = semAutorizacao(request);
  if (negado) return negado;
  const q = new URL(request.url).searchParams;
  const ate = q.get("ate");
  if (ate && !Number.isFinite(Date.parse(ate))) {
    return NextResponse.json({ ok: false, erro: "ate: data inválida (ISO 8601)." }, { status: 422 });
  }
  try {
    const r = await pendentes({
      classes: classesDaQuery(q.get("classe")),
      vencidos: q.get("vencidos") === "1" || q.get("vencidos") === "true",
      ate: ate ? new Date(Date.parse(ate)).toISOString() : undefined,
    });
    return NextResponse.json({ ok: true, ...r });
  } catch (e) {
    return falhaInterna("GET pendentes", e);
  }
}
