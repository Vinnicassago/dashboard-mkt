import Link from "next/link";
import { Info } from "lucide-react";

/** Honest notice that the dashboard is showing the example seed dataset. */
export function ExampleBanner() {
  return (
    <div className="flex items-start gap-2.5 rounded-lg border border-primary/25 bg-primary/[0.06] px-4 py-3 text-sm">
      <Info className="mt-0.5 size-4 shrink-0 text-primary" />
      <p className="text-muted-foreground">
        <span className="font-medium text-foreground">Dados de exemplo.</span> Você
        está vendo um dataset fictício para o dashboard ficar "vivo". Importe seus
        números reais em{" "}
        <Link href="/config" className="font-medium text-primary underline-offset-2 hover:underline">
          Importar / Config
        </Link>
        .
      </p>
    </div>
  );
}
