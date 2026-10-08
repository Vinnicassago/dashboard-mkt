/**
 * Domain types for the marketing campaign dashboard.
 *
 * Field names follow the Meta 2026 vocabulary where it matters:
 * `views` replaces the deprecated `impressions` for Instagram organic;
 * paid `impressions` stays because the Ads/Marketing API still reports it.
 *
 * All dates are ISO strings: `yyyy-mm-dd` for daily rows, full ISO for events.
 */

// ------------------------- Marca / conta ----------------------------

/**
 * Marca/conta a que uma linha pertence — um slug estável e minúsculo
 * (`"consorcio"`, `"krone"`, …). TODA linha persistida carrega a marca para que
 * o painel separe contas que dividem o mesmo backend (ex.: consorcio.brunno,
 * lead-gen, vs. krone.capital, só seguidores). KPI nenhum deve misturar marcas.
 */
export type Brand = string;

/** Marca padrão: os dados já existentes (consorcio.brunno) recebem este slug. */
export const DEFAULT_BRAND: Brand = "consorcio";

// ------------------------- Campaign ---------------------------------

export type CampaignStatus = "ativa" | "pausada" | "encerrada";

export interface Campaign {
  id: string;
  brand: Brand;
  name: string;
  objective: string; // e.g. "Geração de cadastros (leads)"
  status: CampaignStatus;
  startDate: string; // yyyy-mm-dd
  endDate?: string;
  budgetTotal: number; // planned total budget (BRL)
  dailyBudget?: number; // BRL/day
}

// ------------------------- Instagram (organic) ----------------------

export interface IgAccountDaily {
  brand: Brand;
  date: string; // yyyy-mm-dd
  followers: number; // snapshot at end of day
  reach: number;
  views: number; // unified metric that replaced `impressions`
  profileLinkTaps: number;
  accountsEngaged: number;
  totalInteractions: number;
  profileViews: number; // visits to the profile
  reachFollowers?: number; // reach among existing followers
  reachNonFollowers?: number; // reach among non-followers (discovery)
  /** Conversas de DM iniciadas no dia — registro MANUAL (a API do Instagram não
   *  expõe DMs). É a métrica de negócio do perfil; semanal = soma dos dias. */
  dmConversations?: number;
  /** Crescimento BRUTO do dia (métrica follows_and_unfollows): quem começou a
   *  seguir vs quem deixou — o líquido esconde churn. Exige conta 100+. */
  followsDay?: number;
  unfollowsDay?: number;
  /** Cliques no link da bio por tipo de botão (breakdown contact_button_type). */
  linkTapsWebsite?: number;
  linkTapsWhatsApp?: number;
  // ---- rotina diária de presença (registro MANUAL — a API não expõe nada disto) ----
  /** Stories publicados no dia (o guia pede 3–5). */
  storiesPosted?: number;
  /** Destes, quantos eram interativos: enquete, quiz, caixinha (o guia pede ≥1). */
  storiesInteractive?: number;
  /** Comentários feitos em perfis do nicho (o guia pede 20/dia). */
  nicheComments?: number;
  /** Contas do nicho seguidas no dia (o guia pede 10–15). */
  accountsFollowed?: number;
  /** Respondeu 100% dos comentários e DMs do dia? */
  repliedAll?: boolean;
}

export type IgMediaType = "feed" | "carrossel" | "reel" | "story";

/** Tipo de chamada-para-ação pedida na legenda do post. */
export type CtaType = "dm" | "comentario" | "salvamento" | "marcacao" | "outro";

export interface IgPost {
  id: string;
  brand: Brand;
  publishedAt: string; // full ISO datetime
  type: IgMediaType;
  caption: string;
  permalink: string;
  reach: number;
  views: number;
  likes: number;
  comments: number;
  saved: number;
  shares: number;
  // avg watch time in seconds — reels only
  avgWatchTime?: number;
  // total seconds watched — reels only
  totalWatchTime?: number;
  /** Duração do vídeo em segundos — entrada MANUAL (a API não expõe a duração).
   *  Habilita a retenção real: avgWatchTime ÷ durationSec. Reels only. */
  durationSec?: number;
  /** Pilar/série de conteúdo (ex.: "Mito ou verdade", "Card de frase") — tag
   *  manual para comparar performance por categoria. */
  pillar?: string;
  /** CTA pedido na legenda — override manual; sem ele a heurística de caption
   *  (detectCta em metrics.ts) classifica na leitura. */
  ctaType?: CtaType;
  /** Visitas ao perfil atribuídas ao post (media insight; instável p/ contas pequenas). */
  profileVisits?: number;
  /** Seguidores ganhos atribuídos ao post (media insight; idem). */
  follows?: number;
  /** URLs do CDN da Meta — EXPIRAM em dias; o re-sync renova, a UI tolera 404. */
  mediaUrl?: string;
  thumbnailUrl?: string;
  /** Post de TESTE (validação de formato/gancho) — marcado manualmente; fica
   *  FORA da análise orgânica de performance (agregados, formatos, rankings).
   *  Conta para a cadência: é uma publicação real no perfil. */
  isTest?: boolean;
}

// ------------------------- Produção (pré-publicação) ----------------

/**
 * Estágio de uma peça antes (e depois) de ir ao ar. `publicado` é terminal e
 * carrega `publishedPostId` — é o vínculo que fecha o loop entre o que foi
 * planejado e o que a API do Instagram devolveu.
 */
export type DraftStatus = "rascunho" | "aprovado" | "publicado" | "descartado";

/**
 * Uma peça EM PRODUÇÃO — o que o painel não conhecia até aqui. `IgPost` só
 * existe depois que a Meta devolve; sem esta entidade não há o que validar
 * antes de publicar, nem como medir aderência à grade do guia.
 *
 * Os campos espelham o "Padrão de reel" e o "Checklist antes de publicar":
 * gancho falado e escrito são campos separados porque o guia trata os dois como
 * obrigações distintas ("gancho falado + escrito ao mesmo tempo nos 2 primeiros
 * segundos"), e sem separá-los não dá para validar as 7 palavras do texto de tela.
 */
export interface PostDraft {
  id: string;
  brand: Brand;
  status: DraftStatus;
  createdAt: string; // ISO completo
  updatedAt: string; // ISO completo
  /** Dia planejado de publicação (yyyy-mm-dd) — casa com a grade semanal. */
  plannedFor?: string;
  type: IgMediaType;
  /** Série/pilar do guia ("Simulação da semana", "Mito ou verdade", "Bastidor"). */
  pillar?: string;
  /** Texto de tela do gancho — máx. 7 palavras. */
  hookText: string;
  /** Gancho FALADO: a 1ª frase, a que passa no teste do áudio. */
  hookSpoken: string;
  /** 2ª frase: a promessa do que a pessoa leva (seg. 2–5). */
  promise?: string;
  /** Roteiro do reel ou os slides do carrossel (um por linha). */
  script: string;
  /** Legenda como vai ao ar (a 1ª linha precisa sobreviver ao "… mais"). */
  caption: string;
  ctaType?: CtaType;
  /** Palavra-chave do CTA de comentário ("SIMULA") — vira automação na Fase 3. */
  ctaKeyword?: string;
  /** Duração planejada em segundos (reels). */
  durationSec?: number;
  /** Legenda embutida no vídeo inteiro (85% assistem no mudo). */
  hasBurnedCaptions?: boolean;
  /** Nota da última validação (0–100) e quando ela rodou. */
  score?: number;
  validatedAt?: string;
  /**
   * Ids das regras que a peça violou na última validação (`gancho`, `duracao`,
   * `cta-da-vez`, …). Guardado como SNAPSHOT porque a validação é contextual —
   * "única peça do dia" e "CTA da vez" dependem do que mais existia na época.
   * Revalidar um rascunho antigo daria outra resposta; é isto que permite
   * perguntar depois "violar esta regra custou alcance?".
   */
  validationFailed?: string[];
  /** Versão do guia contra a qual a peça foi validada (a régua evolui). */
  playbookVersion?: string;
  /** Id do IgPost publicado a partir deste rascunho — fecha o loop (Etapa 4). */
  publishedPostId?: string;
  /** Anotações livres da produção (não vão para a legenda). */
  notes?: string;
  /** Última revisão de IA (Etapa 2). Conselho, nunca veredito — quem bloqueia
   *  a publicação é o validador determinístico. */
  aiReview?: AiReview;
}

/** Um julgamento da IA sobre um critério que regex não consegue avaliar. */
export interface AiJudgement {
  /** Passou no critério? */
  ok: boolean;
  /** Por quê, em uma frase, citando o texto da peça. */
  porque: string;
}

/** Reescrita de gancho proposta pela IA, usando um molde do banco do guia. */
export interface AiHookSuggestion {
  /** `key` de um molde de `HOOK_MOLDS` (caso-cliente, pergunta-real, …). */
  molde: string;
  /** Texto de tela — precisa caber em 7 palavras. */
  textoDeTela: string;
  /** Gancho falado (1ª frase). */
  falado: string;
}

/**
 * Resultado da revisão de IA. Só carrega JULGAMENTO — nada que o validador
 * determinístico já resolve, e nenhum número calculado pelo modelo.
 */
export interface AiReview {
  /** Veredito editorial: publica, ajusta o que foi apontado, ou refaz o gancho. */
  veredito: "aprova" | "ajusta" | "refaz";
  /** Resumo em uma frase, na voz de quem edita o perfil. */
  resumo: string;
  /** O gancho soa como áudio de WhatsApp (ok) ou como locutor de anúncio? */
  testeDoAudio: AiJudgement;
  /** Cria tensão ou apenas anuncia o tema? */
  ganchoCriaTensao: AiJudgement;
  /** A 2ª frase promete algo concreto que a pessoa leva? */
  promessaConcreta: AiJudgement;
  /** O número é uma conta de verdade ou enfeite? */
  numeroEspecifico: AiJudgement;
  /** O último segundo volta ao gancho (gera replay)? */
  fechaEmReplay: AiJudgement;
  /** Três reescritas do gancho usando os moldes do banco. */
  ganchosAlternativos: AiHookSuggestion[];
  // ---- proveniência (a UI mostra; sem isto o conselho vira "verdade") ----
  modelo: string;
  criadoEm: string; // ISO
  playbookVersion: string;
}

// ------------------------- Análise de IA (Etapa 3) ------------------

/** Uma ação priorizada. `comoMedir` é o que separa conselho de palpite. */
export interface AiAction {
  prioridade: "alta" | "media" | "baixa";
  /** A ação, começando por verbo. */
  titulo: string;
  /** O número do período que justifica a ação. */
  porque: string;
  /** O que olhar, e quando, para saber se funcionou. */
  comoMedir: string;
}

/**
 * Leitura do período escrita pela IA a partir do briefing numérico. Guardada no
 * `app_state` por marca — não é recalculada a cada render (chamada custa).
 */
export interface AiAnalysis {
  /** O que aconteceu no período, em 2–4 frases. */
  diagnostico: string;
  /** Três ações priorizadas. */
  acoes: AiAction[];
  /** A hipótese a testar na próxima semana. */
  testarNaSemana: string;
  /** O que NÃO mudou apesar do esforço — o ponto cego do painel. */
  naoMudou: string;
  // ---- proveniência ----
  modelo: string;
  criadoEm: string; // ISO
  /** Período que a análise cobriu — para a UI avisar quando está velha. */
  periodo: { de: string; ate: string };
}

// ------------------------- Paid traffic (Meta Ads) ------------------

export interface AdDaily {
  brand: Brand;
  date: string; // yyyy-mm-dd
  campaign: string;
  adset: string;
  adId: string; // FK -> Creative.adId
  /** Id da campanha na Meta. Ausente em linha de CSV e nas anteriores a 0016. */
  campaignId?: string;
  /**
   * Raw Meta objective of the campaign this ad belongs to, e.g. `OUTCOME_LEADS`
   * (conversão) or `OUTCOME_ENGAGEMENT` (descoberta/seguidores). Comes from the
   * insights `objective` field; may be undefined for legacy rows or CSVs that
   * don't carry it. Classified into a budget bucket by `objectiveBucket()` in
   * metrics.ts — never persist the derived bucket.
   */
  objective?: string;
  spend: number; // BRL
  impressions: number;
  reach: number;
  frequency: number;
  clicks: number; // link clicks
  leads: number;
}

export type CreativeFormat = "imagem" | "video" | "carrossel";

export interface Creative {
  adId: string;
  brand: Brand;
  name: string;
  format: CreativeFormat;
  thumbnailUrl?: string;
  // video engagement (for hook rate / retention study)
  videoPlays?: number; // 3s plays
  thruPlays?: number; // 15s / completed
  /** Mídia do IG por trás do anúncio (effective_instagram_media_id). Se casa com
   *  um IgPost da marca → post impulsionado; se não casa → dark post (anúncio
   *  sem post na grade). O permalink é o fallback de match entre superfícies. */
  instagramMediaId?: string;
  instagramPermalink?: string;
}

// ------------------------- Landing page -----------------------------

export interface LpDaily {
  brand: Brand;
  date: string; // yyyy-mm-dd
  visits: number; // landing page views / sessions
  clicks: number; // clicks on the page CTA
  formSubmits: number; // leads generated on the page
}

// ------------------------- Leads & meetings -------------------------

/**
 * Estágio do lead. `lead` é a entrada (chegou, NINGUÉM tentou contato ainda);
 * `em_contato` = já houve tentativa; `no_show` = tinha reunião e não apareceu
 * (pode remarcar). Os quatro motivos de perda encerram o lead — o que muda
 * entre eles é a decisão que provocam. Rótulo, cor, agrupamento e transições
 * ficam em `lib/lead-status.ts`.
 */
export type LeadStatus =
  | "lead"
  | "em_contato"
  | "agendado"
  | "no_show"
  | "reuniao_realizada"
  | "cliente"
  | "contato_invalido"
  | "sem_resposta"
  | "sem_interesse"
  | "desistencia";

export interface Lead {
  id: string;
  brand: Brand;
  createdAt: string; // full ISO datetime
  name: string;
  // Contact details — persisted for the sales team (LGPD: restrict access).
  email?: string;
  phone?: string;
  utmSource?: string;
  utmCampaign?: string;
  utmContent?: string; // maps to the creative/ad
  utmMedium?: string;
  utmTerm?: string;
  /** Id do clique do anúncio (cru, como chegou na URL da LP). */
  fbclid?: string;
  status: LeadStatus;
  /**
   * LEGADO: até out/2026 guardava o MOMENTO em que o status virou "Agendado",
   * não a data da reunião (esse fato hoje é `bookedAt`). Não grave mais aqui.
   */
  meetingAt?: string;
  /** Data e hora DA REUNIÃO (ISO), exigida ao agendar. */
  meetingFor?: string;
  /**
   * MARCO: quando aconteceu a 1ª tentativa de contato (gravado uma vez). É o fato
   * que mede velocidade de contato — a alavanca nº 1 com o robô parado.
   */
  firstContactAt?: string;
  /** Detalhe do motivo de perda (ex.: "número inexistente" em Contato inválido). */
  lostReasonDetail?: string;
  /** Valor da carta/contrato (BRL), preenchido quando o lead vira cliente. */
  value?: number;

  /**
   * MARCOS — o que aconteceu com o lead, com data. Diferente de `status`, que é
   * um estado mutável e só sabe onde o lead está AGORA.
   *
   * É a separação que faz o CPR parar de mentir: quem agendou e depois virou
   * perda mantém `bookedAt`, então a reunião não desaparece da história quando
   * o comercial registra o desfecho. O `status` continua sendo a fonte do
   * rótulo, da cor e da fila; a CONTAGEM de reuniões passa a ler daqui.
   *
   * `bookedAt`/`attendedAt`/`closedAt` são gravados uma única vez e nunca
   * sobrescritos. `lostAt` acompanha o estado atual: é limpo se o lead voltar
   * para o caminho feliz.
   */
  bookedAt?: string;
  attendedAt?: string;
  closedAt?: string;
  lostAt?: string;

  /**
   * Sessão correspondente no banco do robô de WhatsApp. Gravado no primeiro
   * pareamento por telefone, para o casamento não precisar ser refeito (nem
   * depender de o telefone continuar batendo).
   */
  roboSessionId?: string;
  /**
   * Pseudonymous identifiers captured on the landing page. Kept so a later
   * server-side event (Schedule) can still be matched to the same person.
   */
  fbc?: string;
  fbp?: string;
  gaClientId?: string;
  gaSessionId?: string;

  /**
   * EXCLUSÃO REVERSÍVEL. Lead excluído sai de todas as listas e métricas
   * (`getData` não o devolve), mas a linha e o histórico ficam: dá para ver o
   * que foi apagado, por quem e por quê, e restaurar. Nunca há DELETE de lead.
   */
  deletedAt?: string;
  deletedBy?: string;
  deletedReason?: string;
}

// ------------------------- Lead audit log ---------------------------

/**
 * - created        → o lead entrou (LP, importação, cadastro manual)
 * - reenvio        → a mesma pessoa mandou o formulário de novo (mesmo id);
 *                    o lead NÃO é recriado nem tem o status mexido
 * - status_changed → mudança de status
 * - excluido / restaurado → exclusão reversível
 */
export type LeadEventAction =
  | "created"
  | "reenvio"
  | "status_changed"
  | "tentativa"
  | "desfeito"
  | "reaberto"
  | "nota"
  | "mesclado"
  | "excluido"
  | "restaurado";

/** One entry in the "quem alterou o lead" trail. */
export interface LeadEvent {
  id: string;
  leadId: string;
  /** Marca do lead (o histórico de uma marca não mostra o da outra). */
  brand?: Brand;
  leadName: string; // denormalised for display
  actor: string; // username, or "Landing page" for automated ingest
  action: LeadEventAction;
  fromStatus?: LeadStatus;
  toStatus?: LeadStatus;
  /** Detalhe do evento (ex.: motivo da exclusão, contato novo num reenvio). */
  payload?: Record<string, string>;
  /**
   * Quando o fato ACONTECEU, se diferente de quando foi registrado
   * (`createdAt`). Uma tentativa feita às 9h e registrada às 15h tem os dois —
   * é a diferença que mede o atraso de registro.
   */
  occurredAt?: string;
  createdAt: string; // full ISO datetime — quando foi REGISTRADO
}

// ------------------------- Audit log (ações administrativas) ----------

/**
 * Registro de ações que mexem em muitos dados de uma vez (restaurar exemplo,
 * ressincronizar anúncios, reclassificar marcas, corrigir leads). O histórico
 * de cada lead mora em `lead_events`; isto é o "quem apertou o botão".
 */
export interface AuditEntry {
  id: string;
  at: string;
  actor: string;
  action: string;
  detail?: string;
}

// ------------------------- Sincronizações (ADR-04) --------------------

export type SyncFonte = "ads" | "instagram";

/**
 * Uma execução de sincronização, por fonte e marca — tenha dado certo ou não.
 * O último sucesso diz de quando é o dado (cabeçalho). A JANELA de cada sucesso
 * (`dateFrom`–`dateTo`) separa o dia SEM VEICULAÇÃO (um sync cobriu e não veio
 * linha: a campanha estava parada) do dia SEM DADOS (nenhum sync cobriu: falha
 * ou nunca buscado) — ADR-06. O erro guardado é o da tela; o técnico vai ao log.
 */
export interface SyncRun {
  id: string;
  source: SyncFonte;
  brand: string;
  startedAt: string;
  finishedAt: string;
  ok: boolean;
  /** Janela pedida à API (AAAA-MM-DD, inclusiva). */
  dateFrom?: string;
  dateTo?: string;
  /** Linhas gravadas para a marca. */
  rows?: number;
  /** Mensagem humana (`mensagemHumana`), nunca o erro cru. */
  error?: string;
}

// ------------------------- Goals ------------------------------------

export type GoalMetric =
  | "leads"
  | "meetings"
  | "cpl"
  | "cpr"
  | "spend"
  | "followers"
  // ---- metas orgânicas do plano de 90 dias (diagnóstico do perfil) ----
  | "retencao_reels" // retenção média dos reels, em VALOR percentual (40 = 40%)
  | "alcance_base" // alcance sobre a base por post, em VALOR percentual (35 = 35%)
  | "saves_1k" // salvamentos por mil views
  | "comentarios_post" // comentários por post
  | "compartilhamentos_post" // compartilhamentos por post
  | "posts_semana" // posts por semana
  | "conversas_dm"; // conversas de DM iniciadas no período (registro manual)

export interface Goal {
  brand: Brand;
  metric: GoalMetric;
  period: "mes" | "campanha";
  target: number;
  // for cost goals, lower is better
  lowerIsBetter?: boolean;
}

// ------------------------- Metas v2 (Fase 4) ------------------------

/** As métricas do funil que têm meta (a régua da Bússola). */
export type MetricaComMeta =
  | "reunioes_agendadas"
  | "leads"
  | "cpl"
  | "custo_por_reuniao"
  | "taxa_lead_agendada"
  | "primeiro_contato_no_prazo"
  | "comparecimento"
  | "investimento_conversao";

/** As entradas da calculadora (seção 9 do relatório), guardadas com a meta. */
export interface EntradasCalculadora {
  /** Valor médio da carta vendida (R$). */
  V: number;
  /** Receita da empresa por venda, fração da carta (0,02 = 2%). */
  c: number;
  /** Fatia da receita aceitável como custo de aquisição (0,30 = 30%). */
  m: number;
  /** Fechamento: reunião realizada → venda (fração). */
  f: number;
  /** Comparecimento: agendada → realizada (fração). */
  s: number;
  /** Lead → reunião agendada (fração). */
  a: number;
  /** Vendas desejadas por mês. */
  N: number;
}

/**
 * Uma meta, com vigência. Mudar a meta INSERE uma linha nova a partir de uma
 * data — o passado continua sendo julgado pela meta que valia nele. `alvo: null`
 * limpa a meta a partir de `vigenteDesde`.
 */
export interface Meta {
  id: string;
  brand: Brand;
  metrica: MetricaComMeta;
  /** Contagens e orçamento escalam com o período; custo e taxa, não. */
  periodo: "semana" | "mes";
  alvo: number | null;
  /** AAAA-MM-DD. */
  vigenteDesde: string;
  /** Sem amostra para sustentar a taxa (< 20 leads ou < 5 agendadas em 8 semanas). */
  provisoria: boolean;
  origem: "calculadora" | "manual" | "legado";
  /** O que a calculadora recebeu — a meta é auditável. */
  entradas?: EntradasCalculadora;
  criadaEm: string;
  criadaPor: string;
}

// ------------------------- Ações da semana (Fase 5) ------------------

export type AcaoEstadoValor = "feita" | "ignorada" | "reaberta";

/**
 * O que alguém decidiu sobre uma ação do motor numa semana. Só se INSERE: a
 * última linha de (marca, semana, ação) é o estado atual e as anteriores são o
 * histórico. Na semana seguinte a ação volta a ser avaliada do zero — "feita"
 * não some com o gatilho, só com o fato que o disparou.
 */
export interface AcaoEstado {
  id: string;
  brand: Brand;
  /** Segunda-feira da semana (AAAA-MM-DD, Brasília). */
  semana: string;
  /** Id estável da ação (regra + alvo), ex. "C1", "M3:120003". */
  acao: string;
  estado: AcaoEstadoValor;
  /** Obrigatório ao ignorar. */
  motivo?: string;
  /** O título da ação na hora — o histórico conta a história sem recalcular. */
  titulo: string;
  por: string;
  em: string; // ISO
}

// ------------------------- Resumo semanal (H7) -----------------------

/**
 * A leitura da semana escrita pela IA (cron de segunda 08:00, ou regenerada à
 * mão). Uma linha por geração; a Bússola mostra a mais recente e guarda as 12
 * últimas como histórico.
 */
export interface ResumoSemanal {
  id: string;
  brand: Brand;
  /** Segunda-feira da semana resumida (AAAA-MM-DD). */
  semana: string;
  periodo: { de: string; ate: string };
  analise: AiAnalysis;
  origem: "cron" | "manual";
  criadoEm: string; // ISO
}

// ------------------------- Dataset ----------------------------------

/** The full dataset the dashboard renders from. */
export interface DashboardData {
  campaign: Campaign;
  igAccountDaily: IgAccountDaily[];
  igPosts: IgPost[];
  adDaily: AdDaily[];
  creatives: Creative[];
  lpDaily: LpDaily[];
  leads: Lead[];
  goals: Goal[];
  /** Metas do funil com vigência (Fase 4). Ausente em dados antigos/testes. */
  metas?: Meta[];
  /** When the data was last refreshed (ISO). */
  updatedAt: string;
  /** True while the dataset is the untouched example seed. */
  isSeed?: boolean;
}
