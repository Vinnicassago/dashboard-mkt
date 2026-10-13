import { AlertTriangle, ShieldAlert } from "lucide-react";
import { MotivosTable } from "@/components/robo/robo-tables";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ChartCard } from "@/components/ui/chart-card";
import { VistaToggle } from "@/components/funil/vista-toggle";
import { FunilConversao } from "@/components/funil/funil-conversao";
import { FunilDescoberta } from "@/components/funil/funil-descoberta";
import { TendenciaChart } from "@/components/funil/tendencia-chart";
import { CoortesTable } from "@/components/funil/coortes-table";
import { PerdasTable } from "@/components/funil/perdas-table";
import { NotasMedicao } from "@/components/funil/notas-medicao";
import { getData, listLeadEvents } from "@/lib/data/store";
import { activeBrandSlug } from "@/lib/active-brand";
import { pageRange } from "@/lib/page-range";
import { resolveMetaBrands } from "@/lib/meta/config";
import { coberturaDeAnuncios } from "@/lib/sincronizacao";
import { kpisDoPeriodo, periodoDaRegua } from "@/lib/kpis";
import { gargalo, transicoesDoFunil } from "@/lib/gargalo";
import { hojeEmBrasilia } from "@/lib/range";
import { dica } from "@/lib/dicionario";
import { alertasDeAtribuicao, alertasDeConfianca } from "@/lib/alertas";
import { RegistrarAlertas } from "@/components/layout/alertas";
import { getCascataFontes, getRoboSnapshot } from "@/lib/robo/client";
import {
  confiancaDoRegistro,
  coortesDoFunil,
  fraseDoGargalo,
  funilDeDescoberta,
  montarFunil,
  notasDeMedicao,
  perdasConfiaveis,
  tendenciaDasTaxas,
  vistaDoFunil,
} from "@/lib/funil";
import { formatCurrency0, formatDecimal, formatInt, formatarEspera, formatPercentValue } from "@/lib/format";

export const dynamic = "force-dynamic";

/** Média que pode não existir ainda (robô sem nenhuma transferência). */
function media(v: number | null | undefined): string {
  return v == null ? "—" : formatDecimal(v, 1);
}

/** Horas médias do robô → a mesma escrita de espera do resto do painel. */
const horas = (n: number | null) => formatarEspera(n);

/** Semanas da tendência (o relatório pede 10–12). */
const SEMANAS_TENDENCIA = 12;

/**
 * Funil — onde exatamente estamos perdendo reuniões (7.1 do relatório).
 *
 * Abre com a resposta: o gargalo, com dono e impacto — o MESMO da Bússola. Em
 * seguida, dois funis com escopo próprio (conversão × descoberta), a alternância
 * período × coorte, a tendência das três taxas, as coortes semana a semana, as
 * perdas confiáveis e, recolhidas, as notas de medição. O robô aparece quando
 * está ligado; "Receita e retorno" fecha a página.
 */
export default async function FunilPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string; vista?: string }>;
}) {
  const brand = await activeBrandSlug();
  const data = await getData(brand);
  const sp = await searchParams;
  const { range, rangeKey } = pageRange(data, sp.range);
  const vista = vistaDoFunil(sp.vista);
  const agoraDate = new Date();
  const agora = agoraDate.toISOString();
  const hoje = hojeEmBrasilia(agoraDate);

  const [brandRules, cobertura, fontes, robo, eventos] = await Promise.all([
    resolveMetaBrands(),
    coberturaDeAnuncios(brand),
    getCascataFontes(),
    getRoboSnapshot(range?.from),
    listLeadEvents({ brand, limit: 0 }),
  ]);

  // Os MESMOS números da home e da Mídia (kpisDoPeriodo), com Δ do período anterior.
  const kp = kpisDoPeriodo(data, range, { brandRules, cobertura, comparar: true, hoje, agora });
  const k = kp.overview;

  // A resposta: o gargalo da Bússola, calculado do mesmo jeito.
  const transicoes = transicoesDoFunil(data, range, kp, { agora, hoje });
  const g = gargalo(transicoes, periodoDaRegua(data, range, hoje));
  const resposta = fraseDoGargalo(g);

  const funil = montarFunil({ data, range, kpis: kp, robo: fontes.robo, comercial: fontes.comercial, vista, hoje, agora });
  const descoberta = funilDeDescoberta(data, range, kp);
  const tendencia = tendenciaDasTaxas(data, hoje, SEMANAS_TENDENCIA, agora);
  const coortes = coortesDoFunil(data, range, { agora, hoje, cobertura });
  const perdas = perdasConfiaveis(data, range, eventos);
  const confianca = confiancaDoRegistro(data, range, eventos);
  const notas = notasDeMedicao({ data, range, kpis: kp, cascata: funil.cascata });

  const parcial = fontes.falha?.tipo === "erro";
  const semRobo = fontes.falha?.tipo === "desligado";
  const ex = perdas.excluidos;
  const excluidos = [
    ex.testes > 0 ? `${formatInt(ex.testes)} ${ex.testes === 1 ? "teste" : "testes"}` : "",
    ex.duplicados > 0 ? `${formatInt(ex.duplicados)} ${ex.duplicados === 1 ? "duplicado" : "duplicados"}` : "",
    ex.comReuniao > 0 ? `${formatInt(ex.comReuniao)} ${ex.comReuniao === 1 ? "encerrado depois de ter reunião" : "encerrados depois de ter reunião"}` : "",
  ].filter(Boolean);

  return (
    <div className="space-y-6">
      <RegistrarAlertas alertas={[...alertasDeConfianca(kp.trust.travas), ...alertasDeAtribuicao(data, range)]} />

      {/* 1. A resposta — o mesmo gargalo da Bússola, com dono e impacto. */}
      <p className="max-w-3xl text-base leading-relaxed">
        <span className={g ? "font-semibold text-[var(--status-fora-text)]" : "font-semibold"}>
          {g ? "► " : ""}
          {resposta.titulo}
        </span>{" "}
        <span className="text-muted-foreground">{resposta.detalhe}</span>
      </p>

      {/* 2. Período × coorte — a vista viaja na URL, o período fica. */}
      <VistaToggle vista={vista} />

      {parcial ? (
        <Card className="border-[var(--warning)]/40">
          <CardContent className="flex items-start gap-3 p-4">
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-[var(--warning-text)]" />
            <p className="text-sm text-muted-foreground">
              <span className="font-medium text-foreground">O funil está truncado.</span> Não consegui ler o robô,
              então ele termina nos leads — o fundo do funil não está aqui, e não é porque não aconteceu.
            </p>
          </CardContent>
        </Card>
      ) : null}

      {/* 3. Dois funis, cada um com o seu escopo. */}
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Funil de conversão</CardTitle>
            <CardDescription>
              Só campanhas de conversão: custo por unidade sobre{" "}
              <span title={dica("investimento_conversao")}>{formatCurrency0(funil.investimentoConversao)} de verba de conversão</span>.
              Cada etapa reparte o mesmo dinheiro — não some entre linhas. Acima de Leads a base são impressões.
              {vista === "periodo"
                ? " De Leads para baixo, cada etapa conta o que aconteceu no período, com leads de qualquer data — não são frações umas das outras, então não há “% da anterior” (a taxa lead → reunião está na vista por coorte)."
                : " De Leads para baixo, os leads que entraram no período são 100%; a taxa de reuniões é sobre eles — o 1º contato é ramo paralelo, porque há quem agende sem tentativa registrada."}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {/* O robô/atendimento, quando ligado, vem como bloco separado — com a nota de que é campanha inteira. */}
            <FunilConversao etapas={funil.etapas} bloco={funil.bloco} rangeKey={rangeKey} />
            {semRobo ? (
              <p className="mt-4 border-t pt-4 text-xs text-muted-foreground">
                O robô de WhatsApp não está conectado, então o funil termina no painel do lead. Com ele ligado, as
                etapas de conversa, convite e transferência ao especialista aparecem num bloco à parte, abaixo.
              </p>
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Funil de descoberta</CardTitle>
            <CardDescription>
              A conta do Instagram no período — alcance, visitas ao perfil e seguidores. Outro escopo: a verba de descoberta
              não entra no CPL nem no custo por reunião.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <FunilDescoberta funil={descoberta} />
          </CardContent>
        </Card>
      </div>

      {/* 4. Tendência semanal das três taxas. */}
      <ChartCard
        title="Tendência semanal das taxas"
        description={`Últimas ${SEMANAS_TENDENCIA} semanas (segunda a domingo): visita → lead, lead → 1º contato no prazo e lead → agendada, cada ponto com os KPIs daquela semana. A última semana ainda não fechou; semana sem denominador fica sem ponto.`}
      >
        <TendenciaChart data={tendencia} />
      </ChartCard>

      {/* 5. Coortes — todas as semanas, inclusive as de 0 lead. */}
      {coortes.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Coorte por semana de entrada</CardTitle>
            <CardDescription>
              O que aconteceu com os leads de cada semana, em qualquer data. Semana sem lead aparece com 0 e o motivo;
              coortes sombreadas ainda estão maturando — não compare a conversão delas com as semanas mais antigas.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <CoortesTable coortes={coortes} />
          </CardContent>
        </Card>
      ) : null}

      {/* 6. Perdas, confiáveis. */}
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="space-y-1">
              <CardTitle>Por que perdemos</CardTitle>
              <CardDescription>
                {formatInt(perdas.total)} {perdas.total === 1 ? "lead encerrado" : "leads encerrados"} sem nunca ter tido
                reunião, de {formatInt(perdas.base)} que entraram no período
                {excluidos.length > 0 ? ` (fora da conta: ${excluidos.join(", ")})` : ""}.
              </CardDescription>
            </div>
            {confianca.baixa ? (
              <Badge variant="warning" title={confianca.texto}>
                Baixa confiança no registro: {formatPercentValue(confianca.share * 100, 0)} em lote ou com atraso
              </Badge>
            ) : confianca.total > 0 ? (
              <span className="text-xs text-muted-foreground" title={confianca.texto}>
                registro: {formatPercentValue(confianca.share * 100, 0)} suspeito em {formatInt(confianca.total)}
              </span>
            ) : null}
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <PerdasTable linhas={perdas.linhas} />
          <p className="text-xs leading-relaxed text-muted-foreground">
            <span className="font-medium text-foreground">Onde atacar, pela regra:</span> “Sem resposta” aponta para o
            comercial quando houve menos de 3 tentativas ou a 1ª tentativa saiu depois de 1 hora útil; só com 3 ou mais
            tentativas, a primeira no prazo, aponta para mídia/formulário. “Contato inválido” abre pelo motivo registrado.
            “Não tem interesse” e “Desistência” são oferta e pitch.
            {perdas.semTentativa > 0
              ? ` ${formatInt(perdas.semTentativa)} “Sem resposta” não ${perdas.semTentativa === 1 ? "tem" : "têm"} nenhuma tentativa registrada — sem tentativa, ninguém sabe se a pessoa responderia.`
              : ""}
            {confianca.baixa
              ? ` ${confianca.texto}: registro tardio distorce o 1º contato, a taxa lead → reunião e a comparação entre semanas.`
              : ""}
          </p>
        </CardContent>
      </Card>

      {/* 7. Notas de medição, recolhidas. */}
      <NotasMedicao notas={notas} />

      {/* 8. Dentro do robô — só com o robô ligado. */}
      {robo.kpis ? (
        <Card id="robo" className="scroll-mt-24">
          <CardHeader>
            <CardTitle>Dentro do robô: onde cada conversa parou</CardTitle>
            <CardDescription>
              A decisão que o robô registrou no último turno de cada lead. Score baixo com muitos turnos costuma indicar
              pergunta que não gera sinal.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted-foreground">
              <span>
                Score médio {media(robo.kpis.score_medio)} · {media(robo.kpis.score_medio_transferidos)} entre os transferidos
              </span>
              <span>
                Da saudação à transferência: {horas(robo.kpis.horas_medias_ate_transferir)},{" "}
                {media(robo.kpis.turnos_medios_ate_transferir)} turnos em média
              </span>
            </p>

            <MotivosTable rows={robo.motivos} />

            {robo.saude ? (
              <div className="space-y-3 border-t pt-4">
                <p className="flex items-center gap-2 text-sm font-medium">
                  <ShieldAlert className="size-4 text-muted-foreground" />
                  Saúde do robô
                </p>
                <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
                  <div>
                    <p className="text-xs text-muted-foreground">Respostas enviadas</p>
                    <p className="mt-1 text-xl font-semibold tabular">{formatInt(robo.saude.respostas_robo)}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Corrigidas pelo filtro</p>
                    <p className="mt-1 text-xl font-semibold tabular">{formatPercentValue(robo.saude.taxa_bloqueio)}</p>
                    <p className="text-xs text-muted-foreground">{formatInt(robo.saude.respostas_bloqueadas)} respostas</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Convite fora de hora</p>
                    <p className="mt-1 text-xl font-semibold tabular">
                      {formatInt(robo.saude.bloq_convite + robo.saude.convite_removido)}
                    </p>
                    <p className="text-xs text-muted-foreground">removido antes de enviar</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Sem identificação</p>
                    <p className="mt-1 text-xl font-semibold tabular">{formatInt(robo.saude.pendencias_identidade)}</p>
                    <p className="text-xs text-muted-foreground">leads a reconciliar</p>
                  </div>
                </div>
              </div>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      {/* Receita e retorno — o fim da jornada, só quando há cliente/receita */}
      {k.clients > 0 || k.revenue > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Receita e retorno</CardTitle>
            <CardDescription>
              Dos leads que entraram no período. CAC = gasto de conversão ÷ clientes · ROAS = receita ÷ investimento total ·
              valor por reunião = receita ÷ quem agendou.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
              {[
                { label: "Clientes", value: formatInt(k.clients) },
                { label: "Receita", value: formatCurrency0(k.revenue) },
                // Custo com denominador zero não existe: "—", nunca "R$ 0".
                { label: "CAC", value: k.clients > 0 && k.spendConversao > 0 ? formatCurrency0(k.cac) : "—" },
                { label: "ROAS", value: k.spend > 0 ? `${formatDecimal(k.roas, 2)}×` : "—" },
                { label: "Ticket médio", value: k.clients > 0 ? formatCurrency0(k.ticket) : "—" },
                { label: "Valor / reunião", value: k.meetingsCoorte > 0 ? formatCurrency0(k.valuePerMeeting) : "—" },
              ].map((s) => (
                <div key={s.label}>
                  <p className="text-xs text-muted-foreground">{s.label}</p>
                  <p className="text-2xl font-semibold tabular">{s.value}</p>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
