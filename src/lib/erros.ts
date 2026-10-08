/**
 * Erro técnico → frase para a tela. Fonte ÚNICA (B14/S19).
 *
 * "TypeError: fetch failed" aparecia cru em Pessoas; erros da Graph API, em
 * Ajustes. Quem lê a tela precisa saber O QUE fazer, não o stack. O texto
 * original vai para o log do servidor (quem chama decide se loga — esta função
 * é pura e roda no cliente também).
 */

export type FonteDeErro = "Meta" | "Instagram" | "robô" | "IA" | "banco de dados" | "servidor";

function texto(erro: unknown): string {
  if (erro instanceof Error) return `${erro.name}: ${erro.message}`;
  return String(erro ?? "");
}

export function mensagemHumana(fonte: FonteDeErro, erro: unknown): string {
  const t = texto(erro).toLowerCase();

  if (/fetch failed|econnrefused|enotfound|eai_again|etimedout|timeout|network|socket hang up/.test(t)) {
    return `Não consegui falar com ${fonte === "robô" ? "o banco do robô" : `o ${fonte}`}: a conexão falhou (serviço fora do ar ou endereço errado).`;
  }
  if (/oauth|access token|session has expired|error validating|invalid token|\(#190\)|code":190|jwt/.test(t)) {
    return `${fonte}: a credencial de acesso venceu ou foi revogada — gere uma nova e atualize no servidor.`;
  }
  if (/permission|\(#10\)|\(#200\)|not authorized|forbidden|401|403/.test(t)) {
    return `${fonte}: a credencial não tem permissão para esta leitura.`;
  }
  if (/rate limit|too many|\(#4\)|\(#17\)|\(#32\)|\(#613\)|80004|429/.test(t)) {
    return `${fonte}: limite de chamadas atingido — tente de novo em alguns minutos.`;
  }
  if (/relation .* does not exist|column .* does not exist|schema cache/.test(t)) {
    return `${fonte}: a estrutura do banco não é a esperada (tabela ou coluna faltando).`;
  }
  return `${fonte} devolveu um erro inesperado (o detalhe ficou no log do servidor).`;
}
