/**
 * Alertas do painel — um lugar só, no cabeçalho ("⚠ N"). Puro.
 *
 * Antes eles moravam em quatro lugares: a faixa "Antes de decidir" (só na home de
 * conversão), o card "Qualidade dos dados" (só na home da Krone — na de conversão
 * eram calculados e jogados fora), o rodapé de pendências e o cabeçalho. Agora
 * todo aviso vira um `Alerta` e aparece no mesmo painel, em qualquer tela: os
 * GLOBAIS (sync falhando, campanha sem marca, rastreio aberto) vêm do layout; os
 * do PERÍODO (confiança dos números, atribuição) vêm da página que os calculou.
 */

import type { Trava } from "./trust";
import type { DataWarning, DateRange } from "./metrics";
import { filterLeads, lpParouNoPeriodo } from "./metrics";
import { atribuidor } from "./atribuicao";
import { encerrado } from "./lead-status";
import { classeDiverge } from "./qualificacao";
import { RESGATE_ROBO_NAO_FALOU_H, ROBO_SEM_MSG_MIN } from "./robo/situacao";
import type { DashboardData, Lead } from "./types";

export type NivelAlerta = "falha" | "quarentena" | "teto" | "piso" | "aviso" | "config";

export interface Alerta {
  id: string;
  nivel: NivelAlerta;
  titulo: string;
  detalhe: string;
  cta?: { label: string; href: string };
}

/** Do mais grave ao menos grave — a ordem do painel. */
export const ORDEM_ALERTA: Record<NivelAlerta, number> = {
  falha: 5,
  quarentena: 4,
  teto: 3,
  piso: 2,
  aviso: 1,
  config: 0,
};

/**
 * As travas de confiança (`assessTrust`) do período da página — SEM as de
 * configuração (`nivel: "config"`: meta e orçamento não cadastrados). Elas não
 * desqualificam número nenhum e moram em Configurações → Pendências
 * (`pendenciasDeConfiguracoes`, que lê as mesmas travas). Vale para o Início, a
 * Mídia e o Funil de uma vez; `assessTrust` não muda.
 */
export function alertasDeConfianca(travas: Trava[]): Alerta[] {
  return travas
    .filter((t) => t.nivel !== "config")
    .map((t) => ({ id: `trava-${t.id}`, nivel: t.nivel, titulo: t.titulo, detalhe: t.detalhe, cta: t.cta }));
}

/** As checagens de saúde do dado (`dataQualityChecks`). */
export function alertasDeQualidade(warnings: DataWarning[]): Alerta[] {
  return warnings.map((w) => ({
    id: `qualidade-${w.message.slice(0, 40)}`,
    nivel: "aviso",
    titulo: w.message.split(" — ")[0],
    detalhe: w.message,
    cta: { label: "Ver integrações", href: "/configuracoes/integracoes" },
  }));
}

/**
 * Leads do período cuja origem não aponta para um anúncio: a macro do link não
 * foi resolvida ({{ad.name}} literal) ou o nome bate com mais de um anúncio.
 * Eles contam como lead, mas ficam fora do custo por criativo e por conjunto.
 */
export function alertasDeAtribuicao(data: DashboardData, range?: DateRange): Alerta[] {
  const atribuir = atribuidor(data.creatives);
  let macro = 0;
  let ambigua = 0;
  for (const l of filterLeads(data.leads, range)) {
    const t = atribuir(l).tipo;
    if (t === "macro") macro += 1;
    else if (t === "ambigua") ambigua += 1;
  }
  const out: Alerta[] = [];
  if (macro > 0) {
    out.push({
      id: "atribuicao-macro",
      nivel: "aviso",
      titulo: `${macro} ${macro === 1 ? "lead chegou" : "leads chegaram"} com a origem “{{…}}” sem resolver`,
      detalhe:
        "O link do anúncio usa uma macro que a Meta não preencheu (ex.: {{ad.name}} literal no utm_content). Esses leads aparecem com origem “Desconhecida” e ficam fora do custo por criativo e por conjunto. Corrija o utm_content no anúncio — use {{ad.id}}.",
      cta: { label: "Gerar o link certo", href: "/configuracoes/ferramentas#utm" },
    });
  }
  if (ambigua > 0) {
    out.push({
      id: "atribuicao-ambigua",
      nivel: "aviso",
      titulo: `${ambigua} ${ambigua === 1 ? "lead tem" : "leads têm"} origem ambígua`,
      detalhe:
        "O utm_content traz só o NOME do anúncio, e mais de um anúncio tem esse nome. Sem o id não dá para dizer qual trouxe o lead — atribuir ao primeiro poderia mandar pausar o errado. Eles ficam fora do custo por criativo; inclua o id do anúncio no link.",
      cta: { label: "Gerar o link certo", href: "/configuracoes/ferramentas#utm" },
    });
  }
  return out;
}

/**
 * A landing page que parou de registrar (K13): há histórico dela, o período já
 * começou (`range.from <= hoje`, C9) e termina depois do 1º dia rastreado, mas não
 * tem nenhuma linha (`lpParouNoPeriodo`). Um período futuro, ou de antes de a
 * landing page existir, não tem linha de nada — e isso não é o rastreio parado.
 * Registrado pelo Início (`alertasDoInicio`) e pelo Funil (`alertasDoFunil`).
 */
export function alertaLpSemDado(data: DashboardData, range: DateRange | undefined, hoje: string): Alerta[] {
  if (!range || range.from > hoje || !lpParouNoPeriodo(data, range)) return [];
  return [
    {
      id: "lp-sem-dado",
      nivel: "aviso",
      titulo: "O rastreio da landing page parou: sem visitas registradas no período",
      detalhe:
        "Há histórico da landing page, mas nenhuma linha neste período: o rastreio (/api/track) pode ter parado — chave trocada, script fora da página. Visitas e envios ficam fora do funil até voltar.",
      cta: { label: "Ver integrações", href: "/configuracoes/integracoes" },
    },
  ];
}

/**
 * Leads em aberto cuja classe do n8n é diferente da do painel. A Fila usa a do
 * painel; o n8n mandou a mensagem e o aviso pela dele — um dos dois está com a
 * régua errada (a tabela de parcela aqui, ou o fluxo lá).
 */
export function alertaDeClasse(leads: Pick<Lead, "classe" | "classeN8n" | "status">[]): Alerta[] {
  const n = leads.filter((l) => classeDiverge(l) && !encerrado(l.status)).length;
  if (n === 0) return [];
  return [
    {
      id: "classe-diverge",
      nivel: "aviso",
      titulo: `${n} ${n === 1 ? "lead tem" : "leads têm"} a classe do n8n diferente da do painel`,
      detalhe:
        "O painel calcula a classe pelas respostas e pela tabela de parcela; o n8n manda a dele. A Fila segue a do painel, mas a mensagem e o aviso ao atendimento saíram pela do n8n. Confira a tabela de parcela e o fluxo — a coluna Classe de Leads marca quem diverge (≠ n8n).",
      cta: { label: "Ver a tabela de parcela", href: "/configuracoes/atendimento#tabela-parcela" },
    },
  ];
}

/**
 * Gente sem a 1ª mensagem do robô (global, só com o robô ligado e a leitura em
 * dia): a contagem é a de `semMensagemDoRobo` (`lib/robo/situacao.ts`) — o MESMO
 * número da frase do Início, de Integrações e da B1 do motor (dormente). Com a
 * leitura parada quem fala é o `sync-robo`.
 */
export function alertaRoboSem1aMsg(c: { total: number; naoChegaram: number }): Alerta[] {
  if (c.total <= 0) return [];
  const chegaram = c.total - c.naoChegaram;
  return [
    {
      id: "robo-sem-1a-msg",
      nivel: "falha",
      titulo: `${c.total} ${c.total === 1 ? "lead sem" : "leads sem"} a 1ª mensagem do robô`,
      detalhe:
        [
          c.naoChegaram > 0 ? `${c.naoChegaram} não ${c.naoChegaram === 1 ? "chegou" : "chegaram"} ao robô` : "",
          chegaram > 0 ? `${chegaram} ${chegaram === 1 ? "chegou" : "chegaram"} e não ${chegaram === 1 ? "recebeu" : "receberam"} a 1ª mensagem` : "",
        ]
          .filter(Boolean)
          .join("; ") +
        ` há mais de ${ROBO_SEM_MSG_MIN} min. Confira o robô e o fluxo do n8n; depois de ${RESGATE_ROBO_NAO_FALOU_H} h, essas pessoas vão para o resgate da Fila.`,
      cta: { label: "Ver integrações", href: "/configuracoes/integracoes#robo" },
    },
  ];
}

/** Junta, tira repetidos (mesmo id) e ordena do mais grave. */
export function ordenarAlertas(listas: Alerta[][]): Alerta[] {
  const porId = new Map<string, Alerta>();
  for (const a of listas.flat()) if (!porId.has(a.id)) porId.set(a.id, a);
  return [...porId.values()].sort((a, b) => ORDEM_ALERTA[b.nivel] - ORDEM_ALERTA[a.nivel]);
}
