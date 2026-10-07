/**
 * Versão do painel. O deploy no EasyPanel só entra com o clique em Deploy, e o
 * build não enxerga o git (.git fica fora da imagem) — então a versão é uma
 * constante, atualizada em todo commit que vai para produção. É o jeito de saber,
 * sem login, se a produção está rodando o código novo: GET /api/health.
 */
export const VERSAO = "2026-10-07 · fase 0.1 (colisão de id)";
