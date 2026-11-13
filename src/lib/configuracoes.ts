/**
 * Configurações em vistas (Fase 6.6, relatório §7.7). Puro: sem I/O.
 *
 * A página era uma coluna de 14 cards; virou 7 vistas por assunto (a lista está
 * em `components/layout/nav-items.ts`). O resto do painel aponta para uma
 * ÂNCORA — `/configuracoes#metas`, `#orcamento`, `#utm`, `#diagnostico-leads` —
 * e cada âncora mora numa vista. Este módulo é a fonte única de "qual vista
 * abre qual âncora": o link da trava de confiança, do alerta e da pendência cai
 * na aba certa, nunca no topo da errada. Âncora nova = entrada em
 * `VISTA_DA_ANCORA` + `id` no card.
 */

import { comPeriodo } from "./range";
import { formatDateTime, formatDateTimeCurta, formatarEspera } from "./format";
import { mensagemHumana } from "./erros";
import type { EstadoAvisoResgate } from "./robo/aviso-resgate";
import { LEITURA_PARADA_MIN, leituraDoRoboParada } from "./robo/situacao";
import { ROLES, ROLE_LABELS, hasCapability, type Role } from "./auth/roles";
import { CONFIRMACAO_PERIGO } from "./perigo";
import type { Trava } from "./trust";

// ---------------------------------------------------------------- vistas

export const VISTA_CONFIG = {
  metas: "/configuracoes",
  atendimento: "/configuracoes/atendimento",
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
  "campanha-live": "metas",
  orcamento: "metas",
  metas: "metas",
  "metas-conteudo": "metas",
  "tabela-parcela": "atendimento",
  turno: "atendimento",
  feriados: "atendimento",
  "faixas-horario": "atendimento",
  integracoes: "integracoes",
  sync: "integracoes",
  robo: "integracoes",
  // A conferência com o Gerenciador (Fase 4): a Mídia só linka para cá.
  "conferir-gasto": "integracoes",
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
 * "O que falta aqui": a mesma avaliação de confiança das telas (`assessTrust`),
 * filtrada pelo que se conserta em Configurações. As travas `config` (meta,
 * orçamento em branco) moram SÓ aqui — o ⚠ não as mostra (`alertasDeConfianca`).
 * Cada link já sai na vista da sua âncora, com o período.
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

/** O que a leitura do robô gravou (`ResumoLeituraRobo`): só contagens. */
export interface ContagensDaLeitura {
  casaram: number;
  semLeadNoPainel: number;
  /** Das sem lead no painel, as que aceitaram o convite — o número do link da Fila ("N aceitaram pelo robô…"). */
  transferidosSemLead?: number;
}

/**
 * Robô de WhatsApp: escolha operacional (D5). Desligado NÃO é erro — as etapas
 * dele simplesmente não existem no painel.
 *
 * Com `registro` (o estado do sync, `estadoDoRoboAgora().sync`, de `sync_runs`):
 * "Falhando desde …" (a 1ª falha depois do último ok, com a frase humana que o
 * sync gravou), "Parado · lido há X" (sem falha, mas sem leitura há mais de
 * `LEITURA_PARADA_MIN` — a régua ÚNICA da B1 "leitura parada", `leituraDoRoboParada`),
 * "Ativo · lido há X" ou "Nunca lido"; o detalhe é UMA linha: "N casaram · N do
 * robô sem lead no painel (K aceitaram o convite) · N sem a 1ª mensagem do robô (M
 * não chegaram ao robô)" — o 3º número é `semMensagemDoRobo`, o MESMO do alerta e
 * da frase do Início, e por isso só sai com a leitura em dia (parada, os dois somem:
 * o dado velho culparia o robô por uma falha da leitura). Sem `registro`, o
 * comportamento de antes (falha = "Falhando agora").
 */
export function estadoDoRobo(r: {
  configurado: boolean;
  desativado: boolean;
  erro?: string | null;
  registro?: RegistroDaFonte;
  /** A última leitura que deu certo (`STATE_KEYS.roboUltimaLeitura`). */
  leitura?: ContagensDaLeitura | null;
  /** `semMensagemDoRobo` — a contagem do alerta `robo-sem-1a-msg` e da frase do Início (e da B1 do motor, dormente). */
  semMensagem?: { total: number; naoChegaram: number };
  agora?: string;
}): EstadoExibido {
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
      detalhe: "Desligado por escolha: as etapas do robô não aparecem no Início, no Funil, na Fila nem em Leads. Desligado não é erro.",
    };
  }
  if (r.registro) {
    const agora = r.agora ?? new Date().toISOString();
    const parada = leituraDoRoboParada({ sync: r.registro }, agora);
    const linha = linhaDaLeitura(r.leitura, parada ? undefined : r.semMensagem);
    const lidoHa = (ok: string) => formatarEspera(Math.max(0, Date.parse(agora) - Date.parse(ok)) / 3_600_000);
    if (r.registro.falha) {
      // O erro já é a frase humana que o sync gravou (`mensagemHumana` em lib/robo/sync.ts).
      const ok = r.registro.ultimoOk ? ` Última leitura que deu certo: ${formatDateTime(r.registro.ultimoOk)}.` : "";
      return {
        estado: "falhando",
        rotulo: `Falhando desde ${formatDateTimeCurta(r.registro.falha.desde)}`,
        detalhe: `${r.registro.falha.erro}${ok}${linha ? ` ${linha}` : ""}`,
      };
    }
    if (r.registro.ultimoOk && parada) {
      return {
        estado: "falhando",
        rotulo: `Parado · lido há ${lidoHa(r.registro.ultimoOk)}`,
        detalhe: `Sem leitura nova há mais de ${LEITURA_PARADA_MIN} min — confira a leitura por cron.${linha ? ` ${linha}` : ""}`,
      };
    }
    if (r.registro.ultimoOk) {
      return { estado: "ativo", rotulo: `Ativo · lido há ${lidoHa(r.registro.ultimoOk)}`, detalhe: linha || "Lido sem nenhuma conversa casada ainda." };
    }
    return {
      estado: "nunca",
      rotulo: "Nunca lido",
      detalhe: "Credencial reconhecida; a primeira leitura ainda não rodou — use “Sincronizar agora” (Só o robô) ou aguarde o cron.",
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
    detalhe: "O painel lê o robô: as etapas da conversa (sem o texto) entram no Início, no Funil, na Fila e em Leads.",
  };
}

/**
 * "52 casaram · 5 do robô sem lead no painel (3 aceitaram o convite) · 3 sem a 1ª
 * mensagem do robô (1 não chegou ao robô)".
 */
function linhaDaLeitura(leitura: ContagensDaLeitura | null | undefined, sem: { total: number; naoChegaram: number } | undefined): string {
  const partes: string[] = [];
  if (leitura) {
    partes.push(`${leitura.casaram} ${leitura.casaram === 1 ? "casou" : "casaram"}`);
    const t = leitura.transferidosSemLead ?? 0;
    partes.push(
      `${leitura.semLeadNoPainel} do robô sem lead no painel${t > 0 ? ` (${t} ${t === 1 ? "aceitou" : "aceitaram"} o convite)` : ""}`,
    );
  }
  if (sem) {
    const n = sem.naoChegaram;
    partes.push(
      `${sem.total} sem a 1ª mensagem do robô${sem.total > 0 ? ` (${n} não ${n === 1 ? "chegou" : "chegaram"} ao robô)` : ""}`,
    );
  }
  return partes.join(" · ");
}

/** O cron do robô roda a cada 15 min (`/api/sync?source=robo`). */
export const CRON_ROBO_MINUTOS = 15;
/** Duas rodadas perdidas e uma folga: depois disso o cron está parado. */
export const ATRASO_DO_CRON_ROBO_MINUTOS = 2 * CRON_ROBO_MINUTOS + 5;

/**
 * A linha "Leitura do robô por cron": diz se o cron RODA, não só se a chave
 * existe (o molde de `estadoDoCronCapi`). `ultimaExecucao` = `roboUltimoCron`,
 * gravado SÓ pela chamada do cron — o "Sincronizar agora" e a carona não contam.
 */
export function estadoDoCronRobo({
  configurado,
  desativado = false,
  cronSecret,
  ultimaExecucao,
  agora,
}: {
  configurado: boolean;
  desativado?: boolean;
  cronSecret: boolean;
  ultimaExecucao?: string | null;
  agora: string;
}): EstadoExibido {
  const instrucao = `Agende no cron-job.org a cada ${CRON_ROBO_MINUTOS} min: GET /api/sync?secret=CRON_SECRET&source=robo.`;
  if (!configurado || !cronSecret) {
    return {
      estado: "nao-configurado",
      rotulo: "Não configurado",
      detalhe: `Precisa do robô configurado e de CRON_SECRET; depois agende GET /api/sync?secret=…&source=robo a cada ${CRON_ROBO_MINUTOS} min.`,
    };
  }
  if (desativado) return { estado: "desativado", rotulo: "Desativado", detalhe: "O robô está desligado: o cron não lê nada." };
  if (!ultimaExecucao) return { estado: "nunca", rotulo: "Nunca rodou", detalhe: instrucao };
  const atraso = Date.parse(agora) - Date.parse(ultimaExecucao);
  if (atraso > ATRASO_DO_CRON_ROBO_MINUTOS * 60_000) {
    return {
      estado: "falhando",
      rotulo: `Parado desde ${formatDateTimeCurta(ultimaExecucao)}`,
      detalhe: `A última execução foi em ${formatDateTime(ultimaExecucao)}. ${instrucao}`,
    };
  }
  return { estado: "ativo", rotulo: "Rodando", detalhe: `Última execução: ${formatDateTime(ultimaExecucao)}.` };
}

/**
 * A linha "Aviso de resgate (n8n)": ligado só com N8N_RESGATE_WEBHOOK_URL (o
 * webhook próprio do resgate); a última falha (`EstadoAvisoResgate.ultimaFalha`,
 * limpa no próximo envio que der certo) vira "Falhou em …".
 */
export function estadoDoAvisoResgate({
  configurado,
  estado,
}: {
  configurado: boolean;
  estado: EstadoAvisoResgate | null;
}): EstadoExibido {
  if (!configurado) {
    return {
      estado: "nao-configurado",
      rotulo: "Desligado",
      detalhe: "Sem N8N_RESGATE_WEBHOOK_URL o painel não avisa o resgate; a Fila mostra do mesmo jeito.",
    };
  }
  const falha = estado?.ultimaFalha;
  const ultimo = estado?.ultimoEnvio ? `Último aviso que deu certo: ${formatDateTime(estado.ultimoEnvio)}.` : "Nenhum aviso enviado ainda.";
  if (falha && (!estado?.ultimoEnvio || falha.em > estado.ultimoEnvio)) {
    return {
      estado: "falhando",
      rotulo: `Falhou em ${formatDateTimeCurta(falha.em)}`,
      detalhe: `${falha.detalhe ? `${falha.detalhe.charAt(0).toUpperCase()}${falha.detalhe.slice(1)}. ` : ""}${ultimo} A próxima rodada tenta de novo.`,
    };
  }
  return {
    estado: "ativo",
    rotulo: "Ligado",
    detalhe: `${ultimo} Sai com gente nova no resgate, seg–sex, 9h–18h, no máximo um por rodada do cron.`,
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
 * `data:write` (Marketing). Uma coluna só para as duas dizia que o papel Comercial
 * não importava — e o servidor deixava.
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
