"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronDown, Clock, MessageCircle, Undo2 } from "lucide-react";
import {
  changeLeadStatus,
  desfazerTentativa,
  marcarReuniao,
  registrarTentativa,
} from "@/app/(dashboard)/leads/actions";
import { RegistrarStatus } from "@/components/tables/lead-status";
import { useComPeriodo } from "@/components/layout/use-periodo";
import { Info } from "@/components/ui/info";
import { estaResolvido, podarResolvidos, type Resolvido } from "@/components/fila/resolvidos";
import { FILA_ETAPAS, formatEspera, type FilaEtapa, type FilaGrupo, type FilaItem } from "@/lib/fila";
import { RESGATE_MOTIVO_LABEL } from "@/lib/robo/situacao";
import { CANAL_LABEL, linkWhatsapp, type CanalContato } from "@/lib/contato";
import { formatDateTimeCurta } from "@/lib/format";
import { telefoneUtilizavel } from "@/lib/phone";
import { cn } from "@/lib/utils";

/**
 * A Fila de contato por grupo (Fase 1, nov/26) — uma linha por pessoa: nome
 * (abre a ficha) · o porquê em poucas palavras · a espera na cor do prazo ·
 * WhatsApp · a ação do grupo. O registro abre embaixo da linha só quando se
 * pede (nada de painel aberto por padrão). Cinco pessoas por grupo; "ver todos"
 * expande aqui mesmo. Nada de telefone, e-mail, briefing ou score na linha.
 *
 * Ações: Tentativa▾ no resgate (e nos grupos de antes do robô); "Registrar a
 * reunião▾" e Tentativa▾ em "Aceitou o convite" (a data vai pelo "Agendado" de
 * sempre — conferir o Calendly NÃO é tentativa); "Confirmada · Pediu para
 * remarcar" nas reuniões a confirmar (com o robô desligado, também o Desfecho▾
 * de antes); Desfecho▾ nas sem desfecho. Sem WhatsApp (o robô viu que o número
 * não tem, ou a pessoa pediu para não receber mensagens): sem o botão, e a
 * tentativa começa por ligação.
 */

/** Pessoas por grupo antes do "ver todos". */
const POR_GRUPO = 5;
/** Quanto tempo o "Desfazer" fica na tela depois de uma tentativa. */
const DESFAZER_MS = 10_000;

/** O que a linha precisa saber do lead além do item da Fila (montado na página, do store). */
export interface ExtrasDaLinha {
  /** Aceitou o convite do robô (recebeu o link do Calendly). */
  aceitouEm?: string;
  /** Também está na Fila da live (o número da aba já conta uma vez). */
  naLive?: boolean;
  /** Pediu ao robô para não receber mensagens: sem WhatsApp (LGPD). */
  optOut?: boolean;
  /** A 1ª mensagem do robô NESTE episódio (`fatoDoEpisodio`) — só no resgate "não respondeu ao robô". */
  primeiraMsgEm?: string;
}

/** Cor do prazo: verde até metade, âmbar até estourar, vermelho depois. */
function corDoPrazo(atraso: number): string {
  if (atraso >= 1) return "text-[var(--danger-text)]";
  if (atraso >= 0.5) return "text-[var(--warning-text)]";
  return "text-[var(--success-text)]";
}

const horaBrt = new Intl.DateTimeFormat("pt-BR", {
  timeZone: "America/Sao_Paulo",
  hour: "2-digit",
  minute: "2-digit",
});

const tentativasTxt = (n: number) => `${n} ${n === 1 ? "tentativa" : "tentativas"}`;

/** "26 h" desde `iso` até `agora`. */
const haQuanto = (iso: string, agora: string) => formatEspera(Math.max(0, Date.parse(agora) - Date.parse(iso)) / 3_600_000);

/** O porquê da linha, em poucas palavras. */
function contexto(item: FilaItem, extras: ExtrasDaLinha | undefined, agora: string): string {
  const n = item.contato?.tentativas ?? 0;
  const comTentativas = (t: string) => (n > 0 ? `${t} · ${tentativasTxt(n)}` : t);
  switch (item.etapa) {
    case "resgate": {
      // "1ª msg há 26 h": a medida, não a régua — o relógio ao lado é o tempo no grupo.
      const msg = item.motivo === "sem-resposta-24h" ? extras?.primeiraMsgEm : undefined;
      return comTentativas(
        msg ? `1ª msg há ${haQuanto(msg, agora)}` : item.motivo ? RESGATE_MOTIVO_LABEL[item.motivo] : "retomar o contato",
      );
    }
    case "convite-aceito": {
      const em = extras?.aceitouEm;
      return comTentativas(em ? `aceitou há ${haQuanto(em, agora)}` : "aceitou o convite");
    }
    case "confirmar":
    case "sem-desfecho":
      return item.reuniao ? `reunião ${formatDateTimeCurta(item.reuniao)}` : "reunião sem data";
    case "novo":
      return item.venceEm && item.atraso < 1 ? `prazo vence às ${horaBrt.format(new Date(item.venceEm))}` : "";
    case "retornar": {
      const c = item.contato;
      if (!c) return "";
      const ultima = c.ultima ? ` · última ${formatDateTimeCurta(c.ultima)}` : "";
      const fim = item.status === "no_show" ? " · não compareceu" : c.falou ? " · já falou" : "";
      return `${tentativasTxt(c.tentativas)}${ultima}${fim}`;
    }
  }
}

type Painel = "tentativa" | "reuniao" | "desfecho" | null;

const botaoCls =
  "inline-flex h-8 items-center gap-1.5 rounded-md border px-2.5 text-xs font-medium hover:bg-foreground/5 disabled:opacity-50";

function Abre({ rotulo, aberto, onClick, disabled }: { rotulo: string; aberto: boolean; onClick: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-expanded={aberto}
      className={cn(botaoCls, aberto && "border-primary text-primary")}
    >
      {rotulo}
      <ChevronDown className={cn("size-3.5 transition-transform", aberto && "rotate-180")} />
    </button>
  );
}

function FilaLinha({
  item,
  extras,
  agora,
  canEdit,
  roboLigado,
  mensagemWhatsapp,
  onDone,
  onTentativa,
}: {
  item: FilaItem;
  extras?: ExtrasDaLinha;
  agora: string;
  canEdit: boolean;
  roboLigado: boolean;
  mensagemWhatsapp: string;
  onDone: (item: Resolvido) => void;
  onTentativa: (t: UltimaTentativa, fixar?: FilaItem) => void;
}) {
  const comPeriodo = useComPeriodo();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [painel, setPainel] = useState<Painel>(null);
  const optOut = Boolean(extras?.optOut);
  // O robô viu que o número não tem WhatsApp: sem o botão, e a tentativa começa por
  // ligação (o chip continua livre — quem bloqueia o canal é o opt-out, por LGPD).
  const semWhatsapp = item.motivo === "sem-whatsapp";
  // Sem número utilizável ("sem telefone" no resgate, ou lixo como "123" fora dele):
  // nada de botão, e a tentativa começa pelo e-mail quando há um.
  const semNumero = !telefoneUtilizavel(item.telefone);
  const [canalEscolhido, setCanal] = useState<CanalContato>(
    semNumero && item.email ? "email" : optOut || semWhatsapp || semNumero ? "ligacao" : "whatsapp",
  );
  // O opt-out pode chegar com a linha já na tela (a recarga de cada minuto mantém o
  // estado): o canal bloqueado nunca fica escolhido nem vai para o servidor.
  const canal: CanalContato = optOut && canalEscolhido === "whatsapp" ? "ligacao" : canalEscolhido;
  const [reuniaoEm, setReuniaoEm] = useState("");
  const leadId = item.leadId;
  const pode = canEdit && Boolean(leadId);
  const e = item.etapa;
  const aceitaTentativa = pode && (e === "resgate" || e === "convite-aceito" || e === "novo" || e === "retornar");
  // Robô desligado: "a confirmar" mantém o Desfecho▾ de antes (desistiu, remarcou por telefone).
  const desfechoNaLinha =
    pode && (e === "novo" || e === "retornar" || e === "sem-desfecho" || (e === "confirmar" && !roboLigado));
  const alternar = (p: Exclude<Painel, null>) => setPainel((atual) => (atual === p ? null : p));

  function tentativa(falou: boolean) {
    if (!leadId) return;
    start(async () => {
      const r = await registrarTentativa(leadId, canal, falou);
      setMsg({ ok: r.ok, text: r.message });
      if (!r.ok || !r.eventoId) return;
      if (falou) {
        // Falou com a pessoa: o próximo passo é o desfecho, na mesma linha — que
        // fica fixada, porque o servidor já tirou o lead da Fila.
        setPainel("desfecho");
        onTentativa(
          { leadId, eventoId: r.eventoId, nome: item.nome, itemId: "", etapa: item.etapa, msg: r.message },
          { ...item, status: item.status === "lead" ? "em_contato" : item.status },
        );
      } else {
        onTentativa({ leadId, eventoId: r.eventoId, nome: item.nome, itemId: item.id, etapa: item.etapa, msg: r.message });
      }
    });
  }

  function registrarReuniao() {
    if (!leadId) return;
    // datetime-local vem no horário do navegador; vira instante absoluto aqui.
    const t = reuniaoEm ? new Date(reuniaoEm) : null;
    if (!t || Number.isNaN(t.getTime())) {
      setMsg({ ok: false, text: "Informe a data e a hora da reunião." });
      return;
    }
    start(async () => {
      // O "Agendado" de sempre (marco, histórico, Meta/GA4) — NÃO é tentativa.
      const r = await changeLeadStatus(leadId, "agendado", { meetingFor: t.toISOString() });
      setMsg({ ok: r.ok, text: r.message });
      if (r.ok) onDone(item);
    });
  }

  function reuniao(o: "confirmada" | "remarcar") {
    if (!leadId) return;
    start(async () => {
      const r = await marcarReuniao(leadId, o);
      setMsg({ ok: r.ok, text: r.message });
      if (!r.ok) return;
      if (o === "confirmada") onDone(item);
      else setPainel("reuniao"); // a data nova vai pelo "Agendado"
    });
  }

  const atrasado = item.atraso >= 1 && e !== "confirmar";
  const texto = contexto(item, extras, agora);

  return (
    <li className={cn("px-3 py-2", atrasado && "bg-[var(--danger)]/[0.04]")}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        {leadId ? (
          <Link
            href={comPeriodo(`/leads/${encodeURIComponent(leadId)}`)}
            className="max-w-[16rem] truncate text-sm font-medium hover:underline"
            title="Abrir a ficha"
          >
            {item.nome}
          </Link>
        ) : (
          <span className="max-w-[16rem] truncate text-sm font-medium">{item.nome}</span>
        )}
        {texto ? <span className="text-xs text-muted-foreground">{texto}</span> : null}
        {e !== "confirmar" ? (
          <span className={cn("inline-flex items-center gap-1 text-xs font-medium tabular-nums", corDoPrazo(item.atraso))}>
            <Clock className="size-3" aria-hidden />
            {formatEspera(item.horasEsperando)}
            {item.atraso >= 1 ? ` · ${Math.floor(item.atraso)}× o prazo` : ""}
          </span>
        ) : null}
        {extras?.naLive ? <span className="rounded border px-1.5 py-px text-[11px] text-muted-foreground">também na live</span> : null}
        {optOut ? (
          <span className="rounded border px-1.5 py-px text-[11px] text-muted-foreground" title="Pediu ao robô para não receber mensagens">
            não quer mensagens
          </span>
        ) : null}
        {item.tambemEm.map((t) => (
          <span key={t} className="rounded border px-1.5 py-px text-[11px] text-muted-foreground">
            também em {FILA_ETAPAS[t].label.toLowerCase()}
          </span>
        ))}

        {/* Sem `shrink-0`: a 375 px o bloco encolhe e os botões quebram dentro dele (sem rolagem lateral). */}
        <div className="ml-auto flex min-w-0 flex-wrap items-center gap-2">
          {item.telefone && !semNumero && !optOut && !semWhatsapp ? (
            <a
              href={linkWhatsapp(item.telefone, mensagemWhatsapp, item.nome)}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => {
                // Depois de mandar a mensagem, registrar é um clique.
                if (aceitaTentativa) {
                  setCanal("whatsapp");
                  setPainel("tentativa");
                }
              }}
              className={botaoCls}
            >
              <MessageCircle className="size-3.5 text-[var(--success-text)]" aria-hidden />
              WhatsApp
            </a>
          ) : null}
          {pode && e === "convite-aceito" ? (
            <Abre rotulo="Registrar a reunião" aberto={painel === "reuniao"} onClick={() => alternar("reuniao")} disabled={pending} />
          ) : null}
          {aceitaTentativa ? (
            <Abre rotulo="Tentativa" aberto={painel === "tentativa"} onClick={() => alternar("tentativa")} disabled={pending} />
          ) : null}
          {pode && e === "confirmar" ? (
            <>
              <button type="button" disabled={pending} onClick={() => reuniao("confirmada")} className={botaoCls}>
                Confirmada
              </button>
              <button type="button" disabled={pending} onClick={() => reuniao("remarcar")} className={botaoCls}>
                Pediu para remarcar
              </button>
            </>
          ) : null}
          {desfechoNaLinha ? (
            <Abre rotulo="Desfecho" aberto={painel === "desfecho"} onClick={() => alternar("desfecho")} disabled={pending} />
          ) : null}
        </div>
      </div>

      {painel === "tentativa" && aceitaTentativa ? (
        <div className="mt-2 flex flex-wrap items-center gap-2 border-t pt-2">
          <span className="text-xs text-muted-foreground">Canal:</span>
          {(Object.keys(CANAL_LABEL) as CanalContato[]).map((c) => {
            const bloqueado = c === "whatsapp" && optOut;
            return (
              <button
                key={c}
                type="button"
                disabled={bloqueado}
                onClick={() => setCanal(c)}
                title={bloqueado ? "Pediu para não receber mensagens" : undefined}
                className={cn(
                  "rounded-full border px-2.5 py-1 text-xs disabled:cursor-not-allowed disabled:opacity-40",
                  canal === c ? "border-primary text-primary" : "text-muted-foreground hover:text-foreground",
                )}
              >
                {CANAL_LABEL[c]}
              </button>
            );
          })}
          <span className="mx-1 h-4 w-px bg-border" aria-hidden />
          <button type="button" disabled={pending} onClick={() => tentativa(false)} className={botaoCls}>
            Sem resposta
          </button>
          <button
            type="button"
            disabled={pending}
            onClick={() => tentativa(true)}
            className="h-8 rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground disabled:opacity-50"
          >
            Conseguiu falar
          </button>
          {!desfechoNaLinha ? (
            <button
              type="button"
              disabled={pending}
              onClick={() => setPainel("desfecho")}
              className="text-xs text-muted-foreground underline-offset-4 hover:underline"
            >
              Outro desfecho…
            </button>
          ) : null}
        </div>
      ) : null}

      {painel === "reuniao" && pode ? (
        <div className="mt-2 flex flex-wrap items-center gap-2 border-t pt-2">
          <label className="text-xs text-muted-foreground" htmlFor={`reuniao-${item.id}`}>
            {e === "confirmar" ? "Data nova" : "Data da reunião (Calendly)"}
          </label>
          <input
            id={`reuniao-${item.id}`}
            type="datetime-local"
            value={reuniaoEm}
            onChange={(ev) => setReuniaoEm(ev.target.value)}
            className="h-8 rounded-md border bg-background px-2 text-xs"
          />
          <button
            type="button"
            disabled={pending || !reuniaoEm}
            onClick={registrarReuniao}
            className="h-8 rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground disabled:opacity-50"
          >
            Registrar
          </button>
        </div>
      ) : null}

      {painel === "desfecho" && leadId && item.status ? (
        <div className="mt-2 border-t pt-2">
          <RegistrarStatus
            id={leadId}
            name={item.nome}
            status={item.status}
            jaAgendou={item.jaAgendou ?? false}
            tentativas={item.contato?.tentativas}
            diasComTentativa={item.contato?.diasComTentativa}
            modo="botoes"
            onDone={(m) => {
              setMsg({ ok: true, text: m });
              onDone(item);
            }}
          />
        </div>
      ) : null}

      {msg ? (
        <p className={cn("mt-1 text-xs", msg.ok ? "text-muted-foreground" : "text-[var(--danger-text)]")}>{msg.text}</p>
      ) : null}
    </li>
  );
}

interface UltimaTentativa {
  leadId: string;
  eventoId: string;
  nome: string;
  itemId: string;
  /** O grupo da linha (o resolvido vale para ele, `resolvidos.ts`). */
  etapa: FilaEtapa;
  msg: string;
}

export function FilaList({
  grupos,
  canEdit,
  mensagemWhatsapp,
  agora,
  grupoInicial = null,
  extras = {},
  transferidosSemLead = 0,
  roboLigado,
}: {
  /** `montarFila(...).grupos` — os grupos desta operação, na ordem fixa. */
  grupos: FilaGrupo[];
  canEdit: boolean;
  /** Modelo da mensagem do WhatsApp; `{nome}` vira o primeiro nome. */
  mensagemWhatsapp: string;
  /** Quando a página foi montada (ISO, do servidor) — as esperas contam dali. */
  agora: string;
  /** O grupo do link que trouxe até aqui (`grupoDaUrl`): já abre expandido. */
  grupoInicial?: FilaEtapa | null;
  /** Por lead: aceitou o convite, também na live, opt-out. */
  extras?: Record<string, ExtrasDaLinha>;
  /** Aceitaram o convite pelo robô e não casaram com lead nenhum (sem nome nem telefone). */
  transferidosSemLead?: number;
  /** O robô está ligado (`estadoDoRoboAgora`): decide as ações de "a confirmar". */
  roboLigado: boolean;
}) {
  const router = useRouter();
  const comPeriodo = useComPeriodo();
  /** Linhas tiradas da tela na hora da ação — por GRUPO (`resolvidos.ts`). */
  const [resolvidos, setResolvidos] = useState<Resolvido[]>([]);
  // A cada resposta do servidor (a da ação, a recarga de cada minuto) sai o resolvido
  // que ele deixou de listar naquele grupo: quem voltar (a cadência, a reunião que
  // passou) reaparece. Ajuste de estado no render, sem efeito (o padrão do React).
  const [gruposVistos, setGruposVistos] = useState(grupos);
  if (gruposVistos !== grupos) {
    setGruposVistos(grupos);
    setResolvidos((r) => podarResolvidos(r, grupos));
  }
  const [ultima, setUltima] = useState<UltimaTentativa | null>(null);
  /** Linhas que a lista do servidor já tirou mas ainda esperam o desfecho. */
  const [fixos, setFixos] = useState<FilaItem[]>([]);
  const [expandidos, setExpandidos] = useState<FilaEtapa[]>(grupoInicial ? [grupoInicial] : []);
  const [desfazendo, startDesfazer] = useTransition();

  // O "Desfazer" some sozinho depois de alguns segundos.
  useEffect(() => {
    if (!ultima) return;
    const t = setTimeout(() => setUltima(null), DESFAZER_MS);
    return () => clearTimeout(t);
  }, [ultima]);

  const porGrupo = useMemo(() => {
    const doServidor = new Set(grupos.flatMap((g) => g.itens.map((i) => i.id)));
    return grupos.map((g) => {
      const extrasDoGrupo = fixos.filter((f) => f.etapa === g.etapa && !doServidor.has(f.id));
      return { ...g, visiveis: [...extrasDoGrupo, ...g.itens].filter((i) => !estaResolvido(resolvidos, i)) };
    });
  }, [grupos, fixos, resolvidos]);

  function onDone({ id, etapa }: Resolvido) {
    // Some da lista na hora e revalida no servidor: o comercial não perde o
    // lugar onde estava depois de cada ligação.
    setResolvidos((r) => [...r, { id, etapa }]);
    setFixos((f) => f.filter((x) => x.id !== id));
    router.refresh();
  }

  function onTentativa(t: UltimaTentativa, fixar?: FilaItem) {
    setUltima(t);
    if (fixar) setFixos((f) => [fixar, ...f.filter((x) => x.id !== fixar.id)]);
    if (t.itemId) onDone({ id: t.itemId, etapa: t.etapa });
  }

  function desfazer() {
    if (!ultima) return;
    const alvo = ultima;
    startDesfazer(async () => {
      await desfazerTentativa(alvo.leadId, alvo.eventoId);
      setUltima(null);
      setResolvidos((r) => r.filter((x) => !(x.id === alvo.itemId && x.etapa === alvo.etapa)));
      router.refresh();
    });
  }

  return (
    <div className="space-y-5">
      {ultima ? (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border bg-card px-3 py-2 text-xs">
          <span>
            <span className="font-medium">{ultima.nome}:</span> {ultima.msg}
          </span>
          <button
            type="button"
            onClick={desfazer}
            disabled={desfazendo}
            className="inline-flex items-center gap-1 rounded-md border px-2 py-1 font-medium hover:bg-foreground/5 disabled:opacity-50"
          >
            <Undo2 className="size-3.5" />
            Desfazer
          </button>
        </div>
      ) : null}

      {porGrupo.map((g) => {
        const meta = FILA_ETAPAS[g.etapa];
        const aberto = expandidos.includes(g.etapa);
        const mostrar = aberto ? g.visiveis : g.visiveis.slice(0, POR_GRUPO);
        const resto = g.visiveis.length - mostrar.length;
        const vazio = g.total === 0 && g.visiveis.length === 0;
        return (
          <section key={g.etapa} id={g.etapa} className="scroll-mt-24 space-y-2">
            <h2 className={cn("flex flex-wrap items-center gap-x-1 text-sm font-semibold", vazio && "text-muted-foreground")}>
              <span>
                {meta.label} · {g.total}
                {g.etapa !== "confirmar" && g.foraDoPrazo > 0 ? (
                  <>
                    {" "}
                    · <span className="text-[var(--danger-text)]">{g.foraDoPrazo} fora do prazo</span>
                  </>
                ) : null}
              </span>
              <Info texto={meta.hint} rotulo={`Sobre “${meta.label}”`} />
            </h2>
            {mostrar.length ? (
              <ul className="divide-y rounded-lg border bg-card">
                {mostrar.map((item) => (
                  <FilaLinha
                    key={item.id}
                    item={item}
                    extras={item.leadId ? extras[item.leadId] : undefined}
                    agora={agora}
                    canEdit={canEdit}
                    roboLigado={roboLigado}
                    mensagemWhatsapp={mensagemWhatsapp}
                    onDone={onDone}
                    onTentativa={onTentativa}
                  />
                ))}
              </ul>
            ) : null}
            {resto > 0 ? (
              <button
                type="button"
                onClick={() => setExpandidos((x) => [...x, g.etapa])}
                className="text-xs font-medium text-primary underline-offset-4 hover:underline"
              >
                ver todos ({g.visiveis.length})
              </button>
            ) : null}
            {g.etapa === "convite-aceito" && transferidosSemLead > 0 ? (
              <p className="text-xs text-muted-foreground">
                <Link href={comPeriodo("/configuracoes/integracoes#robo")} className="underline-offset-4 hover:underline">
                  {transferidosSemLead} {transferidosSemLead === 1 ? "aceitou" : "aceitaram"} pelo robô sem cadastro no painel
                </Link>
              </p>
            ) : null}
          </section>
        );
      })}
    </div>
  );
}
