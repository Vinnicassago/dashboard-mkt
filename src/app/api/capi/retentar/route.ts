import { NextResponse } from "next/server";
import { reenviarPendentes } from "@/lib/meta/capi-envios";
import { setState } from "@/lib/data/store";
import { STATE_KEYS } from "@/lib/data/backend";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Nova tentativa da CAPI (Fase 7, D9), por cron.
 *
 * O cron-job.org chama a cada 15 minutos com `?secret=` ou `Authorization:
 * Bearer $CRON_SECRET` — a mesma chave de `/api/sync`. Reenvia os pendentes cuja
 * hora chegou (até `?limit=`, padrão 50) e responde a contagem. Sem CRON_SECRET
 * só roda fora de produção. Não custa nada além das chamadas à Meta.
 */
function authorize(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return process.env.NODE_ENV !== "production";
  const auth = request.headers.get("authorization");
  if (auth === `Bearer ${secret}`) return true;
  return new URL(request.url).searchParams.get("secret") === secret;
}

async function handle(request: Request) {
  if (!authorize(request)) return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  const pedido = Number(new URL(request.url).searchParams.get("limit"));
  const limit = Number.isInteger(pedido) && pedido > 0 ? Math.min(pedido, 200) : 50;
  try {
    const r = await reenviarPendentes({ limit });
    // Integrações diz se o cron RODA (não só se a chave existe).
    await setState(STATE_KEYS.capiUltimoReenvio, new Date().toISOString());
    return NextResponse.json({ ok: true, ...r });
  } catch (e) {
    console.error("[api/capi/retentar]", e);
    return NextResponse.json({ ok: false, error: "Falha ao reenviar — detalhe no log do servidor." }, { status: 500 });
  }
}

export const GET = handle;
export const POST = handle;
