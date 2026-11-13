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
  // ---- funil do processo (Funil e Início, Fase 3 de nov/26) ----
  | "com_robo"
  | "primeira_mensagem"
  | "responderam"
  | "convite_aceito"
  | "confirmaram"
  | "reunioes_realizadas"
  | "vendas"
  | "onde_trava"
  // ---- mídia (Fase 4 de nov/26) ----
  | "no_ar"
  | "sinal_do_criativo"
  | "qualidade_do_robo"
  | "sem_whatsapp"
  | "fora_das_linhas"
  // ---- conta do Instagram (Conteúdo, Fase 6) ----
  | "seguidores"
  | "alcance_conta"
  | "alcance_organico_posts"
  | "views"
  | "interacoes"
  | "visitas_perfil"
  // ---- live de 01/12 (ficha, Fila e painel da live) ----
  | "qualificados"
  | "comunidade"
  | "custo_por_inscrito"
  | "custo_por_qualificado";

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
  // ---- funil do processo (`lib/funil-processo.ts`): a COORTE do período, lida do
  // lead (colunas `robo_*` pelo sync e os marcos), nunca do banco do robô. O Funil e
  // o Início (recorte) leem as MESMAS entradas. ----
  com_robo: {
    id: "com_robo",
    nome: "Com o robô",
    definicao:
      "Leads do período que o robô de WhatsApp deveria atender: fora os de antes de 29/10, sem telefone, inscritos da live, recém-chegados, os que entraram depois da última leitura do robô e reabertos no painel.",
    formula: "leads do período − os que ficam fora do robô (por motivo)",
    fonte: "Painel (colunas do robô, pelo sync)",
    inclui: "teste e duplicado, como o cartão Leads",
    exclui: "antes de 29/10, sem telefone, inscritos da live, recém-chegados, depois da última leitura, reabertos no painel sem fala do robô",
  },
  primeira_mensagem: {
    id: "primeira_mensagem",
    nome: "1ª mensagem",
    definicao:
      "O robô falou com a pessoa neste episódio (a saudação, ou a interação dele depois de um reaberto). Não prova entrega.",
    formula: "dos que estão com o robô, os com a fala do robô no episódio",
    fonte: "Robô (pelo sync)",
    inclui: "a interação do robô depois de um reaberto, sem saudação nova",
    exclui: "a saudação de uma conversa anterior ao reaberto",
  },
  responderam: {
    id: "responderam",
    nome: "Responderam",
    definicao: "Dos que receberam a 1ª mensagem, quem mandou mensagem ao robô neste episódio.",
    formula: "dos com a 1ª mensagem, os com resposta da pessoa no episódio",
    fonte: "Robô (pelo sync)",
    inclui: "a resposta depois de um reaberto",
    exclui: "a resposta de uma conversa anterior ao reaberto",
  },
  convite_aceito: {
    id: "convite_aceito",
    nome: "Convite aceito",
    definicao: "Dos que responderam, quem aceitou o convite e recebeu o link do Calendly.",
    formula: "dos que responderam, os com o aceite no episódio",
    fonte: "Robô (pelo sync)",
    inclui: "quem aceitou e ainda não agendou",
    exclui: "o aceite de uma conversa anterior ao reaberto",
  },
  confirmaram: {
    id: "confirmaram",
    nome: "Confirmaram",
    definicao:
      "Dos que agendaram, quem teve a confirmação da reunião registrada ao menos uma vez (Fila, ficha ou n8n). O registro existe desde 04/11.",
    formula: "dos que agendaram, os com a confirmação registrada (o campo ou o evento da ficha)",
    fonte: "Painel",
    inclui: "a confirmação limpa por uma remarcação depois",
    exclui: "reunião realizada sem confirmação registrada; desistências",
  },
  reunioes_realizadas: {
    id: "reunioes_realizadas",
    nome: "Reuniões realizadas",
    definicao: "Dos leads do período, quem fez a reunião (o marco; desistência fora). O % é sobre os que agendaram.",
    formula: "nº de leads do período com o marco da reunião realizada",
    fonte: "Painel (marco de comparecimento)",
    inclui: "reunião em qualquer data, de lead que entrou no período",
    exclui: "desistência",
  },
  vendas: {
    id: "vendas",
    nome: "Vendas",
    definicao: "Dos leads do período, quem virou cliente (o marco do fechamento).",
    formula: "nº de leads do período com o marco do fechamento",
    fonte: "Painel (marco de fechamento)",
    inclui: "venda sem valor registrado (legado)",
    exclui: "venda de lead que entrou antes do período",
  },
  onde_trava: {
    id: "onde_trava",
    nome: "Onde trava",
    definicao:
      "A etapa com mais pessoas paradas: não passaram, não agendaram por outro caminho e o prazo da etapa já venceu (as 2 h e 24 h do robô, 48 h sem atividade na conversa, as 2 h úteis do convite aceito, as 24 h úteis da reunião sem desfecho, 30 dias de negociação; sem o robô, o prazo da Fila). Sem meta nem média.",
    formula: "por etapa: entraram − passaram − outro caminho − ainda no prazo; vence o maior (empate: a mais funda), com 3 ou mais",
    fonte: "Painel + Robô",
    inclui: "quem desistiu depois de agendar (trava em “a reunião não aconteceu”)",
    exclui:
      "testes, cópias de duplicado e inscritos da live (a Fila da live) e, com o robô no período, os de antes de 29/10 que não estão na Fila",
  },
  // ---- mídia (Fase 4 de nov/26) ----
  no_ar: {
    id: "no_ar",
    nome: "No ar",
    definicao: "Anúncio com impressão ou gasto nos 3 dias até o último sync de anúncios que deu certo.",
    formula: "impressões ou gasto > 0 entre ref − 2 e ref; ref = min(fim do período, dia do último sync ok)",
    fonte: "Meta Ads (sync diário) + registro de sincronizações",
    inclui: "anúncio que parou ontem (aparece no ar por até 2 dias)",
    exclui: "o status e o orçamento do Meta (o painel não os lê)",
  },
  sinal_do_criativo: {
    id: "sinal_do_criativo",
    nome: "Sinal",
    definicao:
      "O que fazer com o criativo no ar: escalar, candidato a escalar, manter, trocar a arte, pausar ou cedo para julgar. É sugestão: nada muda no Meta.",
    formula: "REGUA_DO_SINAL (lib/sinal-do-criativo.ts)",
    fonte: "Painel (leads, reuniões, robô) + Meta (gasto, fadiga)",
    inclui: "a resposta ao robô como critério principal quando há 10 pessoas com 24 h",
    exclui: "criativos da live (bloco próprio) e os fora do ar",
  },
  qualidade_do_robo: {
    id: "qualidade_do_robo",
    nome: "Resposta ao robô",
    definicao:
      "Leads do período deste criativo que passaram pelo robô, sem teste e sem cópia de duplicado. Responderam sobre a 1ª mensagem; aceitaram sobre quem respondeu.",
    formula: "fatosDoTrecho por lead, somados por criativo ou conjunto",
    fonte: "Robô (pelo sync)",
    inclui: "quem ainda está nas primeiras 24 h (conta na tela, não no sinal)",
    exclui: "antes de 29/10, sem telefone, inscritos da live, recém-chegados",
  },
  sem_whatsapp: {
    id: "sem_whatsapp",
    nome: "Sem WhatsApp",
    definicao: "Das pessoas do criativo no robô, as que estão na etapa 'Telefone sem WhatsApp' neste episódio.",
    formula: "etapa do robô no episódio = sem_whatsapp ÷ pessoas no robô (a mesma regra do Funil)",
    fonte: "Robô (pelo sync)",
    inclui: "a etapa atual do episódio (a mesma leitura do Funil)",
    exclui: "sem telefone utilizável (fica fora do robô)",
  },
  fora_das_linhas: {
    id: "fora_das_linhas",
    nome: "Fora das linhas",
    definicao:
      "Leads de conversão do período sem conjunto identificado: anúncio fora das linhas desta marca, origem desconhecida, sem UTM, nome ambíguo, macro sem resolver ou anúncio sem gasto no período.",
    formula: "leads de conversão − leads de conversão nos conjuntos de conversão (a mesma passada)",
    fonte: "Painel (atribuição lead → anúncio)",
    inclui: "lead com id de anúncio que não está nas linhas desta marca",
    exclui: "leads orgânicos",
  },
  // ---- conta do Instagram (Conteúdo). Não são KPI do funil, mas o ⓘ e o
  // briefing leem do MESMO dicionário — um fato, um lugar. ----
  seguidores: {
    id: "seguidores",
    nome: "Seguidores",
    definicao:
      "Último total de seguidores conhecido no período. O líquido é a variação desde a véspera do período; com a série completa, ganhos − perdas.",
    formula: "followers no último dia com total · líquido = ganhos − perdas (série completa) ou fim − total da véspera",
    fonte: "Instagram (followers_count no sync; follows_and_unfollows para ganhos e perdas)",
    inclui: "ganhos e perdas do período, quando a API fornece a série (100+ seguidores)",
    exclui: "nada — é o total da conta",
  },
  alcance_conta: {
    id: "alcance_conta",
    nome: "Alcance da conta (pago + orgânico)",
    definicao:
      "Soma do alcance diário da conta no período, com o que os anúncios entregaram. A Meta não separa o pago aqui.",
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
    exclui: "visitas ao perfil",
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
  qualificados: {
    id: "qualificados",
    nome: "Qualificados",
    definicao: "Inscritos de classe A ou B — os que entram na Fila de contato.",
    formula: "nº de leads com entrada no período e classe A ou B",
    fonte: "Painel (classe calculada das respostas; sem respostas, a do n8n)",
    inclui: "classes A e B",
    exclui: "C, X e quem não tem classe (sem as respostas do formulário)",
  },
  comunidade: {
    id: "comunidade",
    nome: "Na comunidade",
    definicao: "Inscritos que clicaram no link da comunidade do WhatsApp.",
    formula: "nº de leads com clique na comunidade registrado pelo n8n",
    fonte: "n8n (clique no link da comunidade)",
    inclui: "o 1º clique de cada pessoa",
    exclui: "quem entrou na comunidade sem passar pelo link",
  },
  custo_por_inscrito: {
    id: "custo_por_inscrito",
    nome: "Custo por inscrito",
    definicao: "Gasto da captação da live ÷ inscrições no período.",
    formula: "gasto nas campanhas de captação ÷ leads da live",
    fonte: "Meta Ads + Painel",
    inclui: "só a verba da captação",
    exclui: "remarketing e pós-live, leads que não são da live",
  },
  custo_por_qualificado: {
    id: "custo_por_qualificado",
    nome: "Custo por qualificado",
    definicao: "Gasto da captação da live ÷ inscritos de classe A ou B.",
    formula: "gasto nas campanhas de captação ÷ qualificados (A+B)",
    fonte: "Meta Ads + Painel",
    inclui: "só a verba da captação",
    exclui: "C, X e sem classe",
  },
};

/** "Nome — definição", para o `title` (ⓘ) de um número. */
export function dica(id: MetricaId): string {
  const d = DICIONARIO[id];
  return `${d.nome}: ${d.definicao}`;
}
