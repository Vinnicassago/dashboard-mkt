import { CHART } from "@/components/charts/colors";
import { MiniaturaDoCriativo } from "@/components/midia/miniatura";
import { SeloDoSinal } from "@/components/midia/selo-do-sinal";
import { Info } from "@/components/ui/info";
import type { CardDoCriativo, CriativosNoArDaTela } from "@/lib/midia-tela";
import { cn } from "@/lib/utils";

const largura = (v: number) => `${Math.round(Math.max(0, Math.min(1, v)) * 1000) / 10}%`;

function Barra({ v, cor }: { v: number; cor: string }) {
  return (
    <span aria-hidden="true" className="mt-1 block h-1 overflow-hidden rounded-full bg-foreground/[0.06]">
      <span className="block h-full rounded-full" style={{ width: largura(v), backgroundColor: cor }} />
    </span>
  );
}

const TH = "pb-1 pr-2 text-left font-normal text-muted-foreground";
const TD = "pr-2 align-top tabular-nums";

/**
 * O cartão de UM criativo no ar (§2.4, K30/K31): miniatura e, ao lado, o nome (≤ 8
 * palavras, duas linhas no máximo), a desambiguação dos homônimos numa linha própria e,
 * numa linha só dele, o selo do sinal com o ⓘ (motivo, regra e robô) — o selo não
 * divide a linha com o nome: a 375 px (e nas 2–3 colunas de `lg`/`2xl`) ele deixava ao
 * nome ≈ 90 px, e o que distingue dois criativos sumia no corte. Embaixo, na largura
 * inteira do cartão, a mini-tabela dos números e, com o robô, a da resposta; por
 * último, a linha (a ressalva do candidato ou o motivo). Nenhum `<p>` dentro do `<li>`.
 */
function Cartao({ card, colunasDoRobo }: { card: CardDoCriativo; colunasDoRobo: boolean }) {
  const n = card.numeros;
  return (
    <li className="min-w-0 space-y-3 rounded-xl border bg-card p-4 text-card-foreground shadow-sm">
      <div className="flex items-start gap-3">
        <MiniaturaDoCriativo url={card.miniatura} formato={card.formato} />
        <div className="min-w-0 flex-1 space-y-1">
          <span className="line-clamp-2 font-medium break-words">{card.nome}</span>
          {card.desambiguacao ? (
            <span className="block text-xs break-words text-muted-foreground">{card.desambiguacao}</span>
          ) : null}
          <span className="flex items-center">
            <SeloDoSinal rotulo={card.sinal.rotulo} tom={card.sinal.tom} />
            <Info texto={card.dica} rotulo={`Sobre o sinal de ${card.nomeCompleto}`} className="-my-1" />
          </span>
        </div>
      </div>

      <table className="w-full table-fixed text-xs">
        <colgroup>
          <col className="w-[22%]" />
          <col className="w-[14%]" />
          <col className="w-[24%]" />
          <col className="w-[20%]" />
          <col className="w-[20%]" />
        </colgroup>
        <thead>
          <tr>
            <th className={TH}>Gasto</th>
            <th className={TH}>Leads</th>
            <th className={TH}>CPL</th>
            <th className={TH}>% verba</th>
            <th className={cn(TH, "pr-0")}>% leads</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td className={cn(TD, "whitespace-nowrap")}>{n.gasto}</td>
            <td className={cn(TD, "whitespace-nowrap")}>{n.leads}</td>
            <td className={TD}>
              <span className="block whitespace-nowrap">{n.cpl}</span>
              {n.razao ? <span className="block whitespace-nowrap text-muted-foreground">{n.razao}</span> : null}
            </td>
            <td className={TD}>
              <span className="block whitespace-nowrap">{n.pctVerba}</span>
              <Barra v={n.barraVerba} cor={CHART.primary} />
            </td>
            <td className={cn(TD, "pr-0")}>
              <span className="block whitespace-nowrap">{n.pctLeads}</span>
              <Barra v={n.barraLeads} cor={CHART.series[1]} />
            </td>
          </tr>
        </tbody>
      </table>

      {colunasDoRobo && card.robo ? (
        <table className="w-full table-fixed text-xs">
          <thead>
            <tr>
              <th className={TH}>Responderam</th>
              <th className={TH}>Aceitaram</th>
              <th className={cn(TH, "pr-0")}>Sem WhatsApp</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td className={cn(TD, "whitespace-nowrap")}>{card.robo.responderam}</td>
              <td className={cn(TD, "whitespace-nowrap")}>{card.robo.aceitaram}</td>
              <td className={cn(TD, "whitespace-nowrap pr-0")}>{card.robo.semWhatsapp}</td>
            </tr>
          </tbody>
        </table>
      ) : null}

      {card.linha ? <div className="text-xs text-muted-foreground">{card.linha}</div> : null}
    </li>
  );
}

/**
 * "CRIATIVOS NO AR" (Fase 4, §2.4): o título dá a resposta ("5 criativos no ar · 1
 * candidato a escalar"); a leitura do robô parada, quando houver, é uma linha entre o
 * título e a lista; até 5 cartões numa grade de 1 coluna abaixo de `lg` (a 768 px o
 * conteúdo tem ≈ 480 px); com mais, "Ver todos os N criativos →" leva à tabela de
 * Detalhes (um `<a>` simples: o `RolarParaAncora` abre o recolhido no clique, K27).
 */
export function CriativosNoAr({ criativos, colunasDoRobo }: { criativos: CriativosNoArDaTela; colunasDoRobo: boolean }) {
  const c = criativos;
  return (
    <section id="criativos" className="min-w-0 scroll-mt-24 space-y-3">
      <div className="flex items-center gap-0.5">
        <h2 data-titulo className="min-w-0 text-base font-semibold tracking-tight">
          {c.titulo}
        </h2>
        <Info texto={c.dica} rotulo="Sobre os criativos no ar" className="-my-1" />
      </div>
      {c.leituraParada ? (
        <p data-parte="robo" className="text-xs font-medium text-[var(--status-perto-text)]">
          {c.leituraParada}
        </p>
      ) : null}
      {c.cards.length > 0 ? (
        <ul data-parte="criativos" className="grid grid-cols-1 gap-3 lg:grid-cols-2 2xl:grid-cols-3">
          {c.cards.map((card) => (
            <Cartao key={card.chave} card={card} colunasDoRobo={colunasDoRobo} />
          ))}
        </ul>
      ) : null}
      {c.verTodos ? (
        <p data-parte="ver-todos" className="text-sm">
          <a href={c.verTodos.href} className="font-medium text-primary underline-offset-4 hover:underline">
            {c.verTodos.texto}
          </a>
        </p>
      ) : null}
    </section>
  );
}
