import "server-only";
import { NextResponse } from "next/server";
import { autorizarN8n } from "./auth";

/**
 * Respostas da API do n8n. Erro técnico não vai cru para fora nem para o log com
 * dado pessoal: o log leva só o tipo do erro (LGPD — telefone e e-mail nunca).
 */
export function semAutorizacao(request: Request): NextResponse | null {
  const a = autorizarN8n(request);
  if (a === "ok") return null;
  if (a === "desligada") {
    return NextResponse.json(
      { ok: false, erro: "A API do n8n está desligada: defina N8N_API_TOKEN no servidor." },
      { status: 503 },
    );
  }
  return NextResponse.json({ ok: false, erro: "Token inválido ou ausente (Authorization: Bearer …)." }, { status: 401 });
}

export async function lerJson(request: Request): Promise<{ ok: true; corpo: unknown } | { ok: false; resposta: NextResponse }> {
  try {
    return { ok: true, corpo: JSON.parse(await request.text()) };
  } catch {
    return { ok: false, resposta: NextResponse.json({ ok: false, erro: "JSON inválido." }, { status: 400 }) };
  }
}

export function invalido(erros: string[]): NextResponse {
  return NextResponse.json({ ok: false, erro: "Campos inválidos.", erros }, { status: 422 });
}

export function falhaInterna(rota: string, e: unknown): NextResponse {
  // Só o nome e a mensagem do erro: nada do corpo (que traz telefone e e-mail).
  console.error(`[api/n8n] ${rota}:`, e instanceof Error ? `${e.name}: ${e.message}` : "erro desconhecido");
  return NextResponse.json({ ok: false, erro: "Falha interna ao gravar — tente de novo." }, { status: 500 });
}
