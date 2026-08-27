import { existsSync, readFileSync } from "node:fs";
import { BudgetSchema, type Budget } from "./schemas.js";

export const DEFAULT_BUDGET: Budget = {
  maxDiscoverySearchesPerProject: 12,
  maxCandidatesPerProject: 60,
  maxRetainedPapers: 20,
  cacheTtlDays: 7,
  requestTimeoutMs: 15000,
  arxivMinDelayMs: 3000,
};

export function loadBudget(configPath: string): Budget {
  if (!existsSync(configPath)) return DEFAULT_BUDGET;
  const raw = JSON.parse(readFileSync(configPath, "utf-8"));
  const merged = { ...DEFAULT_BUDGET, ...raw };
  return BudgetSchema.parse(merged);
}
