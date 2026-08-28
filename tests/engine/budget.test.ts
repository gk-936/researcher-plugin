import { describe, expect, it, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_BUDGET, loadBudget } from "../../src/engine/budget.js";

let dir: string;
afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
});

describe("loadBudget", () => {
  it("returns DEFAULT_BUDGET when the config file does not exist", () => {
    dir = mkdtempSync(join(tmpdir(), "budget-test-"));
    const budget = loadBudget(join(dir, "config.json"));
    expect(budget).toEqual(DEFAULT_BUDGET);
  });

  it("merges a partial override on top of defaults", () => {
    dir = mkdtempSync(join(tmpdir(), "budget-test-"));
    const configPath = join(dir, "config.json");
    writeFileSync(configPath, JSON.stringify({ maxRetainedPapers: 5 }));
    const budget = loadBudget(configPath);
    expect(budget.maxRetainedPapers).toBe(5);
    expect(budget.maxDiscoverySearchesPerProject).toBe(DEFAULT_BUDGET.maxDiscoverySearchesPerProject);
  });

  it("throws when the override has an invalid value", () => {
    dir = mkdtempSync(join(tmpdir(), "budget-test-"));
    const configPath = join(dir, "config.json");
    writeFileSync(configPath, JSON.stringify({ maxRetainedPapers: -5 }));
    expect(() => loadBudget(configPath)).toThrow();
  });
});

describe("DEFAULT_BUDGET", () => {
  it("includes the Phase 2 gap/idea budget fields", () => {
    expect(DEFAULT_BUDGET.maxGaps).toBe(8);
    expect(DEFAULT_BUDGET.maxRawIdeas).toBe(10);
    expect(DEFAULT_BUDGET.maxIdeasAudited).toBe(4);
  });

  it("includes the Phase 3A mutation budget fields", () => {
    expect(DEFAULT_BUDGET.maxMutationDepth).toBe(2);
    expect(DEFAULT_BUDGET.maxMutationsPerProject).toBe(3);
  });

  it("includes maxIdeasEvaluated", () => {
    expect(DEFAULT_BUDGET.maxIdeasEvaluated).toBe(3);
  });
});
