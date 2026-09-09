/**
 * Pareamento de telefone — fonte ÚNICA.
 *
 * O lead do painel vem do rastreio da landing page; o do robô vem do WhatsApp.
 * Os dois vivem em bancos diferentes e o telefone é o único campo em comum, então
 * é por ele que casamos. Como o mesmo número aparece com e sem DDI, com e sem o
 * nono dígito, comparar string crua erra — e um erro aqui não é cosmético: é uma
 * reunião que não chega ao funil, ou a mesma pessoa contada duas vezes na fila.
 *
 * Puro, sem I/O. Usado pela ponte do Comercial e pela dedupe da Fila.
 */

/** Só dígitos, com DDI 55 quando o número vier sem ele. */
export function normalizarTelefone(phone: string): string {
  let d = phone.replace(/\D/g, "").replace(/^0+/, "");
  if (d.length >= 10 && d.length <= 11) d = `55${d}`;
  return d;
}

/**
 * Grafias equivalentes do mesmo número: 5511955008549 e 551155008549 são a
 * mesma pessoa (o nono dígito foi adicionado aos celulares em datas diferentes
 * por DDD, então bases antigas convivem com as duas formas).
 */
export function variantesTelefone(d: string): string[] {
  const set = new Set([d]);
  if (d.startsWith("55") && d.length >= 12) {
    const ddd = d.slice(2, 4);
    const resto = d.slice(4);
    if (resto.length === 9 && resto.startsWith("9")) set.add(`55${ddd}${resto.slice(1)}`);
    if (resto.length === 8) set.add(`55${ddd}9${resto}`);
  }
  return [...set];
}

/** Os dois telefones são da mesma pessoa? */
export function mesmoTelefone(a?: string | null, b?: string | null): boolean {
  if (!a || !b) return false;
  const alvos = new Set(variantesTelefone(normalizarTelefone(a)));
  return variantesTelefone(normalizarTelefone(b)).some((v) => alvos.has(v));
}

/**
 * Chave canônica para agrupar/deduplicar por telefone: a menor variante, para
 * que as duas grafias do mesmo número caiam na mesma chave.
 */
export function chaveTelefone(phone?: string | null): string | null {
  if (!phone) return null;
  const vars = variantesTelefone(normalizarTelefone(phone));
  return vars.sort()[0] ?? null;
}
