import { NextResponse } from "next/server";
import { VERSAO } from "@/lib/version";

export const dynamic = "force-dynamic";

/**
 * Qual versão está no ar. Público e sem dado: serve para conferir, depois do
 * clique em Deploy no EasyPanel, que a produção pegou o código novo.
 */
export function GET() {
  return NextResponse.json({ ok: true, versao: VERSAO });
}
