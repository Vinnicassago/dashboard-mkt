import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // ADR-03 — um número por métrica. Tela (e componente) não monta KPI com os
  // helpers de baixo nível: lê `kpisDoPeriodo` (lib/kpis.ts), que é a mesma
  // conta da cascata, do farol, do motor de ações e da IA.
  {
    files: ["src/app/**/*.{ts,tsx}", "src/components/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "@/lib/metrics",
              importNames: [
                "adKpis",
                "objectiveBreakdown",
                "overviewKpis",
                "filterLeads",
                "filterAds",
                "countMeetings",
                "countAttended",
                "countClients",
                "cpr",
                "reunioesNoPeriodo",
                "lossBreakdown",
                "lossByKind",
                "countLostAfterMeeting",
                "baldeDosLeads",
              ],
              message:
                "KPI em tela só via kpisDoPeriodo (lib/kpis.ts) — ADR-03: mesmo nome, mesmo número em todas as telas.",
            },
            {
              name: "@/lib/trust",
              importNames: ["assessTrust"],
              message: "A confiança dos números vem junto de kpisDoPeriodo (lib/kpis.ts).",
            },
          ],
        },
      ],
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
