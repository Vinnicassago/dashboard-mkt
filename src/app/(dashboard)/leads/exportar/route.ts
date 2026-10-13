import { addAuditEntry, getData, listLeadEvents } from "@/lib/data/store";
import { activeBrandSlug } from "@/lib/active-brand";
import { can } from "@/lib/auth/guard";
import { currentActor, newEventId } from "@/lib/auth/actor";
import { mensagemHumana } from "@/lib/erros";
import {
  CABECALHO_QTD_EXPORTADA,
  aplicarFiltro,
  descreverFiltro,
  filtroDoPedido,
  montarCsvDeLeads,
  montarLinhasDeLeads,
  periodoDoRegistro,
  qtdDeLeads,
} from "@/lib/leads-vista";
import { pageRange } from "@/lib/page-range";
import { isRangeKey, rangeLabel } from "@/lib/range";

export const dynamic = "force-dynamic";

const erro = (status: number, message: string) => Response.json({ ok: false, message }, { status });

/**
 * Exportação de leads em CSV, inteira no servidor. O CSV leva nome, telefone e
 * e-mail; saber quem levou o quê é parte da LGPD, e por isso "exportação SEMPRE
 * registrada" não pode depender do que o navegador declara:
 *
 *  1. confere `leads:write` (comercial e administrador — Marketing vê o contato
 *     mascarado e não exporta);
 *  2. recalcula as linhas como a página (`montarLinhasDeLeads`, mesma marca,
 *     mesmo período) e aplica o filtro PEDIDO, conferido (`filtroDoPedido`);
 *  3. grava em `audit_log` a contagem e o filtro do que vai sair — direto no
 *     store, sem o `registrarAuditoria` que engole o erro;
 *  4. só então devolve o arquivo. Insert falhou → erro e nenhum byte de CSV.
 *
 * POST, não GET: a busca vai no corpo — costuma ser um telefone ou um e-mail, e
 * PII não vai em URL. O registro diz só "busca: sim".
 */
export async function POST(request: Request): Promise<Response> {
  // O cookie de sessão é SameSite=Lax; isto fecha também o modo aberto (sem
  // AUTH_SECRET) para uma página de outro site que dispare o POST.
  if (request.headers.get("sec-fetch-site") === "cross-site") {
    return erro(403, "Exportação pedida de fora do painel.");
  }
  if (!(await can("leads:write"))) {
    return erro(403, "Só o comercial e o administrador exportam leads.");
  }

  let pedido: Record<string, unknown> = {};
  try {
    const corpo: unknown = await request.json();
    if (corpo && typeof corpo === "object") pedido = corpo as Record<string, unknown>;
  } catch {
    return erro(400, "Pedido de exportação inválido.");
  }
  const rangeParam = typeof pedido.range === "string" && isRangeKey(pedido.range) ? pedido.range : undefined;
  const filtro = filtroDoPedido(pedido.filtro);

  const brand = await activeBrandSlug();
  let csv: string;
  let n: number;
  let descricao: string;
  try {
    const [data, eventos] = await Promise.all([getData(brand), listLeadEvents({ brand, limit: 0 })]);
    const { range, rangeKey } = pageRange(data, rangeParam);
    const linhas = aplicarFiltro(montarLinhasDeLeads(data, eventos, new Date().toISOString(), { range }), filtro);
    n = linhas.length;
    descricao = descreverFiltro(filtro, periodoDoRegistro(rangeLabel(rangeKey), range));
    csv = montarCsvDeLeads(linhas);
  } catch (e) {
    console.error("[leads/exportar] não consegui ler os leads:", e);
    return erro(500, `Não consegui ler os leads para exportar. ${mensagemHumana("banco de dados", e)}`);
  }
  if (n === 0) return erro(422, "Nenhum lead com esse filtro — nada para exportar.");

  try {
    await addAuditEntry({
      id: newEventId(),
      at: new Date().toISOString(),
      actor: await currentActor(),
      action: "exportar_leads",
      detail: `${qtdDeLeads(n)} · marca: ${brand} · ${descricao}`,
    });
  } catch (e) {
    console.error("[leads/exportar] não registrei a exportação em audit_log:", e);
    return erro(
      503,
      `Não consegui registrar a exportação, então o arquivo não foi gerado. ${mensagemHumana("banco de dados", e)}`,
    );
  }

  return new Response(csv, {
    status: 200,
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": 'attachment; filename="leads.csv"',
      "cache-control": "no-store",
      [CABECALHO_QTD_EXPORTADA]: String(n),
    },
  });
}
