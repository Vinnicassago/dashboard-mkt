import Link from "next/link";
import { AcoesDaGrade } from "@/components/conteudo/acoes-da-grade";
import { ContaDoInstagram } from "@/components/conteudo/conta-do-instagram";
import { MelhoresPosts } from "@/components/conteudo/melhores-posts";
import { Placar } from "@/components/conteudo/placar";
import { VariacoesParaConferir } from "@/components/conteudo/variacoes";
import { Recolhido } from "@/components/funil/recolhido";
import { PostsTable } from "@/components/tables/posts-table";
import { RolarParaAncora } from "@/components/ui/rolar-para-ancora";
import { activeBrandSlug } from "@/lib/active-brand";
import { can } from "@/lib/auth/guard";
import { carregarConteudo } from "@/lib/conteudo-server";

export const dynamic = "force-dynamic";

/**
 * Conteúdo — "A grade está em dia, e quais posts funcionaram?" Sem `?range=`, 30 dias (Fase 5 de nov/26).
 * O placar numa linha, os posts iguais no mesmo dia para conferir, os 3 posts que mais funcionaram e
 * até 2 ações da grade; o resto fica recolhido. A página só carrega (`carregarConteudo`) e renderiza.
 */
export default async function ConteudoPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string | string[]; [chave: string]: string | string[] | undefined }>;
}) {
  const brand = await activeBrandSlug();
  const sp = await searchParams;
  const r = Array.isArray(sp.range) ? sp.range[0] : sp.range;
  // Sem `?range=` o carregador resolve o padrão do Conteúdo (`PERIODO_PADRAO_DO_CONTEUDO`, 30 dias).
  const [{ conteudo: c }, podeEditar] = await Promise.all([carregarConteudo(brand, r), can("data:write")]);

  return (
    <div className="space-y-6">
      {/* Abre o <details> da âncora e rola até ela: na chegada, no hashchange e no clique em <a href="#…">. */}
      <RolarParaAncora abrirDetalhes />

      {/* 1–2. O placar em uma linha (sem régua) e, com grupo pendente, a linha dos posts iguais. */}
      <Placar placar={c.placar} variacoes={c.variacoes?.linha ?? null} />

      {/* 3. Os posts que mais funcionaram: salvos + compartilhamentos, depois interações. */}
      {c.melhores ? <MelhoresPosts melhores={c.melhores} /> : null}

      {/* 4. Até 2 ações da grade (só na marca de conversão). */}
      <AcoesDaGrade acoes={c.acoes} />

      {/* 5–7. Recolhidos: os posts iguais no mesmo dia, todos os posts e a conta. */}
      {c.variacoes ? (
        <Recolhido
          id="variacoes"
          resumo="Posts iguais no mesmo dia"
          dica={c.variacoes.dica}
          rotulo="Sobre os posts iguais no mesmo dia"
        >
          <VariacoesParaConferir
            variacoes={c.variacoes.lista}
            podeEditar={podeEditar}
            registrosHref={c.variacoes.registrosHref}
          />
        </Recolhido>
      ) : null}
      {c.todos ? (
        <Recolhido id="todos-os-posts" resumo="Todos os posts" dica={c.todos.dica} rotulo="Sobre todos os posts">
          <div className="min-w-0 space-y-3">
            <PostsTable linhas={c.todos.linhas} />
            {c.todos.producao ? (
              <p className="text-xs">
                <Link href={c.todos.producao.href} className="font-medium text-primary underline-offset-4 hover:underline">
                  Planejar a próxima peça → Produção
                </Link>
              </p>
            ) : null}
          </div>
        </Recolhido>
      ) : null}
      {c.conta ? (
        <Recolhido id="conta" resumo="Conta do Instagram" dica={c.conta.dica} rotulo="Sobre a conta do Instagram">
          <ContaDoInstagram conta={c.conta} />
        </Recolhido>
      ) : null}
    </div>
  );
}
