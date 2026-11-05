/**
 * As linhas que a Fila tira da tela na hora em que o comercial age (antes de o
 * servidor responder) — puro, testado em `robo-fila.test.ts`.
 *
 * Um resolvido vale para o GRUPO em que a ação aconteceu, não para a pessoa: o id
 * (`lead:<id>`) é o mesmo em todos os grupos, e quem registra a reunião em "Aceitou
 * o convite" pode cair em "Reuniões a confirmar" no mesmo instante — esconder pelo
 * id sumia com a linha de lá, com o título contando 1. E a lista é podada a cada
 * resposta do servidor: o que ele deixou de listar naquele grupo sai dos
 * resolvidos, para a pessoa reaparecer quando voltar (a cadência, a reunião que
 * passou e virou "sem desfecho").
 */
import type { FilaEtapa, FilaGrupo, FilaItem } from "@/lib/fila";

export interface Resolvido {
  id: string;
  etapa: FilaEtapa;
}

/** A linha está escondida por um resolvido DESTE grupo? */
export function estaResolvido(resolvidos: readonly Resolvido[], item: Pick<FilaItem, "id" | "etapa">): boolean {
  return resolvidos.some((r) => r.id === item.id && r.etapa === item.etapa);
}

/** Fica só o resolvido que o servidor ainda lista no mesmo grupo (a resposta ainda não chegou). */
export function podarResolvidos(resolvidos: readonly Resolvido[], grupos: readonly Pick<FilaGrupo, "etapa" | "itens">[]): Resolvido[] {
  const listados = new Set(grupos.flatMap((g) => g.itens.map((i) => `${g.etapa}|${i.id}`)));
  return resolvidos.filter((r) => listados.has(`${r.etapa}|${r.id}`));
}
