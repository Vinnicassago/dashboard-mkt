import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { CascataComercial, CascataRobo } from "@/lib/cascata";
import { roboDesativado } from "@/lib/integracoes";
import { normalizarLinhaRobo, type LinhaRobo } from "./etapa";

/**
 * Cliente do Supabase do robô de WhatsApp — banco SEPARADO do store do painel.
 *
 * Usa nomes próprios de variável (ROBO_*) de propósito: SUPABASE_URL e
 * SUPABASE_SERVICE_ROLE_KEY trocam o backend do painel inteiro (ver
 * lib/data/backend.ts), e não é isso que queremos aqui.
 *
 * SÓ LEITURA: o painel não escreve no banco do robô (D4 — o "Abordado" e a
 * tabela "Com o especialista" saíram em nov/26). As telas leem o store; quem lê
 * daqui é o sync (`lerLeadsDoRobo`) e, até a Fase 3, o Funil (contagens).
 */

const url = process.env.ROBO_SUPABASE_URL;
const key = process.env.ROBO_SUPABASE_KEY;

export function isRoboConfigured(): boolean {
  return Boolean(url && key);
}

/**
 * Credencial presente E não desativado em Configurações. Desativado devolve
 * "desligado" em toda leitura — as etapas do robô somem, sem erro (D5).
 * Para saber se o robô vale numa MARCA (só a padrão), use `estadoDoRoboAgora`.
 */
export async function roboLigado(): Promise<boolean> {
  return isRoboConfigured() && !(await roboDesativado());
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

/**
 * O que o Funil lê das views do robô no render (exceção declarada até a Fase 3,
 * 11.8). Só contagens — sem nome nem telefone: os pendentes saíram (o Funil não
 * os usava; quem espera está na Fila, que lê do store).
 */
export interface RoboSnapshot {
  kpis: RoboKpis | null;
  diario: RoboDia[];
  motivos: RoboMotivo[];
  saude: RoboSaude | null;
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
  if (!(await roboLigado())) {
    return { kpis: null, diario: [], motivos: [], saude: null, falha: DESLIGADO };
  }
  const sb = client();

  const diarioQuery = sb.from("vw_robo_diario").select("*").order("dia", { ascending: true });
  if (desde) diarioQuery.gte("dia", desde);

  const [kpis, diario, motivos, saude] = await Promise.all([
    sb.from("vw_robo_kpis").select("*").maybeSingle(),
    diarioQuery,
    sb.from("vw_robo_motivos").select("*").order("leads", { ascending: false }),
    sb.from("vw_robo_saude").select("*").maybeSingle(),
  ]);

  // Uma view quebrada contamina a leitura inteira: melhor a aba dizer "não
  // consegui ler" do que exibir três blocos certos e um zerado sem aviso.
  const falha = primeiroErro(kpis, diario, motivos, saude);
  if (falha) {
    return { kpis: null, diario: [], motivos: [], saude: null, falha };
  }

  return {
    kpis: (kpis.data as RoboKpis) ?? null,
    diario: (diario.data as RoboDia[]) ?? [],
    motivos: (motivos.data as RoboMotivo[]) ?? [],
    saude: (saude.data as RoboSaude) ?? null,
    falha: null,
  };
}

/**
 * Os números do robô no formato que a cascata precisa.
 *
 * Deriva o que as views não expõem direto: "responderam" é o total menos os que
 * nunca responderam, e "convidados" soma quem ainda está com o convite aberto,
 * quem declinou e quem foi transferido — as três saídas possíveis do convite.
 *
 * A "mesa do atendimento" (`vw_robo_comercial_kpis`: abordados, reuniões, vendas)
 * NÃO é mais lida (11.8): quem escrevia `abordado_em` no banco do robô saiu em
 * nov/26 (o "Abordado" da Fila e a tabela "Com o especialista" de Leads — o
 * painel não escreve no banco do robô), e aqueles números congelariam. `comercial` é sempre null e a
 * cascata roda no modo "robô sem a mesa do atendimento" — reunião e venda ficam
 * no painel. Até a Fase 3.
 */
export async function getCascataFontes(): Promise<{
  robo: CascataRobo | null;
  comercial: CascataComercial | null;
  falha: RoboFalha;
}> {
  if (!(await roboLigado())) return { robo: null, comercial: null, falha: DESLIGADO };
  const kpis = await client().from("vw_robo_kpis").select("*").maybeSingle();
  const falha = primeiroErro(kpis);
  if (falha) return { robo: null, comercial: null, falha };

  const k = kpis.data as RoboKpis | null;
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
    comercial: null,
    falha: null,
  };
}

// ---------------------------------------------------------------- leitura do sync

/**
 * As ÚNICAS colunas de "Leads WhatsApp" que o painel lê. A lista explícita é a
 * barreira de LGPD: a tabela tem 84 colunas, com nome, e-mail, briefing,
 * transcrição e resumo — `*` traria tudo isso para a memória do servidor e para
 * o log de erro. O telefone vem só para casar; nunca é gravado nem logado.
 */
export const COLUNAS_DO_ROBO = [
  "Session_id",
  "Telefone",
  "status",
  "status_atendimento",
  "turno",
  "convite_enviado",
  "convite_enviado_em",
  "transferido_em",
  "criado_em",
  "ultima_interacao",
  "saudacao_em",
  "ultima_msg_cliente_em",
  "followups_enviados",
  "ultimo_followup_em",
  "robo_encerrado_em",
  "opt_out",
  "opt_out_em",
  "bot_pausado",
] as const;

/** Linhas por página (o teto padrão do PostgREST no Supabase). */
export const PAGINA_DO_ROBO = 1000;
/** Tempo máximo de cada página — o supabase-js não tem timeout próprio. */
export const TIMEOUT_DO_ROBO_MS = 15_000;
/** Trava de segurança contra laço infinito (100 mil linhas). */
const MAX_PAGINAS = 100;

/**
 * Lê a tabela inteira do robô, paginada com ordem ESTÁVEL (`criado_em`, depois
 * `Session_id`): sem ORDER BY o PostgREST não garante a mesma ordem entre as
 * páginas, e linha que some entre páginas viraria um falso "robô não recebeu".
 * Avança pelo que de fato veio e para na página vazia — se o servidor cortar
 * abaixo de 1000, nada se perde. Datas normalizadas (`toISOString`).
 *
 * LANÇA no erro (com a mensagem do PostgREST, sem dado de linha): quem chama
 * (`sincronizarRobo`) registra a falha. Nunca transforma erro em lista vazia.
 * Não confere se o robô está ligado — quem chama confere.
 */
export async function lerLeadsDoRobo(): Promise<LinhaRobo[]> {
  const sb = client();
  const select = COLUNAS_DO_ROBO.join(",");
  const out: LinhaRobo[] = [];
  let de = 0;
  for (let pagina = 0; pagina < MAX_PAGINAS; pagina++) {
    const { data, error } = await sb
      .from("Leads WhatsApp")
      .select(select)
      .order("criado_em", { ascending: true })
      .order("Session_id", { ascending: true })
      .range(de, de + PAGINA_DO_ROBO - 1)
      .abortSignal(AbortSignal.timeout(TIMEOUT_DO_ROBO_MS));
    if (error) throw new Error(error.message);
    const linhas = (data ?? []) as unknown as Record<string, unknown>[];
    if (linhas.length === 0) return out;
    for (const r of linhas) out.push(normalizarLinhaRobo(r));
    de += linhas.length;
  }
  throw new Error(`a leitura passou de ${MAX_PAGINAS} páginas`);
}
