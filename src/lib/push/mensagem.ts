/**
 * A mensagem que o service worker (`public/sw.js`) manda às abas abertas do painel
 * quando chega o aviso de um lead: a aba se atualiza sozinha
 * (`components/layout/atualizar-com-aviso.tsx`). Arquivo à parte, sem import, para
 * o client não carregar o resto de `push/`. O `sw.js` não importa TypeScript: ele
 * repete o texto, e `push-avisos.test.ts` confere que os dois são o mesmo.
 */
export const MENSAGEM_LEAD_NOVO = "painel:lead-novo";
