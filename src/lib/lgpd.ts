/**
 * Máscara de contato (LGPD) — puro, sem I/O.
 *
 * O painel persiste nome, telefone e e-mail para o comercial trabalhar. O papel
 * Marketing não liga para ninguém: vê o lead, o status, a origem e o que
 * aconteceu, mas o contato chega mascarado — o bastante para reconhecer a
 * pessoa numa conversa ("o de final 1234"), não para contatá-la. Quem decide se
 * mascara é a página, pelo papel (`getCurrentUser`); aqui só se mascara.
 *
 * Mascarado é texto, não link: um `wa.me` com "•••" no meio não leva a lugar
 * nenhum, e um link que não funciona vira chamado de suporte.
 */

/** Dígitos de um telefone sem o DDI do Brasil, para o DDD aparecer na máscara. */
function digitosSemDdi(phone: string): string {
  const d = phone.replace(/\D/g, "").replace(/^0+/, "");
  return (d.length === 12 || d.length === 13) && d.startsWith("55") ? d.slice(2) : d;
}

/**
 * "(11) •••••-1234": ficam o DDD e os 4 últimos dígitos. Sem DDD (8–9 dígitos),
 * "•••••-1234"; curto demais para ser telefone, só "•••". Vazio devolve vazio —
 * quem exibe decide entre "—" e nada.
 */
export function mascararTelefone(phone?: string | null): string {
  if (!phone) return "";
  const d = digitosSemDdi(phone);
  if (d.length < 5) return "•••";
  const final = d.slice(-4);
  if (d.length >= 10) {
    return `(${d.slice(0, 2)}) ${"•".repeat(d.length - 6)}-${final}`;
  }
  return `${"•".repeat(d.length - 4)}-${final}`;
}

/** "a•••@dominio.com": a 1ª letra e o domínio ficam. Sem "@", só "•••". */
export function mascararEmail(email?: string | null): string {
  if (!email) return "";
  const e = email.trim();
  const arroba = e.indexOf("@");
  if (arroba <= 0) return "•••";
  return `${e[0]}•••${e.slice(arroba)}`;
}

export interface ComContato {
  phone?: string;
  email?: string;
}

/** O mesmo objeto com telefone e e-mail mascarados (os demais campos intactos). */
export function mascararContato<T extends ComContato>(x: T): T {
  return {
    ...x,
    ...(x.phone ? { phone: mascararTelefone(x.phone) } : {}),
    ...(x.email ? { email: mascararEmail(x.email) } : {}),
  };
}
