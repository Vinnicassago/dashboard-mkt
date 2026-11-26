/**
 * Versão do painel. O deploy no EasyPanel só entra com o clique em Deploy, e o
 * build não enxerga o git (.git fica fora da imagem) — então a versão é uma
 * constante, atualizada em todo commit que vai para produção. É o jeito de saber,
 * sem login, se a produção está rodando o código novo: GET /api/health.
 */
export const VERSAO = "2026-11-26a · API do n8n lista os leads (GET /api/n8n/leads) para o disparo do convite";
