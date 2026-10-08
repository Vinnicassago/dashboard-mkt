"use server";

import { revalidatePath } from "next/cache";
import { randomUUID } from "node:crypto";
import { addMeta, getData } from "@/lib/data/store";
import { can } from "@/lib/auth/guard";
import { currentActor } from "@/lib/auth/actor";
import { activeBrandSlug } from "@/lib/active-brand";
import { registrarAuditoria } from "@/lib/auditoria";
import { hojeEmBrasilia } from "@/lib/range";
import {
  META_DEF,
  METRICAS_COM_META,
  calcularMetas,
  errosDaCalculadora,
  formatarAlvo,
  metasDaCalculadora,
  taxasObservadas,
} from "@/lib/metas";
import type { EntradasCalculadora, MetricaComMeta } from "@/lib/types";
import type { ActionState } from "./actions";

const DENIED: ActionState = { ok: false, message: "Você não tem permissão para esta ação." };

/** "20" (%) → 0,2. Vazio ou inválido → NaN (a validação diz qual campo). */
const pct = (v: FormDataEntryValue | null) => (v == null || String(v).trim() === "" ? NaN : Number(v) / 100);
const num = (v: FormDataEntryValue | null) => (v == null || String(v).trim() === "" ? NaN : Number(v));

function dataValida(v: FormDataEntryValue | null, hoje: string): string {
  const s = String(v ?? "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : hoje;
}

/**
 * Grava as metas que saem da calculadora (seção 9 do relatório), todas com as
 * entradas, a partir de uma data. Nada é sobrescrito: a vigência nova vale dali
 * em diante e o passado continua julgado pela meta antiga. Sem amostra (< 20
 * leads ou < 5 agendadas em 8 semanas) as metas saem "provisórias".
 */
export async function salvarMetasDaCalculadoraAction(
  _prev: ActionState | null,
  formData: FormData,
): Promise<ActionState> {
  if (!(await can("data:write"))) return DENIED;
  const e: EntradasCalculadora = {
    V: num(formData.get("V")),
    c: pct(formData.get("c")),
    m: pct(formData.get("m")),
    f: pct(formData.get("f")),
    s: pct(formData.get("s")),
    a: pct(formData.get("a")),
    N: num(formData.get("N")),
  };
  const erros = errosDaCalculadora(e);
  if (erros.length) return { ok: false, message: erros.join(" ") };
  const contato = pct(formData.get("primeiroContato"));
  if (Number.isFinite(contato) && !(contato > 0 && contato <= 1)) {
    return { ok: false, message: "Informe o 1º contato no prazo entre 0% e 100%." };
  }

  const brand = await activeBrandSlug();
  const hoje = hojeEmBrasilia();
  const agora = new Date().toISOString();
  const observadas = taxasObservadas(await getData(brand), hoje, agora);
  const metas = metasDaCalculadora(e, {
    brand,
    vigenteDesde: dataValida(formData.get("vigenteDesde"), hoje),
    criadaEm: agora,
    criadaPor: await currentActor(),
    provisoria: !observadas.suficiente,
    primeiroContatoNoPrazo: Number.isFinite(contato) ? contato : undefined,
    novoId: () => `META-${randomUUID()}`,
  });
  for (const m of metas) await addMeta(m);

  const s = calcularMetas(e);
  const resumo = `CAC ${formatarAlvo("cpl", s.cacMax)} · custo por reunião ${formatarAlvo("custo_por_reuniao", s.custoPorReuniaoMax)} · CPL ${formatarAlvo("cpl", s.cplMax)} · ${formatarAlvo("reunioes_agendadas", s.reunioesPorSemana)} reuniões e ${formatarAlvo("leads", s.leadsPorSemana)} leads por semana`;
  await registrarAuditoria("Metas pela calculadora", `${brand}: ${resumo}`);
  revalidatePath("/", "layout");
  return {
    ok: true,
    message:
      `Metas gravadas, valendo a partir de ${metas[0].vigenteDesde}: ${resumo}.` +
      (observadas.suficiente ? "" : " Sem amostra nas últimas 8 semanas: as metas de taxa ficam marcadas como provisórias."),
  };
}

/**
 * Ajusta UMA meta à mão (ou a limpa, com o alvo vazio). Também só insere: a
 * meta anterior continua valendo para os dias antes de `vigenteDesde`.
 */
export async function salvarMetaManualAction(
  _prev: ActionState | null,
  formData: FormData,
): Promise<ActionState> {
  if (!(await can("data:write"))) return DENIED;
  const metrica = String(formData.get("metrica") ?? "") as MetricaComMeta;
  if (!METRICAS_COM_META.includes(metrica)) return { ok: false, message: "Escolha a métrica." };
  const def = META_DEF[metrica];
  const bruto = formData.get("alvo");
  const limpar = bruto == null || String(bruto).trim() === "";
  const alvo = limpar ? null : def.formato === "pct" ? pct(bruto) : num(bruto);
  if (alvo != null && !(alvo > 0) ) return { ok: false, message: "O alvo precisa ser maior que zero." };
  if (alvo != null && def.formato === "pct" && alvo > 1) return { ok: false, message: "Taxa entre 0% e 100%." };

  const hoje = hojeEmBrasilia();
  const vigenteDesde = dataValida(formData.get("vigenteDesde"), hoje);
  const brand = await activeBrandSlug();
  await addMeta({
    id: `META-${randomUUID()}`,
    brand,
    metrica,
    periodo: formData.get("periodo") === "mes" ? "mes" : "semana",
    alvo,
    vigenteDesde,
    provisoria: false,
    origem: "manual",
    criadaEm: new Date().toISOString(),
    criadaPor: await currentActor(),
  });
  await registrarAuditoria(
    limpar ? "Meta limpa" : "Meta ajustada",
    `${brand}: ${def.nome}${alvo != null ? ` = ${formatarAlvo(metrica, alvo)}` : " (sem meta)"} desde ${vigenteDesde}`,
  );
  revalidatePath("/", "layout");
  return {
    ok: true,
    message: limpar
      ? `${def.nome}: sem meta a partir de ${vigenteDesde}.`
      : `${def.nome}: ${formatarAlvo(metrica, alvo!)} a partir de ${vigenteDesde}.`,
  };
}
