import { MessageCircle } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Info } from "@/components/ui/info";
import { AMOSTRA_MINIMA } from "@/lib/cascata";
import {
  textoDasConquistas,
  textoDoDiagnostico,
  textoDoRaioX,
  type LinhaSemInscricao,
  type ResumoDepoisDaInscricao,
} from "@/lib/diagnostico-live";
import { formatDateTimeCurta, formatInt, formatPercent } from "@/lib/format";
import { normalizarTelefone, telefoneUtilizavel } from "@/lib/phone";

/**
 * Os ⓘ do bloco (cada frase ≤ 25 palavras, a régua de `t3-leads-tela.test.ts`).
 * O texto mora aqui, nunca embaixo do título.
 */
export const SOBRE_DEPOIS_DA_INSCRICAO = [
  "As pessoas da live nesta lista (o período vale pela data de entrada) e o que fizeram depois de se inscrever.",
  "Comunidade é o 1º clique em “Entrar na comunidade”, na página de obrigado.",
  "O diagnóstico vale pela tentativa mais avançada: concluída vence incompleta e, entre iguais, vale a mais recente.",
  "Chegar à pergunta N é ter respondido as anteriores; a pergunta 1 é de quem começou.",
  "Horários de Brasília, da hora em que o evento chegou ao painel.",
].join(" ");

export const SOBRE_SEM_INSCRICAO = [
  "Diagnósticos cujo WhatsApp não bate com nenhum lead (DDD e os 8 últimos dígitos, com e sem o nono dígito).",
  "Nada se perde: quando o lead aparecer, o diagnóstico passa para ele.",
].join(" ");

const th = "px-2 py-1.5 text-left text-xs font-medium text-muted-foreground";
const td = "px-2 py-1.5 tabular-nums";

/** "30 (75%)": a taxa só com base de verdade (`AMOSTRA_MINIMA`), nunca acima da base. */
function comTaxa(n: number, base: number): string {
  if (base < AMOSTRA_MINIMA || n > base) return formatInt(n);
  return `${formatInt(n)} (${formatPercent(n / base, 0)})`;
}

/**
 * "Live · N de M concluíram o diagnóstico" — o resumo do período de Leads: quantos
 * se inscreveram, clicaram na comunidade, começaram e concluíram o diagnóstico, e
 * quantos chegaram a cada pergunta; recolhido, o diagnóstico sem inscrição. Tudo
 * em tabela (a régua do texto conta só o título e o rótulo do recolhido).
 */
export function DepoisDaInscricao({
  resumo,
  semInscricao,
  mascarar,
}: {
  resumo: ResumoDepoisDaInscricao;
  /** Já mascarado para o papel Marketing. */
  semInscricao: LinhaSemInscricao[];
  mascarar: boolean;
}) {
  const titulo =
    resumo.inscritos > 0
      ? `Live · ${formatInt(resumo.concluiram)} de ${formatInt(resumo.inscritos)} concluíram o diagnóstico`
      : "Live · nenhum inscrito no período";
  return (
    <Card id="depois-da-inscricao" className="scroll-mt-24">
      <CardHeader>
        <CardTitle className="flex items-center gap-0.5" data-titulo>
          <span className="min-w-0">{titulo}</span>
          <Info texto={SOBRE_DEPOIS_DA_INSCRICAO} rotulo="Sobre o depois da inscrição" className="-my-1" />
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {resumo.inscritos > 0 ? (
          <div className="grid gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
            <div className="overflow-x-auto rounded-lg border">
              <table className="w-full text-sm">
                <thead className="border-b bg-muted/40">
                  <tr>
                    <th className={th}>Inscritos</th>
                    <th className={th}>Clicaram na comunidade</th>
                    <th className={th}>Começaram o diagnóstico</th>
                    <th className={th}>Concluíram</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td className={td}>{formatInt(resumo.inscritos)}</td>
                    <td className={td}>{comTaxa(resumo.comunidade, resumo.inscritos)}</td>
                    <td className={td}>{comTaxa(resumo.comecaram, resumo.inscritos)}</td>
                    <td className={td}>{comTaxa(resumo.concluiram, resumo.inscritos)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <div className="overflow-x-auto rounded-lg border">
              <table className="w-full text-sm" aria-label="Quantas pessoas chegaram a cada pergunta do diagnóstico">
                <thead className="border-b bg-muted/40">
                  <tr>
                    <th className={th}>Pergunta</th>
                    {resumo.chegaram.map((_, i) => (
                      <th key={i} className={`${th} text-right`}>
                        {i + 1}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <th scope="row" className={th}>
                      Chegaram
                    </th>
                    {resumo.chegaram.map((n, i) => (
                      <td key={i} className={`${td} text-right`}>
                        {formatInt(n)}
                      </td>
                    ))}
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        ) : null}

        {semInscricao.length ? (
          <details id="diagnostico-sem-inscricao" className="scroll-mt-24 rounded-lg border">
            <summary className="cursor-pointer px-3 py-2 text-sm font-semibold select-none">Diagnóstico sem inscrição</summary>
            <div className="space-y-2 px-3 pb-3">
              <div className="flex justify-end">
                <Info texto={SOBRE_SEM_INSCRICAO} rotulo="Sobre o diagnóstico sem inscrição" />
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="border-b">
                    <tr>
                      <th className={th}>WhatsApp</th>
                      <th className={th}>Diagnóstico</th>
                      <th className={th}>Começou</th>
                      <th className={th}>Último evento</th>
                      <th className={th}>Raio-x e conquistas</th>
                      <th className={`${th} text-right`}>Tentativas</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {semInscricao.map((s) => (
                      <tr key={`${s.telefone}-${s.resumo.iniciadoEm}`}>
                        <td className={td}>
                          {mascarar || !telefoneUtilizavel(s.telefone) ? (
                            s.telefone
                          ) : (
                            <a
                              href={`https://wa.me/${normalizarTelefone(s.telefone)}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1 hover:underline"
                            >
                              <MessageCircle className="size-3 text-[var(--success-text)]" />
                              {s.telefone}
                            </a>
                          )}
                        </td>
                        <td className="px-2 py-1.5">{textoDoDiagnostico(s.resumo)}</td>
                        <td className={`${td} whitespace-nowrap`}>{formatDateTimeCurta(s.resumo.iniciadoEm)}</td>
                        <td className={`${td} whitespace-nowrap`}>{formatDateTimeCurta(s.ultimoEm)}</td>
                        <td className="px-2 py-1.5 text-xs text-muted-foreground">
                          {[
                            textoDoRaioX(s.resumo.notas),
                            s.resumo.conquistas !== undefined ? `${textoDasConquistas(s.resumo)} conquistas` : "",
                          ]
                            .filter(Boolean)
                            .join(" · ") || "—"}
                        </td>
                        <td className={`${td} text-right`}>{formatInt(s.resumo.tentativas)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </details>
        ) : null}
      </CardContent>
    </Card>
  );
}
