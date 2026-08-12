import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { runSync, type SyncSource } from "@/lib/meta/sync";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Daily collection endpoint.
 *
 * Vercel Cron calls it with `Authorization: Bearer $CRON_SECRET`. It also
 * accepts `?secret=` so you can trigger it manually from a terminal.
 * Without CRON_SECRET set it only runs outside production, so an unprotected
 * deploy can never be triggered by a stranger.
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
  const sourceParam = url.searchParams.get("source") ?? "all";
  const source: SyncSource =
    sourceParam === "ads" || sourceParam === "instagram" ? sourceParam : "all";
  const daysParam = Number(url.searchParams.get("days"));
  // Teto de 30 dias por rodada: cada dia custa ~5 requests de insights e o teto
  // da superfície Instagram Login é ~200 calls/hora — backfill maior deve ser
  // feito em janelas de ≤30 com 1h de intervalo.
  const days =
    Number.isFinite(daysParam) && daysParam > 0 ? Math.min(daysParam, 30) : undefined;
  // Opcional: sincroniza só uma marca (útil p/ cron por marca / rate-limit).
  const brand = url.searchParams.get("brand")?.trim() || undefined;

  try {
    const report = await runSync({ source, days, brand });
    revalidatePath("/", "layout");
    return NextResponse.json(report);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Falha na sincronização." },
      { status: 500 },
    );
  }
}

export const GET = handle;
export const POST = handle;
