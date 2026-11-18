import { NextResponse } from "next/server";
import { isAuthEnabled } from "@/lib/auth/config";
import { getCurrentUser } from "@/lib/auth/current-user";
import { removerInscricaoPush, salvarInscricaoPush } from "@/lib/data/store";
import { aparelhoDoUserAgent, lerInscricao } from "@/lib/push/aviso";
import { pushConfigurado } from "@/lib/push/config";
import { enviarTeste } from "@/lib/push/enviar";

export const dynamic = "force-dynamic";

/**
 * A inscrição deste navegador nos avisos de lead novo (o sino do cabeçalho e o
 * `pushsubscriptionchange` de `public/sw.js`).
 *
 *   POST   { inscricao, testar?, anterior? } — grava (upsert pelo endpoint, com o
 *          usuário logado); `testar` manda o aviso de confirmação SÓ para este
 *          aparelho e diz se o serviço de push aceitou; `anterior` = o endpoint que
 *          o navegador trocou (sai).
 *   DELETE { endpoint } — desativa este aparelho.
 *
 * Atrás do login (o middleware e, de novo, aqui). Só da própria origem: com o modo
 * aberto ou o cookie Lax, uma página de fora não inscreve um aparelho dela para
 * receber os leads. O endpoint é a prova de posse do aparelho — quem o tem desliga.
 */

const erro = (status: number, mensagem: string) => NextResponse.json({ ok: false, erro: mensagem }, { status });

async function pedidoValido(request: Request): Promise<{ usuario: string | null } | Response> {
  const origem = request.headers.get("sec-fetch-site");
  if (origem && origem !== "same-origin") return erro(403, "Pedido de fora do painel.");
  if (!request.headers.get("content-type")?.includes("application/json")) return erro(415, "Envie JSON.");
  if (!isAuthEnabled()) return { usuario: null };
  const user = await getCurrentUser();
  return user ? { usuario: user.username } : erro(401, "Entre no painel de novo.");
}

async function corpoDe(request: Request): Promise<Record<string, unknown> | null> {
  try {
    const c: unknown = await request.json();
    return c && typeof c === "object" ? (c as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export async function POST(request: Request) {
  const ok = await pedidoValido(request);
  if (ok instanceof Response) return ok;
  if (!pushConfigurado()) return erro(503, "Os avisos estão desligados no servidor.");
  const corpo = await corpoDe(request);
  if (!corpo) return erro(400, "Pedido inválido.");
  const lida = lerInscricao(corpo.inscricao);
  if (!lida.ok) return erro(400, lida.erro);

  const agora = new Date().toISOString();
  const inscricao = {
    ...lida.valor,
    usuario: ok.usuario,
    aparelho: aparelhoDoUserAgent(request.headers.get("user-agent")),
    criadaEm: agora,
    atualizadaEm: agora,
  };
  try {
    await salvarInscricaoPush(inscricao);
    const anterior = typeof corpo.anterior === "string" ? corpo.anterior : null;
    if (anterior && anterior !== inscricao.endpoint) await removerInscricaoPush(anterior);
  } catch (e) {
    console.warn("[push] não consegui gravar a inscrição:", e instanceof Error ? e.message : e);
    return erro(500, "Não consegui ativar os avisos. Tente de novo.");
  }

  if (corpo.testar !== true) return NextResponse.json({ ok: true });
  const r = await enviarTeste(inscricao);
  // entregue = o serviço de push aceitou; o aviso aparece em segundos.
  const teste = !r ? "falhou" : r.entregues ? "entregue" : r.removidas ? "recusada" : "falhou";
  return NextResponse.json({ ok: true, teste });
}

export async function DELETE(request: Request) {
  const ok = await pedidoValido(request);
  if (ok instanceof Response) return ok;
  const corpo = await corpoDe(request);
  const endpoint = typeof corpo?.endpoint === "string" ? corpo.endpoint : "";
  if (!endpoint) return erro(400, "Pedido inválido.");
  try {
    await removerInscricaoPush(endpoint);
  } catch (e) {
    console.warn("[push] não consegui remover a inscrição:", e instanceof Error ? e.message : e);
    return erro(500, "Não consegui desativar os avisos. Tente de novo.");
  }
  return NextResponse.json({ ok: true });
}
