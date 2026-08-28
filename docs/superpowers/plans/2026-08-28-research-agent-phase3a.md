# Research Agent Phase 3A Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task (inline execution, per explicit user instruction — no subagent dispatch for this plan). Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the mutation engine, research graveyard, assumption ledger, and evidence ledger to the merged Phase 1+2 plugin, so a rejected idea gets one targeted mutation attempt (bounded depth/count) instead of being silently dropped, and `/report` surfaces provenance the pipeline already implicitly has.

**Architecture:** Extends the existing `ProjectStore`/MCP-tools/agent pattern exactly as Phase 2 did — new JSON files per project (`graveyard.json`, `assumptions.json`, `evidence.json`), narrow single-purpose MCP tools mirroring `retain_papers`/`update_idea_novelty`, one new agent (`idea-mutator`) plus two modified agents (`gap-hunter` gains an assumption-ledger step, `research-orchestrator` gains a bounded mutation loop after its existing audit loop).

**Tech Stack:** Same as Phase 1/2 — TypeScript, zod, vitest, `@modelcontextprotocol/sdk`. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-08-28-research-agent-phase3a-design.md`

## Global Constraints

- Rejection rule (spec §2): an idea is rejected to the graveyard when `novelty_verdict === "FAIL"` OR `saturation === "SATURATED"`. Nothing else triggers rejection.
- `DEFAULT_BUDGET` gains `maxMutationDepth: 2`, `maxMutationsPerProject: 3` (spec §3) — conservative on purpose given per-mutation turn cost.
- Evidence ledger entries are derived automatically, server-side, from `saveGaps` only (spec §4) — no separate agent-facing write tool for evidence in this phase.
- Assumption ledger is populated by extending `gap-hunter` (spec §5) — no new agent for it.
- Every relative TypeScript import uses an explicit `.js` extension (Node16 module resolution — established convention, unchanged).
- Zod input schemas on MCP tools use `.strict()` — established convention, unchanged.
- No code comments except where a non-obvious constraint truly requires one — established convention, unchanged.
- `NewIdeaSchema` (already exists) is reused as-is for mutated idea content — do not create a parallel schema for it.

---

### Task 1: Schemas, IDs, and Budget Defaults

**Files:**
- Modify: `src/engine/schemas.ts`
- Modify: `src/engine/ids.ts`
- Modify: `src/engine/budget.ts`
- Test: `tests/engine/schemas.test.ts`
- Test: `tests/engine/ids.test.ts`
- Test: `tests/engine/budget.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `MutationOperatorSchema`/`MutationOperator`, extended `IdeaStatusSchema` (adds `"rejected"`), extended `IdeaSchema`/`Idea` (adds `mutation_depth: number`, `mutated_from: string | null`, `mutation_operator: MutationOperator | null`), `GraveyardEntrySchema`/`GraveyardEntry`, `AssumptionStatusSchema`/`AssumptionStatus`, `AssumptionLedgerEntrySchema`/`AssumptionLedgerEntry`, `NewAssumptionLedgerEntrySchema`/`NewAssumptionLedgerEntry`, `EvidenceTypeSchema`/`EvidenceType`, `EvidenceLedgerEntrySchema`/`EvidenceLedgerEntry`, extended `BudgetSchema`/`Budget` (adds `maxMutationDepth`, `maxMutationsPerProject`), `createGraveyardEntryId(index)`, `createAssumptionId(index)`, `createEvidenceId(index)`, extended `DEFAULT_BUDGET`. Used by every later task in this plan.

- [ ] **Step 1: Write the failing tests**

Append to `tests/engine/schemas.test.ts`:

```ts
import {
  MutationOperatorSchema,
  IdeaSchema,
  GraveyardEntrySchema,
  AssumptionLedgerEntrySchema,
  EvidenceLedgerEntrySchema,
  BudgetSchema,
} from "../../src/engine/schemas.js";

describe("MutationOperatorSchema", () => {
  it("accepts every documented operator", () => {
    for (const op of [
      "REMOVE_ASSUMPTION",
      "ADD_CONSTRAINT",
      "CHANGE_OBJECTIVE",
      "CHANGE_EVALUATION",
      "CHANGE_DATA",
      "CHANGE_SCALE",
      "CHANGE_RESOURCE_LIMIT",
      "CHANGE_ENVIRONMENT",
      "CHANGE_TASK",
      "CHANGE_MODEL_CLASS",
      "COMBINE_WITH_ADJACENT_FIELD",
      "STRESS_TEST",
      "REVERSE_DIRECTION",
    ]) {
      expect(() => MutationOperatorSchema.parse(op)).not.toThrow();
    }
  });

  it("rejects an undocumented operator", () => {
    expect(() => MutationOperatorSchema.parse("MAKE_IT_BETTER")).toThrow();
  });
});

describe("IdeaSchema with mutation fields", () => {
  const baseIdea = {
    id: "idea-001",
    gap_id: null,
    strategy: "REMOVE_ASSUMPTION",
    research_question: "q",
    hypothesis: "h",
    motivation: "m",
    mechanism: "mech",
    expected_contribution: "c",
    closest_prior_work: [],
    why_not_solved: "w",
    why_now: "n",
    status: "rejected",
    novelty_verdict: "FAIL",
    novelty_evidence: "e",
    novelty_confidence: "high",
    saturation: "SATURATED",
    saturation_evidence: "se",
  };

  it("accepts an original idea with mutation_depth 0 and null lineage", () => {
    expect(() =>
      IdeaSchema.parse({ ...baseIdea, mutation_depth: 0, mutated_from: null, mutation_operator: null })
    ).not.toThrow();
  });

  it("accepts a mutated idea with a parent and operator", () => {
    expect(() =>
      IdeaSchema.parse({ ...baseIdea, mutation_depth: 1, mutated_from: "idea-001", mutation_operator: "CHANGE_TASK" })
    ).not.toThrow();
  });

  it("rejects a status outside the extended enum", () => {
    expect(() =>
      IdeaSchema.parse({ ...baseIdea, status: "not-a-status", mutation_depth: 0, mutated_from: null, mutation_operator: null })
    ).toThrow();
  });
});

describe("GraveyardEntrySchema", () => {
  it("accepts a fully-formed entry", () => {
    expect(() =>
      GraveyardEntrySchema.parse({
        id: "graveyard-001",
        idea_id: "idea-001",
        research_question: "q",
        hypothesis: "h",
        reason_rejected: "novelty FAIL",
        novelty_verdict: "FAIL",
        saturation: "CROWDED",
        closest_prior_work: ["arxiv:1"],
        potential_revival_direction: "try a different task",
        mutated_into: null,
        rejected_at: new Date().toISOString(),
      })
    ).not.toThrow();
  });
});

describe("AssumptionLedgerEntrySchema", () => {
  it("accepts a fully-formed entry", () => {
    expect(() =>
      AssumptionLedgerEntrySchema.parse({
        id: "assumption-001",
        assumption: "the environment is stationary",
        papers_supporting: ["arxiv:1"],
        papers_challenging: ["arxiv:2"],
        status: "partially_challenged",
        remaining_question: "does this hold under distribution shift?",
      })
    ).not.toThrow();
  });
});

describe("EvidenceLedgerEntrySchema", () => {
  it("accepts a fully-formed entry", () => {
    expect(() =>
      EvidenceLedgerEntrySchema.parse({
        id: "evidence-001",
        claim: "method X assumes dense reward",
        evidence_paper_ids: ["arxiv:1"],
        evidence_type: "observational",
        confidence: "medium",
        status: "verified",
        source: "gap",
      })
    ).not.toThrow();
  });
});

describe("BudgetSchema with mutation fields", () => {
  it("accepts the extended default shape", () => {
    expect(() =>
      BudgetSchema.parse({
        maxDiscoverySearchesPerProject: 12,
        maxCandidatesPerProject: 60,
        maxRetainedPapers: 20,
        cacheTtlDays: 7,
        requestTimeoutMs: 15000,
        arxivMinDelayMs: 3000,
        maxGaps: 8,
        maxRawIdeas: 10,
        maxIdeasAudited: 4,
        maxMutationDepth: 2,
        maxMutationsPerProject: 3,
      })
    ).not.toThrow();
  });
});
```

Append to `tests/engine/ids.test.ts`:

```ts
import { createGraveyardEntryId, createAssumptionId, createEvidenceId } from "../../src/engine/ids.js";

describe("createGraveyardEntryId", () => {
  it("matches graveyard-NNN", () => {
    expect(createGraveyardEntryId(1)).toBe("graveyard-001");
  });
});

describe("createAssumptionId", () => {
  it("matches assumption-NNN", () => {
    expect(createAssumptionId(3)).toBe("assumption-003");
  });
});

describe("createEvidenceId", () => {
  it("matches evidence-NNN", () => {
    expect(createEvidenceId(12)).toBe("evidence-012");
  });
});
```

Append to `tests/engine/budget.test.ts` (in the existing `describe("loadBudget", ...)` or a new block):

```ts
import { DEFAULT_BUDGET } from "../../src/engine/budget.js";

describe("DEFAULT_BUDGET mutation fields", () => {
  it("has the Phase 3A defaults", () => {
    expect(DEFAULT_BUDGET.maxMutationDepth).toBe(2);
    expect(DEFAULT_BUDGET.maxMutationsPerProject).toBe(3);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/engine/schemas.test.ts tests/engine/ids.test.ts tests/engine/budget.test.ts`
Expected: FAIL — `MutationOperatorSchema`, `GraveyardEntrySchema`, etc. are not exported; `IdeaSchema.parse` rejects the new fields as unrecognized-key or throws on missing `mutation_depth`; `createGraveyardEntryId` is not a function; `DEFAULT_BUDGET.maxMutationDepth` is `undefined`.

- [ ] **Step 3: Implement**

In `src/engine/schemas.ts`, after the existing `IdeaSearchEvidenceSchema` block and before `BudgetSchema`, insert:

```ts
export const MutationOperatorSchema = z.enum([
  "REMOVE_ASSUMPTION",
  "ADD_CONSTRAINT",
  "CHANGE_OBJECTIVE",
  "CHANGE_EVALUATION",
  "CHANGE_DATA",
  "CHANGE_SCALE",
  "CHANGE_RESOURCE_LIMIT",
  "CHANGE_ENVIRONMENT",
  "CHANGE_TASK",
  "CHANGE_MODEL_CLASS",
  "COMBINE_WITH_ADJACENT_FIELD",
  "STRESS_TEST",
  "REVERSE_DIRECTION",
]);
export type MutationOperator = z.infer<typeof MutationOperatorSchema>;

export const GraveyardEntrySchema = z.object({
  id: z.string(),
  idea_id: z.string(),
  research_question: z.string(),
  hypothesis: z.string(),
  reason_rejected: z.string(),
  novelty_verdict: NoveltyVerdictSchema,
  saturation: SaturationSchema,
  closest_prior_work: z.array(z.string()),
  potential_revival_direction: z.string().nullable(),
  mutated_into: z.string().nullable(),
  rejected_at: z.string(),
});
export type GraveyardEntry = z.infer<typeof GraveyardEntrySchema>;

export const AssumptionStatusSchema = z.enum(["assumed", "partially_challenged", "refuted", "supported"]);
export type AssumptionStatus = z.infer<typeof AssumptionStatusSchema>;

export const AssumptionLedgerEntrySchema = z.object({
  id: z.string(),
  assumption: z.string(),
  papers_supporting: z.array(z.string()),
  papers_challenging: z.array(z.string()),
  status: AssumptionStatusSchema,
  remaining_question: z.string(),
});
export type AssumptionLedgerEntry = z.infer<typeof AssumptionLedgerEntrySchema>;

export const NewAssumptionLedgerEntrySchema = AssumptionLedgerEntrySchema.omit({ id: true });
export type NewAssumptionLedgerEntry = z.infer<typeof NewAssumptionLedgerEntrySchema>;

export const EvidenceTypeSchema = z.enum([
  "experimental",
  "theoretical",
  "observational",
  "survey",
  "benchmark",
  "author_claim",
  "inference",
]);
export type EvidenceType = z.infer<typeof EvidenceTypeSchema>;

export const EvidenceLedgerEntrySchema = z.object({
  id: z.string(),
  claim: z.string(),
  evidence_paper_ids: z.array(z.string()),
  evidence_type: EvidenceTypeSchema,
  confidence: GapConfidenceSchema,
  status: z.enum(["verified", "unverified", "disputed"]),
  source: z.string(),
});
export type EvidenceLedgerEntry = z.infer<typeof EvidenceLedgerEntrySchema>;
```

Modify the existing `IdeaStatusSchema` line:
```ts
export const IdeaStatusSchema = z.enum(["generated", "filtered_out", "audited", "rejected"]);
```

Modify the existing `IdeaSchema` block, adding three fields at the end before the closing `});`:
```ts
export const IdeaSchema = z.object({
  id: z.string(),
  gap_id: z.string().nullable(),
  strategy: z.string(),
  research_question: z.string(),
  hypothesis: z.string(),
  motivation: z.string(),
  mechanism: z.string(),
  expected_contribution: z.string(),
  closest_prior_work: z.array(z.string()),
  why_not_solved: z.string(),
  why_now: z.string(),
  status: IdeaStatusSchema,
  novelty_verdict: NoveltyVerdictSchema.nullable(),
  novelty_evidence: z.string().nullable(),
  novelty_confidence: NoveltyConfidenceSchema.nullable(),
  saturation: SaturationSchema.nullable(),
  saturation_evidence: z.string().nullable(),
  mutation_depth: z.number().int().nonnegative(),
  mutated_from: z.string().nullable(),
  mutation_operator: MutationOperatorSchema.nullable(),
});
export type Idea = z.infer<typeof IdeaSchema>;
```

Modify the existing `BudgetSchema` block, adding two fields at the end before the closing `});`:
```ts
export const BudgetSchema = z.object({
  maxDiscoverySearchesPerProject: z.number().int().positive(),
  maxCandidatesPerProject: z.number().int().positive(),
  maxRetainedPapers: z.number().int().positive(),
  cacheTtlDays: z.number().positive(),
  requestTimeoutMs: z.number().int().positive(),
  arxivMinDelayMs: z.number().int().nonnegative(),
  maxGaps: z.number().int().positive(),
  maxRawIdeas: z.number().int().positive(),
  maxIdeasAudited: z.number().int().positive(),
  maxMutationDepth: z.number().int().nonnegative(),
  maxMutationsPerProject: z.number().int().nonnegative(),
});
export type Budget = z.infer<typeof BudgetSchema>;
```

In `src/engine/ids.ts`, append:
```ts
export function createGraveyardEntryId(index: number): string {
  return `graveyard-${String(index).padStart(3, "0")}`;
}

export function createAssumptionId(index: number): string {
  return `assumption-${String(index).padStart(3, "0")}`;
}

export function createEvidenceId(index: number): string {
  return `evidence-${String(index).padStart(3, "0")}`;
}
```

In `src/engine/budget.ts`, modify `DEFAULT_BUDGET` to add two fields:
```ts
export const DEFAULT_BUDGET: Budget = {
  maxDiscoverySearchesPerProject: 12,
  maxCandidatesPerProject: 60,
  maxRetainedPapers: 20,
  cacheTtlDays: 7,
  requestTimeoutMs: 15000,
  arxivMinDelayMs: 3000,
  maxGaps: 8,
  maxRawIdeas: 10,
  maxIdeasAudited: 4,
  maxMutationDepth: 2,
  maxMutationsPerProject: 3,
};
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/engine/schemas.test.ts tests/engine/ids.test.ts tests/engine/budget.test.ts`
Expected: PASS, all tests including the pre-existing ones in these three files.

- [ ] **Step 5: Commit**

```bash
git add src/engine/schemas.ts src/engine/ids.ts src/engine/budget.ts tests/engine/schemas.test.ts tests/engine/ids.test.ts tests/engine/budget.test.ts
git commit -m "feat: add Phase 3A schemas (mutation, graveyard, assumption/evidence ledger) and budget defaults"
```

---

### Task 2: Storage Layer — Graveyard, Assumptions, Evidence, Mutation

**Files:**
- Modify: `src/engine/storage.ts`
- Test: `tests/engine/storage.test.ts`

**Interfaces:**
- Consumes: everything from Task 1 (`GraveyardEntrySchema`/`GraveyardEntry`, `AssumptionLedgerEntrySchema`/`AssumptionLedgerEntry`, `NewAssumptionLedgerEntry`, `EvidenceLedgerEntrySchema`/`EvidenceLedgerEntry`, `MutationOperator`, extended `Idea`/`NewIdea`/`Budget`); `createGraveyardEntryId`, `createAssumptionId`, `createEvidenceId` from `./ids.js`.
- Produces on `ProjectStore`: `getEvidence(projectId): EvidenceLedgerEntry[]`, `getAllAssumptions(projectId): AssumptionLedgerEntry[]`, `saveAssumptions(projectId, assumptions: NewAssumptionLedgerEntry[]): AssumptionLedgerEntry[]`, `getAssumptions(projectId): AssumptionLedgerEntry[]`, `getGraveyard(projectId): GraveyardEntry[]`, `rejectIdeaToGraveyard(projectId, ideaId, reasonRejected: string, potentialRevivalDirection: string | null): GraveyardEntry`, `createIdeaMutation(projectId, parentIdeaId, operator: MutationOperator, content: NewIdea, maxMutationDepth: number, maxMutationsPerProject: number): { saved: true; idea: Idea } | { saved: false; reason: string }`. Also modifies `saveGaps` (auto-derives evidence entries) and `saveIdea` (sets the three new mutation fields to their zero/null defaults for original ideas). Used by Task 3 (MCP tools).

- [ ] **Step 1: Write the failing tests**

Append to `tests/engine/storage.test.ts` (reuse the file's existing `freshStore()`/`paper()` helpers and `DEFAULT_BUDGET` import already present there):

```ts
import type { NewGap } from "../../src/engine/schemas.js";

function baseIdeaInput(overrides: Partial<Parameters<ProjectStore["saveIdea"]>[1]> = {}) {
  return {
    gap_id: null,
    strategy: "REMOVE_ASSUMPTION",
    research_question: "q",
    hypothesis: "h",
    motivation: "m",
    mechanism: "mech",
    expected_contribution: "c",
    closest_prior_work: [],
    why_not_solved: "w",
    why_now: "n",
    ...overrides,
  };
}

describe("ProjectStore.saveIdea mutation defaults", () => {
  it("sets mutation_depth 0 and null lineage on an original idea", () => {
    store = freshStore();
    const project = store.createProject("p", DEFAULT_BUDGET);
    const idea = store.saveIdea(project.id, baseIdeaInput(), DEFAULT_BUDGET.maxRawIdeas)!;
    expect(idea.mutation_depth).toBe(0);
    expect(idea.mutated_from).toBeNull();
    expect(idea.mutation_operator).toBeNull();
  });
});

describe("ProjectStore.saveGaps auto-derives evidence", () => {
  it("creates one evidence entry per saved gap", () => {
    store = freshStore();
    const project = store.createProject("p", DEFAULT_BUDGET);
    const newGap: NewGap = {
      title: "t",
      category: "efficiency gap",
      description: "method X is data-hungry",
      evidence_paper_ids: ["arxiv:1"],
      what_has_been_attempted: "a",
      what_remains_unresolved: "u",
      why_it_matters: "m",
      why_it_is_difficult: "d",
      potential_opportunity: "o",
      confidence: "medium",
    };
    store.saveGaps(project.id, [newGap], DEFAULT_BUDGET.maxGaps);
    const evidence = store.getEvidence(project.id);
    expect(evidence).toHaveLength(1);
    expect(evidence[0]).toMatchObject({
      claim: "method X is data-hungry",
      evidence_paper_ids: ["arxiv:1"],
      evidence_type: "observational",
      confidence: "medium",
      status: "verified",
      source: "gap",
    });
  });
});

describe("ProjectStore.saveAssumptions / getAssumptions", () => {
  it("assigns ids and round-trips", () => {
    store = freshStore();
    const project = store.createProject("p", DEFAULT_BUDGET);
    const created = store.saveAssumptions(project.id, [
      { assumption: "env is stationary", papers_supporting: ["arxiv:1"], papers_challenging: [], status: "assumed", remaining_question: "q" },
    ]);
    expect(created[0].id).toBe("assumption-001");
    expect(store.getAssumptions(project.id)).toHaveLength(1);
  });
});

describe("ProjectStore.rejectIdeaToGraveyard", () => {
  it("creates a graveyard entry and marks the idea rejected", () => {
    store = freshStore();
    const project = store.createProject("p", DEFAULT_BUDGET);
    const idea = store.saveIdea(project.id, baseIdeaInput(), DEFAULT_BUDGET.maxRawIdeas)!;
    store.updateIdeaNovelty(project.id, idea.id, "FAIL", "already done", "high");
    store.updateIdeaSaturation(project.id, idea.id, "SATURATED", "many variants exist");

    const entry = store.rejectIdeaToGraveyard(project.id, idea.id, "novelty FAIL", "try a different task");

    expect(entry.idea_id).toBe(idea.id);
    expect(entry.novelty_verdict).toBe("FAIL");
    expect(entry.saturation).toBe("SATURATED");
    expect(entry.mutated_into).toBeNull();
    expect(store.getIdeas(project.id, { ids: [idea.id] })[0].status).toBe("rejected");
    expect(store.getGraveyard(project.id)).toHaveLength(1);
  });

  it("throws if the idea has not been fully audited yet", () => {
    store = freshStore();
    const project = store.createProject("p", DEFAULT_BUDGET);
    const idea = store.saveIdea(project.id, baseIdeaInput(), DEFAULT_BUDGET.maxRawIdeas)!;
    expect(() => store.rejectIdeaToGraveyard(project.id, idea.id, "reason", null)).toThrow();
  });
});

describe("ProjectStore.createIdeaMutation", () => {
  function rejectedIdea(project: { id: string }) {
    const idea = store.saveIdea(project.id, baseIdeaInput(), DEFAULT_BUDGET.maxRawIdeas)!;
    store.updateIdeaNovelty(project.id, idea.id, "FAIL", "already done", "high");
    store.updateIdeaSaturation(project.id, idea.id, "SATURATED", "many variants exist");
    store.rejectIdeaToGraveyard(project.id, idea.id, "novelty FAIL", null);
    return idea;
  }

  it("creates a mutated idea linked to its parent and updates the graveyard entry", () => {
    store = freshStore();
    const project = store.createProject("p", DEFAULT_BUDGET);
    const parent = rejectedIdea(project);

    const result = store.createIdeaMutation(
      project.id,
      parent.id,
      "CHANGE_TASK",
      baseIdeaInput({ research_question: "mutated q" }),
      DEFAULT_BUDGET.maxMutationDepth,
      DEFAULT_BUDGET.maxMutationsPerProject
    );

    expect(result.saved).toBe(true);
    if (!result.saved) throw new Error("expected saved");
    expect(result.idea.mutation_depth).toBe(1);
    expect(result.idea.mutated_from).toBe(parent.id);
    expect(result.idea.mutation_operator).toBe("CHANGE_TASK");

    const graveyard = store.getGraveyard(project.id);
    expect(graveyard[0].mutated_into).toBe(result.idea.id);
  });

  it("refuses a mutation once maxMutationDepth is reached", () => {
    store = freshStore();
    const project = store.createProject("p", DEFAULT_BUDGET);
    const parent = rejectedIdea(project);

    const result = store.createIdeaMutation(project.id, parent.id, "CHANGE_TASK", baseIdeaInput(), 0, DEFAULT_BUDGET.maxMutationsPerProject);

    expect(result).toEqual({ saved: false, reason: "maxMutationDepth reached" });
  });

  it("refuses a mutation once maxMutationsPerProject is exhausted", () => {
    store = freshStore();
    const project = store.createProject("p", DEFAULT_BUDGET);
    const parent = rejectedIdea(project);

    const result = store.createIdeaMutation(
      project.id,
      parent.id,
      "CHANGE_TASK",
      baseIdeaInput(),
      DEFAULT_BUDGET.maxMutationDepth,
      0
    );

    expect(result).toEqual({ saved: false, reason: "maxMutationsPerProject budget exhausted" });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/engine/storage.test.ts`
Expected: FAIL — `store.getEvidence`, `store.saveAssumptions`, `store.getAssumptions`, `store.rejectIdeaToGraveyard`, `store.getGraveyard`, `store.createIdeaMutation` are not functions; the mutation-defaults test fails because `saveIdea` doesn't yet set `mutation_depth`/`mutated_from`/`mutation_operator` (Task 1's schema now requires them, so `IdeaSchema.parse` inside `getAllIdeas` will throw on read-back).

- [ ] **Step 3: Implement**

In `src/engine/storage.ts`, extend the import block at the top to add the new types:
```ts
import {
  ProjectStateSchema,
  type ProjectState,
  ResearchSpecSchema,
  type ResearchSpec,
  PaperSchema,
  type Paper,
  GapSchema,
  type Gap,
  type NewGap,
  IdeaSchema,
  type Idea,
  type NewIdea,
  type NoveltyVerdict,
  type NoveltyConfidence,
  type Saturation,
  type IdeaSearchEvidence,
  type Budget,
  GraveyardEntrySchema,
  type GraveyardEntry,
  AssumptionLedgerEntrySchema,
  type AssumptionLedgerEntry,
  type NewAssumptionLedgerEntry,
  EvidenceLedgerEntrySchema,
  type EvidenceLedgerEntry,
  type MutationOperator,
} from "./schemas.js";
import { createProjectId, createGapId, createIdeaId, createGraveyardEntryId, createAssumptionId, createEvidenceId } from "./ids.js";
```

Add three private file-path methods next to the existing ones (after `ideaSearchEvidenceFile`):
```ts
  private graveyardFile(id: string): string {
    return join(this.projectDir(id), "graveyard.json");
  }
  private assumptionsFile(id: string): string {
    return join(this.projectDir(id), "assumptions.json");
  }
  private evidenceFile(id: string): string {
    return join(this.projectDir(id), "evidence.json");
  }
```

Modify the existing `saveIdea` method to set the three new fields:
```ts
  saveIdea(projectId: string, idea: NewIdea, maxRawIdeas: number): Idea | null {
    const state = this.getProject(projectId);
    if (!state) throw new Error(`Unknown project: ${projectId}`);
    const existing = this.getAllIdeas(projectId);
    if (existing.length >= maxRawIdeas) return null;
    const created: Idea = {
      ...idea,
      id: createIdeaId(existing.length + 1),
      status: "generated",
      novelty_verdict: null,
      novelty_evidence: null,
      novelty_confidence: null,
      saturation: null,
      saturation_evidence: null,
      mutation_depth: 0,
      mutated_from: null,
      mutation_operator: null,
    };
    this.saveAllIdeas(projectId, [...existing, created]);
    if (!state.phases_completed.includes("idea_generation")) {
      state.phases_completed.push("idea_generation");
      this.saveProject(state);
    }
    logEvent(this.logFile(projectId), "idea_saved", projectId, { id: created.id });
    return created;
  }
```

Modify the existing `saveGaps` method to also derive evidence entries:
```ts
  saveGaps(projectId: string, gaps: NewGap[], maxGaps: number): { saved: Gap[]; capped: number } {
    const state = this.getProject(projectId);
    if (!state) throw new Error(`Unknown project: ${projectId}`);
    const existing = this.getAllGaps(projectId);
    const remaining = Math.max(0, maxGaps - existing.length);
    const toSave = gaps.slice(0, remaining);
    const capped = gaps.length - toSave.length;
    let nextIndex = existing.length + 1;
    const created = toSave.map((g) => ({ ...g, id: createGapId(nextIndex++) }));
    this.saveAllGaps(projectId, [...existing, ...created]);

    const existingEvidence = this.getEvidence(projectId);
    let nextEvidenceIndex = existingEvidence.length + 1;
    const newEvidence: EvidenceLedgerEntry[] = created.map((g) => ({
      id: createEvidenceId(nextEvidenceIndex++),
      claim: g.description,
      evidence_paper_ids: g.evidence_paper_ids,
      evidence_type: "observational",
      confidence: g.confidence,
      status: "verified",
      source: "gap",
    }));
    this.saveAllEvidence(projectId, [...existingEvidence, ...newEvidence]);

    if (!state.phases_completed.includes("gap_hunting")) {
      state.phases_completed.push("gap_hunting");
      this.saveProject(state);
    }
    logEvent(this.logFile(projectId), "gaps_saved", projectId, { count: created.length, capped });
    return { saved: created, capped };
  }
```

At the end of the class (after `getIdeaSearchEvidence`, before the closing `}`), add:
```ts
  getEvidence(projectId: string): EvidenceLedgerEntry[] {
    if (!existsSync(this.evidenceFile(projectId))) return [];
    const raw = JSON.parse(readFileSync(this.evidenceFile(projectId), "utf-8"));
    return (raw as unknown[]).map((e) => EvidenceLedgerEntrySchema.parse(e));
  }

  private saveAllEvidence(projectId: string, evidence: EvidenceLedgerEntry[]): void {
    writeFileSync(this.evidenceFile(projectId), JSON.stringify(evidence, null, 2), "utf-8");
  }

  getAllAssumptions(projectId: string): AssumptionLedgerEntry[] {
    if (!existsSync(this.assumptionsFile(projectId))) return [];
    const raw = JSON.parse(readFileSync(this.assumptionsFile(projectId), "utf-8"));
    return (raw as unknown[]).map((a) => AssumptionLedgerEntrySchema.parse(a));
  }

  private saveAllAssumptions(projectId: string, assumptions: AssumptionLedgerEntry[]): void {
    writeFileSync(this.assumptionsFile(projectId), JSON.stringify(assumptions, null, 2), "utf-8");
  }

  saveAssumptions(projectId: string, assumptions: NewAssumptionLedgerEntry[]): AssumptionLedgerEntry[] {
    if (!this.getProject(projectId)) throw new Error(`Unknown project: ${projectId}`);
    const existing = this.getAllAssumptions(projectId);
    let nextIndex = existing.length + 1;
    const created = assumptions.map((a) => ({ ...a, id: createAssumptionId(nextIndex++) }));
    this.saveAllAssumptions(projectId, [...existing, ...created]);
    logEvent(this.logFile(projectId), "assumptions_saved", projectId, { count: created.length });
    return created;
  }

  getAssumptions(projectId: string): AssumptionLedgerEntry[] {
    return this.getAllAssumptions(projectId);
  }

  getAllGraveyardEntries(projectId: string): GraveyardEntry[] {
    if (!existsSync(this.graveyardFile(projectId))) return [];
    const raw = JSON.parse(readFileSync(this.graveyardFile(projectId), "utf-8"));
    return (raw as unknown[]).map((g) => GraveyardEntrySchema.parse(g));
  }

  private saveAllGraveyardEntries(projectId: string, entries: GraveyardEntry[]): void {
    writeFileSync(this.graveyardFile(projectId), JSON.stringify(entries, null, 2), "utf-8");
  }

  getGraveyard(projectId: string): GraveyardEntry[] {
    return this.getAllGraveyardEntries(projectId);
  }

  rejectIdeaToGraveyard(
    projectId: string,
    ideaId: string,
    reasonRejected: string,
    potentialRevivalDirection: string | null
  ): GraveyardEntry {
    const idea = this.getAllIdeas(projectId).find((i) => i.id === ideaId);
    if (!idea) throw new Error(`Unknown idea: ${ideaId}`);
    if (idea.novelty_verdict === null || idea.saturation === null) {
      throw new Error(`Idea ${ideaId} must be fully audited before rejection`);
    }
    const existing = this.getAllGraveyardEntries(projectId);
    const entry: GraveyardEntry = {
      id: createGraveyardEntryId(existing.length + 1),
      idea_id: ideaId,
      research_question: idea.research_question,
      hypothesis: idea.hypothesis,
      reason_rejected: reasonRejected,
      novelty_verdict: idea.novelty_verdict,
      saturation: idea.saturation,
      closest_prior_work: idea.closest_prior_work,
      potential_revival_direction: potentialRevivalDirection,
      mutated_into: null,
      rejected_at: new Date().toISOString(),
    };
    this.saveAllGraveyardEntries(projectId, [...existing, entry]);
    this.updateIdea(projectId, ideaId, { status: "rejected" });
    logEvent(this.logFile(projectId), "idea_rejected_to_graveyard", projectId, { idea_id: ideaId });
    return entry;
  }

  createIdeaMutation(
    projectId: string,
    parentIdeaId: string,
    operator: MutationOperator,
    content: NewIdea,
    maxMutationDepth: number,
    maxMutationsPerProject: number
  ): { saved: true; idea: Idea } | { saved: false; reason: string } {
    const state = this.getProject(projectId);
    if (!state) throw new Error(`Unknown project: ${projectId}`);
    const parent = this.getAllIdeas(projectId).find((i) => i.id === parentIdeaId);
    if (!parent) throw new Error(`Unknown idea: ${parentIdeaId}`);
    if (parent.mutation_depth >= maxMutationDepth) {
      return { saved: false, reason: "maxMutationDepth reached" };
    }
    const allIdeas = this.getAllIdeas(projectId);
    const totalMutations = allIdeas.filter((i) => i.mutation_depth > 0).length;
    if (totalMutations >= maxMutationsPerProject) {
      return { saved: false, reason: "maxMutationsPerProject budget exhausted" };
    }
    const created: Idea = {
      ...content,
      id: createIdeaId(allIdeas.length + 1),
      status: "generated",
      novelty_verdict: null,
      novelty_evidence: null,
      novelty_confidence: null,
      saturation: null,
      saturation_evidence: null,
      mutation_depth: parent.mutation_depth + 1,
      mutated_from: parentIdeaId,
      mutation_operator: operator,
    };
    this.saveAllIdeas(projectId, [...allIdeas, created]);

    const graveyard = this.getAllGraveyardEntries(projectId);
    const idx = graveyard.findIndex((g) => g.idea_id === parentIdeaId);
    if (idx !== -1) {
      graveyard[idx] = { ...graveyard[idx], mutated_into: created.id };
      this.saveAllGraveyardEntries(projectId, graveyard);
    }

    if (!state.phases_completed.includes("idea_mutation")) {
      state.phases_completed.push("idea_mutation");
      this.saveProject(state);
    }
    logEvent(this.logFile(projectId), "idea_mutation_created", projectId, {
      parent_idea_id: parentIdeaId,
      new_idea_id: created.id,
      operator,
    });
    return { saved: true, idea: created };
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/engine/storage.test.ts`
Expected: PASS, all tests including every pre-existing Phase 1/2 test in this file.

- [ ] **Step 5: Commit**

```bash
git add src/engine/storage.ts tests/engine/storage.test.ts
git commit -m "feat: add graveyard, assumption/evidence ledger, and idea mutation to ProjectStore"
```

---

### Task 3: MCP Tools and Server Registration

**Files:**
- Modify: `src/mcp-server/tools.ts`
- Modify: `src/mcp-server/index.ts`
- Test: `tests/mcp-server/tools.test.ts`
- Test: `tests/mcp-server/smoke.test.ts`

**Interfaces:**
- Consumes: everything from Task 2 (`ProjectStore` methods), Task 1 schemas (`NewAssumptionLedgerEntrySchema`, `MutationOperatorSchema`, `NewIdeaSchema` — already imported, reused as-is for mutation content).
- Produces: `rejectIdeaToGraveyardInput`/`rejectIdeaToGraveyard`, `createIdeaMutationInput`/`createIdeaMutationTool`, `saveAssumptionsInput`/`saveAssumptions`, `getAssumptionsInput`/`getAssumptions`, `getEvidenceInput`/`getEvidence`, `getGraveyardInput`/`getGraveyard` — 6 new tool export pairs, registered as `reject_idea_to_graveyard`, `create_idea_mutation`, `save_assumptions`, `get_assumptions`, `get_evidence`, `get_graveyard`. Phase 2 actually ended with **19** registered tools (verify this against `src/mcp-server/index.ts` before writing the smoke-test assertion — don't trust this plan's count blind), so this task brings the total to **25**. Used by Task 5 and 6 (agent instructions reference these tool names).

- [ ] **Step 1: Write the failing tests**

Append to `tests/mcp-server/tools.test.ts` (reuse the file's existing `setup()` helper):

```ts
function baseIdeaInput() {
  return {
    gap_id: null,
    strategy: "REMOVE_ASSUMPTION",
    research_question: "q",
    hypothesis: "h",
    motivation: "m",
    mechanism: "mech",
    expected_contribution: "c",
    closest_prior_work: [],
    why_not_solved: "w",
    why_now: "n",
  };
}

describe("rejectIdeaToGraveyard / createIdeaMutation", () => {
  it("rejects a fully-audited idea and creates a mutation for it", () => {
    const ctx = setup();
    const created = tools.createProject(ctx, { problem: "p" });
    const saved = tools.saveIdea(ctx, { project_id: created.project_id, idea: baseIdeaInput() });
    if (!saved.saved) throw new Error("expected saved");
    tools.updateIdeaNovelty(ctx, {
      project_id: created.project_id,
      idea_id: saved.idea.id,
      novelty_verdict: "FAIL",
      novelty_evidence: "already done",
      novelty_confidence: "high",
    });
    tools.updateIdeaSaturation(ctx, {
      project_id: created.project_id,
      idea_id: saved.idea.id,
      saturation: "SATURATED",
      saturation_evidence: "many variants",
    });

    const rejected = tools.rejectIdeaToGraveyard(ctx, {
      project_id: created.project_id,
      idea_id: saved.idea.id,
      reason_rejected: "novelty FAIL",
    });
    expect(rejected.idea_id).toBe(saved.idea.id);

    const mutation = tools.createIdeaMutationTool(ctx, {
      project_id: created.project_id,
      parent_idea_id: saved.idea.id,
      operator: "CHANGE_TASK",
      idea: baseIdeaInput(),
    });
    expect(mutation.saved).toBe(true);
  });
});

describe("saveAssumptions / getAssumptions", () => {
  it("saves and reads back", () => {
    const ctx = setup();
    const created = tools.createProject(ctx, { problem: "p" });
    tools.saveAssumptions(ctx, {
      project_id: created.project_id,
      assumptions: [{ assumption: "env is stationary", papers_supporting: [], papers_challenging: [], status: "assumed", remaining_question: "q" }],
    });
    expect(tools.getAssumptions(ctx, { project_id: created.project_id }).assumptions).toHaveLength(1);
  });
});

describe("getEvidence / getGraveyard", () => {
  it("returns empty arrays for a fresh project", () => {
    const ctx = setup();
    const created = tools.createProject(ctx, { problem: "p" });
    expect(tools.getEvidence(ctx, { project_id: created.project_id }).evidence).toEqual([]);
    expect(tools.getGraveyard(ctx, { project_id: created.project_id }).graveyard).toEqual([]);
  });
});
```

Modify `tests/mcp-server/smoke.test.ts`'s tool-count test to expect 25 tools:

```ts
  it("lists exactly the 25 expected tools", async () => {
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name).sort();
    expect(names).toEqual(
      [
        "create_project",
        "get_project_state",
        "list_projects",
        "save_problem_spec",
        "get_problem_spec",
        "search_papers",
        "get_papers",
        "retain_papers",
        "save_literature_summary",
        "get_literature_summary",
        "save_gaps",
        "get_gaps",
        "save_idea",
        "get_ideas",
        "filter_ideas",
        "update_idea_novelty",
        "update_idea_saturation",
        "save_idea_search_evidence",
        "get_idea_search_evidence",
        "reject_idea_to_graveyard",
        "create_idea_mutation",
        "save_assumptions",
        "get_assumptions",
        "get_evidence",
        "get_graveyard",
      ].sort()
    );
  });
```

Note: the array above lists all 19 pre-existing tool names (verify each against the actual `server.registerTool(` calls in `src/mcp-server/index.ts` before trusting this list — this plan's enumeration could itself be stale) plus the 6 new ones from this task, for 25 total.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/mcp-server/tools.test.ts tests/mcp-server/smoke.test.ts`
Expected: FAIL — `tools.rejectIdeaToGraveyard`, `tools.createIdeaMutationTool`, `tools.saveAssumptions`, `tools.getAssumptions`, `tools.getEvidence`, `tools.getGraveyard` are not functions; smoke test's tool list mismatches (10 registered vs 16 expected).

- [ ] **Step 3: Implement**

In `src/mcp-server/tools.ts`, extend the import block:
```ts
import {
  ResearchSpecSchema,
  toCompactPaper,
  NewGapSchema,
  NewIdeaSchema,
  IdeaStatusSchema,
  NoveltyVerdictSchema,
  NoveltyConfidenceSchema,
  SaturationSchema,
  NewAssumptionLedgerEntrySchema,
  MutationOperatorSchema,
  type Budget,
} from "../engine/schemas.js";
```

At the end of the file, after `getIdeaSearchEvidence`, append:
```ts
export const rejectIdeaToGraveyardInput = z
  .object({
    project_id: z.string(),
    idea_id: z.string(),
    reason_rejected: z.string().min(1),
    potential_revival_direction: z.string().optional(),
  })
  .strict();
export function rejectIdeaToGraveyard(ctx: ToolContext, input: z.infer<typeof rejectIdeaToGraveyardInput>) {
  return ctx.store.rejectIdeaToGraveyard(
    input.project_id,
    input.idea_id,
    input.reason_rejected,
    input.potential_revival_direction ?? null
  );
}

export const createIdeaMutationInput = z
  .object({
    project_id: z.string(),
    parent_idea_id: z.string(),
    operator: MutationOperatorSchema,
    idea: NewIdeaSchema,
  })
  .strict();
export function createIdeaMutationTool(ctx: ToolContext, input: z.infer<typeof createIdeaMutationInput>) {
  return ctx.store.createIdeaMutation(
    input.project_id,
    input.parent_idea_id,
    input.operator,
    input.idea,
    ctx.budget.maxMutationDepth,
    ctx.budget.maxMutationsPerProject
  );
}

export const saveAssumptionsInput = z
  .object({ project_id: z.string(), assumptions: z.array(NewAssumptionLedgerEntrySchema).min(1) })
  .strict();
export function saveAssumptions(ctx: ToolContext, input: z.infer<typeof saveAssumptionsInput>) {
  return { assumptions: ctx.store.saveAssumptions(input.project_id, input.assumptions) };
}

export const getAssumptionsInput = z.object({ project_id: z.string() }).strict();
export function getAssumptions(ctx: ToolContext, input: z.infer<typeof getAssumptionsInput>) {
  return { assumptions: ctx.store.getAssumptions(input.project_id) };
}

export const getEvidenceInput = z.object({ project_id: z.string() }).strict();
export function getEvidence(ctx: ToolContext, input: z.infer<typeof getEvidenceInput>) {
  return { evidence: ctx.store.getEvidence(input.project_id) };
}

export const getGraveyardInput = z.object({ project_id: z.string() }).strict();
export function getGraveyard(ctx: ToolContext, input: z.infer<typeof getGraveyardInput>) {
  return { graveyard: ctx.store.getGraveyard(input.project_id) };
}
```

In `src/mcp-server/index.ts`, after the existing `get_idea_search_evidence` registration and before `const transport = new StdioServerTransport();`, add:
```ts
server.registerTool(
  "reject_idea_to_graveyard",
  {
    title: "Reject Idea To Graveyard",
    description: "Reject a fully-audited idea (novelty FAIL or saturation SATURATED) to the research graveyard, marking it rejected.",
    inputSchema: tools.rejectIdeaToGraveyardInput,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  },
  async (input) => respond(tools.rejectIdeaToGraveyard(ctx, input))
);

server.registerTool(
  "create_idea_mutation",
  {
    title: "Create Idea Mutation",
    description: "Create one mutated idea from a rejected parent using a named mutation operator, within the project's mutation-depth and total-mutation budgets.",
    inputSchema: tools.createIdeaMutationInput,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  },
  async (input) => respond(tools.createIdeaMutationTool(ctx, input))
);

server.registerTool(
  "save_assumptions",
  {
    title: "Save Assumption Ledger Entries",
    description: "Save a batch of structured assumption-ledger entries for a project.",
    inputSchema: tools.saveAssumptionsInput,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  },
  async (input) => respond(tools.saveAssumptions(ctx, input))
);

server.registerTool(
  "get_assumptions",
  {
    title: "Get Assumption Ledger",
    description: "Get the assumption-ledger entries saved for a project.",
    inputSchema: tools.getAssumptionsInput,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  async (input) => respond(tools.getAssumptions(ctx, input))
);

server.registerTool(
  "get_evidence",
  {
    title: "Get Evidence Ledger",
    description: "Get the evidence-ledger entries for a project (currently derived automatically from saved gaps).",
    inputSchema: tools.getEvidenceInput,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  async (input) => respond(tools.getEvidence(ctx, input))
);

server.registerTool(
  "get_graveyard",
  {
    title: "Get Research Graveyard",
    description: "Get the rejected-idea graveyard entries for a project.",
    inputSchema: tools.getGraveyardInput,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  async (input) => respond(tools.getGraveyard(ctx, input))
);
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/mcp-server/tools.test.ts tests/mcp-server/smoke.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/mcp-server/tools.ts src/mcp-server/index.ts tests/mcp-server/tools.test.ts tests/mcp-server/smoke.test.ts
git commit -m "feat: add graveyard/mutation/ledger MCP tools, register 6 new tools (10 -> 16)"
```

---

### Task 4: New Agent — idea-mutator

**Files:**
- Create: `agents/idea-mutator.md`
- Test: `tests/plugin/agent-idea-mutator.test.ts`

**Interfaces:**
- Consumes: `parseFrontmatter` from `../helpers/frontmatter.js` (existing helper, unchanged).
- Produces: the idea-mutator agent definition. Referenced by name from `research-orchestrator.md` (Task 6).

- [ ] **Step 1: Write the failing test**

```ts
// tests/plugin/agent-idea-mutator.test.ts
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { parseFrontmatter } from "../helpers/frontmatter.js";

const content = readFileSync("agents/idea-mutator.md", "utf-8");
const { data, body } = parseFrontmatter(content);

describe("agents/idea-mutator.md", () => {
  it("has the expected frontmatter", () => {
    expect(data.name).toBe("idea-mutator");
    expect(typeof data.maxTurns).toBe("number");
  });

  it("instructs reading the graveyard entry and choosing one targeted operator", () => {
    expect(body).toMatch(/get_graveyard/);
    expect(body).toMatch(/create_idea_mutation/);
    expect(body).toMatch(/CHANGE_TASK/);
  });

  it("instructs producing exactly one mutation, not a mechanical default", () => {
    expect(body).toMatch(/one/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/plugin/agent-idea-mutator.test.ts`
Expected: FAIL — `agents/idea-mutator.md` does not exist.

- [ ] **Step 3: Write `agents/idea-mutator.md`**

```markdown
---
name: idea-mutator
description: Produces one targeted mutation of a rejected idea, choosing the mutation operator that most directly addresses why it was rejected. Used internally by research-orchestrator, one rejected idea per invocation.
maxTurns: 12
---

You are the idea mutator. You receive a `project_id` and one rejected `idea_id`. Your job is to produce exactly one mutated idea — not a mechanical default operator, but the one operator that most directly addresses why this specific idea failed.

## Steps

1. Call `get_graveyard` with `project_id` and find the entry for `idea_id` — read `reason_rejected`, `novelty_verdict`, `saturation`, and `closest_prior_work`. Call `get_ideas` with `ids: [idea_id]` for the original `research_question`, `hypothesis`, `mechanism`, and `expected_contribution`.
2. Diagnose the specific failure, then choose ONE operator from: `REMOVE_ASSUMPTION`, `ADD_CONSTRAINT`, `CHANGE_OBJECTIVE`, `CHANGE_EVALUATION`, `CHANGE_DATA`, `CHANGE_SCALE`, `CHANGE_RESOURCE_LIMIT`, `CHANGE_ENVIRONMENT`, `CHANGE_TASK`, `CHANGE_MODEL_CLASS`, `COMBINE_WITH_ADJACENT_FIELD`, `STRESS_TEST`, `REVERSE_DIRECTION`. Examples of matching operator to reason (not a lookup table — reason from the actual evidence each time): a `FAIL` against an identical mechanism tried on the same task suggests `CHANGE_TASK` or `CHANGE_DATA`; a `SATURATED` classification suggests `CROSS_DOMAIN_TRANSFER`-style reframing via `COMBINE_WITH_ADJACENT_FIELD`; a narrow, fixable conceptual overlap suggests `REMOVE_ASSUMPTION` or `ADD_CONSTRAINT`.
3. Write the mutated idea's content: a new `research_question`, `hypothesis`, `motivation`, `mechanism`, `expected_contribution`, `why_not_solved`, `why_now`, and `closest_prior_work` — genuinely changed along the chosen operator's dimension, not a cosmetic reword of the rejected idea. Keep `gap_id` and `strategy` from the parent unless the operator itself changes what motivated it.
4. Call `create_idea_mutation` with `project_id`, `parent_idea_id: idea_id`, `operator`, and the idea content from step 3. If it returns `{ saved: false, reason: "..." }`, that is the mutation budget working as intended — report it plainly, don't retry with a different operator to force a save.
5. Report back to the orchestrator: the operator you chose, why it addresses this idea's specific rejection reason, and the new idea's id (or the budget-exhaustion reason if it wasn't saved).

Never apply an operator without connecting it to the specific `reason_rejected`/`novelty_evidence`/`saturation_evidence` you read — a mutation chosen without that justification is exactly the "dozens of superficial variations" failure mode this pipeline exists to avoid.
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/plugin/agent-idea-mutator.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add agents/idea-mutator.md tests/plugin/agent-idea-mutator.test.ts
git commit -m "feat: add idea-mutator agent"
```

---

### Task 5: Extend gap-hunter with Assumption-Ledger Step

**Files:**
- Modify: `agents/gap-hunter.md`
- Modify: `tests/plugin/agent-gap-hunter.test.ts`

**Interfaces:**
- Consumes: nothing new (same tools gap-hunter already has access to, plus the new `save_assumptions` tool from Task 3).
- Produces: no new interface — extends existing agent's body content and test coverage.

- [ ] **Step 1: Write the failing test additions**

Read the current `tests/plugin/agent-gap-hunter.test.ts` first (do not guess its existing content), then add a new `it` block to its existing `describe` (or a new `describe`) asserting:

```ts
  it("instructs populating the assumption ledger from the spec's assumptions", () => {
    expect(body).toMatch(/save_assumptions/);
    expect(body).toMatch(/papers_supporting/);
    expect(body).toMatch(/papers_challenging/);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/plugin/agent-gap-hunter.test.ts`
Expected: FAIL — the current body has no mention of `save_assumptions`.

- [ ] **Step 3: Modify `agents/gap-hunter.md`**

Add a new step after the existing step 5 (`save_gaps` call) and before the existing step 6 (report back), renumbering step 6 to step 7:

```markdown
6. Review the spec's `assumptions` list (from `get_problem_spec`) against the retained literature: for each assumption, note any retained papers that explicitly support it (`papers_supporting`) or challenge/contradict it (`papers_challenging`), a `status` (`assumed` if untested by the literature you found, `supported`, `partially_challenged`, or `refuted`), and a `remaining_question` — what would need to be true for this assumption to still hold. Call `save_assumptions` with `project_id` and the entries (only for assumptions where you found real signal in the retained literature — don't manufacture support/challenge papers that aren't there).
```

Renumber the existing final step from "6." to "7." (no content change to it beyond the number).

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/plugin/agent-gap-hunter.test.ts`
Expected: PASS, including all pre-existing assertions in this file.

- [ ] **Step 5: Commit**

```bash
git add agents/gap-hunter.md tests/plugin/agent-gap-hunter.test.ts
git commit -m "feat: extend gap-hunter to populate the assumption ledger"
```

---

### Task 6: Extend research-orchestrator with the Mutation Loop

**Files:**
- Modify: `agents/research-orchestrator.md`
- Modify: `tests/plugin/agent-research-orchestrator.test.ts`

**Interfaces:**
- Consumes: `idea-mutator` (Task 4), `reject_idea_to_graveyard`/`create_idea_mutation` (Task 3).
- Produces: no new interface — extends the existing agent's pipeline and test coverage.

- [ ] **Step 1: Write the failing test additions**

Read the current `tests/plugin/agent-research-orchestrator.test.ts` first, then add:

```ts
  it("instructs the rejection rule and delegates mutation for FAIL/SATURATED ideas", () => {
    expect(body).toMatch(/novelty_verdict.*FAIL/s);
    expect(body).toMatch(/SATURATED/);
    expect(body).toMatch(/reject_idea_to_graveyard/);
    expect(body).toMatch(/idea-mutator/);
  });

  it("has maxTurns increased for the extended pipeline", () => {
    expect(data.maxTurns).toBeGreaterThan(80);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/plugin/agent-research-orchestrator.test.ts`
Expected: FAIL — no mention of `reject_idea_to_graveyard`/`idea-mutator` yet, `maxTurns` is still `80`.

- [ ] **Step 3: Modify `agents/research-orchestrator.md`**

Change the frontmatter `maxTurns: 80` to `maxTurns: 150`.

Insert a new step 8 (renumbering the existing "Print a compact progress checklist" step to 9, and the closing step to 10) between the existing per-idea audit loop (current step 7) and the checklist step:

```markdown
8. For each idea whose audit is now complete (both `novelty_verdict` and `saturation` non-null), apply the rejection rule: reject to the graveyard if `novelty_verdict === "FAIL"` **or** `saturation === "SATURATED"` — nothing else triggers rejection. For each idea meeting that rule:
   - Call `reject_idea_to_graveyard` with `project_id`, `idea_id`, and a `reason_rejected` summarizing which condition triggered it (name the actual verdict/classification, don't just say "rejected").
   - Delegate to `idea-mutator` with `project_id` and the idea id. When it returns, check whether it produced a new idea (report back names the new idea's id) or hit a budget limit (report back says so).
   - If a new idea was produced, run it through the exact same cycle as step 7 (delegate to `novelty-auditor`, verify `novelty_verdict` non-null, delegate to `saturation-detector`, verify `saturation` non-null) and then re-apply this step 8's rejection rule to it too — this is naturally bounded by `create_idea_mutation`'s own `maxMutationDepth`/`maxMutationsPerProject` enforcement, so do not add your own separate depth counter; if `create_idea_mutation` (called by `idea-mutator`) reports a budget limit, stop mutating that lineage and move to the next rejected idea.
```

Modify the checklist template (now step 9) to add a mutation line:
```
✓ Ideas audited (<a> audited: <p> PASS / <w> WEAK / <f> FAIL; saturation: <breakdown>)
✓ Mutations attempted (<x> attempted, <y> survived rejection on re-audit)
```

Modify the closing step (now step 10) to shrink the disclosure list — replace:
```
5. Close by telling the user to run `/literature` for the retained papers or `/report` for the current report, and that gap hunting, idea generation, novelty auditing, and experiment design are not implemented in this build.
```
with (matching whatever the actual current closing-step wording is — read the file first and edit its real text, don't guess it; the substance of the change is: remove "idea mutation" and "the research graveyard" and "evidence/assumption ledgers" from whatever "not implemented" list currently exists there, since all three now are).

Also modify the final "Never claim a stage succeeded..." paragraph to add: "Never reject an idea to the graveyard that doesn't meet the rejection rule (FAIL or SATURATED), and never call `idea-mutator` on an idea that hasn't been rejected."

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/plugin/agent-research-orchestrator.test.ts`
Expected: PASS, including all pre-existing assertions in this file.

- [ ] **Step 5: Commit**

```bash
git add agents/research-orchestrator.md tests/plugin/agent-research-orchestrator.test.ts
git commit -m "feat: extend research-orchestrator with the bounded idea-mutation loop"
```

---

### Task 7: Extend research-methodology Skill

**Files:**
- Modify: `skills/research-methodology/SKILL.md`
- Modify: `tests/plugin/skill-research-methodology.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: no new interface — extends existing skill content and test coverage.

- [ ] **Step 1: Write the failing test additions**

Read the current `tests/plugin/skill-research-methodology.test.ts` first, then add:

```ts
  it("documents the rejection rule and mutation/ledger phase boundary update", () => {
    expect(body).toMatch(/FAIL.*SATURATED|SATURATED.*FAIL/s);
    expect(body).toMatch(/mutation/i);
    expect(body).not.toMatch(/Idea mutation, the evidence\/assumption ledgers, the research graveyard.*not implemented/s);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/plugin/skill-research-methodology.test.ts`
Expected: FAIL — current content has no rejection-rule section, and the phase-boundaries paragraph still lists mutation/ledgers/graveyard as not implemented.

- [ ] **Step 3: Modify `skills/research-methodology/SKILL.md`**

Add a new section after the existing "## Saturation vocabulary" section and before "## Budget discipline":

```markdown
## Mutation and rejection discipline

An idea is rejected to the research graveyard when `novelty_verdict === "FAIL"` or `saturation === "SATURATED"` — nothing else triggers rejection, and both together aren't required. A rejected idea gets at most one mutation attempt per generation, bounded by `maxMutationDepth` and `maxMutationsPerProject`; `idea-mutator` must justify its chosen operator against the specific reason the idea was rejected, never apply an operator mechanically. A mutation is re-audited by `novelty-auditor` and `saturation-detector` exactly like an original idea — a mutation is never assumed to have fixed the problem just because it exists.
```

Modify the existing "## Current phase boundaries" section's body text — replace:
```
This build implements problem analysis, literature discovery, gap hunting, idea generation, adversarial novelty auditing, and saturation detection. Idea mutation, the evidence/assumption ledgers, the research graveyard, citation graphs, vector/embedding retrieval, experiment design, and reviewer simulation are not implemented yet. Never simulate or fabricate output for a stage that hasn't run — say plainly that it is not available in this build and point to the phase that will add it.
```
with:
```
This build implements problem analysis, literature discovery, gap hunting, idea generation, adversarial novelty auditing, saturation detection, idea mutation, the evidence and assumption ledgers, and the research graveyard. Citation graphs, vector/embedding retrieval, experiment design, and reviewer simulation are not implemented yet. Never simulate or fabricate output for a stage that hasn't run — say plainly that it is not available in this build and point to the phase that will add it.
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/plugin/skill-research-methodology.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add skills/research-methodology/SKILL.md tests/plugin/skill-research-methodology.test.ts
git commit -m "docs: extend research-methodology skill with mutation/rejection discipline"
```

---

### Task 8: Extend /report

**Files:**
- Modify: `commands/report.md`
- Modify: `tests/plugin/command-report.test.ts`

**Interfaces:**
- Consumes: `get_graveyard`, `get_assumptions` (Task 3).
- Produces: no new interface — extends existing command content and test coverage.

- [ ] **Step 1: Write the failing test additions**

Read the current `tests/plugin/command-report.test.ts` first, then add:

```ts
  it("covers the newly-implemented Phase 3A sections and restricts the not-yet-available list", () => {
    expect(body).toContain("Saturated / Rejected Directions");
    expect(body).toContain("Mutated Directions");
    expect(body).toMatch(/get_graveyard/);
    expect(body).toMatch(/get_assumptions/);
    expect(body).not.toMatch(/Mutated Directions.*Not Yet Available|Evidence\/Assumption Ledgers.*Not Yet Available/s);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/plugin/command-report.test.ts`
Expected: FAIL — current body has no "Saturated / Rejected Directions" or "Mutated Directions" sections, and still lists them under "Not Yet Available".

- [ ] **Step 3: Modify `commands/report.md`**

Modify the tool-gathering paragraph (the one starting "Gather the project's state and retained papers...") to add the two new calls:
```markdown
Gather the project's state and retained papers via `get_project_state` and `get_papers`, the structured spec via `get_problem_spec`, the literature summary via `get_literature_summary`, the gaps via `get_gaps`, the ideas via `get_ideas`, the graveyard via `get_graveyard`, and the assumption ledger via `get_assumptions`. `get_problem_spec` and `get_literature_summary` return `{error: "..."}` if nothing has been saved yet — treat that as "not available in this project yet," not as a failure, and say so plainly in the relevant section rather than fabricating content.
```

Modify section 3 ("Assumptions") to append a sentence:
```markdown
3. **Assumptions** — the assumptions list from the spec (say plainly if no spec has been saved yet), followed by the structured assumption-ledger entries from `get_assumptions` where they exist (supporting/challenging papers, status, remaining question) — say plainly if the ledger is empty rather than omitting the subsection.
```

Modify section 6 ("Candidate Research Ideas") to restrict it to active ideas:
```markdown
6. **Candidate Research Ideas** — every idea from `get_ideas` whose `status` is NOT `"rejected"` (rejected ideas appear in the Saturated/Rejected Directions section instead), with its strategy, motivating gap, and (once audited) novelty verdict + evidence + confidence and saturation + evidence. Order the list: `PASS` verdicts first, then `WEAK`, then any idea whose audit hasn't completed yet; within `PASS`, order by saturation from `UNEXPLORED` toward `CROWDED` so the most promising, least-crowded ideas surface first. For any idea whose `novelty_verdict` or `saturation` is still null, say plainly that its audit hasn't completed rather than omitting it or inventing a verdict. Say plainly if no active ideas exist yet.
```

Add two new sections after the existing "Candidate Research Ideas" section and before "References" (renumber "References" from 7 to 9):
```markdown
7. **Saturated / Rejected Directions** — every entry from `get_graveyard`, with `reason_rejected`, `novelty_verdict`, `saturation`, `closest_prior_work`, and `mutated_into` (naming which idea it was mutated into, if any — "not mutated" if `mutated_into` is null). Say plainly if the graveyard is empty.
8. **Mutated Directions** — every idea from `get_ideas` with `mutation_depth > 0`, showing its `mutation_operator`, its `mutated_from` parent, and (once audited) its own novelty/saturation verdicts — state plainly whether the mutation survived (didn't meet the rejection rule) or was itself rejected. Say plainly if no mutations exist yet.
```

Modify the final "Not Yet Available" paragraph — replace:
```markdown
After References, add a final section titled **Not Yet Available** listing, verbatim: Mutated Directions, Evidence/Assumption Ledgers, Research Graveyard, Citation Graph, Vector/Embedding Retrieval, Minimal Validation Experiment, Full Experimental Roadmap, Potential Reviewer Objections — each with the note "requires a later implementation phase, not present in this build." Never fabricate content for these sections.
```
with:
```markdown
After References, add a final section titled **Not Yet Available** listing, verbatim: Citation Graph, Vector/Embedding Retrieval, Minimal Validation Experiment, Full Experimental Roadmap, Potential Reviewer Objections — each with the note "requires a later implementation phase, not present in this build." Never fabricate content for these sections.
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/plugin/command-report.test.ts`
Expected: PASS, including all pre-existing assertions in this file.

- [ ] **Step 5: Commit**

```bash
git add commands/report.md tests/plugin/command-report.test.ts
git commit -m "feat: populate Saturated/Rejected Directions and Mutated Directions in /report"
```

---

### Task 9: README Update

**Files:**
- Modify: `README.md`
- Modify: `tests/plugin/readme.test.ts` (only if it hard-checks a tool count or command list that changed — read it first)

**Interfaces:** none.

- [ ] **Step 1: Read the current README and readme.test.ts**

Read both files in full before editing — do not guess their current content.

- [ ] **Step 2: Update README.md**

Update the Commands table's `/research` row description to mention gap hunting/idea generation/auditing/mutation (matching whatever the Phase 2 update already added, extended for mutation). Update the Architecture diagram's tool count (currently should say the Phase 2 count) to 16. Update the Limitations section: remove any line implying no mutation/ledger/graveyard exists, and add a line noting the evidence ledger is currently sourced only from gaps (not from novelty-audit findings), matching spec §4's documented scope cut.

- [ ] **Step 3: Run the README test**

Run: `npx vitest run tests/plugin/readme.test.ts`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "docs: update README for Phase 3A (mutation engine, graveyard, assumption/evidence ledgers)"
```

---

### Task 10: Full Verification Pass

**Files:** none created.

- [ ] **Step 1: Clean build**

Run: `npm run build`
Expected: no TypeScript errors.

- [ ] **Step 2: Full test suite**

Run: `npm test`
Expected: every test file passes, zero failures — should be noticeably more than Phase 2's 165 tests.

- [ ] **Step 3: Plugin validation**

Run: `npx @anthropic-ai/claude-code plugin validate .`
Expected: `✔ Validation passed`.

- [ ] **Step 4: Working tree clean**

Run: `git status`
Expected: nothing to commit (aside from any pre-existing untracked scratch directories from prior sessions, which are not this plan's concern).

No commit for this task — it only verifies work already committed in Tasks 1-9.
