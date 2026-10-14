/**
 * A política da caixa de saída da CAPI (Fase 7, D9) — pura, sem I/O: quando
 * tentar de novo, quando desistir, como contar um erro para pessoas e como o
 * envio aparece na ficha, em Integrações e nos alertas.
 *
 * A régua é a deduplicação da Meta: ela junta dois eventos com o mesmo
 * (event_name, event_id) que chegam em até 48 h. Dentro dessa janela, reenviar é
 * seguro — se a 1ª tentativa tiver chegado sem resposta, a Meta descarta a
 * cópia. Depois dela, um reenvio poderia contar o mesmo fato duas vezes. Então
 * a nova tentativa automática vive só nas 48 h depois do fato, e o que não sair
 * até lá fica "não chegou", com o porquê.
 *
 * Tudo que EXIBE recebe `agora`: um pendente cuja janela já fechou é "não
 * chegou" na tela mesmo antes de alguém rodar a limpeza, e um pendente cuja
 * tentativa venceu há muito diz que o reenvio automático não está rodando —
 * nunca "nova tentativa automática" com data no passado.
 */
import { formatDateTime } from "./format";
import type { Alerta } from "./alertas";
import type { EstadoExibido } from "./configuracoes";
import type { CapiEnvio, CapiEventName } from "./types";

/** Janela em que reenviar é seguro — a da deduplicação da Meta. */
export const JANELA_REENVIO_HORAS = 48;

/**
 * Espera depois da N-ésima tentativa que falhou (em minutos): 5 min, 15 min,
 * 1 h, 3 h, 6 h e, daí em diante, a cada 12 h — até a janela fechar.
 */
export const ESPERAS_MINUTOS = [5, 15, 60, 180, 360, 720] as const;

/**
 * A última tentativa fica a esta distância do fim da janela: com a espera de
 * 12 h, a próxima cairia fora e o envio desistiria até 12 h antes da hora — e
 * um token trocado no meio desse tempo não teria mais o que reenviar.
 */
export const MARGEM_FINAL_MINUTOS = 30;

/** Com que frequência o cron deve chamar `/api/capi/retentar` (o texto de Integrações). */
export const CRON_REENVIO_MINUTOS = 15;

/** Pendente vencido há mais que isto = o reenvio automático não está rodando. */
export const ATRASO_DO_REENVIO_MINUTOS = 2 * CRON_REENVIO_MINUTOS + 5;

/** Quantos envios o "Reenviar agora" tenta por clique (o botão diz quando há mais). */
export const LIMITE_REENVIO_MANUAL = 200;

/** Reserva de uma linha enquanto alguém a posta: ninguém mais a pega nesse tempo. */
export const RESERVA_MINUTOS = 2;

const HORA = 3_600_000;
const MIN = 60_000;

/** O fato já passou da janela de reenvio seguro? */
export function expirouJanela(eventTime: string, agora: string): boolean {
  return Date.parse(agora) - Date.parse(eventTime) >= JANELA_REENVIO_HORAS * HORA;
}

/** O instante em que a janela do fato fecha (ISO). */
export function fimDaJanela(eventTime: string): string {
  return new Date(Date.parse(eventTime) + JANELA_REENVIO_HORAS * HORA).toISOString();
}

/**
 * Quando tentar de novo depois de `tentativasFeitas` tentativas que falharam
 * (≥ 1). Se a espera normal cairia fora da janela, a última tentativa vai para
 * `MARGEM_FINAL_MINUTOS` antes do fim; `null` = já passou disso: desiste.
 */
export function proximaTentativaCapi(tentativasFeitas: number, eventTime: string, agora: string): string | null {
  const i = Math.min(Math.max(tentativasFeitas, 1), ESPERAS_MINUTOS.length) - 1;
  const proxima = Date.parse(agora) + ESPERAS_MINUTOS[i] * MIN;
  const fim = Date.parse(eventTime) + JANELA_REENVIO_HORAS * HORA;
  if (proxima < fim) return new Date(proxima).toISOString();
  const ultima = fim - MARGEM_FINAL_MINUTOS * MIN;
  return Date.parse(agora) < ultima ? new Date(ultima).toISOString() : null;
}

/** O que uma resposta de erro da Meta diz — o recorte que a política usa. */
export interface ErroDaMeta {
  detalhe: string;
  /** 0 = sem resposta (rede). */
  http: number;
  codigo?: number;
  subcodigo?: number;
}

/** Subcódigos de validação do PRÓPRIO evento (família 2804xxx da Conversions API). */
const eValidacaoDoEvento = (sub?: number) => sub !== undefined && sub >= 2804000 && sub <= 2804999;

/**
 * Erro que nenhuma nova tentativa resolve: a Meta leu o evento e recusou um dado
 * DELE (HTTP 400, código 100, subcódigo 2804xxx). Reenviar o MESMO evento dá o
 * mesmo erro — desiste já e diz por quê. O 400/100 sem esse subcódigo (o 33 é
 * "dataset inexistente ou sem permissão") e o token recusado (190) são de
 * CONFIGURAÇÃO: corrigida a variável, a próxima tentativa passa — então seguem
 * na fila até a janela fechar.
 */
export function erroPermanente(r: ErroDaMeta): boolean {
  return r.http === 400 && r.codigo === 100 && eValidacaoDoEvento(r.subcodigo);
}

/** O erro em uma frase para pessoas (o técnico fica no log do servidor). */
export function mensagemDoErroCapi(r: ErroDaMeta): string {
  if (r.detalhe === "CAPI não configurado") return "Faltam META_DATASET_ID e META_CAPI_TOKEN no servidor.";
  if (r.codigo === 190 || r.http === 401 || r.http === 403) {
    return "A Meta recusou o token da CAPI (vencido ou sem permissão) — gere outro e atualize META_CAPI_TOKEN.";
  }
  if (r.http === 0 && r.detalhe.startsWith("Evento de teste")) {
    return "Entrou na fila em modo de teste e o modo de teste foi desligado — um evento de teste não vai para a produção.";
  }
  if (r.http === 0) return "A Meta não respondeu (rede ou tempo esgotado).";
  if (r.http >= 500) return "A Meta estava fora do ar nesta tentativa.";
  if (erroPermanente(r)) return "A Meta recusou um dado do evento — o detalhe está no log do servidor.";
  if (r.codigo === 100 && r.subcodigo === 33) {
    return "A Meta não encontrou o dataset ou o token não tem acesso a ele — confira META_DATASET_ID e as permissões do token.";
  }
  if (r.codigo === 100) return "A Meta recusou o pedido (dataset, token ou parâmetro) — o detalhe está no log do servidor.";
  return "A Meta não aceitou o evento — o detalhe está no log do servidor.";
}

/** O nome do evento para pessoas — com o nome técnico, que é o que aparece no Gerenciador de Eventos. */
export const EVENTO_CAPI_LABEL: Record<CapiEventName, string> = {
  Lead: "Cadastro (Lead)",
  Schedule: "Reunião agendada (Schedule)",
  ReuniaoRealizada: "Reunião realizada (ReuniaoRealizada)",
  Purchase: "Venda (Purchase)",
};

/**
 * Como um envio está AGORA, para exibir — a linha gravada pode estar atrás do
 * relógio. `teste-descartado`: evento de TESTE que não vai sair (modo de teste
 * desligado, ou a janela fechou) — não é perda: teste não conta em relatório nem
 * otimização, então não entra em "não chegou" nem acende alerta.
 */
export type SituacaoDoEnvio = "enviado" | "na-fila" | "reenviando" | "atrasado" | "nao-chegou" | "teste-descartado";

export function situacaoDoEnvio(e: CapiEnvio, agora: string): SituacaoDoEnvio {
  if (e.status === "enviado") return "enviado";
  const parou = e.status === "expirado" || expirouJanela(e.eventTime, agora);
  if (parou) return e.teste ? "teste-descartado" : "nao-chegou";
  const vencida = e.proximaTentativa ? Date.parse(agora) - Date.parse(e.proximaTentativa) : 0;
  if (vencida > ATRASO_DO_REENVIO_MINUTOS * MIN) return "atrasado";
  return e.tentativas === 0 ? "na-fila" : "reenviando";
}

// ---------------------------------------------------------------- ficha do lead

export interface EntradaDaMeta {
  id: string;
  /** Quando aconteceu o que a linha conta (ISO): o envio, ou a última tentativa. */
  quando: string;
  tom: "ok" | "pendente" | "falha";
  texto: string;
}

/**
 * Cada envio vira UMA linha na linha do tempo do lead. "Enviado à Meta ✓" só
 * quando a Meta respondeu que recebeu — e, em modo de teste, a linha diz que o
 * evento não conta nos relatórios. O texto começa pelo que aconteceu ("Enviado à
 * Meta ✓ — Reunião realizada"): assim concorda com qualquer nome de evento.
 */
export function entradasDaMeta(envios: CapiEnvio[], agora: string): EntradaDaMeta[] {
  return envios.map((e) => {
    const nome = EVENTO_CAPI_LABEL[e.eventName] ?? e.eventName;
    const id = `capi:${e.id}`;
    const erro = e.ultimoErro ?? "sem resposta.";
    const tentativas = `${e.tentativas} ${e.tentativas === 1 ? "tentativa" : "tentativas"}`;
    switch (situacaoDoEnvio(e, agora)) {
      case "enviado":
        return {
          id,
          quando: e.enviadoEm ?? e.atualizadoEm,
          tom: "ok",
          texto: e.teste
            ? `Enviado à Meta ✓ — ${nome}, em modo de teste: aparece em “Eventos de teste” e não conta nos relatórios.`
            : `Enviado à Meta ✓ — ${nome}`,
        };
      case "na-fila":
        return { id, quando: e.atualizadoEm, tom: "pendente", texto: `Na fila para a Meta — ${nome}.` };
      case "reenviando": {
        // Vencida há pouco (menos que o atraso tolerado): a vez chegou, falta a rodada.
        const naVez = e.proximaTentativa && Date.parse(e.proximaTentativa) <= Date.parse(agora);
        return {
          id,
          quando: e.atualizadoEm,
          tom: "pendente",
          texto: `Ainda não chegou à Meta — ${nome} (${tentativas}): ${erro}${
            naVez
              ? " Nova tentativa na próxima rodada do reenvio automático."
              : e.proximaTentativa
                ? ` Nova tentativa automática em ${formatDateTime(e.proximaTentativa)}.`
                : ""
          }`,
        };
      }
      case "atrasado":
        return {
          id,
          quando: e.atualizadoEm,
          tom: "pendente",
          texto: `Ainda não chegou à Meta — ${nome} (${tentativas}): ${erro} A nova tentativa estava marcada para ${formatDateTime(
            e.proximaTentativa!,
          )} e não rodou — confira o cron de /api/capi/retentar (Configurações → Integrações). Dá para reenviar até ${formatDateTime(
            fimDaJanela(e.eventTime),
          )}.`,
        };
      case "teste-descartado":
        return {
          id,
          quando: e.status === "expirado" ? e.atualizadoEm : fimDaJanela(e.eventTime),
          tom: "pendente",
          texto: `Evento de teste descartado — ${nome}: não vai para a produção (o modo de teste foi desligado ou a janela fechou). Não é perda: teste não conta nos relatórios.`,
        };
      default: {
        // O motivo GRAVADO na desistência (pendente fora da janela, ainda não fechado, é a janela).
        const motivo = e.status === "expirado" ? (e.motivo ?? "janela") : "janela";
        const porque =
          motivo === "recusado"
            ? "Reenviar o mesmo evento daria o mesmo erro — ninguém tenta mais."
            : motivo === "sem-payload"
              ? "O evento guardado não está mais na fila — não dá para reenviar."
              : `Passou da janela de ${JANELA_REENVIO_HORAS} h: reenviar agora poderia contar o evento duas vezes — ninguém tenta mais.`;
        return {
          id,
          quando: e.status === "expirado" ? e.atualizadoEm : fimDaJanela(e.eventTime),
          tom: "falha",
          texto: `Não chegou à Meta — ${nome}: ${erro} ${porque}`,
        };
      }
    }
  });
}

// ---------------------------------------------------------------- Integrações e alertas

export interface ResumoDosEnvios {
  enviados: number;
  /** Enviados com `test_event_code` (entre os `enviados`). */
  enviadosEmTeste: number;
  /** Ainda dentro da janela, esperando a vez (na fila, reenviando ou atrasados). */
  pendentes: number;
  /** Pendentes que já falharam ao menos uma vez. */
  pendentesComFalha: number;
  /** Pendentes cuja tentativa venceu há mais de `ATRASO_DO_REENVIO_MINUTOS`: o reenvio não roda. */
  atrasados: number;
  /** Eventos REAIS que não vão mais chegar. */
  naoChegaram: number;
  /** Eventos de teste que não vão sair — contados à parte: não são perda. */
  testesDescartados: number;
  /** O erro mais recente entre os que ainda podem sair. */
  ultimoErro?: { texto: string; em: string; evento: CapiEventName };
  /** O erro mais recente entre os que NÃO chegaram — a causa do alerta de perdidos. */
  ultimoErroPerdido?: { texto: string; em: string; evento: CapiEventName };
}

/**
 * Os envios de uma janela, como estão AGORA. Integrações e o alerta passam os
 * últimos 7 dias MAIS todo pendente de qualquer idade (o que ainda guarda payload
 * não some da tela só porque ficou velho).
 */
export function resumoDosEnvios(envios: CapiEnvio[], agora: string): ResumoDosEnvios {
  const r: ResumoDosEnvios = {
    enviados: 0,
    enviadosEmTeste: 0,
    pendentes: 0,
    pendentesComFalha: 0,
    atrasados: 0,
    naoChegaram: 0,
    testesDescartados: 0,
  };
  const vistos = new Set<string>();
  const maisRecente = (atual: ResumoDosEnvios["ultimoErro"], e: CapiEnvio) =>
    e.ultimoErro && (!atual || Date.parse(e.atualizadoEm) > Date.parse(atual.em))
      ? { texto: e.ultimoErro, em: e.atualizadoEm, evento: e.eventName }
      : atual;
  for (const e of envios) {
    if (vistos.has(e.id)) continue;
    vistos.add(e.id);
    const s = situacaoDoEnvio(e, agora);
    if (s === "enviado") {
      r.enviados++;
      if (e.teste) r.enviadosEmTeste++;
    } else if (s === "nao-chegou") {
      r.naoChegaram++;
      r.ultimoErroPerdido = maisRecente(r.ultimoErroPerdido, e);
    } else if (s === "teste-descartado") {
      r.testesDescartados++;
    } else {
      r.pendentes++;
      if (e.tentativas > 0) r.pendentesComFalha++;
      if (s === "atrasado") r.atrasados++;
      r.ultimoErro = maisRecente(r.ultimoErro, e);
    }
  }
  return r;
}

const plural = (n: number, um: string, varios: string) => `${n} ${n === 1 ? um : varios}`;

/**
 * A linha da CAPI em Integrações: o selo sai dos ENVIOS, não só das chaves —
 * "Conectado" com metade dos eventos sem chegar era o que a tela dizia antes.
 */
export function estadoDaCapi({
  configurada,
  teste,
  resumo,
}: {
  configurada: boolean;
  teste: boolean;
  resumo: ResumoDosEnvios;
}): EstadoExibido {
  if (!configurada) {
    return {
      estado: "nao-configurado",
      rotulo: "Não configurado",
      detalhe: "Faltam META_DATASET_ID e META_CAPI_TOKEN. Sem eles nenhum evento sai pelo servidor (o Pixel da LP segue sozinho).",
    };
  }
  const partes = [
    `Últimos 7 dias: ${plural(resumo.enviados, "evento enviado", "eventos enviados")}${
      resumo.enviadosEmTeste > 0 ? ` (${resumo.enviadosEmTeste} em modo de teste)` : ""
    }`,
    resumo.pendentes > 0 ? `${resumo.pendentes} aguardando nova tentativa` : "",
    resumo.atrasados > 0 ? `${plural(resumo.atrasados, "atrasado", "atrasados")} (o reenvio automático não rodou)` : "",
    resumo.naoChegaram > 0 ? plural(resumo.naoChegaram, "não chegou", "não chegaram") : "",
    resumo.testesDescartados > 0
      ? `${plural(resumo.testesDescartados, "evento de teste descartado", "eventos de teste descartados")} (não é perda)`
      : "",
  ].filter(Boolean);
  const ultimo = resumo.ultimoErroPerdido ?? resumo.ultimoErro;
  const erro = ultimo ? ` Último erro (${formatDateTime(ultimo.em)}): ${ultimo.texto}` : "";
  const modoTeste = teste
    ? " Em MODO DE TESTE (META_CAPI_TEST_EVENT_CODE definido): os eventos novos aparecem em “Eventos de teste” e não contam nos relatórios — tire a variável para valer."
    : "";
  const base = `Lead, reunião agendada, reunião realizada e venda saem pelo servidor, com nova tentativa automática por ${JANELA_REENVIO_HORAS} h. ${partes.join(" · ")}.${erro}${modoTeste}`;
  if (resumo.naoChegaram > 0) return { estado: "falhando", rotulo: "Eventos perdidos", detalhe: base };
  if (resumo.atrasados > 0) return { estado: "falhando", rotulo: "Reenvio parado", detalhe: base };
  if (resumo.pendentesComFalha > 0) return { estado: "falhando", rotulo: "Reenviando", detalhe: base };
  if (teste) return { estado: "nunca", rotulo: "Modo de teste", detalhe: base };
  return { estado: "ativo", rotulo: "Conectado", detalhe: base };
}

/** A linha do cron de reenvio: diz se ele RODA, não só se a chave existe. */
export function estadoDoCronCapi({
  capiConfigurada,
  cronSecret,
  ultimaExecucao,
  agora,
}: {
  capiConfigurada: boolean;
  cronSecret: boolean;
  ultimaExecucao?: string | null;
  agora: string;
}): EstadoExibido {
  const instrucao = `Agende no cron-job.org a cada ${CRON_REENVIO_MINUTOS} min: GET /api/capi/retentar?secret=CRON_SECRET. Sem custo além das chamadas à Meta; sem ele, a nova tentativa só acontece quando entra lead novo ou alguém aperta "Reenviar agora".`;
  if (!capiConfigurada || !cronSecret) {
    return {
      estado: "nao-configurado",
      rotulo: "Não configurado",
      detalhe: `Precisa da CAPI configurada e de CRON_SECRET; depois agende GET /api/capi/retentar?secret=… a cada ${CRON_REENVIO_MINUTOS} min.`,
    };
  }
  if (!ultimaExecucao) return { estado: "nunca", rotulo: "Nunca rodou", detalhe: instrucao };
  const atraso = Date.parse(agora) - Date.parse(ultimaExecucao);
  if (atraso > ATRASO_DO_REENVIO_MINUTOS * MIN) {
    return {
      estado: "falhando",
      rotulo: `Parado desde ${formatDateTime(ultimaExecucao)}`,
      detalhe: `A última execução foi em ${formatDateTime(ultimaExecucao)}. ${instrucao}`,
    };
  }
  return { estado: "ativo", rotulo: "Rodando", detalhe: `Última execução: ${formatDateTime(ultimaExecucao)}.` };
}

/** Os alertas globais da CAPI (o "⚠" do cabeçalho), para quem cuida dos dados. */
export function alertasDaCapi({
  configurada,
  teste,
  producao,
  resumo,
}: {
  configurada: boolean;
  teste: boolean;
  producao: boolean;
  resumo: ResumoDosEnvios;
}): Alerta[] {
  if (!configurada) return [];
  const cta = { label: "Ver integrações", href: "/configuracoes/integracoes" };
  const alertas: Alerta[] = [];
  if (resumo.naoChegaram > 0) {
    alertas.push({
      id: "capi-perdidos",
      nivel: "falha",
      titulo: `${plural(resumo.naoChegaram, "evento não chegou", "eventos não chegaram")} à Meta`,
      detalhe: `${resumo.ultimoErroPerdido ? `${resumo.ultimoErroPerdido.texto} ` : ""}Não vão mais ser reenviados (a Meta recusou o evento ou passou a janela de ${JANELA_REENVIO_HORAS} h): ela otimiza e atribui sem eles.`,
      cta,
    });
  }
  if (resumo.atrasados > 0) {
    alertas.push({
      id: "capi-reenvio-parado",
      nivel: "aviso",
      titulo: "O reenvio automático da CAPI não está rodando",
      detalhe: `${plural(resumo.atrasados, "evento espera", "eventos esperam")} uma nova tentativa que já venceu. Agende /api/capi/retentar a cada ${CRON_REENVIO_MINUTOS} min ou use "Reenviar agora" — depois de ${JANELA_REENVIO_HORAS} h do fato não dá mais.`,
      cta,
    });
  } else if (resumo.pendentesComFalha > 0) {
    alertas.push({
      id: "capi-reenviando",
      nivel: "aviso",
      titulo: `${plural(resumo.pendentesComFalha, "evento ainda não chegou", "eventos ainda não chegaram")} à Meta`,
      detalhe: `${resumo.ultimoErro ? `${resumo.ultimoErro.texto} ` : ""}O painel tenta de novo sozinho por ${JANELA_REENVIO_HORAS} h depois do fato.`,
      cta,
    });
  }
  if (teste && producao) {
    alertas.push({
      id: "capi-modo-teste",
      nivel: "aviso",
      titulo: "A CAPI está em modo de teste",
      detalhe:
        "META_CAPI_TEST_EVENT_CODE está definido: os eventos novos aparecem em “Eventos de teste” do Gerenciador de Eventos e não contam nos relatórios nem na otimização. Tire a variável quando terminar o teste.",
      cta,
    });
  }
  return alertas;
}
