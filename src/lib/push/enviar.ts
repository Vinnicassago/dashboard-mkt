import "server-only";
import webpush from "web-push";
import { isAuthEnabled } from "../auth/config";
import { STATE_KEYS } from "../data/backend";
import { listInscricoesPush, listUsers, removerInscricaoPush, setState } from "../data/store";
import { estadoDoRoboAgora } from "../robo/estado";
import type { InscricaoPush, Lead } from "../types";
import { configDoPush, pushConfigurado, type ConfigDoPush } from "./config";
import {
  VALIDADE_DO_AVISO_S,
  avisoDeTeste,
  avisoDoLead,
  inscricaoMorta,
  type AvisoPush,
  type EventoDoAviso,
  type ResumoEnvioPush,
} from "./aviso";

/**
 * Avisos de lead novo por Web Push — o envio (as chaves: `push/config.ts`). Falha no
 * envio nunca derruba quem chama: a entrada do lead já foi gravada.
 */

/** Quem PODE receber: com login, só inscrição de usuário que ainda existe. */
async function inscricoesValidas(): Promise<{ validas: InscricaoPush[]; orfas: InscricaoPush[] }> {
  const todas = await listInscricoesPush();
  if (!isAuthEnabled()) return { validas: todas, orfas: [] };
  const usuarios = new Set((await listUsers()).map((u) => u.username));
  const validas: InscricaoPush[] = [];
  const orfas: InscricaoPush[] = [];
  for (const i of todas) (i.usuario && usuarios.has(i.usuario) ? validas : orfas).push(i);
  return { validas, orfas };
}

type ResultadoDoEnvio = { ok: true } | { ok: false; status?: number; erro: string };

async function enviarUm(cfg: ConfigDoPush, i: InscricaoPush, aviso: AvisoPush): Promise<ResultadoDoEnvio> {
  try {
    await webpush.sendNotification(
      { endpoint: i.endpoint, keys: { p256dh: i.p256dh, auth: i.auth } },
      JSON.stringify(aviso),
      {
        vapidDetails: { subject: cfg.assunto, publicKey: cfg.publica, privateKey: cfg.privada },
        TTL: VALIDADE_DO_AVISO_S,
        urgency: "high",
        timeout: 5_000,
      },
    );
    return { ok: true };
  } catch (e) {
    const status = e instanceof webpush.WebPushError ? e.statusCode : undefined;
    // A mensagem do web-push pode trazer o corpo da resposta; o endpoint nunca vai ao log.
    const msg = e instanceof Error ? e.message.split("\n")[0].slice(0, 120) : String(e).slice(0, 120);
    return { ok: false, status, erro: status ? `${status} ${msg}` : msg };
  }
}

/**
 * Manda um aviso para os aparelhos (todos, ou só `apenas`). A inscrição que o serviço
 * diz não existir mais (404/410) sai; a de usuário que não existe mais também. Grava
 * o resumo (só contagens) para Integrações. Nunca lança.
 */
export async function enviarAviso(
  aviso: AvisoPush,
  evento: ResumoEnvioPush["evento"],
  opts: { apenas?: InscricaoPush } = {},
): Promise<ResumoEnvioPush | null> {
  const cfg = configDoPush();
  if (!cfg) return null;
  try {
    let alvo: InscricaoPush[];
    if (opts.apenas) alvo = [opts.apenas];
    else {
      const { validas, orfas } = await inscricoesValidas();
      for (const o of orfas) await removerInscricaoPush(o.endpoint);
      alvo = validas;
    }
    if (!alvo.length) return null;
    const resultados = await Promise.all(alvo.map((i) => enviarUm(cfg, i, aviso)));
    const resumo: ResumoEnvioPush = {
      em: new Date().toISOString(),
      evento,
      aparelhos: alvo.length,
      entregues: 0,
      removidas: 0,
      falhas: 0,
    };
    for (const [k, r] of resultados.entries()) {
      if (r.ok) resumo.entregues++;
      else if (inscricaoMorta(r.status)) {
        resumo.removidas++;
        await removerInscricaoPush(alvo[k].endpoint);
      } else {
        resumo.falhas++;
        resumo.erro ??= r.erro;
      }
    }
    if (resumo.falhas) console.warn(`[push] ${resumo.falhas} de ${resumo.aparelhos} avisos falharam: ${resumo.erro}`);
    // O teste de um aparelho não é "o último envio" do painel.
    if (!opts.apenas) await setState(STATE_KEYS.pushUltimoEnvio, resumo);
    return resumo;
  } catch (e) {
    console.warn("[push] o envio dos avisos falhou:", e instanceof Error ? e.message : e);
    return null;
  }
}

/** O robô está ligado para a marca? Na dúvida, desligado (o aviso só muda a frase). */
async function roboLigado(brand: string): Promise<boolean> {
  try {
    return (await estadoDoRoboAgora(brand)).ligado;
  } catch {
    return false;
  }
}

/**
 * Lead novo (ou que voltou) para todos os aparelhos inscritos. Quem chama roda isto
 * DEPOIS da resposta (`after`): a página e o n8n não esperam o serviço de push.
 */
export async function avisarLeadPorPush(lead: Lead, evento: EventoDoAviso): Promise<void> {
  if (!pushConfigurado()) return;
  await enviarAviso(avisoDoLead(lead, evento, { robo: await roboLigado(lead.brand) }), evento);
}

/** O aviso de confirmação, só para o aparelho que acabou de ativar. */
export async function enviarTeste(inscricao: InscricaoPush): Promise<ResumoEnvioPush | null> {
  return enviarAviso(avisoDeTeste(), "teste", { apenas: inscricao });
}
