/**
 * Versão do painel. O deploy no EasyPanel só entra com o clique em Deploy, e o
 * build não enxerga o git (.git fica fora da imagem) — então a versão é uma
 * constante, atualizada em todo commit que vai para produção. É o jeito de saber,
 * sem login, se a produção está rodando o código novo: GET /api/health.
 */
export const VERSAO = "2026-11-03c · live 01/12 · página manda as respostas, CAPI de qualificado e comunidade, textos das tarefas, reunião na ficha, A e B sem reunião";
