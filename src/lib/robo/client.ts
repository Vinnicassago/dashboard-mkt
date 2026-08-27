import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

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
}

// ---------------------------------------------------------------- consultas

/** Tudo que a aba precisa, em paralelo. Devolve vazio se o robô não estiver ligado. */
export async function getRoboSnapshot(desde?: string): Promise<RoboSnapshot> {
  if (!isRoboConfigured()) {
    return { kpis: null, diario: [], motivos: [], saude: null, pendentes: [] };
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

  return {
    kpis: (kpis.data as RoboKpis) ?? null,
    diario: (diario.data as RoboDia[]) ?? [],
    motivos: (motivos.data as RoboMotivo[]) ?? [],
    saude: (saude.data as RoboSaude) ?? null,
    pendentes: (pendentes.data as RoboPendente[]) ?? [],
  };
}

/**
 * Leads transferidos ao especialista no período — alimenta o card da Visão Geral.
 * Devolve null quando o robô não está configurado, para o painel manter o valor
 * que já vinha do store.
 */
export async function getTransferidos(desde?: string, ate?: string): Promise<number | null> {
  if (!isRoboConfigured()) return null;
  const q = client().from("vw_robo_diario").select("transferidos");
  if (desde) q.gte("dia", desde);
  if (ate) q.lte("dia", ate);
  const { data } = await q;
  if (!data) return null;
  return (data as { transferidos: number }[]).reduce((a, d) => a + (d.transferidos ?? 0), 0);
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
}> {
  if (!isRoboConfigured()) return { rows: [], kpis: null };
  const sb = client();
  const [rows, kpis] = await Promise.all([
    sb.from("vw_robo_comercial").select("*").order("transferido_em", { ascending: false }),
    sb.from("vw_robo_comercial_kpis").select("*").maybeSingle(),
  ]);
  return {
    rows: (rows.data as ComercialRow[]) ?? [],
    kpis: (kpis.data as ComercialKpis) ?? null,
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
