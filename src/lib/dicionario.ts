/**
 * Dicionário de métricas (ADR-03) — o que cada número QUER DIZER, num lugar só.
 *
 * O relatório de out/2026 achou 4 CPLs, 5 custos por reunião e 3 sentidos de
 * "leads" no painel, cada tela com o seu. Aqui cada métrica tem um id, o nome que
 * aparece na tela, a definição em uma linha, a fórmula, a fonte e o que entra e
 * o que fica de fora. As telas usam o `nome` e a `definicao` (no ⓘ); o briefing
 * da IA recebe as definições junto com os números; o teste de consistência
 * garante que mesmo nome = mesmo número em todas as telas.
 *
 * Duas visões de reunião convivem e têm nomes diferentes de propósito:
 *   • PERÍODO — "Reuniões agendadas": as marcadas NO período (data do
 *     agendamento). É a north star e o denominador do custo por reunião.
 *   • COORTE — "Agendaram": dos leads que ENTRARAM no período, quantos marcaram
 *     (em qualquer data). Mede a taxa lead → reunião, que precisa de base fixa.
 */

export type MetricaId =
  | "investimento"
  | "investimento_conversao"
  | "investimento_descoberta"
  | "leads"
  | "leads_conversao"
  | "leads_organicos"
  | "cpl"
  | "reunioes_agendadas"
  | "reunioes_conversao"
  | "custo_por_reuniao"
  | "agendaram"
  | "taxa_lead_agendada"
  | "primeiro_contato_no_prazo"
  | "comparecimento"
  | "conversoes_pixel"
  // ---- conta do Instagram (Conteúdo, Fase 6) ----
  | "seguidores"
  | "cliques_link_bio"
  | "conversas_dm"
  | "alcance_conta"
  | "alcance_organico_posts"
  | "views"
  | "interacoes"
  | "visitas_perfil";

export interface Definicao {
  id: MetricaId;
  /** Como aparece na tela. */
  nome: string;
  /** Uma linha, para o ⓘ. */
  definicao: string;
  formula: string;
  fonte: string;
  inclui: string;
  exclui: string;
}

export const DICIONARIO: Record<MetricaId, Definicao> = {
  investimento: {
    id: "investimento",
    nome: "Investimento",
    definicao: "Tudo o que a Meta cobrou no período, de todas as campanhas da marca.",
    formula: "Σ gasto das linhas de anúncio do período",
    fonte: "Meta Ads (sync diário)",
    inclui: "conversão e descoberta",
    exclui: "campanhas de outra marca e as não classificadas",
  },
  investimento_conversao: {
    id: "investimento_conversao",
    nome: "Investimento em conversão",
    definicao: "A parte do investimento em anúncios feitos para gerar lead.",
    formula: "Σ gasto das linhas cujo objetivo é de conversão",
    fonte: "Meta Ads",
    inclui: "objetivos de lead, venda, tráfego e mensagem",
    exclui: "alcance, engajamento, seguidores, visualização de vídeo",
  },
  investimento_descoberta: {
    id: "investimento_descoberta",
    nome: "Investimento em descoberta",
    definicao: "A parte do investimento em alcance, engajamento e seguidores.",
    formula: "Σ gasto das linhas cujo objetivo é de descoberta",
    fonte: "Meta Ads",
    inclui: "alcance, engajamento, seguidores, vídeo",
    exclui: "objetivos de conversão",
  },
  leads: {
    id: "leads",
    nome: "Leads",
    definicao: "Pessoas que se cadastraram no período — uma pessoa conta uma vez.",
    formula: "nº de leads com entrada no período",
    fonte: "Painel (landing page e importações)",
    inclui: "pagos e orgânicos",
    exclui: "excluídos (teste, duplicado) e reenvios da mesma pessoa",
  },
  leads_conversao: {
    id: "leads_conversao",
    nome: "Leads de conversão",
    definicao: "Os leads do período que vieram de anúncio de conversão — o denominador do CPL.",
    formula: "nº de leads do período atribuídos a anúncio de conversão (ou de fonte paga)",
    fonte: "Painel + Meta Ads",
    inclui: "lead com anúncio identificado ou com utm de mídia paga",
    exclui: "orgânicos e diretos",
  },
  leads_organicos: {
    id: "leads_organicos",
    nome: "Leads orgânicos",
    definicao: "Leads do período sem anúncio pago identificado — sem custo de mídia.",
    formula: "leads − leads atribuídos à mídia paga",
    fonte: "Painel",
    inclui: "bio, direto, indicação",
    exclui: "qualquer lead com origem paga",
  },
  cpl: {
    id: "cpl",
    nome: "CPL",
    definicao: "Custo por lead: investimento em conversão ÷ leads de conversão do período.",
    formula: "investimento em conversão ÷ leads de conversão",
    fonte: "Meta Ads + Painel",
    inclui: "só a verba e os leads de conversão",
    exclui: "verba de descoberta, leads orgânicos, conversões do Pixel",
  },
  reunioes_agendadas: {
    id: "reunioes_agendadas",
    nome: "Reuniões agendadas",
    definicao: "Reuniões marcadas NO período, pela data em que foram agendadas (a north star).",
    formula: "nº de leads com agendamento no período",
    fonte: "Painel (marco de agendamento)",
    inclui: "quem depois compareceu, faltou, virou cliente ou se perdeu",
    exclui: "desistências (saem da conta da mídia)",
  },
  reunioes_conversao: {
    id: "reunioes_conversao",
    nome: "Reuniões de conversão",
    definicao: "As reuniões agendadas no período que vieram da mídia de conversão — o denominador do custo por reunião.",
    formula: "reuniões agendadas no período de leads de conversão",
    fonte: "Painel + Meta Ads",
    inclui: "reunião de lead pago, mesmo que ele tenha entrado antes do período",
    exclui: "reuniões de leads orgânicos",
  },
  custo_por_reuniao: {
    id: "custo_por_reuniao",
    nome: "Custo por reunião",
    definicao: "Investimento em conversão ÷ reuniões de conversão agendadas no período. Só aparece com 3 reuniões ou mais.",
    formula: "investimento em conversão ÷ reuniões de conversão",
    fonte: "Meta Ads + Painel",
    inclui: "só verba e reuniões de conversão",
    exclui: "desistências, verba de descoberta; abaixo de 3 reuniões não é exibido",
  },
  agendaram: {
    id: "agendaram",
    nome: "Agendaram",
    definicao: "Dos leads que entraram no período, quantos marcaram reunião (em qualquer data). Visão de coorte.",
    formula: "nº de leads do período com reunião marcada",
    fonte: "Painel",
    inclui: "reunião marcada depois do período",
    exclui: "reunião de lead que entrou antes do período; desistências",
  },
  taxa_lead_agendada: {
    id: "taxa_lead_agendada",
    nome: "Lead → reunião",
    definicao: "Dos leads que entraram no período, a fração que marcou reunião.",
    formula: "agendaram ÷ leads",
    fonte: "Painel",
    inclui: "a coorte de entrada do período",
    exclui: "desistências",
  },
  primeiro_contato_no_prazo: {
    id: "primeiro_contato_no_prazo",
    nome: "1º contato no prazo",
    definicao: "Dos leads do período cujo prazo já fechou, a fração que teve a 1ª tentativa em até 1 hora útil.",
    formula: "leads com 1ª tentativa no prazo ÷ (leads com tentativa + leads esperando com prazo vencido)",
    fonte: "Painel (tentativas registradas)",
    inclui: "quem ainda espera com o prazo vencido (conta como fora)",
    exclui: "quem espera dentro do prazo; encerrado sem tentativa registrada (legado)",
  },
  comparecimento: {
    id: "comparecimento",
    nome: "Comparecimento",
    definicao: "Das reuniões marcadas para o período cuja data já passou, a fração que aconteceu. Métrica de proteção da north star.",
    formula: "reuniões realizadas ÷ reuniões com data passada",
    fonte: "Painel (data da reunião)",
    inclui: "não compareceu (conta como não realizada)",
    exclui: "reunião sem data registrada (legado); desistências",
  },
  conversoes_pixel: {
    id: "conversoes_pixel",
    nome: "Conversões Meta (Pixel)",
    definicao: "O que o Pixel da Meta contou como lead — evento, não pessoa. Número-sombra: não entra em nenhuma taxa.",
    formula: "Σ conversões de lead do Pixel nas linhas do período",
    fonte: "Meta Ads",
    inclui: "reenvios e eventos duplicados",
    exclui: "nada — por isso não é o “lead” do painel",
  },
  // ---- conta do Instagram (Conteúdo). Não são KPI do funil, mas o ⓘ e o
  // briefing leem do MESMO dicionário — um fato, um lugar. ----
  seguidores: {
    id: "seguidores",
    nome: "Seguidores",
    definicao:
      "Último total de seguidores conhecido no período; o líquido é a variação desde o fim do dia anterior ao período — com a série completa, ganhos − perdas.",
    formula: "followers no último dia com total · líquido = ganhos − perdas (série completa) ou fim − total da véspera",
    fonte: "Instagram (followers_count no sync; follows_and_unfollows para ganhos e perdas)",
    inclui: "ganhos e perdas do período, quando a API fornece a série (100+ seguidores)",
    exclui: "nada — é o total da conta",
  },
  cliques_link_bio: {
    id: "cliques_link_bio",
    nome: "Cliques no link da bio",
    definicao: "Toques nos links do perfil (site e WhatsApp) somados dia a dia no período.",
    formula: "Σ profile_links_taps do período",
    fonte: "Instagram (profile_links_taps)",
    inclui: "site e botão de WhatsApp",
    exclui: "cliques em anúncios (ficam na Mídia)",
  },
  conversas_dm: {
    id: "conversas_dm",
    nome: "Conversas de DM",
    definicao: "Conversas de DM iniciadas no período — registro manual em Registros; a API não expõe DMs.",
    formula: "Σ conversas registradas por dia",
    fonte: "Registro manual (Conteúdo → Registros)",
    inclui: "só os dias com registro",
    exclui: "dias sem registro — não viram zero, viram “—”",
  },
  alcance_conta: {
    id: "alcance_conta",
    nome: "Alcance da conta (pago + orgânico)",
    definicao:
      "Soma do alcance diário da conta no período, incluindo o que os anúncios entregaram — a Meta não separa o pago aqui.",
    formula: "Σ reach diário da conta",
    fonte: "Instagram (reach da conta, por dia)",
    inclui: "orgânico e pago; feed, reels e stories",
    exclui: "nada — e a mesma conta alcançada em dias diferentes conta de novo",
  },
  alcance_organico_posts: {
    id: "alcance_organico_posts",
    nome: "Alcance orgânico dos posts",
    definicao: "Soma do alcance dos posts publicados no período que não são teste nem impulsionados.",
    formula: "Σ reach dos posts orgânicos do período",
    fonte: "Instagram (reach por mídia)",
    inclui: "feed, carrossel e reels da grade",
    exclui: "posts de teste e impulsionados (um criativo de anúncio aponta para a mídia)",
  },
  views: {
    id: "views",
    nome: "Views",
    definicao: "Vezes que o conteúdo da conta foi exibido no período (pago + orgânico).",
    formula: "Σ views diárias da conta",
    fonte: "Instagram (views da conta, por dia)",
    inclui: "feed, reels e stories",
    exclui: "nada",
  },
  interacoes: {
    id: "interacoes",
    nome: "Interações",
    definicao: "Curtidas, comentários, salvamentos e compartilhamentos na conta no período.",
    formula: "Σ total_interactions do período",
    fonte: "Instagram (total_interactions)",
    inclui: "todas as superfícies",
    exclui: "cliques no link e visitas ao perfil",
  },
  visitas_perfil: {
    id: "visitas_perfil",
    nome: "Visitas ao perfil",
    definicao: "Vezes que o perfil foi aberto no período.",
    formula: "Σ profile_views do período",
    fonte: "Instagram (profile_views)",
    inclui: "quem veio de post, anúncio ou busca",
    exclui: "nada",
  },
};

/** "Nome — definição", para o `title` (ⓘ) de um número. */
export function dica(id: MetricaId): string {
  const d = DICIONARIO[id];
  return `${d.nome}: ${d.definicao}`;
}
