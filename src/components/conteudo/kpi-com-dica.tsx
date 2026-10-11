import { KpiCard } from "@/components/kpi/kpi-card";

/**
 * KpiCard com o ⓘ da definição (princípio 9 do relatório: explicação em dica,
 * não em parágrafo). A definição vai no `title` — o mesmo mecanismo das colunas
 * do Funil e da Mídia — e o rótulo ganha o ⓘ para a pessoa saber que há o que
 * ler. Server component: recebe só o que o KpiCard recebe.
 */
export function KpiComDica({
  dica,
  label,
  ...rest
}: React.ComponentProps<typeof KpiCard> & { dica: string }) {
  return (
    <div title={dica} className="flex flex-col [&>*]:flex-1">
      <KpiCard label={`${label} ⓘ`} {...rest} />
    </div>
  );
}
