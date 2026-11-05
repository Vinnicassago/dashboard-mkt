/**
 * Fase 1 (nov/26), etapa C — a linha da Fila na tela (`components/fila/fila-list.tsx`),
 * renderizada no servidor: o que cada grupo oferece e o que some sem WhatsApp. A
 * régua da linha (grupos, prazos, motivos) é de `lib/fila.ts` — aqui só a tela.
 */
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { FilaEtapa, FilaGrupo, FilaItem } from "../fila";

vi.mock("next/navigation", () => ({
  usePathname: () => "/fila",
  useSearchParams: () => new URLSearchParams("range=7d"),
  useRouter: () => ({ refresh: () => {}, push: () => {}, replace: () => {} }),
}));
vi.mock("next/link", async () => {
  const { createElement: h } = await import("react");
  return {
    default: ({ href, children, ...resto }: { href: string; children?: ReactNode }) => h("a", { href, ...resto }, children),
  };
});
// As server actions não rodam aqui: a tela só as chama no clique.
vi.mock("@/app/(dashboard)/leads/actions", () => ({
  changeLeadStatus: vi.fn(),
  desfazerTentativa: vi.fn(),
  marcarReuniao: vi.fn(),
  registrarTentativa: vi.fn(),
  reabrirLead: vi.fn(),
}));

const brt = (dia: string, hhmm: string) => new Date(`${dia}T${hhmm}:00-03:00`).toISOString();
const AGORA = brt("2026-11-04", "15:00");

const item = (id: string, etapa: FilaEtapa, extra: Partial<FilaItem> = {}): FilaItem => ({
  id: `lead:${id}`,
  etapa,
  nome: `Pessoa ${id}`,
  telefone: "5511987650001",
  leadId: id,
  status: "em_contato",
  atraso: 0.2,
  horasEsperando: 0.5,
  tambemEm: [],
  ...extra,
});
const grupo = (etapa: FilaEtapa, itens: FilaItem[]): FilaGrupo => ({ etapa, itens, total: itens.length, foraDoPrazo: 0 });

async function tela(grupos: FilaGrupo[], props: Record<string, unknown> = {}) {
  const { FilaList } = await import("@/components/fila/fila-list");
  return renderToStaticMarkup(
    createElement(FilaList, { grupos, canEdit: true, mensagemWhatsapp: "Oi {nome}", agora: AGORA, roboLigado: true, ...props }),
  );
}
/** O trecho do HTML da linha de uma pessoa. */
const linha = (html: string, nome: string) => {
  const i = html.indexOf(nome);
  return html.slice(i, html.indexOf("</li>", i));
};

describe("a linha da Fila", () => {
  it("resgate “sem WhatsApp”: sem o botão de WhatsApp (o robô viu que o número não tem)", async () => {
    const html = await tela([
      grupo("resgate", [
        item("semzap", "resgate", { motivo: "sem-whatsapp" }),
        item("comzap", "resgate", { motivo: "robo-nao-falou" }),
      ]),
    ]);
    expect(linha(html, "Pessoa semzap")).not.toContain("wa.me");
    expect(linha(html, "Pessoa semzap")).toContain("sem WhatsApp");
    expect(linha(html, "Pessoa comzap")).toContain("wa.me");
  });

  it("opt-out: sem WhatsApp e com a etiqueta “não quer mensagens” (11.12)", async () => {
    const html = await tela([grupo("resgate", [item("optout", "resgate", { motivo: "retorno" })])], {
      extras: { optout: { optOut: true } },
    });
    expect(linha(html, "Pessoa optout")).not.toContain("wa.me");
    expect(linha(html, "Pessoa optout")).toContain("não quer mensagens");
  });

  it("“não respondeu ao robô”: a medida (“1ª msg há 1 d 2 h”), não a régua", async () => {
    const html = await tela([grupo("resgate", [item("saudada", "resgate", { motivo: "sem-resposta-24h" })])], {
      extras: { saudada: { primeiraMsgEm: brt("2026-11-03", "13:00") } },
    });
    expect(linha(html, "Pessoa saudada")).toContain("1ª msg há 1 d 2 h");
    // Sem a saudação deste episódio (reaberto), o motivo em palavras.
    const sem = await tela([grupo("resgate", [item("reaberta", "resgate", { motivo: "sem-resposta-24h" })])]);
    expect(linha(sem, "Pessoa reaberta")).toContain("não respondeu ao robô");
  });

  it("“a confirmar”: Confirmada · Pediu para remarcar; com o robô desligado, também o Desfecho▾ de antes", async () => {
    const confirmar = [item("reuniao", "confirmar", { status: "agendado", jaAgendou: true, reuniao: brt("2026-11-05", "10:00") })];
    const ligado = linha(await tela([grupo("confirmar", confirmar)]), "Pessoa reuniao");
    expect(ligado).toContain("Confirmada");
    expect(ligado).toContain("Pediu para remarcar");
    expect(ligado).not.toContain("Desfecho");
    const desligado = linha(await tela([grupo("confirmar", confirmar)], { roboLigado: false }), "Pessoa reuniao");
    expect(desligado).toContain("Confirmada");
    expect(desligado).toContain("Desfecho");
  });

  it("o bloco de ações encolhe e quebra (sem `shrink-0`): a 375 px os botões não empurram a página para o lado", async () => {
    const html = await tela([grupo("convite-aceito", [item("aceitou", "convite-aceito")])]);
    const l = linha(html, "Pessoa aceitou");
    expect(l).toContain("ml-auto flex min-w-0 flex-wrap");
    expect(l).not.toContain("shrink-0");
  });

  it("“N aceitaram pelo robô sem cadastro no painel” abre Integrações no robô, com o período", async () => {
    const html = await tela([grupo("convite-aceito", [])], { transferidosSemLead: 3 });
    expect(html).toContain('href="/configuracoes/integracoes?range=7d#robo"');
    expect(html).toContain("3 aceitaram pelo robô sem cadastro no painel");
  });
});
