/**
 * Configurações em vistas (Fase 6.6, relatório §7.7). Puro: sem I/O.
 *
 * A página era uma coluna de 14 cards; virou 7 vistas por assunto (a lista está
 * em `components/layout/nav-items.ts`). O resto do painel aponta para uma
 * ÂNCORA — `/configuracoes#metas`, `#orcamento`, `#utm`, `#diagnostico-leads` —
 * e cada âncora mora numa vista. Este módulo é a fonte única de "qual vista
 * abre qual âncora": o link da Bússola, da trava de confiança e do alerta cai
 * na aba certa, nunca no topo da errada. Âncora nova = entrada em
 * `VISTA_DA_ANCORA` + `id` no card.
 */

import { comPeriodo } from "./range";
import { formatDateTime } from "./format";
import { mensagemHumana } from "./erros";
import { ROLES, ROLE_LABELS, hasCapability, type Role } from "./auth/roles";
import { CONFIRMACAO_PERIGO } from "./perigo";
import type { Trava } from "./trust";

// ---------------------------------------------------------------- vistas

export const VISTA_CONFIG = {
  metas: "/configuracoes",
  integracoes: "/configuracoes/integracoes",
  marcas: "/configuracoes/marcas",
  usuarios: "/configuracoes/usuarios",
  importar: "/configuracoes/importar",
  ferramentas: "/configuracoes/ferramentas",
  perigo: "/configuracoes/perigo",
} as const;

export type VistaConfig = keyof typeof VISTA_CONFIG;

/** Em qual vista cada âncora mora. */
export const VISTA_DA_ANCORA: Record<string, VistaConfig> = {
  pendencias: "metas",
  orcamento: "metas",
  metas: "metas",
  "metas-conteudo": "metas",
  integracoes: "integracoes",
  sync: "integracoes",
  robo: "integracoes",
  marcas: "marcas",
  usuarios: "usuarios",
  importar: "importar",
  "importar-leads": "importar",
  "importar-anuncios": "importar",
  "adicionar-lead": "importar",
  utm: "ferramentas",
  whatsapp: "ferramentas",
  "diagnostico-leads": "ferramentas",
  perigo: "perigo",
};

const RAIZES = ["/configuracoes", "/config", "/ajustes"];

/** O href aponta para Configurações (rota atual ou antiga)? */
export function ehLinkDeConfiguracoes(href: string): boolean {
  const caminho = href.split("#")[0].split("?")[0];
  return RAIZES.some((r) => caminho === r || caminho.startsWith(`${r}/`));
}

/**
 * Leva um link de Configurações à vista que abriga a âncora dele:
 * `/configuracoes#utm` → `/configuracoes/ferramentas#utm`; `/config#marcas` →
 * `/configuracoes/marcas#marcas`. Query (`?range=`) é preservada. Link que não
 * é de Configurações, ou âncora desconhecida, volta como veio.
 */
export function linkDeConfiguracoes(href: string): string {
  if (!ehLinkDeConfiguracoes(href)) return href;
  const [semHash, hash = ""] = href.split("#");
  const [caminho, query = ""] = semHash.split("?");
  const sufixoQuery = query ? `?${query}` : "";
  const vista = hash ? VISTA_DA_ANCORA[hash] : undefined;
  if (vista) return `${VISTA_CONFIG[vista]}${sufixoQuery}#${hash}`;
  // Rota antiga sem âncora conhecida: só troca a raiz.
  const raizAntiga = RAIZES.slice(1).find((r) => caminho === r || caminho.startsWith(`${r}/`));
  const caminhoNovo = raizAntiga ? `${VISTA_CONFIG.metas}${caminho.slice(raizAntiga.length)}` : caminho;
  return `${caminhoNovo}${sufixoQuery}${hash ? `#${hash}` : ""}`;
}

// ---------------------------------------------------------------- pendências

export interface PendenciaLink {
  id: string;
  titulo: string;
  detalhe: string;
  /** Já na vista certa e com o período. */
  link?: { label: string; href: string };
}

export interface Pendencias {
  /** Campo em branco — não é culpa da campanha (`nivel: "config"`). */
  preencher: PendenciaLink[];
  /** Trava de número cujo conserto mora em Configurações (regra de marca, sync). */
  corrigir: PendenciaLink[];
}

/**
 * "O que falta aqui": a mesma avaliação de confiança da home, filtrada pelo que
 * se conserta em Configurações. O número do link da home é o do grupo
 * "preencher". Cada link já sai na vista da sua âncora, com o período.
 */
export function pendenciasDeConfiguracoes(travas: Trava[], rangeKey?: string | null): Pendencias {
  const converter = (t: Trava): PendenciaLink => ({
    id: t.id,
    titulo: t.titulo,
    detalhe: t.detalhe,
    link: t.cta ? { label: t.cta.label, href: comPeriodo(linkDeConfiguracoes(t.cta.href), rangeKey) } : undefined,
  });
  return {
    preencher: travas.filter((t) => t.nivel === "config").map(converter),
    corrigir: travas
      .filter((t) => t.nivel !== "config" && t.cta != null && ehLinkDeConfiguracoes(t.cta.href))
      .map(converter),
  };
}

// ---------------------------------------------------------------- estado das fontes

export type EstadoIntegracao = "nao-configurado" | "nunca" | "ativo" | "falhando" | "desativado";

export interface EstadoExibido {
  estado: EstadoIntegracao;
  /** O selo: "Ativo", "Desativado", "Falhando desde 07/10 09:00"… */
  rotulo: string;
  /** Uma frase humana — nunca o erro técnico cru (S19). */
  detalhe: string;
}

export interface RegistroDaFonte {
  ultimoOk: string | null;
  falha: { desde: string; erro: string } | null;
}

/**
 * Estado de uma fonte sincronizada (Meta, Instagram) a partir do registro de
 * execuções (`sync_runs`, ADR-04): "Falhando desde …" com a mensagem humana e
 * a última sincronização que deu certo — é nela que os números pararam.
 */
export function estadoDaSincronizacao(
  fonte: "Meta" | "Instagram",
  configurada: boolean,
  registro: RegistroDaFonte | undefined,
  faltam: string,
): EstadoExibido {
  if (!configurada) return { estado: "nao-configurado", rotulo: "Não configurado", detalhe: `Faltam ${faltam}.` };
  const ultimoOk = registro?.ultimoOk
    ? `Última sincronização que deu certo: ${formatDateTime(registro.ultimoOk)}.`
    : "Nenhuma sincronização deu certo ainda.";
  if (registro?.falha) {
    return {
      estado: "falhando",
      rotulo: `Falhando desde ${formatDateTime(registro.falha.desde)}`,
      detalhe: `${mensagemHumana(fonte, registro.falha.erro)} ${ultimoOk} Os números dessa fonte param aí.`,
    };
  }
  if (registro?.ultimoOk) return { estado: "ativo", rotulo: "Ativo", detalhe: ultimoOk };
  return {
    estado: "nunca",
    rotulo: "Nunca sincronizado",
    detalhe: "Credenciais reconhecidas; a primeira coleta ainda não rodou — use “Sincronizar agora” ou aguarde o cron.",
  };
}

/**
 * Robô de WhatsApp e atendimento do especialista: escolha operacional (D5).
 * Desligado NÃO é erro — as etapas dele simplesmente não existem no painel.
 * Falhando = credencial presente, chave ligada e a leitura quebrou agora
 * (não há registro de execuções do robô, então não existe "desde").
 */
export function estadoDoRobo(r: { configurado: boolean; desativado: boolean; erro?: string | null }): EstadoExibido {
  if (!r.configurado) {
    return {
      estado: "nao-configurado",
      rotulo: "Não configurado",
      detalhe: "Faltam ROBO_SUPABASE_URL e ROBO_SUPABASE_KEY — o painel funciona sem o robô.",
    };
  }
  if (r.desativado) {
    return {
      estado: "desativado",
      rotulo: "Desativado",
      detalhe: "Desligado por escolha: as etapas do robô não aparecem na cascata, na Fila nem em Leads. Desligado não é erro.",
    };
  }
  if (r.erro) {
    return {
      estado: "falhando",
      rotulo: "Falhando agora",
      detalhe: `${mensagemHumana("robô", r.erro)} Até a leitura voltar, a Fila avisa que está incompleta.`,
    };
  }
  return {
    estado: "ativo",
    rotulo: "Ativo",
    detalhe: "O painel lê o robô: convites pendentes e transferidos entram na cascata, na Fila e em Leads.",
  };
}

// ---------------------------------------------------------------- papéis

export interface VisibilidadeDoPapel {
  papel: Role;
  rotulo: string;
  /** Vê telefone e e-mail inteiros (quem não vê recebe mascarado, LGPD). */
  veContato: boolean;
  /** Exporta a lista de leads (a exportação fica registrada). */
  exportaLeads: boolean;
  alteraLeads: boolean;
  /** Importa o CSV de leads e cadastra lead à mão (`leads:write`, como alterar). */
  importaLeads: boolean;
  /** Importa anúncios (CSV), sincroniza, define metas e regras de marca (`data:write`). */
  importaAnuncios: boolean;
  /** Usuários, diagnóstico e zona de perigo. */
  administra: boolean;
}

/**
 * Quem vê o quê, derivado de `auth/roles.ts` — a linha da tela nunca diverge da
 * regra que o servidor aplica. Contato e exportação seguem `leads:write`:
 * Administrador e Comercial veem telefone e e-mail; Marketing vê mascarado.
 * "Importa" são DUAS regras, não uma: leads é `leads:write` (Comercial importa
 * o CSV de leads e cadastra à mão); anúncios, sincronização e metas são
 * `data:write` (Marketing). Uma coluna só para as duas dizia a Comercial que
 * ele não importava — e o servidor deixava.
 */
export function visibilidadePorPapel(): VisibilidadeDoPapel[] {
  return ROLES.map((papel) => ({
    papel,
    rotulo: ROLE_LABELS[papel],
    veContato: hasCapability(papel, "leads:write"),
    exportaLeads: hasCapability(papel, "leads:write"),
    alteraLeads: hasCapability(papel, "leads:write"),
    importaLeads: hasCapability(papel, "leads:write"),
    importaAnuncios: hasCapability(papel, "data:write"),
    administra: hasCapability(papel, "users:manage"),
  }));
}

// ---------------------------------------------------------------- zona de perigo

/**
 * A palavra digitada confirma uma ação da zona de perigo? Vale para TODAS elas
 * (restaurar o exemplo, refazer o histórico de anúncios) e é conferida no
 * servidor — o navegador só pergunta. `null` é o prompt cancelado; "" é o Enter
 * sem nada; nada disso confirma.
 */
export function confirmaPerigo(digitado: string | null | undefined): boolean {
  return (digitado ?? "").trim().toUpperCase() === CONFIRMACAO_PERIGO;
}
