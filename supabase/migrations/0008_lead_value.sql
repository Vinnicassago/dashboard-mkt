-- Valor da carta/contrato do lead (BRL), preenchido quando vira cliente.
-- Base para receita, CAC, ROI/ROAS e ticket médio (Fase 3 — do lead à receita).
-- Nullable: só clientes têm valor.

alter table leads add column if not exists value numeric;
