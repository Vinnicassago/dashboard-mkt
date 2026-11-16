import Link from "next/link";
import { notFound } from "next/navigation";
import { AlertTriangle, ArrowLeft, Mail, MessageCircle } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Info } from "@/components/ui/info";
import { StatusBadge } from "@/components/tables/lead-status";
import { DeletedLeads } from "@/components/leads/leads-directory";
import { DescricaoEvento } from "@/components/leads/lead-activity";
import { FichaAcoes } from "@/components/leads/ficha-acoes";
import { getData, getLead, listCapiEnvios, listLeadEvents } from "@/lib/data/store";
import { can } from "@/lib/auth/guard";
import { getCurrentUser } from "@/lib/auth/current-user";
import { mensagemWhatsapp } from "@/lib/integracoes";
import { resumoContato, quando, tentativasDoLead } from "@/lib/contato";
import { FichaQualificacao } from "@/components/leads/ficha-qualificacao";
import { ClasseBadge } from "@/components/leads/classe-badge";
import { ReuniaoNaFicha } from "@/components/leads/reuniao-ficha";
import { mensagemDaVespera, resultadoDaReuniao } from "@/lib/reuniao";
import {
  RESULTADOS_CONTATO,
  STATUS_ATENDIMENTO,
  STATUS_MSG1,
  STATUS_REUNIAO,
  classeDiverge,
  classeDoLead,
  statusAtendimento,
  statusReuniao,
} from "@/lib/qualificacao";
import { etapaDoLead, FILA_ETAPAS, reunioesPorTelefone } from "@/lib/fila";
import { ETAPA_DA_LIVE, etapaDaLive, eventosDoEpisodioDaLive, inicioDoEpisodioDaLive, resumoDaCadencia } from "@/lib/fila-live";
import { expedienteAtual } from "@/lib/atendimento-server";
import { gruposDuplicados, pareceTeste, problemasDeContato } from "@/lib/identidade";
import { ETAPA_MAXIMA_LABEL, etapaMaxima } from "@/lib/lead-status";
import { SOBRE_A_MASCARA, mascararEmail, mascararNoTexto, mascararTelefone } from "@/lib/lgpd";
import { everBooked } from "@/lib/metrics";
import { origemDoLead } from "@/lib/origem";
import { chaveTelefoneValida, normalizarTelefone, telefoneUtilizavel } from "@/lib/phone";
import { comPeriodo } from "@/lib/range";
import { formatCurrency, formatDateTime, formatDateTimeCurta, formatarEspera } from "@/lib/format";
import { estadoDoRoboAgora } from "@/lib/robo/estado";
import { ROBO_ETAPA_LABEL } from "@/lib/robo/etapa";
import {
  RESGATE_MOTIVO_LABEL,
  agendouDepoisDoAceite,
  fatoDoEpisodio,
  reabertoDe,
  reabertoNoPainelDe,
  refDoRobo,
  situacaoDoRobo,
} from "@/lib/robo/situacao";
import type { LeadEvent } from "@/lib/types";
import { entradasDaMeta, type EntradaDaMeta } from "@/lib/capi-politica";

export const dynamic = "force-dynamic";

function Linha({ rotulo, children }: { rotulo: string; children: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-4 py-1.5 text-sm">
      <dt className="text-muted-foreground">{rotulo}</dt>
      <dd className="text-right">{children}</dd>
    </div>
  );
}

const data = (iso?: string) => (iso ? formatDateTimeCurta(iso) : "—");

/** O ⓘ do card do robô: o que ele é e o que ele não é. */
const SOBRE_O_ROBO =
  "O que o robô de WhatsApp fez com esta pessoa, lido do banco do robô a cada 15 min (sem a conversa). O robô não é tentativa: não entra na cadência nem no 1º contato.";

/** Os ⓘ da ficha (T3, nov/26): o que saía embaixo dos títulos. Cada frase ≤ 25 palavras (`t3-ficha-tela.test.ts`). */
const SOBRE_CHEGOU_A =
  "Etapa máxima: até onde chegou, pelos marcos gravados uma vez. O status pode voltar; o fato, não.";
const SOBRE_A_QUALIFICACAO =
  "As respostas do formulário. A classe é a do painel, calculada das respostas; sem respostas completas, vale a que o n8n mandou.";
/** Só para quem edita: salvar as respostas não é inofensivo (classe → Fila, Meta e live). */
const SOBRE_SALVAR_AS_RESPOSTAS =
  "Salvar recalcula a classe: A e B entram na Fila da live e avisam a Meta; C e X saem do contato da Fila. Com bem, valor ou finalidade, o lead pode passar a contar como inscrito da live.";
const SOBRE_O_ATENDIMENTO =
  "Cada tentativa vem do histórico, com o resultado e as notas da ligação: nada é contado à parte. As três primeiras aparecem aqui; as outras, na linha do tempo.";
const SOBRE_OS_MARCOS = "Gravados uma vez, quando aconteceram: o status pode mudar, o fato não.";
const SOBRE_A_ORIGEM =
  "Campanha › conjunto › anúncio, pela junção única lead → anúncio: vence o id gravado na entrada; depois, o do utm_content.";
const SOBRE_A_LINHA_DO_TEMPO =
  "Cada entrada, tentativa, mudança e anotação, a mais recente primeiro. Tracejado = envio à Meta (CAPI); “Enviado à Meta ✓” só com a Meta confirmando.";

/**
 * Contato novo digitado num reenvio, e o contato cru que motivos antigos de
 * exclusão ("parece teste") levavam, vão mascarados para o papel mascarado.
 */
function mascararEvento(e: LeadEvent): LeadEvent {
  if (!e.payload) return e;
  const { telefoneNovo, emailNovo, motivo } = e.payload;
  if (!telefoneNovo && !emailNovo && !motivo) return e;
  return {
    ...e,
    payload: {
      ...e.payload,
      ...(telefoneNovo ? { telefoneNovo: mascararTelefone(telefoneNovo) } : {}),
      ...(emailNovo ? { emailNovo: mascararEmail(emailNovo) } : {}),
      ...(motivo ? { motivo: mascararNoTexto(motivo) } : {}),
    },
  };
}

/**
 * Ficha do lead — tudo o que aconteceu com UMA pessoa, numa tela: de onde veio,
 * cada tentativa, cada mudança de status, a reunião, as anotações; e as mesmas
 * ações da Fila. Não é página de menu: abre pelo nome em Leads, na Fila e no
 * histórico (e pelo link do aviso de lead novo). O período viaja no link de
 * volta. Para o papel Marketing, telefone e e-mail aparecem mascarados e sem
 * link (LGPD). Sem descrição embaixo dos títulos: o método e a ressalva estão no ⓘ
 * de cada card (T3).
 */
export default async function FichaDoLead({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ range?: string }>;
}) {
  const [{ id: bruto }, { range }] = await Promise.all([params, searchParams]);
  const id = decodeURIComponent(bruto);
  const lead = await getLead(id);
  if (!lead) notFound();

  const [dados, proprios, enviosMeta, canEdit, canDelete, mensagem, user, expediente, robo] = await Promise.all([
    getData(lead.brand),
    listLeadEvents({ leadId: id, limit: 0 }),
    listCapiEnvios({ leadId: id, limit: 0 }),
    can("leads:write"),
    can("leads:delete"),
    mensagemWhatsapp(),
    getCurrentUser(),
    expedienteAtual(),
    // O MESMO estado do robô da Fila: a etapa citada no cabeçalho é a do grupo de lá.
    estadoDoRoboAgora(lead.brand),
  ]);
  const mascarar = user?.role === "marketing";
  const comRange = (href: string) => comPeriodo(href, range);

  // Cadastros mesclados neste: o histórico deles mora no id deles.
  const mesclados = new Map(
    proprios
      .filter((e) => e.action === "mesclado" && e.payload?.duplicado)
      .map((e) => [e.payload!.duplicado, e.payload?.nome ?? "outro cadastro"]),
  );
  const deles = await Promise.all([...mesclados.keys()].map((m) => listLeadEvents({ leadId: m, limit: 0 })));
  // Os envios à Meta dos cadastros mesclados também: o Lead da entrada duplicada saiu com o id dela.
  const enviosDeles = await Promise.all(
    [...mesclados.keys()].map(async (m) => ({ m, envios: await listCapiEnvios({ leadId: m, limit: 0 }) })),
  );
  const agoraFicha = new Date().toISOString();
  // Eventos do painel e envios à Meta numa linha só — "Enviado à Meta ✓" ao lado
  // do fato que o disparou (Fase 7). Ordenados pelo instante, não pelo texto da data.
  type ItemDaLinha =
    | { tipo: "evento"; e: LeadEvent; em: string }
    | { tipo: "meta"; m: EntradaDaMeta; em: string; mesclado?: string };
  const linhaDoTempo: ItemDaLinha[] = [
    ...[...proprios, ...deles.flat()].map((e): ItemDaLinha => ({
      tipo: "evento",
      e: mascarar ? mascararEvento(e) : e,
      em: quando(e),
    })),
    ...entradasDaMeta(enviosMeta, agoraFicha).map((m): ItemDaLinha => ({ tipo: "meta", m, em: m.quando })),
    ...enviosDeles.flatMap(({ m: idMesclado, envios }) =>
      entradasDaMeta(envios, agoraFicha).map(
        (m): ItemDaLinha => ({ tipo: "meta", m, em: m.quando, mesclado: mesclados.get(idMesclado) ?? "outro cadastro" }),
      ),
    ),
  ].sort((a, b) => Date.parse(b.em) - Date.parse(a.em));

  const contato = resumoContato(proprios);
  // O card Atendimento é a cadência da live: as tentativas do EPISÓDIO (como a Fila e o n8n); as antigas ficam na linha do tempo.
  const tentativas = tentativasDoLead(
    classeDoLead(lead) ? eventosDoEpisodioDaLive(proprios, inicioDoEpisodioDaLive(lead, proprios)) : proprios,
  );
  // A régua do "Sem resposta" (pedir confirmação) com as tentativas que valem para a cadência — a mesma do servidor.
  const cadencia = resumoDaCadencia(lead, proprios);
  const ultimoResultado = [...tentativas].reverse().find((t) => t.resultado)?.resultado;
  const reuniao = statusReuniao(lead);
  // A linha para o Brunno só faz sentido com a reunião marcada e pela frente (E5-05).
  const vespera =
    (reuniao === "agendada" || reuniao === "confirmada") && lead.meetingFor && Date.parse(lead.meetingFor) > Date.parse(agoraFicha)
      ? mensagemDaVespera(lead)
      : null;
  const resultadoReuniao = resultadoDaReuniao(proprios);
  const origem = origemDoLead(dados)(lead);
  // O MESMO contexto da Fila e de Leads (a mesma pessoa agendou por outro cadastro).
  const naFila = lead.deletedAt
    ? null
    : etapaDoLead(lead, proprios, agoraFicha, robo.ligado ? robo : undefined, {
        reunioesPorTelefone: reunioesPorTelefone(dados.leads),
      });
  // O robô para esta pessoa (`situacaoDoRobo`, a fonte única da Fila e de Leads).
  const reabertoEm = reabertoDe(proprios);
  const situacao = situacaoDoRobo(lead, {
    agora: agoraFicha,
    ref: refDoRobo(robo, agoraFicha),
    ligado: robo.ligado,
    reabertoEm,
    reabertoNoPainel: reabertoNoPainelDe(proprios),
  });
  const ha = (iso: string) => formatarEspera(Math.max(0, Date.parse(agoraFicha) - Date.parse(iso)) / 3_600_000);
  // As linhas do card pelo EPISÓDIO (11.3, a régua de `situacaoDoRobo`): o fato UMA
  // VEZ de antes do `reaberto` é da conversa antiga — aparece marcado, nunca como o de agora.
  const fatoDoRobo = (iso: string | undefined, vazio = "—") =>
    !iso ? vazio : fatoDoEpisodio(iso, reabertoEm) ? formatDateTimeCurta(iso) : `${formatDateTimeCurta(iso)} · antes de reabrir`;
  // "Antes do robô", "sem telefone" e "o robô não recebeu" são uma linha só. O
  // "ainda" só para quem está no recorte e dentro dos 15 min — fora dele (com
  // classe, encerrado, cliente) o robô pode nunca receber.
  const roboUmaLinha = situacao.antesDoRobo
    ? "antes do robô"
    : chaveTelefoneValida(lead.phone) == null
      ? "sem telefone — o robô não tem como falar"
      : !lead.roboVistoEm
        ? situacao.noRecorte && !situacao.naoRecebido && !situacao.resgate
          ? "o robô ainda não recebeu"
          : "o robô não recebeu"
        : null;
  const roboTitulo =
    roboUmaLinha ??
    `${situacao.etapa ? ROBO_ETAPA_LABEL[situacao.etapa] : "recebido"}${situacao.desde ? ` há ${ha(situacao.desde)}` : ""}${
      situacao.resgate ? ` · resgate (${RESGATE_MOTIVO_LABEL[situacao.resgate.motivo]})` : ""
    }`;
  const optOut = Boolean(lead.roboOptOutEm);
  // A e B da ficha da live: a etapa e o prazo vêm da Fila da live (pelo turno).
  const naFilaLive = lead.deletedAt || naFila ? null : etapaDaLive(lead, proprios, expediente);
  const teste = pareceTeste(lead);
  const problemas = problemasDeContato(lead);
  const grupo = gruposDuplicados(dados.leads).find((g) =>
    [g.principal, ...g.duplicados].some((l) => l.id === lead.id),
  );
  const outros = grupo ? [grupo.principal, ...grupo.duplicados].filter((l) => l.id !== lead.id) : [];
  const telefone = lead.phone ? (mascarar ? mascararTelefone(lead.phone) : lead.phone) : undefined;
  const email = lead.email ? (mascarar ? mascararEmail(lead.email) : lead.email) : undefined;

  // Qualificação (T3): a divergência de classe vira "≠ n8n (X)" no título e o porquê no ⓘ.
  const divergeClasse = classeDiverge(lead);
  const editaQualificacao = canEdit && !lead.deletedAt;
  const dicaDaQualificacao = [
    SOBRE_A_QUALIFICACAO,
    editaQualificacao ? SOBRE_SALVAR_AS_RESPOSTAS : null,
    divergeClasse
      ? `O n8n mandou ${lead.classeN8n}; o painel calcula ${lead.classe} com as mesmas respostas. A Fila usa a do painel: confira a tabela de parcela em Configurações → Atendimento e classe e o fluxo do n8n.`
      : null,
  ]
    .filter(Boolean)
    .join(" ");
  // Vazio = nenhuma resposta e nenhuma classe (o lead de conversão que não passou pelo formulário da live).
  const qualificacaoVazia =
    !classeDoLead(lead) &&
    lead.aceiteMensagens == null &&
    [lead.bem, lead.faixaValor, lead.finalidade, lead.faixaParcela, lead.prazoCompra, lead.horarioPreferido].every((v) => !v);
  // Automação sem nenhum fato do n8n: uma linha só, o título.
  const automacaoVazia =
    !lead.msg1EnviadaEm && !lead.msg1Status && !lead.atendimentoAvisadoEm && !lead.escaladoEm && !lead.comunidadeEm;
  const perfilDoDiagnostico = lead.diagnostico?.perfil?.trim() ?? "";
  // Até 6 palavras, o perfil é a resposta do título; mais, é texto do n8n e fica no corpo.
  const perfilNoTitulo = perfilDoDiagnostico !== "" && perfilDoDiagnostico.split(/\s+/).length <= 6;

  return (
    <div className="space-y-6">
      <Link
        href={comRange("/leads")}
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" />
        Leads
      </Link>

      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="text-xl font-semibold tracking-tight">{lead.name}</h2>
          <StatusBadge status={lead.status} />
          <span className="inline-flex items-center gap-0.5 text-xs text-muted-foreground">
            chegou a: {ETAPA_MAXIMA_LABEL[etapaMaxima(lead)]}
            <Info texto={SOBRE_CHEGOU_A} rotulo="Sobre “chegou a”" className="-my-1" />
          </span>
        </div>
        {/* Dois blocos: com a Fila da live e uma trilha longa, uma linha só passava de 25 palavras. */}
        <p className="text-sm text-muted-foreground">
          Entrou em {formatDateTime(lead.createdAt)} · origem {origem.trilha}
        </p>
        {naFila ? (
          <p className="text-sm text-muted-foreground">
            Na{" "}
            <Link
              href={comRange(`/fila?etapa=${naFila.nome}#${naFila.nome}`)}
              className="text-primary underline-offset-4 hover:underline"
            >
              Fila de contato
            </Link>{" "}
            como “{FILA_ETAPAS[naFila.nome].label}”
          </p>
        ) : naFilaLive ? (
          <p className="text-sm text-muted-foreground">
            Na{" "}
            <Link href={comRange("/fila#live")} className="text-primary underline-offset-4 hover:underline">
              Fila da live
            </Link>{" "}
            como “{ETAPA_DA_LIVE[naFilaLive.etapa].label}”, prazo {formatDateTimeCurta(naFilaLive.prazo)}
          </p>
        ) : null}
      </div>

      {lead.deletedAt ? (
        <Card className="border-[var(--danger)]/40">
          <CardContent className="space-y-2 p-4">
            <p className="text-sm">
              Este lead está <span className="font-medium">excluído</span>: fora das listas e dos
              números.
            </p>
            <DeletedLeads
              rows={[
                {
                  id: lead.id,
                  name: lead.name,
                  deletedAt: lead.deletedAt,
                  deletedBy: lead.deletedBy,
                  // Motivos antigos de "parece teste" foram gravados com o contato cru.
                  deletedReason: mascarar ? mascararNoTexto(lead.deletedReason) || undefined : lead.deletedReason,
                },
              ]}
              canRestore={canDelete}
            />
          </CardContent>
        </Card>
      ) : null}

      {teste || problemas.length || outros.length ? (
        <Card className="border-[var(--warning)]/40">
          <CardContent className="flex items-start gap-3 p-4">
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-[var(--warning-text)]" />
            <ul className="space-y-1 text-sm">
              {teste ? <li>Parece cadastro de teste ({teste}).</li> : null}
              {problemas.map((p) => (
                <li key={p}>Contato: {p}.</li>
              ))}
              {outros.length ? (
                <li>
                  A mesma pessoa tem outro cadastro:{" "}
                  {outros.map((o, i) => (
                    <span key={o.id}>
                      {i > 0 ? ", " : ""}
                      <Link
                        href={comRange(`/leads/${encodeURIComponent(o.id)}`)}
                        className="underline-offset-4 hover:underline"
                      >
                        {o.name}
                      </Link>
                    </span>
                  ))}
                  {/* Só quem mescla (`leads:delete`) lê a instrução: os outros não têm o botão. */}
                  .{canDelete ? " Dá para mesclar em Leads → Revisar." : ""}
                </li>
              ) : null}
            </ul>
          </CardContent>
        </Card>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-0.5" data-titulo>
                <span className="min-w-0">Contato</span>
                {mascarar ? <Info texto={SOBRE_A_MASCARA} rotulo="Sobre o contato mascarado" className="-my-1" /> : null}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="divide-y">
                <Linha rotulo="Telefone">
                  {!telefone ? (
                    "—"
                  ) : mascarar || optOut || !telefoneUtilizavel(telefone) ? (
                    // Mascarado, opt-out ou número que não serve (o ⚠ de contato do topo
                    // já diz por quê): texto, sem `wa.me`.
                    <span>
                      {telefone}
                      {optOut ? (
                        <span className="block text-xs text-[var(--status-fora-text)]">pediu para não receber mensagens</span>
                      ) : null}
                    </span>
                  ) : (
                    <a
                      href={`https://wa.me/${normalizarTelefone(telefone)}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 hover:underline"
                    >
                      <MessageCircle className="size-3.5 text-[var(--success-text)]" />
                      {telefone}
                    </a>
                  )}
                </Linha>
                <Linha rotulo="E-mail">
                  {!email ? (
                    "—"
                  ) : mascarar ? (
                    <span>{email}</span>
                  ) : (
                    <a href={`mailto:${email}`} className="inline-flex items-center gap-1.5 hover:underline">
                      <Mail className="size-3.5" />
                      {email}
                    </a>
                  )}
                </Linha>
                <Linha rotulo="Tentativas">
                  {contato.tentativas}
                  {contato.falou ? " · já falou com a pessoa" : ""}
                </Linha>
                <Linha rotulo="Última tentativa">{data(contato.ultima)}</Linha>
                {contato.proxima ? <Linha rotulo="Próxima pela cadência">{data(contato.proxima)}</Linha> : null}
              </dl>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className={qualificacaoVazia && !editaQualificacao ? "pb-5" : undefined}>
              <CardTitle className="flex flex-wrap items-center gap-x-1.5 gap-y-1" data-titulo>
                <span className="min-w-0">{qualificacaoVazia ? "Qualificação · sem respostas" : "Qualificação"}</span>
                {qualificacaoVazia ? null : (
                  <ClasseBadge classe={classeDoLead(lead)} origem={lead.classe ? undefined : lead.classeN8n ? "n8n" : undefined} />
                )}
                {divergeClasse ? (
                  <span className="text-[11px] font-medium text-[var(--status-fora-text)]">≠ n8n ({lead.classeN8n})</span>
                ) : null}
                <Info texto={dicaDaQualificacao} rotulo="Sobre a qualificação" className="-my-1" />
              </CardTitle>
            </CardHeader>
            {qualificacaoVazia && !editaQualificacao ? null : (
              <CardContent>
                <FichaQualificacao
                  id={lead.id}
                  canEdit={editaQualificacao}
                  semRespostas={qualificacaoVazia}
                  atuais={{
                    bem: lead.bem,
                    faixaValor: lead.faixaValor,
                    finalidade: lead.finalidade,
                    faixaParcela: lead.faixaParcela,
                    prazoCompra: lead.prazoCompra,
                    horarioPreferido: lead.horarioPreferido,
                    aceiteMensagens: lead.aceiteMensagens,
                  }}
                />
              </CardContent>
            )}
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-0.5" data-titulo>
                <span className="min-w-0">Atendimento</span>
                <Info texto={SOBRE_O_ATENDIMENTO} rotulo="Sobre o atendimento" className="-my-1" />
              </CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="divide-y">
                <Linha rotulo="Status do atendimento">{STATUS_ATENDIMENTO[statusAtendimento(lead)]}</Linha>
                {[0, 1, 2].map((i) => {
                  const t = tentativas[i];
                  return (
                    <Linha key={i} rotulo={`${i + 1}ª tentativa`}>
                      {t ? (
                        <>
                          {formatDateTimeCurta(t.em)}
                          {t.resultado ? ` · ${RESULTADOS_CONTATO[t.resultado]}` : t.falou ? " · falou" : " · sem resposta"}
                          {t.nota ? (
                            <span className="block text-xs text-muted-foreground whitespace-pre-line" data-medir-texto-ignorar="true">
                              {t.nota}
                            </span>
                          ) : null}
                        </>
                      ) : (
                        "—"
                      )}
                    </Linha>
                  );
                })}
                {tentativas.length > 3 ? <Linha rotulo="Outras tentativas">{tentativas.length - 3}</Linha> : null}
                <Linha rotulo="Resultado do contato">
                  {ultimoResultado ? RESULTADOS_CONTATO[ultimoResultado] : "—"}
                </Linha>
                <Linha rotulo="Reunião">
                  {reuniao ? STATUS_REUNIAO[reuniao] : "—"}
                  {lead.meetingFor ? ` · ${formatDateTimeCurta(lead.meetingFor)}` : ""}
                  {reuniao === "confirmada" && lead.reuniaoConfirmadaEm ? (
                    <span className="block text-xs text-muted-foreground">confirmada em {formatDateTimeCurta(lead.reuniaoConfirmadaEm)}</span>
                  ) : null}
                </Linha>
              </dl>
              <ReuniaoNaFicha
                id={lead.id}
                status={lead.status}
                vespera={vespera}
                resultado={
                  resultadoReuniao
                    ? { resultado: resultadoReuniao.resultado, quando: formatDateTimeCurta(resultadoReuniao.em) }
                    : undefined
                }
                canEdit={canEdit && !lead.deletedAt}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader className={automacaoVazia ? "pb-5" : undefined}>
              <CardTitle data-titulo>{automacaoVazia ? "Automação (n8n) · nada registrado" : "Automação (n8n)"}</CardTitle>
            </CardHeader>
            {automacaoVazia ? null : (
              <CardContent>
                <dl className="divide-y">
                  <Linha rotulo="Mensagem automática">
                    {lead.msg1EnviadaEm ? formatDateTimeCurta(lead.msg1EnviadaEm) : "não enviada"}
                    {lead.msg1Status ? ` · ${(STATUS_MSG1 as Record<string, string>)[lead.msg1Status] ?? lead.msg1Status}` : ""}
                  </Linha>
                  <Linha rotulo="Atendimento avisado">{data(lead.atendimentoAvisadoEm)}</Linha>
                  <Linha rotulo="Escalado">{data(lead.escaladoEm)}</Linha>
                  <Linha rotulo="Clicou na comunidade">
                    {lead.comunidadeEm ? `sim · ${formatDateTimeCurta(lead.comunidadeEm)}` : "não"}
                  </Linha>
                </dl>
              </CardContent>
            )}
          </Card>

          {robo.ligado ? (
            <Card id="robo" className="scroll-mt-24">
              <CardHeader className={roboUmaLinha ? "pb-5" : undefined}>
                <CardTitle className="flex flex-wrap items-center gap-x-0.5" data-titulo>
                  <span className="min-w-0">Robô (WhatsApp) · {roboTitulo}</span>
                  <Info texto={SOBRE_O_ROBO} rotulo="Sobre o robô de WhatsApp" className="-my-1" />
                </CardTitle>
              </CardHeader>
              {roboUmaLinha ? null : (
                <CardContent>
                  <dl className="divide-y">
                    <Linha rotulo="1ª mensagem">{fatoDoRobo(lead.roboSaudacaoEm)}</Linha>
                    <Linha rotulo="Respondeu">{fatoDoRobo(lead.roboRespondeuEm, "não")}</Linha>
                    <Linha rotulo="Última mensagem do cliente">{data(lead.roboUltimaMsgClienteEm)}</Linha>
                    <Linha rotulo="Cobranças">
                      {lead.roboCobrancas
                        ? `${lead.roboCobrancas}${lead.roboUltimaCobrancaEm ? ` · a última em ${formatDateTimeCurta(lead.roboUltimaCobrancaEm)}` : ""}`
                        : "nenhuma"}
                    </Linha>
                    <Linha rotulo="Convite enviado">{fatoDoRobo(lead.roboConviteEm)}</Linha>
                    <Linha rotulo="Aceitou o convite">
                      {fatoDoRobo(lead.roboAceitouEm)}
                      {/* O aceite DESTE episódio, sem reunião: o mesmo fato que põe em "Aceitou o convite". */}
                      {situacao.aceitouEm && !agendouDepoisDoAceite(lead, situacao.aceitouEm) ? " · conferir no Calendly" : ""}
                    </Linha>
                    {lead.roboSemWhatsappEm ? <Linha rotulo="Sem WhatsApp">{formatDateTimeCurta(lead.roboSemWhatsappEm)}</Linha> : null}
                    {lead.roboOptOutEm ? (
                      <Linha rotulo="Pediu para não receber mensagens">{formatDateTimeCurta(lead.roboOptOutEm)}</Linha>
                    ) : null}
                    {lead.roboEncerradoEm || lead.roboPausado ? (
                      <Linha rotulo="Encerrado pelo robô">
                        {lead.roboEncerradoEm ? fatoDoRobo(lead.roboEncerradoEm) : "pausado"}
                        {lead.roboEncerradoEm && lead.roboPausado ? " · pausado" : ""}
                      </Linha>
                    ) : null}
                    <Linha rotulo="Última leitura">
                      {robo.sync.ultimoOk ? formatDateTimeCurta(robo.sync.ultimoOk) : "nunca"}
                      {robo.sync.falha ? " · falhando" : ""}
                    </Linha>
                  </dl>
                </CardContent>
              )}
            </Card>
          ) : null}

          {lead.diagnostico ? (
            <Card>
              <CardHeader>
                <CardTitle data-titulo>
                  {perfilNoTitulo
                    ? `Diagnóstico · ${perfilDoDiagnostico}`
                    : perfilDoDiagnostico
                      ? "Diagnóstico"
                      : "Diagnóstico · sem perfil final"}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {lead.diagnostico.feitoEm || (perfilDoDiagnostico && !perfilNoTitulo) ? (
                  <dl className="divide-y">
                    {lead.diagnostico.feitoEm ? (
                      <Linha rotulo="Feito em">{formatDateTimeCurta(lead.diagnostico.feitoEm)}</Linha>
                    ) : null}
                    {perfilDoDiagnostico && !perfilNoTitulo ? (
                      <Linha rotulo="Perfil">
                        <span className="whitespace-pre-line" data-medir-texto-ignorar="true">
                          {perfilDoDiagnostico}
                        </span>
                      </Linha>
                    ) : null}
                  </dl>
                ) : null}
                {lead.diagnostico.alertas?.length ? (
                  <p className="flex items-start gap-2 rounded-lg border border-[var(--warning)]/50 bg-[var(--warning)]/10 p-2.5 text-xs">
                    <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-[var(--warning-text)]" />
                    <span>Alertas do resultado: {lead.diagnostico.alertas.join(" · ")}</span>
                  </p>
                ) : null}
                <ol className="space-y-2 text-sm">
                  {lead.diagnostico.respostas.map((r, i) => (
                    <li key={i}>
                      <p className="text-xs text-muted-foreground">
                        {i + 1}. {r.pergunta ?? `Pergunta ${i + 1}`}
                      </p>
                      <p className="whitespace-pre-line" data-medir-texto-ignorar="true">
                        {r.resposta}
                      </p>
                    </li>
                  ))}
                </ol>
              </CardContent>
            </Card>
          ) : null}

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-0.5" data-titulo>
                <span className="min-w-0">Marcos</span>
                <Info texto={SOBRE_OS_MARCOS} rotulo="Sobre os marcos" className="-my-1" />
              </CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="divide-y">
                <Linha rotulo="Entrada">{data(lead.createdAt)}</Linha>
                {lead.inscritoLiveEm ? <Linha rotulo="Inscrição na live">{data(lead.inscritoLiveEm)}</Linha> : null}
                <Linha rotulo="1º contato">{data(lead.firstContactAt)}</Linha>
                <Linha rotulo="Agendou">{data(lead.bookedAt)}</Linha>
                <Linha rotulo="Reunião marcada para">
                  {lead.meetingFor ? formatDateTimeCurta(lead.meetingFor) : everBooked(lead) ? "data não registrada" : "—"}
                </Linha>
                <Linha rotulo="Reunião realizada">{data(lead.attendedAt)}</Linha>
                <Linha rotulo="Virou cliente">
                  {lead.closedAt
                    ? `${formatDateTimeCurta(lead.closedAt)}${lead.value ? ` · ${formatCurrency(lead.value)}` : ""}`
                    : "—"}
                </Linha>
                {lead.lostAt ? (
                  <Linha rotulo="Perdido em">
                    {formatDateTimeCurta(lead.lostAt)}
                    {lead.lostReasonDetail ? ` · ${lead.lostReasonDetail}` : ""}
                  </Linha>
                ) : null}
              </dl>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-0.5" data-titulo>
                <span className="min-w-0">Origem</span>
                <Info texto={SOBRE_A_ORIGEM} rotulo="Sobre a origem" className="-my-1" />
              </CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="divide-y">
                <Linha rotulo="Trilha">{origem.trilha}</Linha>
                <Linha rotulo="Campanha">{origem.campanha ?? "—"}</Linha>
                <Linha rotulo="Conjunto">{origem.conjunto ?? "—"}</Linha>
                <Linha rotulo="Anúncio">{origem.anuncio}</Linha>
                <Linha rotulo="utm_source">{lead.utmSource ?? "—"}</Linha>
                <Linha rotulo="utm_campaign">{lead.utmCampaign ?? "—"}</Linha>
                <Linha rotulo="utm_term">{lead.utmTerm ?? "—"}</Linha>
                <Linha rotulo="utm_content">{lead.utmContent ?? "—"}</Linha>
                <Linha rotulo="Clique da Meta (fbc)">{lead.fbc ? "sim" : "não"}</Linha>
                <Linha rotulo="Id">
                  <span className="font-mono text-xs">{lead.id}</span>
                </Linha>
              </dl>
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6">
          {/* Só para quem registra (`leads:write`): para o Marketing era um card vazio. */}
          {!lead.deletedAt && canEdit ? (
            <Card>
              <CardHeader>
                <CardTitle>Registrar</CardTitle>
              </CardHeader>
              <CardContent>
                <FichaAcoes
                  id={lead.id}
                  name={lead.name}
                  status={lead.status}
                  jaAgendou={everBooked(lead)}
                  tentativas={cadencia.tentativas}
                  diasComTentativa={cadencia.diasComTentativa}
                  // Sem telefone para o papel mascarado: o botão do WhatsApp não aparece.
                  telefone={mascarar ? undefined : lead.phone}
                  optOut={optOut}
                  mensagemWhatsapp={mensagem}
                  canEdit={canEdit}
                  podeReabrir={canDelete}
                />
              </CardContent>
            </Card>
          ) : null}

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-0.5" data-titulo>
                <span className="min-w-0">Linha do tempo</span>
                <Info texto={SOBRE_A_LINHA_DO_TEMPO} rotulo="Sobre a linha do tempo" className="-my-1" />
              </CardTitle>
            </CardHeader>
            <CardContent>
              {linhaDoTempo.length === 0 ? (
                <p className="text-sm text-muted-foreground">Nada registrado ainda.</p>
              ) : (
                <ol className="space-y-3">
                  {linhaDoTempo.map((item) =>
                    item.tipo === "meta" ? (
                      <li key={item.m.id} className="border-l-2 border-dashed pl-3 text-sm">
                        <p className="text-xs text-muted-foreground">
                          {formatDateTimeCurta(item.em)} · Meta (CAPI)
                          {item.mesclado ? ` · cadastro mesclado (${item.mesclado})` : ""}
                        </p>
                        <p
                          className={
                            item.m.tom === "ok"
                              ? "mt-0.5 text-[var(--success-text)]"
                              : item.m.tom === "falha"
                                ? "mt-0.5 text-[var(--status-fora-text)]"
                                : "mt-0.5 text-muted-foreground"
                          }
                        >
                          {item.m.texto}
                        </p>
                      </li>
                    ) : (
                      <li key={item.e.id} className="border-l-2 pl-3 text-sm">
                        <p className="text-xs text-muted-foreground">
                          {formatDateTimeCurta(item.em)} · {item.e.actor}
                          {item.e.leadId !== lead.id
                            ? ` · cadastro mesclado (${mesclados.get(item.e.leadId) ?? item.e.leadName})`
                            : ""}
                        </p>
                        <div className="mt-0.5">
                          <DescricaoEvento e={item.e} />
                        </div>
                      </li>
                    ),
                  )}
                </ol>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
