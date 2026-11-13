import { MiniaturaDoCriativo } from "@/components/midia/miniatura";
import { Info } from "@/components/ui/info";
import type { CardDePost, MelhoresDaTela } from "@/lib/conteudo-tela";

/**
 * O cartão de UM post (§2.4): a miniatura (o MESMO client da Mídia — reel com a capa,
 * vencida ou ausente vira o quadrado do formato) e, ao lado, a legenda em UMA linha
 * (`legendaCurta`; com permalink, abre o post no Instagram — a completa nunca vai ao
 * DOM) e a linha dos números ("Reel · 08/11 · 3 salvos · 1 compart. · 42 interações"),
 * que quebra entre os "·". Nenhum `<p>` dentro do `<li>`, nenhum `title`.
 */
function Cartao({ card }: { card: CardDePost }) {
  return (
    <li className="flex min-w-0 items-start gap-3 rounded-xl border bg-card p-4 text-card-foreground shadow-sm">
      <MiniaturaDoCriativo url={card.miniatura} formato={card.formato} />
      <div className="min-w-0 flex-1 space-y-1">
        {card.href ? (
          <a
            href={card.href}
            target="_blank"
            rel="noopener noreferrer"
            className="line-clamp-1 font-medium break-words underline-offset-4 hover:text-primary hover:underline"
          >
            {card.legenda}
          </a>
        ) : (
          <span className="line-clamp-1 font-medium break-words">{card.legenda}</span>
        )}
        <span className="block text-xs text-muted-foreground">{card.linha}</span>
      </div>
    </li>
  );
}

/**
 * "OS POSTS QUE MAIS FUNCIONARAM" (Fase 5 de nov/26, §2.4): o título dá a resposta e
 * diz a chave que decidiu ("Carrossel de 23/07 lidera: 93 salvos, 67 compartilhamentos";
 * "2 posts empatam com 11 interações" no empate); até 3 cartões na ordem de
 * `melhoresDaGrade` — a MESMA que a IA lê —, uma coluna abaixo de `lg` (a 768 px, com a
 * barra lateral, o conteúdo tem ≈ 480 px). Sem post com interação, só o título.
 */
export function MelhoresPosts({ melhores }: { melhores: MelhoresDaTela }) {
  return (
    <section id="melhores" className="min-w-0 scroll-mt-24 space-y-3">
      <div className="flex items-center gap-0.5">
        <h2 data-titulo className="min-w-0 text-base font-semibold tracking-tight">
          {melhores.titulo}
        </h2>
        <Info texto={melhores.dica} rotulo="Sobre os posts que mais funcionaram" className="-my-1" />
      </div>
      {melhores.cards.length > 0 ? (
        <ul data-parte="melhores" className="grid grid-cols-1 gap-3 lg:grid-cols-3">
          {melhores.cards.map((card) => (
            <Cartao key={card.id} card={card} />
          ))}
        </ul>
      ) : null}
    </section>
  );
}
