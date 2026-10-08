import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { BRANDS } from "@/lib/brands";
import { isAiConfigured } from "@/lib/ai/config";
import { aiErrorMessage } from "@/lib/ai/client";
import { gerarResumoSemanal } from "@/lib/ai/resumo-semanal";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * O resumo da semana (H7), por cron.
 *
 * O cron-job.org chama na segunda às 08:00 (Brasília) com `?secret=` ou
 * `Authorization: Bearer $CRON_SECRET` — a mesma chave de `/api/sync`. Gera um
 * resumo por marca (ou só `?brand=`), lendo a semana fechada anterior. Custa
 * cerca de US$ 0,09 por execução. Sem CRON_SECRET só roda fora de produção.
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
  if (!isAiConfigured()) return NextResponse.json({ error: "IA desligada — falta ANTHROPIC_API_KEY." }, { status: 503 });

  const pedida = new URL(request.url).searchParams.get("brand")?.trim();
  const marcas = pedida ? BRANDS.filter((b) => b.slug === pedida) : BRANDS;
  if (marcas.length === 0) return NextResponse.json({ error: "Marca desconhecida." }, { status: 400 });

  const resumos = [];
  for (const b of marcas) {
    try {
      const r = await gerarResumoSemanal(b.slug, "cron");
      resumos.push({ brand: b.slug, ok: true, semana: r.semana, periodo: r.periodo });
    } catch (e) {
      console.error("[api/resumo-semanal]", b.slug, e);
      resumos.push({ brand: b.slug, ok: false, erro: aiErrorMessage(e) });
    }
  }
  revalidatePath("/", "layout");
  return NextResponse.json({ ok: resumos.every((r) => r.ok), resumos });
}

export const GET = handle;
export const POST = handle;
