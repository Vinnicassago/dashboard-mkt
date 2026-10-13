/**
 * O lado do navegador da exportação de leads: PEDE o CSV ao servidor
 * (`/leads/exportar`) com o período e o filtro da tela, e só recebe arquivo se o
 * servidor registrou a exportação em `audit_log`. A contagem que o aviso mostra
 * vem da resposta — é o que saiu, não o que a tela tinha.
 *
 * A busca vai no CORPO do POST: costuma ser telefone ou e-mail, e PII não vai em
 * URL.
 */
import { CABECALHO_QTD_EXPORTADA, ROTA_EXPORTAR_LEADS, type FiltroDeLeads } from "@/lib/leads-vista";

export type ResultadoDaExportacao = { ok: true; arquivo: Blob; n: number } | { ok: false; message: string };

export async function pedirCsvDeLeads(
  rangeKey: string,
  filtro: FiltroDeLeads,
  buscar: typeof fetch = fetch,
): Promise<ResultadoDaExportacao> {
  let res: Response;
  try {
    res = await buscar(ROTA_EXPORTAR_LEADS, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ range: rangeKey, filtro }),
      cache: "no-store",
    });
  } catch {
    return { ok: false, message: "Não consegui falar com o servidor — nada foi exportado. Confira a conexão e tente de novo." };
  }

  const tipo = res.headers.get("content-type") ?? "";
  // Sessão vencida: o middleware manda para /login e o fetch segue o redirect —
  // a página de login não é um CSV.
  if (res.redirected) return { ok: false, message: "A sessão expirou — entre de novo para exportar." };
  if (res.ok && tipo.includes("text/csv")) {
    const n = Number(res.headers.get(CABECALHO_QTD_EXPORTADA));
    return { ok: true, arquivo: await res.blob(), n: Number.isFinite(n) ? n : 0 };
  }
  if (tipo.includes("application/json")) {
    const corpo: unknown = await res.json().catch(() => null);
    const message = corpo && typeof corpo === "object" ? (corpo as { message?: unknown }).message : undefined;
    if (typeof message === "string" && message) return { ok: false, message };
  }
  return { ok: false, message: "O servidor não devolveu o arquivo — nada foi exportado." };
}
