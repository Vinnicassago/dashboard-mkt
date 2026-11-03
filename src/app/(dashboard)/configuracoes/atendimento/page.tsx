import { Clock, Scale } from "lucide-react";
import { TabelaDeParcelaForm } from "@/components/config/atendimento-forms";
import { ExpedienteForm } from "@/components/config/expediente-form";
import { expedienteAtual } from "@/lib/atendimento-server";
import { SemPermissao } from "@/components/config/sem-permissao";
import { RolarParaAncora } from "@/components/ui/rolar-para-ancora";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { tabelaDeParcela } from "@/lib/classe-server";
import { contextoDeConfiguracoes } from "../_carregar";

export const dynamic = "force-dynamic";

/**
 * Configurações → Atendimento e classe: a régua que decide quem entra na Fila e
 * com que prazo — a tabela de parcela da classe A/B/C/X. Editar é de quem cuida
 * dos dados (administrador e marketing); o comercial vê.
 */
export default async function AtendimentoPage({ searchParams }: { searchParams: Promise<{ range?: string }> }) {
  const ctx = await contextoDeConfiguracoes(searchParams);
  if (!ctx.papeis.dados && !ctx.papeis.leads) {
    return (
      <div className="max-w-3xl space-y-6">
        <SemPermissao quem="Administrador, Marketing e Comercial" oque="veem a régua do atendimento" />
      </div>
    );
  }
  const [tabela, expediente] = await Promise.all([tabelaDeParcela(), expedienteAtual()]);

  return (
    <div className="max-w-4xl space-y-6">
      <RolarParaAncora />
      <p className="text-sm text-muted-foreground">
        A régua do atendimento: quem é A, B, C ou X e, por isso, quem entra na Fila de contato e com que prazo.
      </p>

      <Card className="scroll-mt-24">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Clock className="size-4 text-primary" />
            Turno, feriados e prazos
          </CardTitle>
          <CardDescription>
            A “hora útil” da Fila da live: o turno de quem liga, os dias sem expediente, as faixas que o inscrito
            escolhe e a cadência das tentativas. Vale para os inscritos com classe; quem entrou sem as respostas
            segue a régua de sempre (seg–sex, 9h–18h).
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ExpedienteForm atual={expediente} podeEditar={ctx.papeis.dados} />
        </CardContent>
      </Card>

      <Card id="tabela-parcela" className="scroll-mt-24">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Scale className="size-4 text-primary" />
            Tabela de parcela (classe)
          </CardTitle>
          <CardDescription>
            Provisória — troque pela da administradora quando ela chegar. Para cada bem e faixa de valor, a
            parcela mínima que a pessoa precisa marcar; abaixo dela, ou abaixo do valor mínimo, a classe é C.
            Salvar recalcula a classe de todos os leads com respostas.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <TabelaDeParcelaForm atual={tabela} podeEditar={ctx.papeis.dados} />
        </CardContent>
      </Card>
    </div>
  );
}
