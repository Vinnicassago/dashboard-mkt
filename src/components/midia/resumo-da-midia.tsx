import Link from "next/link";
import { Info } from "@/components/ui/info";
import type { MidiaDaTela } from "@/lib/midia-tela";

/**
 * O RESUMO da Mídia (Fase 4, §2.2): UMA linha que abre com o investimento de
 * CONVERSÃO (o MESMO texto do cartão do Início), o CPL e o fato do custo por
 * reunião — `linhaDoResumo`, pronta em `montarMidiaDaTela`. O total e a descoberta
 * ficam no ⓘ. Embaixo, a linha do link para a conferência com o Gerenciador
 * (Configurações → Integrações `#conferir-gasto`); some na awareness.
 */
export function ResumoDaMidia({ resumo, conferir }: { resumo: MidiaDaTela["resumo"]; conferir: MidiaDaTela["conferir"] }) {
  return (
    <div className="space-y-1">
      {/* Texto e ⓘ em linha: o ⓘ acompanha a última palavra quando a linha quebra. */}
      <p data-parte="resumo" id="resumo" className="max-w-3xl scroll-mt-24 text-base leading-relaxed">
        <strong className="font-semibold">{resumo.texto}</strong>{" "}
        <Info texto={resumo.dica} rotulo="Sobre o resumo" className="-my-1" />
      </p>
      {conferir ? (
        <p data-parte="conferir" id="conferir" className="scroll-mt-24 text-sm">
          <Link href={conferir.href} className="font-medium text-primary underline-offset-4 hover:underline">
            {conferir.rotulo}
          </Link>
        </p>
      ) : null}
    </div>
  );
}
