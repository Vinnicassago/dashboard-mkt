"use server";

import { revalidatePath } from "next/cache";
import { can } from "@/lib/auth/guard";
import { currentActor } from "@/lib/auth/actor";
import { registrarAuditoria } from "@/lib/auditoria";
import { GRUPO_LABEL, FAIXAS_VALOR_ORDEM, celulaValida, type GrupoDoBem, type TabelaDeParcela } from "@/lib/classe";
import { salvarTabelaEReclassificar } from "@/lib/classe-server";
import { mensagemHumana } from "@/lib/erros";
import { setState } from "@/lib/data/store";
import { STATE_KEYS } from "@/lib/data/backend";
import { HORARIOS, type HorarioPreferido } from "@/lib/qualificacao";
import { DIAS_DA_SEMANA, DIA_LABEL, lerExpediente, minutosDe, type Expediente, type Janela } from "@/lib/turno";

export interface ResultadoAtendimento {
  ok: boolean;
  message: string;
}

const DENIED: ResultadoAtendimento = { ok: false, message: "Você não tem permissão para esta ação." };

/**
 * Salva o turno do atendimento, os feriados, as faixas de horário e os prazos.
 * Tudo conferido aqui: hora inválida, fim antes do início ou número fora da faixa
 * recusa o envio inteiro (meio expediente salvo mudaria prazos sem ninguém ver).
 * Os prazos da Fila são recalculados na hora (são calculados, não gravados).
 */
export async function salvarExpediente(e: Expediente): Promise<ResultadoAtendimento> {
  if (!(await can("data:write"))) return DENIED;
  const erros: string[] = [];
  const hora = (h: unknown) => typeof h === "string" && minutosDe(h) != null;
  const janela = (j: Janela | undefined, nome: string) => {
    if (!j) return;
    if (!hora(j.inicio) || !hora(j.fim)) erros.push(`${nome}: hora inválida.`);
    else if (minutosDe(j.fim)! <= minutosDe(j.inicio)!) erros.push(`${nome}: o fim precisa ser depois do início.`);
  };
  for (const d of DIAS_DA_SEMANA) janela(e?.dias?.[d], DIA_LABEL[d]);
  for (const f of Object.keys(HORARIOS) as HorarioPreferido[]) {
    if (!e?.faixas?.[f]) erros.push(`${HORARIOS[f]}: faixa ausente.`);
    else janela(e.faixas[f], HORARIOS[f]);
  }
  const feriados = Array.isArray(e?.feriados) ? e.feriados : [];
  if (feriados.some((d) => typeof d !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(d))) erros.push("Feriado com data inválida.");
  const num = (v: unknown, min: number, max: number, nome: string) => {
    if (typeof v !== "number" || !Number.isFinite(v) || v < min || v > max) erros.push(`${nome}: entre ${min} e ${max}.`);
  };
  num(e?.prazoAHoras, 0.25, 24, "Prazo da classe A (horas do turno)");
  num(e?.folgaDoHorarioHoras, 0, 12, "Folga depois do início do horário escolhido");
  num(e?.cadencia?.segundaHorasDoTurno, 0.25, 72, "2ª tentativa");
  num(e?.cadencia?.terceiraHoras, 1, 168, "3ª tentativa");
  num(e?.cadencia?.semRespostaHoras, 1, 336, "Janela até “Sem resposta”");
  if (erros.length) return { ok: false, message: `Nada foi salvo. ${erros.join(" ")}` };

  try {
    const actor = await currentActor();
    const limpo = lerExpediente({ ...e, feriados: [...new Set(feriados)].sort(), atualizadoEm: new Date().toISOString(), atualizadoPor: actor });
    await setState(STATE_KEYS.expediente, limpo);
    const dias = DIAS_DA_SEMANA.filter((d) => limpo.dias[d])
      .map((d) => `${DIA_LABEL[d].slice(0, 3)} ${limpo.dias[d]!.inicio}–${limpo.dias[d]!.fim}`)
      .join(", ");
    await registrarAuditoria("Turno do atendimento salvo", `${dias || "sem expediente"} · feriados: ${limpo.feriados.join(", ") || "nenhum"}`);
    revalidatePath("/", "layout");
    return { ok: true, message: "Turno salvo. Os prazos da Fila já seguem o novo turno." };
  } catch (err) {
    console.error("[atendimento] expediente:", err);
    return { ok: false, message: mensagemHumana("banco de dados", err) };
  }
}

/**
 * Salva a tabela de parcela (a régua da classe C) e recalcula a classe de todos
 * os leads com respostas. Célula que não é do vocabulário recusa o envio inteiro
 * — meia tabela salva mudaria classes que ninguém pediu para mudar.
 */
export async function salvarTabelaDeParcela(celulas: Record<string, Record<string, string>>): Promise<ResultadoAtendimento> {
  if (!(await can("data:write"))) return DENIED;
  const tabela: TabelaDeParcela = { celulas: {} as TabelaDeParcela["celulas"] };
  for (const g of Object.keys(GRUPO_LABEL) as GrupoDoBem[]) {
    tabela.celulas[g] = {} as TabelaDeParcela["celulas"][GrupoDoBem];
    for (const f of FAIXAS_VALOR_ORDEM) {
      const c = celulas?.[g]?.[f];
      if (!celulaValida(c)) return { ok: false, message: "A tabela veio incompleta — nada foi salvo." };
      tabela.celulas[g][f] = c;
    }
  }
  try {
    const actor = await currentActor();
    const r = await salvarTabelaEReclassificar(tabela, actor);
    await registrarAuditoria(
      "Tabela de parcela da classe salva",
      `${r.avaliados} lead(s) com respostas avaliados, ${r.mudaram} mudaram de classe`,
    );
    revalidatePath("/", "layout");
    return {
      ok: true,
      message: r.mudaram
        ? `Tabela salva. ${r.mudaram} de ${r.avaliados} lead(s) mudaram de classe (cada um ganhou a linha no histórico).`
        : `Tabela salva. Nenhum dos ${r.avaliados} lead(s) com respostas mudou de classe.`,
    };
  } catch (e) {
    console.error("[atendimento] tabela de parcela:", e);
    return { ok: false, message: mensagemHumana("banco de dados", e) };
  }
}
