import { mensagemHumana } from "@/lib/erros";
import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { runSync, type SyncReport } from "@/lib/meta/sync";
import { incluirRoboNoRelatorio } from "@/lib/robo/sync";
import { setState } from "@/lib/data/store";
import { STATE_KEYS } from "@/lib/data/backend";
import { ERRO_FONTE_DESCONHECIDA, lerFonteDoSync } from "@/lib/fonte-do-sync";
import { DEFAULT_BRAND } from "@/lib/types";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Collection endpoint (cron).
 *
 * Vercel Cron calls it with `Authorization: Bearer $CRON_SECRET`. It also
 * accepts `?secret=` so you can trigger it manually from a terminal.
 * Without CRON_SECRET set it only runs outside production, so an unprotected
 * deploy can never be triggered by a stranger.
 *
 * `?source=` ∈ all (padrão) · ads · instagram · robo. Fonte desconhecida = 400
 * (nunca "all": o cron do robô roda a cada 15 min). `robo` roda SÓ a leitura do
 * robô e grava `roboUltimoCron` (Integrações diz se o cron RODA); o "all"
 * diário também lê o robô, sem gravar `roboUltimoCron`.
 */
function authorize(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return process.env.NODE_ENV !== "production";

  const auth = request.headers.get("authorization");
  if (auth === `Bearer ${secret}`) return true;

  const url = new URL(request.url);
  return url.searchParams.get("secret") === secret;
}

async function handle(request: Request) {
  if (!authorize(request)) {
    return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  }

  const url = new URL(request.url);
  const source = lerFonteDoSync(url.searchParams.get("source"));
  if (!source) return NextResponse.json({ error: ERRO_FONTE_DESCONHECIDA }, { status: 400 });
  const daysParam = Number(url.searchParams.get("days"));
  // Teto de 30 dias por rodada: cada dia custa ~5 requests de insights e o teto
  // da superfície Instagram Login é ~200 calls/hora — backfill maior deve ser
  // feito em janelas de ≤30 com 1h de intervalo.
  const days =
    Number.isFinite(daysParam) && daysParam > 0 ? Math.min(daysParam, 30) : undefined;
  // Opcional: sincroniza só uma marca (útil p/ cron por marca / rate-limit).
  const brand = url.searchParams.get("brand")?.trim() || undefined;

  try {
    let report: SyncReport;
    if (source === "robo") {
      report = { ranAt: new Date().toISOString(), skipped: [] };
      await incluirRoboNoRelatorio(report, "cron");
      // Só esta chamada grava: é a prova de que o cron de 15 min RODA.
      await setState(STATE_KEYS.roboUltimoCron, new Date().toISOString());
    } else {
      report = await runSync({ source, days, brand });
      // O robô é da marca padrão: o "all" (de todas as marcas ou dela) também o lê.
      if (source === "all" && (!brand || brand === DEFAULT_BRAND)) await incluirRoboNoRelatorio(report, "cron");
    }
    revalidatePath("/", "layout");
    return NextResponse.json(report);
  } catch (e) {
    console.error("[api/sync]", e);
    return NextResponse.json(
      { error: mensagemHumana("servidor", e) },
      { status: 500 },
    );
  }
}

export const GET = handle;
export const POST = handle;
