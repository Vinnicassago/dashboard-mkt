/**
 * ONDE TRAVA (Fase 3, nov/26) — UMA função, PURA, usada só no servidor (K29): a
 * manchete do Funil e `inicio.atendimento.ondeTrava` da IA leem daqui.
 *
 * A maior perda em PESSOAS, sem meta nem média nem impacto estimado, saída das
 * `juntas` de `funilDoProcesso` (a MESMA passada pela coorte que a tela desenha):
 * travados = entraram − passaram − chegaram a agendar NESTE episódio − ainda no
 * prazo da etapa. Concorre a junta com `AMOSTRA_MINIMA` travados ou mais; com a
 * leitura do robô parada, as três juntas do robô não concorrem (quem respondeu
 * depois da última leitura viraria travado falso) e a manchete ganha "⚠"
 * (`semEtapasDoRobo`, K6). Vence o maior; no empate, a mais funda.
 *
 * O chip é o dono da ETAPA (quem corrige o processo, F3-D25); o link vai ao grupo
 * da Fila com mais travados AGORA e não leva número (a Fila é o agora; a perda é a
 * coorte — F3-D22). Nunca devolve `null`: os vazios têm `situacao` própria (K8).
 */

import { dica } from "./dicionario";
import type { Dono } from "./dono";
import { FILA_ETAPAS } from "./fila";
import { formatInt } from "./format";
import type { FunilDoProcesso, JuntaDoProcesso, JuntaId } from "./funil-processo";
import { comPeriodo } from "./range";
import { ROBO_INICIO } from "./robo/situacao";
import { MIN_REUNIOES } from "./trust";

/** K8: os quatro estados, que a IA precisa distinguir (nunca um `null` só). */
export type SituacaoDaTrava = "trava" | "sem-leads" | "leitura-parada" | "abaixo-da-amostra";

export interface OndeTrava {
  situacao: SituacaoDaTrava;
  /** `f.parada && f.comRobo`: as três juntas do robô não concorreram (o título ganha "⚠" na tela). */
  semEtapasDoRobo: boolean;
  /** A junta vencedora (contagens); null sem vencedor. */
  junta: JuntaDoProcesso | null;
  /** A frase do título (§4.3) ou a do vazio, SEM o "⚠" (o componente o põe com `semEtapasDoRobo`). */
  titulo: string;
  /** O dono da ETAPA (a junta), F3-D25; null sem vencedor. */
  dono: Dono | null;
  /** O grupo da Fila onde estão mais travados agora; SEM número. */
  link: { href: string; rotulo: string } | null;
  /** O ⓘ (§4.4). */
  dica: string;
}

/** O título por junta (n = `formatInt(travados)`, sempre ≥ `AMOSTRA_MINIMA`). */
export const TITULO_DA_JUNTA: Record<JuntaId, (n: string) => string> = {
  // K9: não é o "Sem a 1ª mensagem do robô · N" do Início e do alerta (outro número: o de agora, na janela de 48 h).
  "robo-falou": (n) => `${n} pararam antes da 1ª mensagem do robô`,
  respondeu: (n) => `${n} não responderam ao robô`,
  aceitou: (n) => `${n} pararam na conversa com o robô`,
  "agendou-apos-aceite": (n) => `${n} aceitaram o convite sem reunião registrada`,
  "fora-agendou": (n) => `${n} fora do robô não agendaram`,
  agendou: (n) => `${n} entraram e não agendaram`,
  realizou: (n) => `${n} agendaram e a reunião não aconteceu`,
  fechou: (n) => `${n} fizeram a reunião e não fecharam`,
};

/** O que vai para o Início e para a IA (K8): sem link nem ⓘ, só contagens. */
export interface ResumoDaTrava {
  situacao: SituacaoDaTrava;
  semEtapasDoRobo: boolean;
  titulo: string;
  dono: Dono | null;
  junta: JuntaId | null;
  /** 0 sem vencedor (os cinco). */
  travados: number;
  entradas: number;
  emAndamento: number;
  abertos: number;
  encerrados: number;
}

/** A régua ÚNICA de amostra (`AMOSTRA_MINIMA` = `MIN_REUNIOES`). */
const AMOSTRA_MINIMA = MIN_REUNIOES;

const JUNTAS_DO_ROBO: readonly JuntaId[] = ["robo-falou", "respondeu", "aceitou"];

/** A profundidade para o desempate (a mais funda vence); entre as de nível 4, a ordem da lista. */
const NIVEL: Record<JuntaId, number> = {
  "robo-falou": 1,
  respondeu: 2,
  aceitou: 3,
  "agendou-apos-aceite": 4,
  "fora-agendou": 4,
  agendou: 4,
  realizou: 5,
  fechou: 6,
};
const ORDEM: readonly JuntaId[] = ["robo-falou", "respondeu", "aceitou", "agendou-apos-aceite", "fora-agendou", "agendou", "realizou", "fechou"];

/** De / para do ⓘ: [plural, singular]. */
const DE_PARA: Record<JuntaId, { de: [string, string]; para: [string, string] }> = {
  "robo-falou": { de: ["que passam pelo robô", "que passa pelo robô"], para: ["receberam a 1ª mensagem", "recebeu a 1ª mensagem"] },
  respondeu: { de: ["que receberam a 1ª mensagem", "que recebeu a 1ª mensagem"], para: ["responderam", "respondeu"] },
  aceitou: { de: ["que responderam", "que respondeu"], para: ["aceitaram o convite", "aceitou o convite"] },
  "agendou-apos-aceite": { de: ["que aceitaram o convite", "que aceitou o convite"], para: ["agendaram depois do aceite", "agendou depois do aceite"] },
  "fora-agendou": {
    // F3-D31: os de antes de 29/10 só entram quando estão na Fila.
    de: [
      "leads fora do robô (sem telefone, recém-chegados, reabertos no painel ou de antes de 29/10 que estão na Fila)",
      "lead fora do robô (sem telefone, recém-chegado, reaberto no painel ou de antes de 29/10 que está na Fila)",
    ],
    para: ["agendaram", "agendou"],
  },
  agendou: { de: ["leads", "lead"], para: ["agendaram", "agendou"] },
  realizou: { de: ["que chegaram a agendar (desistências incluídas)", "que chegou a agendar (desistências incluídas)"], para: ["fizeram a reunião", "fez a reunião"] },
  fechou: { de: ["com reunião realizada", "com reunião realizada"], para: ["fecharam", "fechou"] },
};

const dm = (dia: string) => `${dia.slice(8, 10)}/${dia.slice(5, 7)}`;
/** "3 abertos" / "1 aberto". */
const qtd = (n: number, um: string, varios: string) => `${formatInt(n)} ${n === 1 ? um : varios}`;
/** "a, b e c". */
function lista(itens: string[]): string {
  if (itens.length <= 1) return itens.join("");
  return `${itens.slice(0, -1).join(", ")} e ${itens.at(-1)}`;
}

/** O ⓘ da manchete com vencedora (§4.4, K32: singular quando é um; cada opcional some com 0). */
function dicaDaJunta(f: FunilDoProcesso, j: JuntaDoProcesso, link: OndeTrava["link"], semEtapasDoRobo: boolean): string {
  const dp = DE_PARA[j.id];
  const partes: string[] = [];
  let abertura = `${j.entradas === 1 ? "Do" : "Dos"} ${formatInt(j.entradas)} ${dp.de[j.entradas === 1 ? 1 : 0]}: ${formatInt(j.passaram)} ${dp.para[j.passaram === 1 ? 1 : 0]}`;
  if (j.outroCaminho > 0) {
    const um = j.outroCaminho === 1;
    abertura += `, ${formatInt(j.outroCaminho)} ${um ? "chegou" : "chegaram"} a agendar por outro caminho ou ${um ? "desistiu" : "desistiram"} depois`;
  }
  if (j.emAndamento > 0) abertura += `, ${formatInt(j.emAndamento)} ainda no prazo`;
  partes.push(`${abertura}.`);

  const estados = [
    j.abertos > 0 ? qtd(j.abertos, "aberto", "abertos") : "",
    j.encerrados > 0 ? qtd(j.encerrados, "encerrado", "encerrados") : "",
  ].filter(Boolean);
  // Só concorre junta com `AMOSTRA_MINIMA` (3) travados ou mais: nunca "O 1 parado".
  partes.push(`Os ${formatInt(j.travados)} parados: ${estados.join(", ")}.`);

  // Partes próprias de algumas juntas.
  if (j.id === "robo-falou" && j.semFala) {
    const motivos = [
      j.semFala.semWhatsapp > 0 ? `${formatInt(j.semFala.semWhatsapp)} sem WhatsApp` : "",
      j.semFala.naoChegou > 0 ? qtd(j.semFala.naoChegou, "não chegou ao robô", "não chegaram ao robô") : "",
      j.semFala.naoFalou > 0 ? `${formatInt(j.semFala.naoFalou)} sem fala do robô` : "",
    ].filter(Boolean);
    if (motivos.length > 0) partes.push(`Dos parados: ${motivos.join(", ")}.`);
  }
  if (j.id === "aceitou") partes.push("Parado = sem atividade do robô, da pessoa ou do comercial há 48 h (pausado incluído).");
  if (j.id === "fechou") partes.push("Negociando até 30 dias depois da reunião.");
  if ((j.id === "fora-agendou" || j.id === "agendou") && f.foraDasJuntas.live > 0) {
    const um = f.foraDasJuntas.live === 1;
    partes.push(`${formatInt(f.foraDasJuntas.live)} ${um ? "inscrito da live fica" : "inscritos da live ficam"} fora (a Fila da live).`);
  }

  // F3-D31: testes, cópias de duplicado e os de antes do robô fora da Fila, cada um só
  // quando > 0. Testes e cópias saem de TODA junta; os de antes do robô fora da Fila só
  // de `fora-agendou` (a reunião deles é julgada em `realizou`/`fechou`, como a da live) —
  // em outra junta, a frase faria crer que saíram de uma base onde nunca estiveram.
  const sem = [
    f.foraDasJuntas.testes > 0 ? qtd(f.foraDasJuntas.testes, "teste", "testes") : "",
    f.foraDasJuntas.duplicados > 0 ? qtd(f.foraDasJuntas.duplicados, "cópia de duplicado", "cópias de duplicado") : "",
    j.id === "fora-agendou" && f.foraDasJuntas.antes > 0
      ? qtd(f.foraDasJuntas.antes, `lead de antes do robô (${dm(ROBO_INICIO)}) fora da Fila`, `leads de antes do robô (${dm(ROBO_INICIO)}) fora da Fila`)
      : "",
  ].filter(Boolean);
  if (sem.length > 0) partes.push(`Sem ${lista(sem)}.`);

  partes.push(`A maior perda em pessoas dos ${f.recorte}, sem meta nem média; o dono é o da etapa.`);
  partes.push(
    link && j.destino
      ? `O link abre o grupo ${FILA_ETAPAS[j.destino].label} da Fila (do comercial), onde eles estão agora — a Fila conta quem espera hoje, de qualquer período.`
      : "Nenhum deles está na Fila agora.",
  );
  if (semEtapasDoRobo) partes.push("A leitura do robô está parada: as etapas do robô não entram.");
  return partes.join(" ");
}

export function ondeTrava(f: FunilDoProcesso, c: { rangeKey: string }): OndeTrava {
  // Com 0 lead o card do funil não existe (K34): não há trecho do robô na tela para o "⚠",
  // e "nenhum lead" é fato do painel, não da leitura do robô. A MESMA regra na tela, no
  // Início e na IA (os três leem esta função).
  const semEtapasDoRobo = f.parada && f.comRobo && f.leads > 0;
  const vazio = (situacao: Exclude<SituacaoDaTrava, "trava">, titulo: string, sufixo: string): OndeTrava => ({
    situacao,
    semEtapasDoRobo,
    junta: null,
    titulo,
    dono: null,
    link: null,
    dica: `${dica("onde_trava")}${sufixo}`,
  });
  if (f.leads === 0) return vazio("sem-leads", "Nenhum lead no período", "");

  let vencedora: JuntaDoProcesso | null = null;
  for (const j of f.juntas) {
    if (j.travados < AMOSTRA_MINIMA) continue;
    // Leitura parada: quem respondeu depois da última leitura viraria travado falso.
    if (f.parada && JUNTAS_DO_ROBO.includes(j.id)) continue;
    if (
      !vencedora ||
      j.travados > vencedora.travados ||
      (j.travados === vencedora.travados &&
        (NIVEL[j.id] > NIVEL[vencedora.id] || (NIVEL[j.id] === NIVEL[vencedora.id] && ORDEM.indexOf(j.id) < ORDEM.indexOf(vencedora.id))))
    ) {
      vencedora = j;
    }
  }

  if (!vencedora) {
    return semEtapasDoRobo
      ? vazio(
          "leitura-parada",
          "Nenhuma trava fora das etapas do robô",
          ` A leitura do robô está parada: as etapas do robô não entram, e fora delas nenhuma tem ${AMOSTRA_MINIMA} ou mais parados.`,
        )
      : vazio(
          "abaixo-da-amostra",
          `Nenhuma etapa com ${AMOSTRA_MINIMA} ou mais pessoas paradas`,
          ` Nenhuma etapa tem ${AMOSTRA_MINIMA} ou mais pessoas paradas.`,
        );
  }

  const g = vencedora.destino;
  const link = g ? { href: comPeriodo(`/fila?etapa=${g}#${g}`, c.rangeKey), rotulo: `${FILA_ETAPAS[g].label} →` } : null;
  return {
    situacao: "trava",
    semEtapasDoRobo,
    junta: vencedora,
    titulo: TITULO_DA_JUNTA[vencedora.id](formatInt(vencedora.travados)),
    dono: vencedora.dono,
    link,
    dica: dicaDaJunta(f, vencedora, link, semEtapasDoRobo),
  };
}

/** O resumo para o Início e a IA (K8): sem link nem ⓘ; as contagens são 0 sem vencedor. */
export function resumoDaTrava(o: OndeTrava): ResumoDaTrava {
  const j = o.junta;
  return {
    situacao: o.situacao,
    semEtapasDoRobo: o.semEtapasDoRobo,
    titulo: o.titulo,
    dono: o.dono,
    junta: j?.id ?? null,
    travados: j?.travados ?? 0,
    entradas: j?.entradas ?? 0,
    emAndamento: j?.emAndamento ?? 0,
    abertos: j?.abertos ?? 0,
    encerrados: j?.encerrados ?? 0,
  };
}
