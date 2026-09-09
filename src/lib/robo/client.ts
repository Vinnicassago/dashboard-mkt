import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { CascataComercial, CascataRobo } from "@/lib/cascata";

/**
 * Cliente do Supabase do robô de WhatsApp — banco SEPARADO do store do painel.
 *
 * Usa nomes próprios de variável (ROBO_*) de propósito: SUPABASE_URL e
 * SUPABASE_SERVICE_ROLE_KEY trocam o backend do painel inteiro (ver
 * lib/data/backend.ts), e não é isso que queremos aqui.
 */

const url = process.env.ROBO_SUPABASE_URL;
const key = process.env.ROBO_SUPABASE_KEY;

export function isRoboConfigured(): boolean {
  return Boolean(url && key);
}

let cached: SupabaseClient | null = null;

function client(): SupabaseClient {
  if (!url || !key) {
    throw new Error("Robô não configurado: defina ROBO_SUPABASE_URL e ROBO_SUPABASE_KEY.");
  }
  if (!cached) {
    cached = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return cached;
}

// ---------------------------------------------------------------- tipos

export interface RoboKpis {
  leads_total: number;
  nao_responderam: number;
  em_conversa: number;
  convite_pendente: number;
  declinaram: number;
  frios: number;
  transferidos: number;
  taxa_resposta: number | null;
  taxa_transferencia: number | null;
  taxa_convite: number | null;
  taxa_aceite_convite: number | null;
  score_medio: number | null;
  score_medio_transferidos: number | null;
  score_medio_perdidos: number | null;
  turnos_medios_ate_transferir: number | null;
  horas_medias_ate_transferir: number | null;
  leads_que_mandaram_midia: number;
}

export interface RoboDia {
  dia: string;
  leads: number;
  responderam: number;
  convidados: number;
  transferidos: number;
  frios: number;
  declinaram: number;
  score_medio: number | null;
}

export interface RoboMotivo {
  etapa: string;
  motivo: string;
  leads: number;
  score_medio: number | null;
  turnos_medios: number | null;
}

export interface RoboSaude {
  respostas_robo: number;
  respostas_bloqueadas: number;
  taxa_bloqueio: number | null;
  bloq_numero: number;
  bloq_promessa: number;
  bloq_convite: number;
  convite_removido: number;
  pendencias_identidade: number;
}

export interface RoboPendente {
  nome: string | null;
  telefone: string | null;
  score: number | null;
  ultima_interacao: string | null;
}

export interface RoboSnapshot {
  kpis: RoboKpis | null;
  diario: RoboDia[];
  motivos: RoboMotivo[];
  saude: RoboSaude | null;
  pendentes: RoboPendente[];
  /** `null` = leitura OK. Ver RoboFalha. */
  falha: RoboFalha;
}

// ---------------------------------------------------------------- falhas

/**
 * Por que não há leitura do robô.
 *
 * `null` = leu com sucesso. A distinção importa: "desligado" é um estado
 * esperado (o painel roda sem o robô), enquanto "erro" quer dizer que as views
 * existiam e a leitura quebrou — view renomeada, credencial vencida, rede.
 *
 * Sem essa separação, `.data ?? []` transforma qualquer falha em ZERO na tela.
 * Num painel que ordena a atenção por "quem está parado", um zero falso apaga
 * exatamente a lista que precisa ser trabalhada — e ninguém fica sabendo.
 */
export type RoboFalha = null | { tipo: "desligado" } | { tipo: "erro"; detalhe: string };

const DESLIGADO: RoboFalha = { tipo: "desligado" };

/** Primeira mensagem de erro entre as respostas do Supabase, se houver alguma. */
function primeiroErro(...res: { error: { message: string } | null }[]): RoboFalha {
  const e = res.find((r) => r.error);
  return e?.error ? { tipo: "erro", detalhe: e.error.message } : null;
}

// ---------------------------------------------------------------- consultas

/**
 * Tudo que a aba precisa, em paralelo.
 *
 * `falha` diz por que veio vazio — a aba usa isso para mostrar "sem leitura" em
 * vez de zeros, que seriam indistinguíveis de "o robô não fez nada hoje".
 */
export async function getRoboSnapshot(desde?: string): Promise<RoboSnapshot> {
  if (!isRoboConfigured()) {
    return { kpis: null, diario: [], motivos: [], saude: null, pendentes: [], falha: DESLIGADO };
  }
  const sb = client();

  const diarioQuery = sb.from("vw_robo_diario").select("*").order("dia", { ascending: true });
  if (desde) diarioQuery.gte("dia", desde);

  const [kpis, diario, motivos, saude, pendentes] = await Promise.all([
    sb.from("vw_robo_kpis").select("*").maybeSingle(),
    diarioQuery,
    sb.from("vw_robo_motivos").select("*").order("leads", { ascending: false }),
    sb.from("vw_robo_saude").select("*").maybeSingle(),
    sb
      .from("vw_robo_leads")
      .select("nome,telefone,score,ultima_interacao")
      .eq("etapa", "convite_pendente")
      .order("ultima_interacao", { ascending: true }),
  ]);

  // Uma view quebrada contamina a leitura inteira: melhor a aba dizer "não
  // consegui ler" do que exibir quatro blocos certos e um zerado sem aviso.
  const falha = primeiroErro(kpis, diario, motivos, saude, pendentes);
  if (falha) {
    return { kpis: null, diario: [], motivos: [], saude: null, pendentes: [], falha };
  }

  return {
    kpis: (kpis.data as RoboKpis) ?? null,
    diario: (diario.data as RoboDia[]) ?? [],
    motivos: (motivos.data as RoboMotivo[]) ?? [],
    saude: (saude.data as RoboSaude) ?? null,
    pendentes: (pendentes.data as RoboPendente[]) ?? [],
    falha: null,
  };
}

/**
 * Leads transferidos ao especialista no período — alimenta o card da Visão Geral.
 *
 * Devolve `valor: null` com o motivo em `falha`. O card NUNCA deve cair para a
 * contagem de reuniões do store quando isto falha: são métricas diferentes, de
 * bancos diferentes, e trocar uma pela outra em silêncio foi como o painel
 * passou a exibir dois números incompatíveis lado a lado.
 */
export async function getTransferidos(
  desde?: string,
  ate?: string,
): Promise<{ valor: number | null; falha: RoboFalha }> {
  if (!isRoboConfigured()) return { valor: null, falha: DESLIGADO };
  const q = client().from("vw_robo_diario").select("transferidos");
  if (desde) q.gte("dia", desde);
  if (ate) q.lte("dia", ate);
  const { data, error } = await q;
  if (error) return { valor: null, falha: { tipo: "erro", detalhe: error.message } };
  const rows = (data ?? []) as { transferidos: number }[];
  return { valor: rows.reduce((a, d) => a + (d.transferidos ?? 0), 0), falha: null };
}

/**
 * Leads parados numa etapa do robô. A Fila única usa `convite_pendente` — são os
 * que já receberam a oferta de falar com o especialista e não responderam, o
 * grupo mais quente que o robô consegue nomear.
 *
 * Existe separado de `getRoboSnapshot` porque a Fila não precisa das outras
 * quatro views: puxar as cinco para renderizar uma lista de telefones pagaria
 * cinco round-trips por visita.
 */
export async function getRoboLeads(
  etapa = "convite_pendente",
): Promise<{ rows: RoboPendente[]; falha: RoboFalha }> {
  if (!isRoboConfigured()) return { rows: [], falha: DESLIGADO };
  const res = await client()
    .from("vw_robo_leads")
    .select("nome,telefone,score,ultima_interacao")
    .eq("etapa", etapa)
    .order("ultima_interacao", { ascending: true });
  if (res.error) return { rows: [], falha: { tipo: "erro", detalhe: res.error.message } };
  return { rows: (res.data as RoboPendente[]) ?? [], falha: null };
}

/**
 * Os números do robô e do atendimento no formato que a cascata precisa.
 *
 * Deriva o que as views não expõem direto: "responderam" é o total menos os que
 * nunca responderam, e "convidados" soma quem ainda está com o convite aberto,
 * quem declinou e quem foi transferido — as três saídas possíveis do convite.
 */
export async function getCascataFontes(): Promise<{
  robo: CascataRobo | null;
  comercial: CascataComercial | null;
  falha: RoboFalha;
}> {
  if (!isRoboConfigured()) return { robo: null, comercial: null, falha: DESLIGADO };
  const sb = client();
  const [kpis, com] = await Promise.all([
    sb.from("vw_robo_kpis").select("*").maybeSingle(),
    sb.from("vw_robo_comercial_kpis").select("*").maybeSingle(),
  ]);
  const falha = primeiroErro(kpis, com);
  if (falha) return { robo: null, comercial: null, falha };

  const k = kpis.data as RoboKpis | null;
  const c = com.data as ComercialKpis | null;
  return {
    robo: k
      ? {
          conversas: k.leads_total,
          responderam: k.leads_total - k.nao_responderam,
          convidados: k.convite_pendente + k.declinaram + k.transferidos,
          transferidos: k.transferidos,
          convitePendente: k.convite_pendente,
        }
      : null,
    comercial: c
      ? {
          abordados: c.abordados,
          reunioesRealizadas: c.reunioes_realizadas,
          negociosFechados: c.negocios_fechados,
          aguardandoAbordagem: c.aguardando_abordagem,
        }
      : null,
    falha: null,
  };
}

// ---------------------------------------------------------------- comercial

export interface ComercialRow {
  session_id: string;
  nome: string | null;
  telefone: string | null;
  email: string | null;
  score: number | null;
  saudacao_em: string | null;
  transferido_em: string | null;
  minutos_ate_transferencia: number | null;
  briefing: string | null;
  transcricao: string | null;
  abordado_em: string | null;
  reuniao_marcada: "sim" | "nao" | null;
  reuniao_realizada: "sim" | "nao" | null;
  negocio_fechado: "sim" | "nao" | null;
  obs_comercial: string | null;
  minutos_ate_abordagem: number | null;
}

export interface ComercialKpis {
  transferidos: number;
  abordados: number;
  taxa_abordagem: number | null;
  minutos_medios_ate_abordagem: number | null;
  pior_tempo_minutos: number | null;
  minutos_medios_ate_transferencia: number | null;
  reunioes_marcadas: number;
  reunioes_realizadas: number;
  negocios_fechados: number;
  aguardando_abordagem: number;
}

export async function getComercial(): Promise<{
  rows: ComercialRow[];
  kpis: ComercialKpis | null;
  falha: RoboFalha;
}> {
  if (!isRoboConfigured()) return { rows: [], kpis: null, falha: DESLIGADO };
  const sb = client();
  const [rows, kpis] = await Promise.all([
    sb.from("vw_robo_comercial").select("*").order("transferido_em", { ascending: false }),
    sb.from("vw_robo_comercial_kpis").select("*").maybeSingle(),
  ]);
  const falha = primeiroErro(rows, kpis);
  if (falha) return { rows: [], kpis: null, falha };
  return {
    rows: (rows.data as ComercialRow[]) ?? [],
    kpis: (kpis.data as ComercialKpis) ?? null,
    falha: null,
  };
}

/** Campos que o painel pode alterar no acompanhamento comercial. */
export type ComercialPatch = Partial<{
  abordado_em: string | null;
  reuniao_marcada: string | null;
  reuniao_realizada: string | null;
  negocio_fechado: string | null;
  obs_comercial: string | null;
}>;

export async function updateComercial(sessionId: string, patch: ComercialPatch) {
  if (!isRoboConfigured()) throw new Error("Robô não configurado.");
  const { error } = await client()
    .from("Leads WhatsApp")
    .update(patch)
    .eq("Session_id", sessionId);
  if (error) throw new Error(error.message);
}
