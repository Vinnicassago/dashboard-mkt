/**
 * Formulários de Configurações — ponto único de importação.
 *
 * Eram 988 linhas num arquivo só; agora moram em um arquivo por vista (Fase
 * 6.6): `importar-forms`, `marcas-forms`, `integracoes-forms`, `perigo-forms`,
 * `ferramentas-forms`, `metas-forms` e `registros-forms` (os registros manuais
 * do Instagram, que Conteúdo → Registros importa daqui). Todo nome que já saía
 * deste módulo continua saindo dele.
 */
export * from "./form-primitives";
export * from "./registros-forms";
export * from "./importar-forms";
export * from "./marcas-forms";
export * from "./integracoes-forms";
export * from "./perigo-forms";
export * from "./ferramentas-forms";
export { BudgetForm, GoalsForm } from "./metas-forms";
