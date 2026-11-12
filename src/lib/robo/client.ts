import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
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
 * daqui é o sync (`lerLeadsDoRobo`). Nenhuma tela lê o banco do robô: as views
 * `vw_robo_*` ficam no banco dele, sem leitor (Fase 3).
 */

const url = process.env.ROBO_SUPABASE_URL;
const key = process.env.ROBO_SUPABASE_KEY;

export function isRoboConfigured(): boolean {
  return Boolean(url && key);
}

/**
 * Credencial presente E não desativado em Configurações. Desativado, o sync não lê
 * e `estadoDoRoboAgora` diz desligado — as etapas do robô somem das telas, sem
 * erro (D5). Para saber se o robô vale numa MARCA (só a padrão), use
 * `estadoDoRoboAgora`.
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
