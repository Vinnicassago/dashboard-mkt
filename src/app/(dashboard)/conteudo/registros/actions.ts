"use server";

import { updatePostsMetaAction, type ActionState } from "@/app/(dashboard)/configuracoes/actions";

/**
 * "Marcar como teste" do recolhido "Posts iguais no mesmo dia" do Conteúdo, que
 * manda só os posts marcados. Passa pelo MESMO caminho de escrita da marcação de
 * posts em Registros: monta só os campos `test_<id>` (sem `orig_`: grava sempre)
 * e deixa `updatePostsMetaAction` conferir a
 * permissão (`data:write`), ignorar ids que não são posts da marca e gravar.
 * Campo ausente não toca o post — duração, pilar e CTA ficam como estão.
 */
export async function marcarComoTesteAction(ids: string[]): Promise<ActionState> {
  const limpos = Array.from(
    new Set((Array.isArray(ids) ? ids : []).filter((id) => typeof id === "string" && id.trim() !== "")),
  );
  if (limpos.length === 0) return { ok: false, message: "Nenhum post para marcar." };
  const fd = new FormData();
  for (const id of limpos) fd.set(`test_${id}`, "1");
  return updatePostsMetaAction(null, fd);
}
