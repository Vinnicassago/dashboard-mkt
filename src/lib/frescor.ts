/**
 * De quando é o dado de cada fonte — o que o cabeçalho mostra. Puro.
 *
 * Antes o cabeçalho dizia "atualizado em" com o `updated_at` global, regravado
 * a cada escrita — inclusive cada visita à landing page. A Meta podia estar
 * falhando havia dias e o painel dizia "agora". Aqui cada fonte fala por si,
 * com a hora do último sync que DEU CERTO.
 */

export type NivelFrescor = "ok" | "velho" | "muito-velho";

export interface Frescor {
  fonte: string;
  /** "07/10 09:00" em Brasília, ou "nunca". */
  quando: string;
  nivel: NivelFrescor;
  /** Frase para o title (passar o mouse). */
  detalhe: string;
}

/** Acima disso o dado está velho (o cron é diário; a Meta atrasa até 48 h). */
export const HORAS_VELHO = 26;
export const HORAS_MUITO_VELHO = 50;

const fmt = new Intl.DateTimeFormat("pt-BR", {
  timeZone: "America/Sao_Paulo",
  day: "2-digit",
  month: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
});

export function frescorDaFonte(fonte: string, iso: string | null, agora: Date = new Date()): Frescor {
  if (!iso) {
    return { fonte, quando: "nunca", nivel: "muito-velho", detalhe: `${fonte}: nenhuma sincronização deu certo ainda.` };
  }
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) {
    return { fonte, quando: "—", nivel: "muito-velho", detalhe: `${fonte}: data de sincronização ilegível.` };
  }
  const horas = (agora.getTime() - t) / 3_600_000;
  const nivel: NivelFrescor =
    horas > HORAS_MUITO_VELHO ? "muito-velho" : horas > HORAS_VELHO ? "velho" : "ok";
  const quando = fmt.format(new Date(t)).replace(",", "");
  const detalhe =
    nivel === "ok"
      ? `${fonte}: último sync que deu certo em ${quando}.`
      : `${fonte}: o último sync que deu certo foi em ${quando} — há ${Math.floor(horas)} h. Os números dessa fonte podem estar desatualizados.`;
  return { fonte, quando, nivel, detalhe };
}
