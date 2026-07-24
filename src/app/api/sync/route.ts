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
  const days = Number.isFinite(daysParam) && daysParam > 0 ? daysParam : undefined;

  try {
    const report = await runSync({ source, days });
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
