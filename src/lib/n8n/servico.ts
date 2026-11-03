import "server-only";
import {
  addLead,
  addLeadEvent,
  comTravaDaPessoa,
  getLead,
  listLeadEvents,
  listLeads,
  setLeadStatus,
} from "../data/store";
import { newEventId } from "../auth/actor";
import { expedienteAtual } from "../atendimento-server";
import { comClasse } from "../classe-server";
import { resumoContato } from "../contato";
import { montarFilaDaLive } from "../fila-live";
import { gravarFicha } from "../leads/gravar-ficha";
import { aplicarStatus } from "../leads/mudar-status";
import { registrarContato } from "../leads/registrar-contato";
import { idLeadLp } from "../lead-id";
import { idsDoUtm } from "../atribuicao";
import { isLostStatus, podeTransitar, statusLabel } from "../lead-status";
import { everBooked } from "../metrics";
import { mesmoTelefone, normalizarTelefone } from "../phone";
import { CLASSES_NA_FILA, type Classe } from "../qualificacao";
import { DEFAULT_BRAND, type Lead, type LeadStatus } from "../types";
import type { Atualizacao, Inscricao } from "./entrada";
import { fichaParaN8n, type FichaN8n } from "./ficha";

/** Quem aparece no histórico como autor do que a API grava. */
export const ATOR_N8N = "n8n";

/**
 * Até quanto tempo depois da entrada o MESMO cadastro chegando pelo outro caminho
 * (a LP manda ao painel e ao n8n ao mesmo tempo) é a mesma inscrição, não um
 * reenvio do formulário.
 */
export const MESMA_INSCRICAO_MIN = 30;

const painelUrl = () => process.env.PAINEL_URL?.trim() || undefined;

/** Um lead pela chave da URL: o WhatsApp (só dígitos) ou o id do lead. */
export async function buscarPorChave(chave: string): Promise<Lead | null> {
  const bruta = decodeURIComponent(chave).trim();
  if (/^\+?[\d\s()-]{10,}$/.test(bruta)) {
    return pessoaDoWhatsapp(normalizarTelefone(bruta), await listLeads(DEFAULT_BRAND)) ?? null;
  }
  const l = await getLead(bruta);
  return l && !l.deletedAt ? l : null;
}

/**
 * O lead que é esta pessoa, pelo WhatsApp. Havendo mais de um cadastro com o
 * mesmo número (duplicado antigo — mesclar é decisão de gente, em Leads →
 * Revisar), vale o que carrega mais história, e no empate o mais antigo.
 */
export function pessoaDoWhatsapp(whatsapp: string, leads: Lead[]): Lead | undefined {
  const peso = (l: Lead) => [l.firstContactAt, l.bookedAt, l.attendedAt, l.closedAt].filter(Boolean).length;
  return leads
    .filter((l) => l.brand === DEFAULT_BRAND && !l.deletedAt && l.phone && mesmoTelefone(l.phone, whatsapp))
    .sort((a, b) => peso(b) - peso(a) || a.createdAt.localeCompare(b.createdAt))[0];
}

async function fichaDe(leadId: string): Promise<FichaN8n | null> {
  const [lead, eventos, cfg] = await Promise.all([getLead(leadId), listLeadEvents({ leadId, limit: 0 }), expedienteAtual()]);
  return lead ? fichaParaN8n(lead, eventos, cfg, new Date().toISOString(), painelUrl()) : null;
}

export async function fichaDoLead(lead: Lead): Promise<FichaN8n | null> {
  return fichaDe(lead.id);
}

// ---------------------------------------------------------------- inscrição

export interface ResultadoInscricao {
  criado: boolean;
  ficha: FichaN8n;
}

/**
 * Cria ou atualiza o lead pela chave do WhatsApp. A mesma pessoa inscrita duas
 * vezes atualiza a ficha — nunca vira um 2º lead. Tudo dentro da trava da
 * pessoa: a LP (/api/track) e o n8n chegando juntos não criam dois.
 */
export async function inscrever(i: Inscricao): Promise<ResultadoInscricao> {
  return comTravaDaPessoa(i.whatsapp, async () => {
    const agora = new Date().toISOString();
    const leads = await listLeads(DEFAULT_BRAND);
    const doEvento = i.eventId ? await getLead(idLeadLp(i.eventId)) : null;
    const existente =
      (doEvento && !doEvento.deletedAt && (!doEvento.phone || mesmoTelefone(doEvento.phone, i.whatsapp)) ? doEvento : null) ??
      pessoaDoWhatsapp(i.whatsapp, leads);

    if (!existente) {
      let id = i.eventId ? idLeadLp(i.eventId) : `LEAD-WA-${i.whatsapp}`;
      // Id ocupado (lead excluído com o mesmo id): um novo, sem tocar no antigo.
      if (await getLead(id)) id = `${id}-${Date.now().toString(36)}`;
      const base: Lead = {
        id,
        brand: DEFAULT_BRAND,
        createdAt: i.inscritoEm ?? agora,
        name: i.nome ?? "Lead sem nome",
        email: i.email,
        phone: i.whatsapp,
        ...i.utm,
        // Os ids que o UTM padrão traz ({{campaign.id}}, {{adset.id}}, {{ad.id}}): a atribuição ao anúncio (D6).
        ...idsDoUtm({ utm_campaign: i.utm.utmCampaign, utm_term: i.utm.utmTerm, utm_content: i.utm.utmContent }),
        status: "lead",
      };
      const ficha = await comClasse(base, i.ficha);
      const lead: Lead = { ...base };
      for (const [k, v] of Object.entries(ficha)) {
        if (v !== null && v !== undefined) (lead as unknown as Record<string, unknown>)[k] = v;
      }
      await addLead(lead);
      await addLeadEvent({
        id: newEventId(),
        leadId: id,
        brand: DEFAULT_BRAND,
        leadName: lead.name,
        actor: ATOR_N8N,
        action: "created",
        toStatus: "lead",
        payload: { origem: "n8n" },
        createdAt: agora,
      });
      return { criado: true, ficha: (await fichaDe(id))! };
    }

    // Já existe: preenche o contato que faltava (nunca sobrescreve) e grava a ficha.
    await addLead({
      ...existente,
      name: i.nome ?? existente.name,
      email: i.email,
      phone: i.whatsapp,
      ...i.utm,
    });
    const mesmaInscricao =
      Date.parse(agora) - Date.parse(existente.createdAt) < MESMA_INSCRICAO_MIN * 60_000 && !existente.classeN8n;
    if (!mesmaInscricao) {
      await addLeadEvent({
        id: newEventId(),
        leadId: existente.id,
        brand: DEFAULT_BRAND,
        leadName: existente.name,
        actor: ATOR_N8N,
        action: "reenvio",
        payload: { pelo: "telefone", origem: "n8n" },
        createdAt: agora,
      });
      // Quem estava perdido e se inscreveu DE NOVO quer conversa: volta para a fila.
      if (isLostStatus(existente.status)) {
        await setLeadStatus(existente.id, "lead", { lostAt: null, lostReasonDetail: null });
        await addLeadEvent({
          id: newEventId(),
          leadId: existente.id,
          brand: DEFAULT_BRAND,
          leadName: existente.name,
          actor: ATOR_N8N,
          action: "reaberto",
          fromStatus: existente.status,
          toStatus: "lead",
          payload: { motivo: "Inscreveu-se de novo" },
          createdAt: agora,
        });
      }
    }
    const atual = (await getLead(existente.id)) ?? existente;
    await gravarFicha(atual, await comClasse(atual, i.ficha), ATOR_N8N);
    return { criado: false, ficha: (await fichaDe(existente.id))! };
  });
}

// ---------------------------------------------------------------- atualização

export interface ResultadoAtualizacao {
  ok: boolean;
  /** 409 = a transição não pode (o lead está num estado que não deixa). */
  status: 200 | 409;
  ficha: FichaN8n | null;
  aplicado: string[];
  erro?: string;
}

/**
 * Grava os fatos que o n8n mandou, nesta ordem: respostas e fatos da ficha →
 * tentativa (com resultado) → reunião → "Sem resposta". Cada passo confere a
 * régua de transição no estado em que o lead está NAQUELE momento; o primeiro que
 * não pode para tudo e diz o que já foi gravado.
 */
export async function atualizar(lead: Lead, a: Atualizacao): Promise<ResultadoAtualizacao> {
  return comTravaDaPessoa(lead.phone ? normalizarTelefone(lead.phone) : lead.id, async () => {
    const aplicado: string[] = [];
    const parar = async (erro: string): Promise<ResultadoAtualizacao> => ({
      ok: false,
      status: 409,
      erro,
      aplicado,
      ficha: await fichaDe(lead.id),
    });
    let atual = (await getLead(lead.id)) ?? lead;

    if (Object.keys(a.ficha).length) {
      const { mudou } = await gravarFicha(atual, await comClasse(atual, a.ficha), ATOR_N8N);
      aplicado.push(...(mudou.length ? mudou : ["ficha (sem mudança)"]));
      atual = (await getLead(lead.id)) ?? atual;
    }

    // "Agendou" na tentativa já leva a data da reunião — a reunião não se repete abaixo.
    const reuniaoNaTentativa = a.tentativa?.resultado === "agendou";
    if (a.tentativa) {
      if (reuniaoNaTentativa && !a.reuniao?.em) return parar("tentativa com resultado “Agendou” precisa de reuniao_em.");
      const r = await registrarContato(lead.id, {
        canal: a.tentativa.canal,
        resultado: a.tentativa.resultado,
        nota: a.tentativa.nota,
        ocorreuEm: a.tentativa.em,
        reuniaoEm: reuniaoNaTentativa ? a.reuniao?.em : undefined,
        actor: ATOR_N8N,
      });
      if (!r.ok) return parar(r.message);
      aplicado.push(`tentativa (${a.tentativa.resultado})`);
      atual = (await getLead(lead.id)) ?? atual;
    }

    if (a.reuniao?.status && !(reuniaoNaTentativa && a.reuniao.status === "agendada")) {
      const r = await aplicarReuniao(atual, a.reuniao.status, a.reuniao.em);
      if (r) return parar(r);
      aplicado.push(`reunião (${a.reuniao.status})`);
      atual = (await getLead(lead.id)) ?? atual;
    }

    if (a.semResposta) {
      const resumo = resumoContato(await listLeadEvents({ leadId: lead.id, limit: 0 }));
      const bloqueio = podeTransitar(
        { status: atual.status, jaAgendou: everBooked(atual), tentativas: resumo.tentativas, diasComTentativa: resumo.diasComTentativa },
        "sem_resposta",
        { confirmado: true },
      );
      if (bloqueio) return parar(bloqueio);
      await aplicarStatus(atual, "sem_resposta", { confirmado: true }, { actor: ATOR_N8N });
      aplicado.push("status (Sem resposta)");
    }

    return { ok: true, status: 200, aplicado, ficha: await fichaDe(lead.id) };
  });
}

/** A reunião pelo estado que o n8n informa; devolve o erro, ou null se gravou. */
async function aplicarReuniao(lead: Lead, s: NonNullable<NonNullable<Atualizacao["reuniao"]>["status"]>, em?: string): Promise<string | null> {
  const transitar = async (para: LeadStatus, dados: { meetingFor?: string } = {}) => {
    const resumo = resumoContato(await listLeadEvents({ leadId: lead.id, limit: 0 }));
    const bloqueio = podeTransitar(
      { status: lead.status, jaAgendou: everBooked(lead), tentativas: resumo.tentativas, diasComTentativa: resumo.diasComTentativa },
      para,
      dados,
    );
    if (bloqueio) return bloqueio;
    await aplicarStatus(lead, para, dados, { actor: ATOR_N8N });
    return null;
  };
  switch (s) {
    case "agendada":
      // "Novo" agenda direto (a régua deixa); sem a data, não.
      return transitar("agendado", { meetingFor: em });
    case "realizada":
      return transitar("reuniao_realizada");
    case "nao_compareceu":
      return transitar("no_show");
    case "confirmada":
      if (lead.status !== "agendado") return `Só se confirma reunião agendada (o lead está em “${statusLabel(lead.status)}”).`;
      await gravarFicha(lead, { reuniaoConfirmadaEm: new Date().toISOString(), reuniaoRemarcarEm: null }, ATOR_N8N);
      return null;
    case "remarcar":
      if (lead.status !== "agendado" && lead.status !== "no_show") {
        return `Só se remarca reunião agendada ou de quem não compareceu (o lead está em “${statusLabel(lead.status)}”).`;
      }
      // Com a data nova junto, já remarca; sem ela, fica "pediu para remarcar".
      if (em) return transitar("agendado", { meetingFor: em });
      await gravarFicha(lead, { reuniaoRemarcarEm: new Date().toISOString(), reuniaoConfirmadaEm: null }, ATOR_N8N);
      return null;
  }
}

// ---------------------------------------------------------------- pendentes

export interface FiltroPendentes {
  classes: Classe[];
  /** Só os que já passaram do prazo (a checagem de 10 em 10 minutos). */
  vencidos: boolean;
  /** Só com prazo até este instante (ISO). */
  ate?: string;
}

/** A Fila da live como o n8n lê: A e B pendentes, do prazo mais antigo para o mais novo. */
export async function pendentes(f: FiltroPendentes) {
  const agora = new Date().toISOString();
  const [leads, eventos, cfg] = await Promise.all([
    listLeads(DEFAULT_BRAND),
    listLeadEvents({ brand: DEFAULT_BRAND, limit: 0 }),
    expedienteAtual(),
  ]);
  const url = painelUrl();
  const itens = montarFilaDaLive(leads, eventos, agora, cfg)
    .filter((i) => f.classes.includes(i.classe))
    .filter((i) => !f.vencidos || i.atrasado)
    .filter((i) => !f.ate || i.prazo <= f.ate)
    .map((i) => ({
      id: i.leadId,
      nome: i.nome,
      whatsapp: i.telefone ? normalizarTelefone(i.telefone) : null,
      classe: i.classe,
      etapa_fila: i.etapa,
      prazo_tentativa: i.prazo,
      atrasado: i.atrasado,
      minutos_para_prazo: i.minutosParaPrazo,
      tentativas: i.contato.tentativas,
      ultima_tentativa_em: i.contato.ultima ?? null,
      horario_preferido: i.horarioPreferido ?? null,
      eduardo_avisado_em: i.atendimentoAvisadoEm ?? null,
      escalado_em: i.escaladoEm ?? null,
      link_ficha: url ? `${url.replace(/\/$/, "")}/leads/${encodeURIComponent(i.leadId)}` : null,
    }));
  return { gerado_em: agora, total: itens.length, atrasados: itens.filter((i) => i.atrasado).length, itens };
}

/** Classes pedidas na query ("A,B"); vazio ou inválido = as da Fila (A e B). */
export function classesDaQuery(v: string | null): Classe[] {
  const pedidas = (v ?? "")
    .split(",")
    .map((s) => s.trim().toUpperCase())
    .filter((s): s is Classe => ["A", "B", "C", "X"].includes(s));
  return pedidas.length ? pedidas : CLASSES_NA_FILA;
}

