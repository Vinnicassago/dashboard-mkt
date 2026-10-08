import "server-only";
import { getState, setState } from "./data/store";

/**
 * Integrações que são ESCOLHA OPERACIONAL, não só credencial (D5).
 *
 * O robô de WhatsApp e o atendimento do especialista estão parados. Com as
 * credenciais ainda no servidor, o painel tentava ler, falhava ("fetch failed")
 * e tratava a ausência como erro: "SEM LEITURA" na home, "fila incompleta" na
 * Fila, detalhe técnico em Pessoas. Desativado é outra coisa — as etapas dele
 * simplesmente não existem. Religar é uma chave em Ajustes.
 */

const CHAVE_ROBO_DESATIVADO = "robo_desativado";

export async function roboDesativado(): Promise<boolean> {
  return (await getState<boolean>(CHAVE_ROBO_DESATIVADO)) === true;
}

export async function setRoboDesativado(desativado: boolean): Promise<void> {
  await setState(CHAVE_ROBO_DESATIVADO, desativado);
}

/** Modelo da mensagem do WhatsApp na Fila. `{nome}` vira o primeiro nome. */
const CHAVE_MENSAGEM_WHATSAPP = "mensagem_whatsapp";

export const MENSAGEM_WHATSAPP_PADRAO =
  "Olá, {nome}! Tudo bem? Recebemos o seu cadastro sobre consórcio e quero te ajudar. Você pode falar agora?";

export async function mensagemWhatsapp(): Promise<string> {
  const m = await getState<string>(CHAVE_MENSAGEM_WHATSAPP);
  return m && m.trim() ? m : MENSAGEM_WHATSAPP_PADRAO;
}

export async function setMensagemWhatsapp(texto: string): Promise<void> {
  await setState(CHAVE_MENSAGEM_WHATSAPP, texto.trim());
}
