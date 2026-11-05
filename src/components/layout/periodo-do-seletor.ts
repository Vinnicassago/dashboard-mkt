import { RANGE_PRESETS, parseCustomRange, rangeLabel } from "@/lib/range";

/**
 * O que o seletor de período do cabeçalho mostra — puro, sem React, para o
 * teste conferir as regras do atalho da live (Fase 2, C10) sem montar a tela.
 *
 * - Presets: aceso o que é igual à chave atual (sem `?range=`, a página diz o
 *   padrão dela: o Início olha a semana).
 * - Atalho da live (`atalhoDaLive`, `lib/atalho-live.ts`): o botão aparece
 *   enquanto `visivel`; com `current === chave` ele aparece ACESO mostrando o
 *   nome da régua MESMO depois do fim (o painel da live continua abrindo pela
 *   chave) e o "Escolher" NÃO acende.
 * - "Escolher" acende com qualquer outro período livre (captação e pós-live
 *   inclusive: mostram as datas, como qualquer período livre). Com qualquer das
 *   três chaves da live o popover abre VAZIO — as datas da régua não são um
 *   ponto de partida (o "De" da live pode estar no futuro, e o campo não aceita).
 * - Abaixo de `2xl` (1536 px: celular, tablet e notebook) o seletor é UM botão com
 *   o rótulo atual (`rotuloAtual`) abrindo a `lista` vertical — os sete botões em
 *   linha não cabem no cabeçalho com o menu do usuário e a data do dado.
 */

export interface AtalhoDoSeletor {
  /** A chave do período livre da campanha da live (`buildCustomKey(de, ate)`). */
  chave: string;
  /** O nome da régua (`cfg.nome`, "Live 01/12"). */
  rotulo: string;
  /** O botão aparece (até o último dia da régua; nunca em marca awareness). */
  visivel: boolean;
}

export type TipoDaOpcao = "preset" | "live" | "escolher";

export interface OpcaoDoSeletor {
  /** Estável: a chave do preset, `"live"` ou `"escolher"`. */
  id: string;
  tipo: TipoDaOpcao;
  /** O texto do botão. */
  rotulo: string;
  /** O texto inteiro (o atalho é truncado em linha). */
  titulo?: string;
  /** A chave de período que o clique aplica (`escolher` abre o popover: sem chave). */
  chave?: string;
  ativo: boolean;
}

export interface EstadoDoSeletor {
  /** De `2xl` para cima, em linha: Campanha · <atalho> · 90 · 30 · 14 · 7 dias · Escolher. */
  emLinha: OpcaoDoSeletor[];
  /** Abaixo de `2xl`, a lista do botão único: Campanha · 90 · 30 · 14 · 7 dias · <atalho> · Escolher… */
  lista: OpcaoDoSeletor[];
  /** O rótulo do botão único (abaixo de `2xl`: "Live 01/12", "7 dias", "16/11 a 01/12"). */
  rotuloAtual: string;
  /** O período atual é o atalho da live (a campanha inteira dela). */
  liveAtiva: boolean;
  /** "Escolher" aceso: um período livre que não é o atalho. */
  escolherAceso: boolean;
  /** Com que datas o popover abre — vazias com qualquer das três chaves da live. */
  popover: { de: string; ate: string; vazio: boolean };
}

/**
 * O estado do seletor para a chave atual. `atalho` é `null` sem régua (marca
 * awareness ou leitura falhou); `chavesDaLive` são as três janelas da régua
 * (campanha, captação, pós-live).
 */
export function estadoDoSeletor(
  current: string,
  atalho: AtalhoDoSeletor | null | undefined,
  chavesDaLive: readonly string[] = [],
): EstadoDoSeletor {
  const liveAtiva = atalho != null && current === atalho.chave;
  const custom = parseCustomRange(current);
  const escolherAceso = custom != null && !liveAtiva;
  const vazio = chavesDaLive.includes(current) || liveAtiva;
  const presets: OpcaoDoSeletor[] = RANGE_PRESETS.map((p) => ({
    id: p.key,
    tipo: "preset",
    rotulo: p.label,
    chave: p.key,
    ativo: current === p.key,
  }));
  const live: OpcaoDoSeletor[] =
    atalho && (atalho.visivel || liveAtiva)
      ? [{ id: "live", tipo: "live", rotulo: atalho.rotulo, titulo: atalho.rotulo, chave: atalho.chave, ativo: liveAtiva }]
      : [];
  const escolher = (rotulo: string): OpcaoDoSeletor => ({
    id: "escolher",
    tipo: "escolher",
    rotulo,
    ativo: escolherAceso,
  });
  const [campanha, ...dias] = presets;

  const preset = RANGE_PRESETS.find((p) => p.key === current);
  const rotuloAtual = liveAtiva
    ? (atalho as AtalhoDoSeletor).rotulo
    : preset
      ? preset.label
      : custom
        ? rangeLabel(current)
        : // Chave inválida: a página resolve como a campanha inteira.
          RANGE_PRESETS[0].label;

  return {
    emLinha: [campanha, ...live, ...dias, escolher(escolherAceso ? rangeLabel(current) : "Escolher")],
    // Na lista o "Escolher…" não repete as datas: o botão único já as mostra.
    lista: [campanha, ...dias, ...live, escolher("Escolher…")],
    rotuloAtual,
    liveAtiva,
    escolherAceso,
    popover: vazio ? { de: "", ate: "", vazio: true } : { de: custom?.from ?? "", ate: custom?.to ?? "", vazio: false },
  };
}
