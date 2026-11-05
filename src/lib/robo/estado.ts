import "server-only";
import { estadoDaFonte, type EstadoFonte } from "../sincronizacao";
import { DEFAULT_BRAND } from "../types";
import { isRoboConfigured, roboLigado } from "./client";

/**
 * O estado do robô AGORA, numa marca — a função ÚNICA que todos os leitores
 * usam (Fila, Início, motor, Leads, exportação, ficha, layout, Integrações e o
 * aviso de resgate), para que o número da Fila seja o mesmo do Início e do alerta.
 *
 * `ligado` = credencial presente, não desativado em Configurações e marca do
 * robô (só a padrão: o sync casa só os leads dela). Desligado não toca o store
 * além da chave "desativado" — e nem ela quando não há credencial ou a marca é
 * outra.
 *
 * `lidoAte` = fim da última leitura ok (o que o robô fez depois disso o painel
 * ainda não sabe). `confiavel` = há leitura ok de até `LEITURA_CONFIAVEL_H`: as
 * regras de tempo medem contra `lidoAte` só quando confiável; senão, contra agora
 * (ninguém fica sem dono quando a leitura para).
 */
export interface EstadoDoRobo {
  ligado: boolean;
  lidoAte: string | null;
  confiavel: boolean;
  sync: EstadoFonte;
}

/** Leitura de até 2 h vale como referência das regras de tempo. */
export const LEITURA_CONFIAVEL_H = 2;

const DESLIGADO: EstadoDoRobo = { ligado: false, lidoAte: null, confiavel: false, sync: { ultimoOk: null, falha: null } };

export async function estadoDoRoboAgora(brand: string, agora: Date = new Date()): Promise<EstadoDoRobo> {
  // A marca e a credencial primeiro, sem tocar o store; depois a MESMA regra do
  // sync e da carona (`roboLigado`) — uma condição nova lá vale aqui também.
  if (!isRoboConfigured() || brand !== DEFAULT_BRAND) return { ...DESLIGADO, sync: { ...DESLIGADO.sync } };
  if (!(await roboLigado())) return { ...DESLIGADO, sync: { ...DESLIGADO.sync } };
  const sync = await estadoDaFonte("robo", DEFAULT_BRAND);
  const lidoAte = sync.ultimoOk;
  const t = lidoAte ? Date.parse(lidoAte) : NaN;
  const confiavel = Number.isFinite(t) && agora.getTime() - t <= LEITURA_CONFIAVEL_H * 3_600_000;
  return { ligado: true, lidoAte, confiavel, sync };
}
