# Research Agent Plugin — Phase 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the Phase 1 plugin so `/research <problem>` runs an end-to-end pipeline: problem analysis → literature discovery → gap hunting → idea generation → per-idea adversarial novelty audit + saturation classification → ranked, evidence-grounded report.

**Architecture:** Four new leaf agents (`gap-hunter`, `idea-generator`, `novelty-auditor`, `saturation-detector`), all direct children of `research-orchestrator` (never nested under each other). `research-orchestrator` gains two mandatory delegation steps, a cheap in-context filter step, and a per-idea audit loop. Nine new narrow MCP tools extend the existing pattern (thin `tools.ts` wrappers over `storage.ts` methods, registered in `index.ts`). Two new per-project JSON files (`gaps.json`, `ideas.json`) plus a third (`idea_search_evidence.json`) let `saturation-detector` reuse `novelty-auditor`'s search results across separate agent invocations.

**Tech Stack:** TypeScript, zod, `@modelcontextprotocol/sdk`, vitest — same as Phase 1, no new dependencies.

**Spec:** `docs/superpowers/specs/2026-08-28-research-agent-phase2-design.md` (read together with `docs/superpowers/specs/2026-08-27-research-agent-phase1-design.md` for the Phase 1 baseline this extends).

## Confirmed Answers to Spec §11 Open Questions

1. **Novelty-auditor search budget:** shared with literature discovery (`maxDiscoverySearchesPerProject`), not a separate pool. `get_project_state` gains a `searches_remaining` field so `novelty-auditor` can check before spending, and `research-methodology` skill states this explicitly.
2. **Saturation-detector access to novelty-auditor's search results:** new MCP tools `save_idea_search_evidence` / `get_idea_search_evidence`, backed by `idea_search_evidence.json`, keyed by idea id.
3. **Numeric budget defaults:** accepted as proposed — `maxGaps: 8`, `maxRawIdeas: 10`, `maxIdeasAudited: 4`.
4. **`research-orchestrator` `maxTurns`:** raised to `80` as proposed.
5. **Skill scope:** extend `skills/research-methodology/SKILL.md` in place rather than creating a new skill.

## Additional Decisions Made During Planning (filling gaps the spec left implicit)

- **Idea-shortlist filter tool:** the spec's tool list (§8) covers save/get/update but never named a tool for the orchestrator's own "dedupe/validate/cap" filter step (§4, §7) to actually mark dropped ideas. Adding `filter_ideas` (`project_id`, `drop_ids[]`) — sets `status: "filtered_out"` on exactly those ideas, leaves the rest untouched. Narrow, single-purpose, matches the rest of the tool set.
- **Id scheme:** `createGapId`/`createIdeaId` in `src/engine/ids.ts`, zero-padded sequential (`gap-001`, `idea-001`), assigned server-side in `storage.ts` — mirrors how `hashPaperId` is deterministic and ids are never client-supplied.
- **`Idea.status` → `"audited"` transition:** happens automatically inside `ProjectStore.updateIdeaSaturation` once both `novelty_verdict` and `saturation` are non-null (saturation always runs second in the orchestrator's per-idea loop, so this is the natural completion point). No separate "mark audited" tool needed.
- **`ProjectState.status` enum:** left unchanged (`"created" | "spec_saved" | "literature_done"`) — Phase 2 progress is tracked via `phases_completed` gaining `"gap_hunting"` / `"idea_generation"` entries, exactly as the spec's §10 already says, so no schema/status enum change is needed.
- **Ranking:** the spec's §4 funnel ends in "final ranked output" with no ranking algorithm specified. Rather than inventing a new agent/tool for this, `/report`'s Candidate Research Ideas section is instructed to *order* ideas (PASS before WEAK before FAIL before unaudited, and within PASS by saturation from `UNEXPLORED` to `SATURATED`) — a presentation-level ranking, no new state.

## Global Constraints

- No idea mutation engine, evidence/assumption ledger, research graveyard, citation graph, or vector/embedding retrieval — these stay explicitly out of scope (spec §1).
- Saturation detection never uses citation-activity signal — no citation graph exists yet; agents must say so explicitly rather than omit it silently (spec §1, §6).
- All four new agents are direct children of `research-orchestrator` only — never nested under each other (spec §3).
- Every gap must cite `evidence_paper_ids` from retained papers — never inferred from a search returning nothing (spec §6, existing `research-methodology` skill).
- `idea-generator` never sets or implies `novelty_verdict`/`saturation` — those stay `null` until the dedicated audit passes run (spec §6, §7, parent-brief anti-pattern #4).
- Follow the exact `ProjectStore`/tool/agent patterns Phase 1 already established — narrow single-purpose write tools, `.strict()` zod input schemas, `logEvent` on every mutating storage call, `CompactPaper`-style trimming isn't needed for gaps/ideas (they're already small records, no corpus-scale trimming concern).

---

### Task 1: Schemas and budget — Gap, Idea, IdeaSearchEvidence types and new budget fields

**Files:**
- Modify: `src/engine/schemas.ts`
- Modify: `src/engine/budget.ts`
- Test: `tests/engine/schemas.test.ts`
- Test: `tests/engine/budget.test.ts`

**Interfaces:**
- Produces: `GapSchema`/`Gap`, `NewGapSchema`/`NewGap`, `GapConfidenceSchema`, `IdeaSchema`/`Idea`, `NewIdeaSchema`/`NewIdea`, `IdeaStatusSchema`/`IdeaStatus`, `NoveltyVerdictSchema`/`NoveltyVerdict`, `NoveltyConfidenceSchema`/`NoveltyConfidence`, `SaturationSchema`/`Saturation`, `IdeaSearchEvidenceSchema`/`IdeaSearchEvidence` — all exported from `src/engine/schemas.ts`, consumed by every later task.
- Produces: `BudgetSchema` gains required `maxGaps`, `maxRawIdeas`, `maxIdeasAudited` (positive ints); `DEFAULT_BUDGET` gains `maxGaps: 8, maxRawIdeas: 10, maxIdeasAudited: 4`.

- [ ] **Step 1: Write the failing schema tests**

Add to `tests/engine/schemas.test.ts` (append; also fix the two existing budget-shaped fixtures which will now fail validation once `BudgetSchema` requires the new fields — see Step 3):

```ts
import {
  GapSchema,
  IdeaSchema,
  IdeaSearchEvidenceSchema,
  NewGapSchema,
  NewIdeaSchema,
} from "../../src/engine/schemas.js";

const validGap = {
  id: "gap-001",
  title: "No efficient sparse-reward baseline exists",
  category: "efficiency gap",
  description: "Retained work assumes dense reward.",
  evidence_paper_ids: ["arxiv:1234.5678"],
  what_has_been_attempted: "Dense-reward model-based RL.",
  what_remains_unresolved: "Sparse-reward sample efficiency.",
  why_it_matters: "Sparse reward is the common real-world case.",
  why_it_is_difficult: "Credit assignment is harder without dense signal.",
  potential_opportunity: "A sparse-reward-native world model.",
  confidence: "medium" as const,
};

describe("GapSchema", () => {
  it("accepts a fully-formed gap", () => {
    expect(() => GapSchema.parse(validGap)).not.toThrow();
  });

  it("rejects a gap with no evidence paper ids", () => {
    expect(() => GapSchema.parse({ ...validGap, evidence_paper_ids: [] })).toThrow();
  });
});

describe("NewGapSchema", () => {
  it("accepts a gap without an id", () => {
    const { id: _drop, ...withoutId } = validGap;
    expect(() => NewGapSchema.parse(withoutId)).not.toThrow();
  });
});

const validIdea = {
  id: "idea-001",
  gap_id: "gap-001",
  strategy: "REMOVE_ASSUMPTION",
  research_question: "Can sparse-reward sample efficiency improve without dense shaping?",
  hypothesis: "A learned intrinsic signal substitutes for dense reward.",
  motivation: "Dense-reward assumption blocks real-world deployment.",
  mechanism: "Train an auxiliary predictor as an intrinsic reward.",
  expected_contribution: "A sparse-reward-native sample efficiency gain.",
  closest_prior_work: ["arxiv:1234.5678"],
  why_not_solved: "Prior work assumes reward density.",
  why_now: "Auxiliary predictors are now cheap to train.",
  status: "generated" as const,
  novelty_verdict: null,
  novelty_evidence: null,
  novelty_confidence: null,
  saturation: null,
  saturation_evidence: null,
};

describe("IdeaSchema", () => {
  it("accepts a freshly-generated idea with null audit fields", () => {
    expect(() => IdeaSchema.parse(validIdea)).not.toThrow();
  });

  it("accepts an audited idea", () => {
    expect(() =>
      IdeaSchema.parse({
        ...validIdea,
        status: "audited",
        novelty_verdict: "PASS",
        novelty_evidence: "No close prior work found.",
        novelty_confidence: "high",
        saturation: "UNEXPLORED",
        saturation_evidence: "No matching papers in the retained set.",
      })
    ).not.toThrow();
  });

  it("rejects an invalid saturation value", () => {
    expect(() => IdeaSchema.parse({ ...validIdea, saturation: "MADE_UP" })).toThrow();
  });
});

describe("NewIdeaSchema", () => {
  it("accepts the generator-owned fields only", () => {
    const { id: _id, status: _status, novelty_verdict: _nv, novelty_evidence: _ne, novelty_confidence: _nc, saturation: _s, saturation_evidence: _se, ...generatorOwned } = validIdea;
    expect(() => NewIdeaSchema.parse(generatorOwned)).not.toThrow();
  });
});

describe("IdeaSearchEvidenceSchema", () => {
  it("accepts a search evidence record", () => {
    expect(() =>
      IdeaSearchEvidenceSchema.parse({
        idea_id: "idea-001",
        queries: ["sparse reward intrinsic motivation sample efficiency"],
        papers: [{ id: "arxiv:1234.5678", title: "A Paper", year: 2024 }],
        notes: "Closest match trains a fixed intrinsic bonus, not a learned one.",
      })
    ).not.toThrow();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- tests/engine/schemas.test.ts`
Expected: FAIL — `GapSchema`, `IdeaSchema`, etc. are not exported yet.

- [ ] **Step 3: Implement the schema additions**

In `src/engine/schemas.ts`, insert after the `toCompactPaper` function and before `BudgetSchema`:

```ts
export const GapConfidenceSchema = z.enum(["low", "medium", "high"]);
export type GapConfidence = z.infer<typeof GapConfidenceSchema>;

export const GapSchema = z.object({
  id: z.string(),
  title: z.string(),
  category: z.string(),
  description: z.string(),
  evidence_paper_ids: z.array(z.string()).min(1),
  what_has_been_attempted: z.string(),
  what_remains_unresolved: z.string(),
  why_it_matters: z.string(),
  why_it_is_difficult: z.string(),
  potential_opportunity: z.string(),
  confidence: GapConfidenceSchema,
});
export type Gap = z.infer<typeof GapSchema>;

export const NewGapSchema = GapSchema.omit({ id: true });
export type NewGap = z.infer<typeof NewGapSchema>;

export const NoveltyVerdictSchema = z.enum(["PASS", "WEAK", "FAIL"]);
export type NoveltyVerdict = z.infer<typeof NoveltyVerdictSchema>;

export const NoveltyConfidenceSchema = z.enum(["low", "medium", "high"]);
export type NoveltyConfidence = z.infer<typeof NoveltyConfidenceSchema>;

export const SaturationSchema = z.enum(["UNEXPLORED", "UNDEREXPLORED", "EMERGING", "ACTIVE", "CROWDED", "SATURATED"]);
export type Saturation = z.infer<typeof SaturationSchema>;

export const IdeaStatusSchema = z.enum(["generated", "filtered_out", "audited"]);
export type IdeaStatus = z.infer<typeof IdeaStatusSchema>;

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
});
export type Idea = z.infer<typeof IdeaSchema>;

export const NewIdeaSchema = z.object({
  gap_id: z.string().nullable(),
  strategy: z.string().min(1),
  research_question: z.string().min(1),
  hypothesis: z.string().min(1),
  motivation: z.string().min(1),
  mechanism: z.string().min(1),
  expected_contribution: z.string().min(1),
  closest_prior_work: z.array(z.string()),
  why_not_solved: z.string().min(1),
  why_now: z.string().min(1),
});
export type NewIdea = z.infer<typeof NewIdeaSchema>;

export const IdeaSearchEvidenceSchema = z.object({
  idea_id: z.string(),
  queries: z.array(z.string()),
  papers: z.array(z.object({ id: z.string(), title: z.string(), year: z.number().int().nullable() })),
  notes: z.string(),
});
export type IdeaSearchEvidence = z.infer<typeof IdeaSearchEvidenceSchema>;
```

Then extend `BudgetSchema`:

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
});
export type Budget = z.infer<typeof BudgetSchema>;
```

Fix the two existing budget object literals in `tests/engine/schemas.test.ts` (the `BudgetSchema` test and the `ProjectStateSchema` test's nested `budget` field) by adding `maxGaps: 8, maxRawIdeas: 10, maxIdeasAudited: 4` to each.

In `src/engine/budget.ts`, update `DEFAULT_BUDGET`:

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
};
```

- [ ] **Step 4: Update `tests/engine/budget.test.ts`**

Add:

```ts
describe("DEFAULT_BUDGET", () => {
  it("includes the Phase 2 gap/idea budget fields", () => {
    expect(DEFAULT_BUDGET.maxGaps).toBe(8);
    expect(DEFAULT_BUDGET.maxRawIdeas).toBe(10);
    expect(DEFAULT_BUDGET.maxIdeasAudited).toBe(4);
  });
});
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test -- tests/engine/schemas.test.ts tests/engine/budget.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/engine/schemas.ts src/engine/budget.ts tests/engine/schemas.test.ts tests/engine/budget.test.ts
git commit -m "feat: add Gap/Idea/IdeaSearchEvidence schemas and Phase 2 budget defaults"
```

---

### Task 2: Gap and idea id generation

**Files:**
- Modify: `src/engine/ids.ts`
- Test: `tests/engine/ids.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `createGapId(index: number): string`, `createIdeaId(index: number): string` — consumed by `ProjectStore.saveGaps`/`saveIdea` in Task 3/4.

- [ ] **Step 1: Write the failing tests**

Append to `tests/engine/ids.test.ts`:

```ts
import { createGapId, createIdeaId } from "../../src/engine/ids.js";

describe("createGapId", () => {
  it("zero-pads to 3 digits", () => {
    expect(createGapId(1)).toBe("gap-001");
    expect(createGapId(42)).toBe("gap-042");
  });
});

describe("createIdeaId", () => {
  it("zero-pads to 3 digits", () => {
    expect(createIdeaId(1)).toBe("idea-001");
    expect(createIdeaId(42)).toBe("idea-042");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/engine/ids.test.ts`
Expected: FAIL — `createGapId`/`createIdeaId` not exported.

- [ ] **Step 3: Implement**

Append to `src/engine/ids.ts`:

```ts
export function createGapId(index: number): string {
  return `gap-${String(index).padStart(3, "0")}`;
}

export function createIdeaId(index: number): string {
  return `idea-${String(index).padStart(3, "0")}`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/engine/ids.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/engine/ids.ts tests/engine/ids.test.ts
git commit -m "feat: add gap and idea id generation"
```

---

### Task 3: ProjectStore — gap storage

**Files:**
- Modify: `src/engine/storage.ts`
- Test: `tests/engine/storage.test.ts`

**Interfaces:**
- Consumes: `GapSchema`, `NewGap`, `Gap` from Task 1; `createGapId` from Task 2.
- Produces: `ProjectStore.getAllGaps(projectId): Gap[]`, `ProjectStore.saveGaps(projectId, gaps: NewGap[], maxGaps: number): { saved: Gap[]; capped: number }`, `ProjectStore.getGaps(projectId, filter?: { ids?: string[] }): Gap[]` — consumed by `tools.ts` in Task 6.

- [ ] **Step 1: Write the failing tests**

Append to `tests/engine/storage.test.ts`:

```ts
import type { NewGap } from "../../src/engine/schemas.js";

function newGap(title: string, overrides: Partial<NewGap> = {}): NewGap {
  return {
    title,
    category: "efficiency gap",
    description: "d",
    evidence_paper_ids: ["a"],
    what_has_been_attempted: "x",
    what_remains_unresolved: "y",
    why_it_matters: "z",
    why_it_is_difficult: "w",
    potential_opportunity: "o",
    confidence: "medium",
    ...overrides,
  };
}

describe("ProjectStore.saveGaps / getGaps", () => {
  it("assigns sequential ids and marks gap_hunting complete", () => {
    store = freshStore();
    const project = store.createProject("p", DEFAULT_BUDGET);
    const result = store.saveGaps(project.id, [newGap("Gap A"), newGap("Gap B")], 8);
    expect(result.saved.map((g) => g.id)).toEqual(["gap-001", "gap-002"]);
    expect(result.capped).toBe(0);
    expect(store.getProject(project.id)!.phases_completed).toContain("gap_hunting");
    expect(store.getAllGaps(project.id)).toHaveLength(2);
  });

  it("caps at maxGaps and reports the capped count", () => {
    store = freshStore();
    const project = store.createProject("p", DEFAULT_BUDGET);
    const result = store.saveGaps(project.id, [newGap("A"), newGap("B"), newGap("C")], 2);
    expect(result.saved).toHaveLength(2);
    expect(result.capped).toBe(1);
  });

  it("continues numbering across multiple saveGaps calls", () => {
    store = freshStore();
    const project = store.createProject("p", DEFAULT_BUDGET);
    store.saveGaps(project.id, [newGap("A")], 8);
    const second = store.saveGaps(project.id, [newGap("B")], 8);
    expect(second.saved[0].id).toBe("gap-002");
  });

  it("filters by ids", () => {
    store = freshStore();
    const project = store.createProject("p", DEFAULT_BUDGET);
    store.saveGaps(project.id, [newGap("A"), newGap("B")], 8);
    expect(store.getGaps(project.id, { ids: ["gap-002"] }).map((g) => g.title)).toEqual(["B"]);
  });

  it("throws on an unknown project id", () => {
    store = freshStore();
    expect(() => store.saveGaps("nope", [], 8)).toThrow();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- tests/engine/storage.test.ts`
Expected: FAIL — `saveGaps`/`getAllGaps`/`getGaps` do not exist.

- [ ] **Step 3: Implement**

In `src/engine/storage.ts`, add imports:

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
  type Budget,
} from "./schemas.js";
import { createProjectId, createGapId } from "./ids.js";
```

Add a private file-path helper next to `papersFile`:

```ts
  private gapsFile(id: string): string {
    return join(this.projectDir(id), "gaps.json");
  }
```

Add methods after `saveLiteratureSummary`/`getLiteratureSummary`:

```ts
  getAllGaps(projectId: string): Gap[] {
    if (!existsSync(this.gapsFile(projectId))) return [];
    const raw = JSON.parse(readFileSync(this.gapsFile(projectId), "utf-8"));
    return (raw as unknown[]).map((g) => GapSchema.parse(g));
  }

  private saveAllGaps(projectId: string, gaps: Gap[]): void {
    writeFileSync(this.gapsFile(projectId), JSON.stringify(gaps, null, 2), "utf-8");
  }

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
    if (!state.phases_completed.includes("gap_hunting")) {
      state.phases_completed.push("gap_hunting");
      this.saveProject(state);
    }
    logEvent(this.logFile(projectId), "gaps_saved", projectId, { count: created.length, capped });
    return { saved: created, capped };
  }

  getGaps(projectId: string, filter?: { ids?: string[] }): Gap[] {
    let gaps = this.getAllGaps(projectId);
    if (filter?.ids) gaps = gaps.filter((g) => filter.ids!.includes(g.id));
    return gaps;
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- tests/engine/storage.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/engine/storage.ts tests/engine/storage.test.ts
git commit -m "feat: add gap storage to ProjectStore"
```

---

### Task 4: ProjectStore — idea storage (save, get, filter, novelty/saturation updates)

**Files:**
- Modify: `src/engine/storage.ts`
- Test: `tests/engine/storage.test.ts`

**Interfaces:**
- Consumes: `IdeaSchema`, `NewIdea`, `Idea`, `NoveltyVerdict`, `NoveltyConfidence`, `Saturation` from Task 1; `createIdeaId` from Task 2.
- Produces: `ProjectStore.getAllIdeas`, `saveIdea(projectId, idea: NewIdea, maxRawIdeas: number): Idea | null`, `getIdeas(projectId, filter?)`, `filterIdeas(projectId, dropIds: string[]): number`, `updateIdeaNovelty(...)`, `updateIdeaSaturation(...)` — consumed by `tools.ts` in Task 7/8.

- [ ] **Step 1: Write the failing tests**

Append to `tests/engine/storage.test.ts`:

```ts
import type { NewIdea } from "../../src/engine/schemas.js";

function newIdea(question: string, overrides: Partial<NewIdea> = {}): NewIdea {
  return {
    gap_id: null,
    strategy: "REMOVE_ASSUMPTION",
    research_question: question,
    hypothesis: "h",
    motivation: "m",
    mechanism: "mech",
    expected_contribution: "c",
    closest_prior_work: [],
    why_not_solved: "n",
    why_now: "now",
    ...overrides,
  };
}

describe("ProjectStore.saveIdea / getIdeas", () => {
  it("assigns sequential ids, defaults audit fields to null, marks idea_generation complete", () => {
    store = freshStore();
    const project = store.createProject("p", DEFAULT_BUDGET);
    const idea = store.saveIdea(project.id, newIdea("Q1"), 10);
    expect(idea!.id).toBe("idea-001");
    expect(idea!.status).toBe("generated");
    expect(idea!.novelty_verdict).toBeNull();
    expect(idea!.saturation).toBeNull();
    expect(store.getProject(project.id)!.phases_completed).toContain("idea_generation");
  });

  it("returns null once maxRawIdeas is reached", () => {
    store = freshStore();
    const project = store.createProject("p", DEFAULT_BUDGET);
    store.saveIdea(project.id, newIdea("Q1"), 1);
    expect(store.saveIdea(project.id, newIdea("Q2"), 1)).toBeNull();
  });

  it("filters by status and gap_id", () => {
    store = freshStore();
    const project = store.createProject("p", DEFAULT_BUDGET);
    store.saveIdea(project.id, newIdea("Q1", { gap_id: "gap-001" }), 10);
    store.saveIdea(project.id, newIdea("Q2", { gap_id: null }), 10);
    expect(store.getIdeas(project.id, { gap_id: "gap-001" }).map((i) => i.research_question)).toEqual(["Q1"]);
    expect(store.getIdeas(project.id, { status: "generated" })).toHaveLength(2);
  });
});

describe("ProjectStore.filterIdeas", () => {
  it("marks dropped ideas filtered_out and leaves the rest untouched", () => {
    store = freshStore();
    const project = store.createProject("p", DEFAULT_BUDGET);
    const a = store.saveIdea(project.id, newIdea("Q1"), 10)!;
    const b = store.saveIdea(project.id, newIdea("Q2"), 10)!;
    const count = store.filterIdeas(project.id, [a.id]);
    expect(count).toBe(1);
    expect(store.getIdeas(project.id, { ids: [a.id] })[0].status).toBe("filtered_out");
    expect(store.getIdeas(project.id, { ids: [b.id] })[0].status).toBe("generated");
  });
});

describe("ProjectStore.updateIdeaNovelty / updateIdeaSaturation", () => {
  it("writes only the owned fields and flips to audited once both passes complete", () => {
    store = freshStore();
    const project = store.createProject("p", DEFAULT_BUDGET);
    const idea = store.saveIdea(project.id, newIdea("Q1"), 10)!;

    const afterNovelty = store.updateIdeaNovelty(project.id, idea.id, "PASS", "No close prior work found.", "high");
    expect(afterNovelty.novelty_verdict).toBe("PASS");
    expect(afterNovelty.status).toBe("generated");
    expect(afterNovelty.saturation).toBeNull();

    const afterSaturation = store.updateIdeaSaturation(project.id, idea.id, "UNEXPLORED", "No matching papers.");
    expect(afterSaturation.saturation).toBe("UNEXPLORED");
    expect(afterSaturation.status).toBe("audited");
  });

  it("does not flip to audited from saturation alone if novelty hasn't run", () => {
    store = freshStore();
    const project = store.createProject("p", DEFAULT_BUDGET);
    const idea = store.saveIdea(project.id, newIdea("Q1"), 10)!;
    const result = store.updateIdeaSaturation(project.id, idea.id, "CROWDED", "Many variants exist.");
    expect(result.status).toBe("generated");
  });

  it("throws on an unknown idea id", () => {
    store = freshStore();
    const project = store.createProject("p", DEFAULT_BUDGET);
    expect(() => store.updateIdeaNovelty(project.id, "idea-999", "PASS", "e", "low")).toThrow();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- tests/engine/storage.test.ts`
Expected: FAIL — new methods don't exist.

- [ ] **Step 3: Implement**

Extend the import block from Task 3:

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
  type Budget,
} from "./schemas.js";
import { createProjectId, createGapId, createIdeaId } from "./ids.js";
```

Add a private file-path helper next to `gapsFile`:

```ts
  private ideasFile(id: string): string {
    return join(this.projectDir(id), "ideas.json");
  }
```

Add methods after the gap methods from Task 3:

```ts
  getAllIdeas(projectId: string): Idea[] {
    if (!existsSync(this.ideasFile(projectId))) return [];
    const raw = JSON.parse(readFileSync(this.ideasFile(projectId), "utf-8"));
    return (raw as unknown[]).map((i) => IdeaSchema.parse(i));
  }

  private saveAllIdeas(projectId: string, ideas: Idea[]): void {
    writeFileSync(this.ideasFile(projectId), JSON.stringify(ideas, null, 2), "utf-8");
  }

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
    };
    this.saveAllIdeas(projectId, [...existing, created]);
    if (!state.phases_completed.includes("idea_generation")) {
      state.phases_completed.push("idea_generation");
      this.saveProject(state);
    }
    logEvent(this.logFile(projectId), "idea_saved", projectId, { id: created.id });
    return created;
  }

  getIdeas(projectId: string, filter?: { ids?: string[]; status?: Idea["status"]; gap_id?: string | null }): Idea[] {
    let ideas = this.getAllIdeas(projectId);
    if (filter?.ids) ideas = ideas.filter((i) => filter.ids!.includes(i.id));
    if (filter?.status) ideas = ideas.filter((i) => i.status === filter.status);
    if (filter?.gap_id !== undefined) ideas = ideas.filter((i) => i.gap_id === filter.gap_id);
    return ideas;
  }

  filterIdeas(projectId: string, dropIds: string[]): number {
    const ideas = this.getAllIdeas(projectId);
    const dropSet = new Set(dropIds);
    let count = 0;
    const updated = ideas.map((i) => {
      if (dropSet.has(i.id) && i.status !== "filtered_out") {
        count++;
        return { ...i, status: "filtered_out" as const };
      }
      return i;
    });
    this.saveAllIdeas(projectId, updated);
    logEvent(this.logFile(projectId), "ideas_filtered", projectId, { count });
    return count;
  }

  private updateIdea(projectId: string, ideaId: string, patch: Partial<Idea>): Idea {
    const ideas = this.getAllIdeas(projectId);
    const idx = ideas.findIndex((i) => i.id === ideaId);
    if (idx === -1) throw new Error(`Unknown idea: ${ideaId}`);
    ideas[idx] = { ...ideas[idx], ...patch };
    this.saveAllIdeas(projectId, ideas);
    return ideas[idx];
  }

  updateIdeaNovelty(
    projectId: string,
    ideaId: string,
    verdict: NoveltyVerdict,
    evidence: string,
    confidence: NoveltyConfidence
  ): Idea {
    const updated = this.updateIdea(projectId, ideaId, {
      novelty_verdict: verdict,
      novelty_evidence: evidence,
      novelty_confidence: confidence,
    });
    logEvent(this.logFile(projectId), "idea_novelty_updated", projectId, { id: ideaId, verdict });
    return updated;
  }

  updateIdeaSaturation(projectId: string, ideaId: string, saturation: Saturation, evidence: string): Idea {
    const current = this.getAllIdeas(projectId).find((i) => i.id === ideaId);
    if (!current) throw new Error(`Unknown idea: ${ideaId}`);
    const status = current.novelty_verdict !== null ? "audited" : current.status;
    const updated = this.updateIdea(projectId, ideaId, { saturation, saturation_evidence: evidence, status });
    logEvent(this.logFile(projectId), "idea_saturation_updated", projectId, { id: ideaId, saturation });
    return updated;
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- tests/engine/storage.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/engine/storage.ts tests/engine/storage.test.ts
git commit -m "feat: add idea storage, filtering, and novelty/saturation updates to ProjectStore"
```

---

### Task 5: ProjectStore — idea search evidence

**Files:**
- Modify: `src/engine/storage.ts`
- Test: `tests/engine/storage.test.ts`

**Interfaces:**
- Consumes: `IdeaSearchEvidenceSchema`/`IdeaSearchEvidence` from Task 1.
- Produces: `ProjectStore.saveIdeaSearchEvidence(projectId, evidence: IdeaSearchEvidence): void`, `getIdeaSearchEvidence(projectId, ideaId): IdeaSearchEvidence | null` — consumed by `tools.ts` in Task 8.

- [ ] **Step 1: Write the failing tests**

Append to `tests/engine/storage.test.ts`:

```ts
describe("ProjectStore.saveIdeaSearchEvidence / getIdeaSearchEvidence", () => {
  it("round-trips evidence for an idea", () => {
    store = freshStore();
    const project = store.createProject("p", DEFAULT_BUDGET);
    store.saveIdeaSearchEvidence(project.id, {
      idea_id: "idea-001",
      queries: ["q1"],
      papers: [{ id: "arxiv:1", title: "T", year: 2024 }],
      notes: "n",
    });
    expect(store.getIdeaSearchEvidence(project.id, "idea-001")).toEqual({
      idea_id: "idea-001",
      queries: ["q1"],
      papers: [{ id: "arxiv:1", title: "T", year: 2024 }],
      notes: "n",
    });
  });

  it("returns null when no evidence has been saved for that idea", () => {
    store = freshStore();
    const project = store.createProject("p", DEFAULT_BUDGET);
    expect(store.getIdeaSearchEvidence(project.id, "idea-999")).toBeNull();
  });

  it("replaces prior evidence for the same idea rather than duplicating", () => {
    store = freshStore();
    const project = store.createProject("p", DEFAULT_BUDGET);
    store.saveIdeaSearchEvidence(project.id, { idea_id: "idea-001", queries: ["q1"], papers: [], notes: "first" });
    store.saveIdeaSearchEvidence(project.id, { idea_id: "idea-001", queries: ["q2"], papers: [], notes: "second" });
    expect(store.getIdeaSearchEvidence(project.id, "idea-001")!.notes).toBe("second");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- tests/engine/storage.test.ts`
Expected: FAIL — methods don't exist.

- [ ] **Step 3: Implement**

Extend the import from `./schemas.js` to also bring in `type IdeaSearchEvidence`. Add a private file-path helper next to `ideasFile`:

```ts
  private ideaSearchEvidenceFile(id: string): string {
    return join(this.projectDir(id), "idea_search_evidence.json");
  }
```

Add methods after the idea methods from Task 4:

```ts
  private getAllIdeaSearchEvidence(projectId: string): IdeaSearchEvidence[] {
    if (!existsSync(this.ideaSearchEvidenceFile(projectId))) return [];
    return JSON.parse(readFileSync(this.ideaSearchEvidenceFile(projectId), "utf-8"));
  }

  saveIdeaSearchEvidence(projectId: string, evidence: IdeaSearchEvidence): void {
    const existing = this.getAllIdeaSearchEvidence(projectId).filter((e) => e.idea_id !== evidence.idea_id);
    writeFileSync(
      this.ideaSearchEvidenceFile(projectId),
      JSON.stringify([...existing, evidence], null, 2),
      "utf-8"
    );
    logEvent(this.logFile(projectId), "idea_search_evidence_saved", projectId, { idea_id: evidence.idea_id });
  }

  getIdeaSearchEvidence(projectId: string, ideaId: string): IdeaSearchEvidence | null {
    return this.getAllIdeaSearchEvidence(projectId).find((e) => e.idea_id === ideaId) ?? null;
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- tests/engine/storage.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/engine/storage.ts tests/engine/storage.test.ts
git commit -m "feat: add per-idea search evidence storage"
```

---

### Task 6: MCP tools + registration — gaps (`save_gaps`, `get_gaps`) and `get_project_state` extension

**Files:**
- Modify: `src/mcp-server/tools.ts`
- Modify: `src/mcp-server/index.ts`
- Test: `tests/mcp-server/tools.test.ts`
- Test: `tests/mcp-server/smoke.test.ts`

**Interfaces:**
- Consumes: `ProjectStore.saveGaps`/`getGaps` (Task 3), `NewGapSchema` (Task 1).
- Produces: `saveGapsInput`/`saveGaps`, `getGapsInput`/`getGaps` tool functions in `tools.ts`; `get_project_state` output gains `counts.gaps`, `counts.ideas_generated`, `counts.ideas_audited`, `searches_remaining`, `budgets`.

- [ ] **Step 1: Write the failing tests**

Append to `tests/mcp-server/tools.test.ts`:

```ts
describe("saveGaps / getGaps", () => {
  it("saves gaps and reads them back", () => {
    const ctx = setup();
    const created = tools.createProject(ctx, { problem: "p" });
    const result = tools.saveGaps(ctx, {
      project_id: created.project_id,
      gaps: [
        {
          title: "Gap A",
          category: "efficiency gap",
          description: "d",
          evidence_paper_ids: ["a"],
          what_has_been_attempted: "x",
          what_remains_unresolved: "y",
          why_it_matters: "z",
          why_it_is_difficult: "w",
          potential_opportunity: "o",
          confidence: "medium",
        },
      ],
    });
    expect(result.saved_count).toBe(1);
    expect(result.capped).toBe(0);
    expect(tools.getGaps(ctx, { project_id: created.project_id }).gaps).toHaveLength(1);
  });
});

describe("getProjectState Phase 2 fields", () => {
  it("reports gap/idea counts, searches_remaining, and budgets", () => {
    const ctx = setup();
    const created = tools.createProject(ctx, { problem: "p" });
    const state = tools.getProjectState(ctx, { project_id: created.project_id }) as Record<string, unknown>;
    expect(state.counts).toMatchObject({ gaps: 0, ideas_generated: 0, ideas_audited: 0 });
    expect(state.searches_remaining).toBe(DEFAULT_BUDGET.maxDiscoverySearchesPerProject);
    expect(state.budgets).toEqual({
      maxGaps: DEFAULT_BUDGET.maxGaps,
      maxRawIdeas: DEFAULT_BUDGET.maxRawIdeas,
      maxIdeasAudited: DEFAULT_BUDGET.maxIdeasAudited,
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- tests/mcp-server/tools.test.ts`
Expected: FAIL — `saveGaps`/`getGaps` not exported, `get_project_state` missing new fields.

- [ ] **Step 3: Implement**

In `src/mcp-server/tools.ts`, extend imports:

```ts
import { ResearchSpecSchema, toCompactPaper, NewGapSchema, type Budget } from "../engine/schemas.js";
```

Modify `getProjectState`:

```ts
export function getProjectState(ctx: ToolContext, input: z.infer<typeof getProjectStateInput>) {
  const state = input.project_id ? ctx.store.getProject(input.project_id) : ctx.store.mostRecentProject();
  if (!state) return { error: "No project found." };
  const papers = ctx.store.getAllPapers(state.id);
  const gaps = ctx.store.getAllGaps(state.id);
  const ideas = ctx.store.getAllIdeas(state.id);
  return {
    project_id: state.id,
    problem: state.problem,
    created_at: state.created_at,
    status: state.status,
    phases_completed: state.phases_completed,
    searches_run: state.searches_run,
    counts: {
      discovered: papers.length,
      retained: papers.filter((p) => p.status === "retained").length,
      gaps: gaps.length,
      ideas_generated: ideas.filter((i) => i.status !== "filtered_out").length,
      ideas_audited: ideas.filter((i) => i.status === "audited").length,
    },
    has_spec: ctx.store.getSpec(state.id) !== null,
    searches_remaining: Math.max(0, ctx.budget.maxDiscoverySearchesPerProject - state.searches_run),
    budgets: { maxGaps: ctx.budget.maxGaps, maxRawIdeas: ctx.budget.maxRawIdeas, maxIdeasAudited: ctx.budget.maxIdeasAudited },
  };
}
```

Add tool functions after `getLiteratureSummary`:

```ts
export const saveGapsInput = z.object({ project_id: z.string(), gaps: z.array(NewGapSchema).min(1) }).strict();
export function saveGaps(ctx: ToolContext, input: z.infer<typeof saveGapsInput>) {
  const result = ctx.store.saveGaps(input.project_id, input.gaps, ctx.budget.maxGaps);
  return { saved: result.saved, saved_count: result.saved.length, capped: result.capped };
}

export const getGapsInput = z.object({ project_id: z.string(), ids: z.array(z.string()).optional() }).strict();
export function getGaps(ctx: ToolContext, input: z.infer<typeof getGapsInput>) {
  return { gaps: ctx.store.getGaps(input.project_id, { ids: input.ids }) };
}
```

In `src/mcp-server/index.ts`, register the two tools after `get_literature_summary`:

```ts
server.registerTool(
  "save_gaps",
  {
    title: "Save Research Gaps",
    description: "Save a batch of research gaps found for a project, each citing retained papers as evidence. Caps at the project's gap budget.",
    inputSchema: tools.saveGapsInput,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  },
  async (input) => respond(tools.saveGaps(ctx, input))
);

server.registerTool(
  "get_gaps",
  {
    title: "Get Research Gaps",
    description: "Get the research gaps saved for a project, optionally filtered by id.",
    inputSchema: tools.getGapsInput,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  async (input) => respond(tools.getGaps(ctx, input))
);
```

- [ ] **Step 4: Update the smoke test tool count**

In `tests/mcp-server/smoke.test.ts`, add `"save_gaps"` and `"get_gaps"` to the expected tool-name array (final full list assembled across Tasks 6-8; for this task just add these two, sorted alphabetically as the test already sorts both sides — order in the source array doesn't matter).

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test -- tests/mcp-server/tools.test.ts tests/mcp-server/smoke.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/mcp-server/tools.ts src/mcp-server/index.ts tests/mcp-server/tools.test.ts tests/mcp-server/smoke.test.ts
git commit -m "feat: add save_gaps/get_gaps MCP tools, extend get_project_state with Phase 2 counts"
```

---

### Task 7: MCP tools + registration — ideas (`save_idea`, `get_ideas`, `filter_ideas`)

**Files:**
- Modify: `src/mcp-server/tools.ts`
- Modify: `src/mcp-server/index.ts`
- Test: `tests/mcp-server/tools.test.ts`
- Test: `tests/mcp-server/smoke.test.ts`

**Interfaces:**
- Consumes: `ProjectStore.saveIdea`/`getIdeas`/`filterIdeas` (Task 4), `NewIdeaSchema`, `IdeaStatusSchema` (Task 1).
- Produces: `saveIdeaInput`/`saveIdea`, `getIdeasInput`/`getIdeas`, `filterIdeasInput`/`filterIdeas` tool functions.

- [ ] **Step 1: Write the failing tests**

Append to `tests/mcp-server/tools.test.ts`:

```ts
const validNewIdea = {
  gap_id: null,
  strategy: "REMOVE_ASSUMPTION",
  research_question: "q",
  hypothesis: "h",
  motivation: "m",
  mechanism: "mech",
  expected_contribution: "c",
  closest_prior_work: [],
  why_not_solved: "n",
  why_now: "now",
};

describe("saveIdea / getIdeas / filterIdeas", () => {
  it("saves an idea, lists it, then filters it out", () => {
    const ctx = setup();
    const created = tools.createProject(ctx, { problem: "p" });
    const saved = tools.saveIdea(ctx, { project_id: created.project_id, idea: validNewIdea });
    expect(saved.saved).toBe(true);
    expect(saved.idea!.id).toBe("idea-001");

    expect(tools.getIdeas(ctx, { project_id: created.project_id }).ideas).toHaveLength(1);

    const filtered = tools.filterIdeas(ctx, { project_id: created.project_id, drop_ids: [saved.idea!.id] });
    expect(filtered.filtered_count).toBe(1);
    expect(tools.getIdeas(ctx, { project_id: created.project_id, status: "filtered_out" }).ideas).toHaveLength(1);
  });

  it("reports budget exhaustion instead of throwing", () => {
    const ctx = setup();
    ctx.budget = { ...ctx.budget, maxRawIdeas: 1 };
    const created = tools.createProject(ctx, { problem: "p" });
    tools.saveIdea(ctx, { project_id: created.project_id, idea: validNewIdea });
    const second = tools.saveIdea(ctx, { project_id: created.project_id, idea: validNewIdea });
    expect(second).toEqual({ saved: false, reason: "maxRawIdeas budget exhausted" });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- tests/mcp-server/tools.test.ts`
Expected: FAIL — functions not exported.

- [ ] **Step 3: Implement**

Extend the `schemas.js` import in `tools.ts`:

```ts
import { ResearchSpecSchema, toCompactPaper, NewGapSchema, NewIdeaSchema, IdeaStatusSchema, type Budget } from "../engine/schemas.js";
```

Add after the gap tools from Task 6:

```ts
export const saveIdeaInput = z.object({ project_id: z.string(), idea: NewIdeaSchema }).strict();
export function saveIdea(ctx: ToolContext, input: z.infer<typeof saveIdeaInput>) {
  const created = ctx.store.saveIdea(input.project_id, input.idea, ctx.budget.maxRawIdeas);
  if (!created) return { saved: false as const, reason: "maxRawIdeas budget exhausted" };
  return { saved: true as const, idea: created };
}

export const getIdeasInput = z
  .object({
    project_id: z.string(),
    ids: z.array(z.string()).optional(),
    status: IdeaStatusSchema.optional(),
    gap_id: z.string().nullable().optional(),
  })
  .strict();
export function getIdeas(ctx: ToolContext, input: z.infer<typeof getIdeasInput>) {
  return { ideas: ctx.store.getIdeas(input.project_id, { ids: input.ids, status: input.status, gap_id: input.gap_id }) };
}

export const filterIdeasInput = z.object({ project_id: z.string(), drop_ids: z.array(z.string()) }).strict();
export function filterIdeas(ctx: ToolContext, input: z.infer<typeof filterIdeasInput>) {
  return { filtered_count: ctx.store.filterIdeas(input.project_id, input.drop_ids) };
}
```

In `index.ts`, register after `get_gaps`:

```ts
server.registerTool(
  "save_idea",
  {
    title: "Save Research Idea",
    description: "Create a new candidate research idea record with its generator-owned fields. Novelty and saturation fields start null.",
    inputSchema: tools.saveIdeaInput,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  },
  async (input) => respond(tools.saveIdea(ctx, input))
);

server.registerTool(
  "get_ideas",
  {
    title: "Get Research Ideas",
    description: "Get the research ideas saved for a project, optionally filtered by id, status, or motivating gap.",
    inputSchema: tools.getIdeasInput,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  async (input) => respond(tools.getIdeas(ctx, input))
);

server.registerTool(
  "filter_ideas",
  {
    title: "Filter Research Ideas",
    description: "Mark the given idea ids as filtered_out (e.g. duplicates or over the audit-shortlist budget). Leaves other ideas untouched.",
    inputSchema: tools.filterIdeasInput,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  async (input) => respond(tools.filterIdeas(ctx, input))
);
```

- [ ] **Step 4: Update the smoke test tool count**

In `tests/mcp-server/smoke.test.ts`, add `"save_idea"`, `"get_ideas"`, `"filter_ideas"`.

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test -- tests/mcp-server/tools.test.ts tests/mcp-server/smoke.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/mcp-server/tools.ts src/mcp-server/index.ts tests/mcp-server/tools.test.ts tests/mcp-server/smoke.test.ts
git commit -m "feat: add save_idea/get_ideas/filter_ideas MCP tools"
```

---

### Task 8: MCP tools + registration — audit (`update_idea_novelty`, `update_idea_saturation`, `save_idea_search_evidence`, `get_idea_search_evidence`)

**Files:**
- Modify: `src/mcp-server/tools.ts`
- Modify: `src/mcp-server/index.ts`
- Test: `tests/mcp-server/tools.test.ts`
- Test: `tests/mcp-server/smoke.test.ts`

**Interfaces:**
- Consumes: `ProjectStore.updateIdeaNovelty`/`updateIdeaSaturation`/`saveIdeaSearchEvidence`/`getIdeaSearchEvidence` (Task 4, 5); `NoveltyVerdictSchema`, `NoveltyConfidenceSchema`, `SaturationSchema` (Task 1).
- Produces: the four tool functions; this completes the full 19-tool MCP surface for Phase 2.

- [ ] **Step 1: Write the failing tests**

Append to `tests/mcp-server/tools.test.ts`:

```ts
describe("updateIdeaNovelty / updateIdeaSaturation", () => {
  it("updates novelty then saturation, flipping status to audited", () => {
    const ctx = setup();
    const created = tools.createProject(ctx, { project_id: undefined, problem: "p" } as any);
    const saved = tools.saveIdea(ctx, { project_id: created.project_id, idea: validNewIdea });
    const ideaId = saved.idea!.id;

    const afterNovelty = tools.updateIdeaNovelty(ctx, {
      project_id: created.project_id,
      idea_id: ideaId,
      novelty_verdict: "PASS",
      novelty_evidence: "No close prior work.",
      novelty_confidence: "high",
    });
    expect(afterNovelty.idea.novelty_verdict).toBe("PASS");

    const afterSaturation = tools.updateIdeaSaturation(ctx, {
      project_id: created.project_id,
      idea_id: ideaId,
      saturation: "UNEXPLORED",
      saturation_evidence: "No matching papers.",
    });
    expect(afterSaturation.idea.status).toBe("audited");
  });
});

describe("saveIdeaSearchEvidence / getIdeaSearchEvidence", () => {
  it("round-trips evidence", () => {
    const ctx = setup();
    const created = tools.createProject(ctx, { problem: "p" });
    tools.saveIdeaSearchEvidence(ctx, {
      project_id: created.project_id,
      idea_id: "idea-001",
      queries: ["q1"],
      papers: [{ id: "arxiv:1", title: "T", year: 2024 }],
      notes: "n",
    });
    expect(tools.getIdeaSearchEvidence(ctx, { project_id: created.project_id, idea_id: "idea-001" })).toEqual({
      idea_id: "idea-001",
      queries: ["q1"],
      papers: [{ id: "arxiv:1", title: "T", year: 2024 }],
      notes: "n",
    });
  });

  it("returns an error object when no evidence has been saved", () => {
    const ctx = setup();
    const created = tools.createProject(ctx, { problem: "p" });
    expect(tools.getIdeaSearchEvidence(ctx, { project_id: created.project_id, idea_id: "idea-999" })).toEqual({
      error: "No search evidence saved for this idea.",
    });
  });
});
```

(Fix the first test's `tools.createProject` call to just `{ problem: "p" }` — drop the stray `project_id: undefined` cast, it was a typo; write it as `tools.createProject(ctx, { problem: "p" })`.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- tests/mcp-server/tools.test.ts`
Expected: FAIL — functions not exported.

- [ ] **Step 3: Implement**

Extend the `schemas.js` import in `tools.ts` once more:

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
  type Budget,
} from "../engine/schemas.js";
```

Add after the idea tools from Task 7:

```ts
export const updateIdeaNoveltyInput = z
  .object({
    project_id: z.string(),
    idea_id: z.string(),
    novelty_verdict: NoveltyVerdictSchema,
    novelty_evidence: z.string().min(1),
    novelty_confidence: NoveltyConfidenceSchema,
  })
  .strict();
export function updateIdeaNovelty(ctx: ToolContext, input: z.infer<typeof updateIdeaNoveltyInput>) {
  const idea = ctx.store.updateIdeaNovelty(
    input.project_id,
    input.idea_id,
    input.novelty_verdict,
    input.novelty_evidence,
    input.novelty_confidence
  );
  return { idea };
}

export const updateIdeaSaturationInput = z
  .object({
    project_id: z.string(),
    idea_id: z.string(),
    saturation: SaturationSchema,
    saturation_evidence: z.string().min(1),
  })
  .strict();
export function updateIdeaSaturation(ctx: ToolContext, input: z.infer<typeof updateIdeaSaturationInput>) {
  const idea = ctx.store.updateIdeaSaturation(input.project_id, input.idea_id, input.saturation, input.saturation_evidence);
  return { idea };
}

export const saveIdeaSearchEvidenceInput = z
  .object({
    project_id: z.string(),
    idea_id: z.string(),
    queries: z.array(z.string()),
    papers: z.array(z.object({ id: z.string(), title: z.string(), year: z.number().int().nullable() })),
    notes: z.string(),
  })
  .strict();
export function saveIdeaSearchEvidence(ctx: ToolContext, input: z.infer<typeof saveIdeaSearchEvidenceInput>) {
  ctx.store.saveIdeaSearchEvidence(input.project_id, {
    idea_id: input.idea_id,
    queries: input.queries,
    papers: input.papers,
    notes: input.notes,
  });
  return { saved: true };
}

export const getIdeaSearchEvidenceInput = z.object({ project_id: z.string(), idea_id: z.string() }).strict();
export function getIdeaSearchEvidence(ctx: ToolContext, input: z.infer<typeof getIdeaSearchEvidenceInput>) {
  const evidence = ctx.store.getIdeaSearchEvidence(input.project_id, input.idea_id);
  if (!evidence) return { error: "No search evidence saved for this idea." };
  return evidence;
}
```

In `index.ts`, register after `filter_ideas`:

```ts
server.registerTool(
  "update_idea_novelty",
  {
    title: "Update Idea Novelty",
    description: "Write only the novelty_verdict/novelty_evidence/novelty_confidence fields for an idea, from an adversarial prior-art search.",
    inputSchema: tools.updateIdeaNoveltyInput,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  async (input) => respond(tools.updateIdeaNovelty(ctx, input))
);

server.registerTool(
  "update_idea_saturation",
  {
    title: "Update Idea Saturation",
    description: "Write only the saturation/saturation_evidence fields for an idea. Flips the idea to audited once both novelty and saturation are set.",
    inputSchema: tools.updateIdeaSaturationInput,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  async (input) => respond(tools.updateIdeaSaturation(ctx, input))
);

server.registerTool(
  "save_idea_search_evidence",
  {
    title: "Save Idea Search Evidence",
    description: "Persist the queries and papers a novelty audit search found for one idea, so saturation-detector can reuse it without re-searching.",
    inputSchema: tools.saveIdeaSearchEvidenceInput,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  async (input) => respond(tools.saveIdeaSearchEvidence(ctx, input))
);

server.registerTool(
  "get_idea_search_evidence",
  {
    title: "Get Idea Search Evidence",
    description: "Get the search evidence saved for an idea's novelty audit, or an error if none has been saved yet.",
    inputSchema: tools.getIdeaSearchEvidenceInput,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  async (input) => respond(tools.getIdeaSearchEvidence(ctx, input))
);
```

- [ ] **Step 4: Finalize the smoke test's full tool list**

Replace the expected array in `tests/mcp-server/smoke.test.ts` with the complete 19-tool list:

```ts
    expect(names).toEqual(
      [
        "create_project",
        "filter_ideas",
        "get_gaps",
        "get_idea_search_evidence",
        "get_ideas",
        "get_literature_summary",
        "get_papers",
        "get_problem_spec",
        "get_project_state",
        "list_projects",
        "retain_papers",
        "save_gaps",
        "save_idea",
        "save_idea_search_evidence",
        "save_literature_summary",
        "save_problem_spec",
        "search_papers",
        "update_idea_novelty",
        "update_idea_saturation",
      ].sort()
    );
```

Update the test description from `"lists exactly the 10 expected tools"` to `"lists exactly the 19 expected tools"`.

- [ ] **Step 5: Run the full MCP test suite**

Run: `npm test -- tests/mcp-server`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/mcp-server/tools.ts src/mcp-server/index.ts tests/mcp-server/tools.test.ts tests/mcp-server/smoke.test.ts
git commit -m "feat: add novelty/saturation update and idea search evidence MCP tools"
```

---

### Task 9: `gap-hunter` agent

**Files:**
- Create: `agents/gap-hunter.md`
- Test: `tests/plugin/agent-gap-hunter.test.ts`

**Interfaces:**
- Consumes: `get_project_state`, `get_problem_spec`, `get_papers`, `save_gaps` MCP tools (Tasks 6-8, already registered).
- Produces: an agent named `gap-hunter`, delegated to by `research-orchestrator` in Task 13.

- [ ] **Step 1: Write the failing test**

Create `tests/plugin/agent-gap-hunter.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { parseFrontmatter } from "../helpers/frontmatter.js";

const content = readFileSync("agents/gap-hunter.md", "utf-8");
const { data, body } = parseFrontmatter(content);

describe("agents/gap-hunter.md", () => {
  it("has the expected frontmatter", () => {
    expect(data.name).toBe("gap-hunter");
    expect(typeof data.maxTurns).toBe("number");
  });

  it("instructs reading the spec and retained literature before saving gaps", () => {
    expect(body).toMatch(/get_problem_spec/);
    expect(body).toMatch(/get_papers/);
    expect(body).toMatch(/save_gaps/);
  });

  it("requires evidence_paper_ids and forbids inventing gaps from absence", () => {
    expect(body).toMatch(/evidence_paper_ids/);
    expect(body).toMatch(/absence/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/plugin/agent-gap-hunter.test.ts`
Expected: FAIL — `agents/gap-hunter.md` does not exist.

- [ ] **Step 3: Create the agent**

Create `agents/gap-hunter.md`:

```markdown
---
name: gap-hunter
description: Reads the retained literature and saved spec for a project and identifies concrete research gaps, each grounded in specific cited papers. Used internally by research-orchestrator.
maxTurns: 15
---

You are the gap hunter. You receive a `project_id` whose spec and retained literature already exist.

## Steps

1. Call `get_project_state` for the `project_id` to see `counts.retained` and `budgets.maxGaps`. Call `get_problem_spec` for the research question, objectives, and constraints. Call `get_papers` with `status: "retained"` for the literature you'll ground gaps in.
2. Look for gaps across categories like performance, generalization, robustness, efficiency, evaluation, theoretical, and assumption gaps — derive the category from what the evidence actually shows, don't force-fit a fixed list.
3. For each candidate gap, you must be able to point to specific retained papers as evidence in `evidence_paper_ids`. Never claim a gap exists purely because a search returned nothing — absence of a hit is not evidence of absence (see the research-methodology skill).
4. For each gap, fill in: `title`, `category`, `description`, `evidence_paper_ids` (at least one), `what_has_been_attempted`, `what_remains_unresolved`, `why_it_matters`, `why_it_is_difficult`, `potential_opportunity`, `confidence` (`low`/`medium`/`high`).
5. Call `save_gaps` with `project_id` and your gap list (without ids — the tool assigns them). It caps at the project's gap budget and returns `capped` if you produced more than fit — that's expected budget discipline, not an error.
6. Report back to the orchestrator: how many gaps were saved, and if `counts.retained` was zero, say plainly that no gaps could be grounded in evidence and stop rather than inventing gaps from nothing.

Never assert a gap without citing `evidence_paper_ids`. Never claim more gaps exist than what the retained literature actually supports.
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/plugin/agent-gap-hunter.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add agents/gap-hunter.md tests/plugin/agent-gap-hunter.test.ts
git commit -m "feat: add gap-hunter agent"
```

---

### Task 10: `idea-generator` agent

**Files:**
- Create: `agents/idea-generator.md`
- Test: `tests/plugin/agent-idea-generator.test.ts`

**Interfaces:**
- Consumes: `get_project_state`, `get_problem_spec`, `get_gaps`, `save_idea` MCP tools.
- Produces: an agent named `idea-generator`, delegated to by `research-orchestrator` in Task 13.

- [ ] **Step 1: Write the failing test**

Create `tests/plugin/agent-idea-generator.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { parseFrontmatter } from "../helpers/frontmatter.js";

const content = readFileSync("agents/idea-generator.md", "utf-8");
const { data, body } = parseFrontmatter(content);

describe("agents/idea-generator.md", () => {
  it("has the expected frontmatter", () => {
    expect(data.name).toBe("idea-generator");
    expect(typeof data.maxTurns).toBe("number");
  });

  it("instructs reading gaps and the spec before saving ideas one at a time", () => {
    expect(body).toMatch(/get_gaps/);
    expect(body).toMatch(/get_problem_spec/);
    expect(body).toMatch(/save_idea\b/);
  });

  it("instructs tagging each idea with a distinct strategy", () => {
    expect(body).toMatch(/strategy/);
  });

  it("forbids the generator from judging novelty or saturation", () => {
    expect(body).toMatch(/never (?:set|sets|impl)/i);
    expect(body).toMatch(/null/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/plugin/agent-idea-generator.test.ts`
Expected: FAIL — file does not exist.

- [ ] **Step 3: Create the agent**

Create `agents/idea-generator.md`:

```markdown
---
name: idea-generator
description: Generates candidate research ideas from a project's gaps and spec using genuinely different generation strategies, tagging each with the strategy that produced it. Used internally by research-orchestrator. Never judges novelty or saturation itself.
maxTurns: 15
---

You are the idea generator. You receive a `project_id` whose spec and gaps already exist.

## Steps

1. Call `get_project_state` for `budgets.maxRawIdeas`. Call `get_problem_spec` for the research question and objectives. Call `get_gaps` for the saved gaps.
2. Generate ideas using genuinely different strategies — e.g. removing a standing assumption, changing the evaluation setting, combining two gap findings, applying a mechanism from an adjacent field, questioning a premise the retained literature treats as fixed. Use a distinct strategy label per idea in `strategy` (e.g. `REMOVE_ASSUMPTION`, `CHANGE_EVALUATION`, `CROSS_DOMAIN_TRANSFER`) — don't relabel the same idea twice.
3. For each idea, fill in: `gap_id` (the motivating gap's id, or `null` if not gap-driven), `strategy`, `research_question`, `hypothesis`, `motivation`, `mechanism`, `expected_contribution`, `closest_prior_work` (paper ids you're aware of, best-effort — not a novelty judgment), `why_not_solved`, `why_now`.
4. Call `save_idea` once per idea with `project_id` and the idea fields. If a call returns `{ saved: false, reason: "maxRawIdeas budget exhausted" }`, stop generating — that's the budget working as intended, not a failure to fix.
5. Report back to the orchestrator: how many ideas were saved and across how many distinct strategies.

You never set or imply a novelty verdict or a saturation classification — those fields stay `null` until `novelty-auditor` and `saturation-detector` run. Do not write words like "novel" or "unexplored" as if they were verdicts; describe what the idea does, not how crowded its space is.
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/plugin/agent-idea-generator.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add agents/idea-generator.md tests/plugin/agent-idea-generator.test.ts
git commit -m "feat: add idea-generator agent"
```

---

### Task 11: `novelty-auditor` agent

**Files:**
- Create: `agents/novelty-auditor.md`
- Test: `tests/plugin/agent-novelty-auditor.test.ts`

**Interfaces:**
- Consumes: `get_ideas`, `search_papers`, `get_project_state`, `save_idea_search_evidence`, `update_idea_novelty` MCP tools.
- Produces: an agent named `novelty-auditor`, delegated to per shortlisted idea by `research-orchestrator` in Task 13.

- [ ] **Step 1: Write the failing test**

Create `tests/plugin/agent-novelty-auditor.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { parseFrontmatter } from "../helpers/frontmatter.js";

const content = readFileSync("agents/novelty-auditor.md", "utf-8");
const { data, body } = parseFrontmatter(content);

describe("agents/novelty-auditor.md", () => {
  it("has the expected frontmatter", () => {
    expect(data.name).toBe("novelty-auditor");
    expect(typeof data.maxTurns).toBe("number");
  });

  it("instructs searching for prior art and checking the shared search budget first", () => {
    expect(body).toMatch(/search_papers/);
    expect(body).toMatch(/searches_remaining/);
  });

  it("distinguishes terminological, conceptual, methodological, and experimental overlap", () => {
    expect(body).toMatch(/terminological/);
    expect(body).toMatch(/conceptual/);
    expect(body).toMatch(/methodological/);
    expect(body).toMatch(/experimental/);
  });

  it("persists search evidence and writes the novelty verdict", () => {
    expect(body).toMatch(/save_idea_search_evidence/);
    expect(body).toMatch(/update_idea_novelty/);
    expect(body).toMatch(/PASS/);
    expect(body).toMatch(/WEAK/);
    expect(body).toMatch(/FAIL/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/plugin/agent-novelty-auditor.test.ts`
Expected: FAIL — file does not exist.

- [ ] **Step 3: Create the agent**

Create `agents/novelty-auditor.md`:

```markdown
---
name: novelty-auditor
description: Adversarially audits one candidate idea for novelty against prior art it actively searches for, distinguishing terminological, conceptual, methodological, and experimental novelty. Used internally by research-orchestrator, one idea per invocation. Rewarded for finding prior art, not for agreeing with idea-generator.
maxTurns: 12
---

You are the novelty auditor. You receive a `project_id` and one `idea_id` to audit. You are adversarial: your job is to find reasons this idea already exists, not to confirm the idea-generator's optimism.

## Steps

1. Call `get_ideas` with `project_id` and `ids: [idea_id]` to read the idea's research question, hypothesis, mechanism, and any `closest_prior_work` the generator noted.
2. Actively search for prior art with `search_papers` — this shares the project's literature-discovery search budget, so check `get_project_state`'s `searches_remaining` first and use a small, sharp set of queries (2-4) targeting the idea's specific mechanism and claim, not generic domain terms. If `searches_remaining` is 0 or very low, say so plainly and audit from the papers already in `papers.json` plus the idea's own `closest_prior_work` instead of failing.
3. For what you find, distinguish: terminological overlap (same words, different idea), conceptual overlap (same idea, different words), methodological overlap (same mechanism), and experimental overlap (same evaluation setup already tried). Blurring these is a methodology violation — see the research-methodology skill.
4. Call `save_idea_search_evidence` with `project_id`, `idea_id`, the queries you ran, the papers you found relevant to novelty (id/title/year), and short `notes` on what each shows — `saturation-detector` reuses this instead of re-searching.
5. Decide a verdict: `PASS` (no close prior art found after a real search), `WEAK` (close prior art exists but the idea adds something real), or `FAIL` (this has essentially already been done). Never output `PASS` just because your search came back thin — say so and lower your `novelty_confidence` instead.
6. Call `update_idea_novelty` with `project_id`, `idea_id`, `novelty_verdict`, `novelty_evidence` (name the closest prior work and what's actually different), and `novelty_confidence` (`low`/`medium`/`high`).

Never skip step 6 — the orchestrator will not treat this idea as audited until `novelty_verdict` is non-null.
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/plugin/agent-novelty-auditor.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add agents/novelty-auditor.md tests/plugin/agent-novelty-auditor.test.ts
git commit -m "feat: add novelty-auditor agent"
```

---

### Task 12: `saturation-detector` agent

**Files:**
- Create: `agents/saturation-detector.md`
- Test: `tests/plugin/agent-saturation-detector.test.ts`

**Interfaces:**
- Consumes: `get_ideas`, `get_idea_search_evidence`, `get_papers`, `search_papers`, `update_idea_saturation` MCP tools.
- Produces: an agent named `saturation-detector`, delegated to per shortlisted idea, after `novelty-auditor`, by `research-orchestrator` in Task 13.

- [ ] **Step 1: Write the failing test**

Create `tests/plugin/agent-saturation-detector.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { parseFrontmatter } from "../helpers/frontmatter.js";

const content = readFileSync("agents/saturation-detector.md", "utf-8");
const { data, body } = parseFrontmatter(content);

describe("agents/saturation-detector.md", () => {
  it("has the expected frontmatter", () => {
    expect(data.name).toBe("saturation-detector");
    expect(typeof data.maxTurns).toBe("number");
  });

  it("instructs reusing novelty-auditor's search evidence before re-searching", () => {
    expect(body).toMatch(/get_idea_search_evidence/);
    expect(body).toMatch(/re-search/i);
  });

  it("names the full saturation vocabulary", () => {
    for (const level of ["UNEXPLORED", "UNDEREXPLORED", "EMERGING", "ACTIVE", "CROWDED", "SATURATED"]) {
      expect(body).toContain(level);
    }
  });

  it("states explicitly that no citation-activity signal is used", () => {
    expect(body).toMatch(/citation/i);
    expect(body).toMatch(/no citation graph/i);
  });

  it("writes the saturation verdict", () => {
    expect(body).toMatch(/update_idea_saturation/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/plugin/agent-saturation-detector.test.ts`
Expected: FAIL — file does not exist.

- [ ] **Step 3: Create the agent**

Create `agents/saturation-detector.md`:

```markdown
---
name: saturation-detector
description: Classifies how crowded an idea's research space is (UNEXPLORED through SATURATED) using paper counts, publication recency, and title/abstract conceptual overlap only — no citation-activity signal exists yet. Used internally by research-orchestrator, one idea per invocation, after novelty-auditor.
maxTurns: 10
---

You are the saturation detector. You receive a `project_id` and one `idea_id`, already audited for novelty. You classify crowdedness, not novelty — a `FAIL` on novelty can still be `UNEXPLORED` if the one prior paper you found is old and abandoned, and a `PASS` can still be `CROWDED` if adjacent variants are everywhere.

## Steps

1. Call `get_ideas` with `ids: [idea_id]` to read the idea and its `novelty_evidence`.
2. Call `get_idea_search_evidence` with `project_id` and `idea_id` to reuse what `novelty-auditor` already found — this avoids re-search spending against the shared budget. If it returns `{ error: "No search evidence saved for this idea." }`, fall back to `get_papers` with `status: "retained"` and, only if that's clearly insufficient, a small number of your own `search_papers` calls; prefer the persisted evidence whenever it exists.
3. Using paper counts, publication recency (are matches recent or old?), and conceptual overlap between the idea and the titles/abstracts you have, classify into exactly one of: `UNEXPLORED` (nothing close found), `UNDEREXPLORED` (a little, old or thin work), `EMERGING` (a few recent papers, still open), `ACTIVE` (an ongoing line of work, room remains), `CROWDED` (many close variants already), `SATURATED` (the specific question is essentially answered).
4. You are explicitly **not** using citation-activity signal — no citation graph exists in this build. Say so in your `saturation_evidence` rather than silently omitting it, and don't let its absence push you toward a false `UNEXPLORED`.
5. Call `update_idea_saturation` with `project_id`, `idea_id`, `saturation`, and `saturation_evidence` naming the specific papers and recency pattern behind your classification.

Never skip step 5 — the orchestrator will not treat this idea as audited until `saturation` is non-null.
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/plugin/agent-saturation-detector.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add agents/saturation-detector.md tests/plugin/agent-saturation-detector.test.ts
git commit -m "feat: add saturation-detector agent"
```

---

### Task 13: Modify `research-orchestrator` to run the full Phase 2 pipeline

**Files:**
- Modify: `agents/research-orchestrator.md`
- Modify: `tests/plugin/agent-research-orchestrator.test.ts`

**Interfaces:**
- Consumes: all four new agents (Tasks 9-12), `get_ideas`, `filter_ideas` MCP tools.
- Produces: the updated orchestrator body/frontmatter that later tasks (`/report`, README) reference.

- [ ] **Step 1: Update the failing test first**

Replace `tests/plugin/agent-research-orchestrator.test.ts` with:

```ts
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { parseFrontmatter } from "../helpers/frontmatter.js";

const content = readFileSync("agents/research-orchestrator.md", "utf-8");
const { data, body } = parseFrontmatter(content);

describe("agents/research-orchestrator.md", () => {
  it("has the expected frontmatter", () => {
    expect(data.name).toBe("research-orchestrator");
    expect(data.skills).toBe("research-methodology");
    expect(data.maxTurns).toBe(80);
  });

  it("instructs creating a project and delegating through all Phase 1+2 sub-agents", () => {
    expect(body).toMatch(/create_project/);
    expect(body).toMatch(/problem-analyzer/);
    expect(body).toMatch(/literature-scout/);
    expect(body).toMatch(/gap-hunter/);
    expect(body).toMatch(/idea-generator/);
    expect(body).toMatch(/novelty-auditor/);
    expect(body).toMatch(/saturation-detector/);
  });

  it("instructs verifying results before reporting success at every stage", () => {
    expect(body).toMatch(/has_spec/);
    expect(body).toMatch(/counts\.retained/);
    expect(body).toMatch(/counts\.gaps/);
    expect(body).toMatch(/counts\.ideas_generated/);
    expect(body).toMatch(/novelty_verdict/);
    expect(body).toMatch(/saturation/);
  });

  it("instructs the cheap orchestrator-side filter step using filter_ideas", () => {
    expect(body).toMatch(/filter_ideas/);
    expect(body).toMatch(/maxIdeasAudited/);
  });

  it("forbids gap-hunter and idea-generator from claiming audit verdicts", () => {
    expect(body).toMatch(/[Nn]ever let `?gap-hunter`?/);
    expect(body).toMatch(/null/);
  });

  it("shrinks the not-implemented disclosure to the Phase 3/4 boundary", () => {
    expect(body).toMatch(/mutation/i);
    expect(body).toMatch(/citation graph/i);
    expect(body).toMatch(/reviewer simulation/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/plugin/agent-research-orchestrator.test.ts`
Expected: FAIL — old body doesn't mention gap-hunter/idea-generator/etc, `maxTurns` is still 40.

- [ ] **Step 3: Rewrite the agent**

Replace `agents/research-orchestrator.md` entirely with:

```markdown
---
name: research-orchestrator
description: Runs the full research pipeline end-to-end for a problem statement — creates the project, delegates problem analysis, literature discovery, gap hunting, idea generation, and per-idea novelty/saturation auditing, verifies results, and reports progress. Invoked only via /research.
skills: research-methodology
maxTurns: 80
---

You are the research orchestrator. You run the pipeline for one research problem statement and you do not blindly trust what other agents report back to you.

## Steps

1. Call the `create_project` tool with the raw problem statement. Record the returned `project_id`.
2. Delegate to the `problem-analyzer` subagent. Give it the problem statement and the `project_id`, and tell it to call `save_problem_spec` when done. When it returns, call `get_project_state` and verify `has_spec` is true. If it is not, treat this as a failure: report it to the user plainly and stop rather than continuing with a missing spec.
3. Delegate to the `literature-scout` subagent. Give it the `project_id`. When it returns, call `get_project_state` and check `counts.retained`. If it is zero, do not describe the search as a success — report exactly what happened (which queries ran, which providers failed) and say the literature base is empty. Continue to gap hunting regardless — a gap-hunter run on zero retained papers will itself report nothing to hunt from, which is the honest outcome.
4. Delegate to the `gap-hunter` subagent with the `project_id`. When it returns, call `get_project_state` and check `counts.gaps`. If it is zero, report plainly that no gaps were found rather than inventing any.
5. Delegate to the `idea-generator` subagent with the `project_id`. When it returns, call `get_project_state` and check `counts.ideas_generated`. If it is zero, report plainly and skip straight to step 8 (steps 6-7 have nothing to work with).
6. Run the cheap orchestrator-side filter yourself — no subagent:
   - Call `get_ideas` with `status: "generated"`.
   - Drop near-duplicate ideas (near-identical `research_question`/`hypothesis` text) and any that are missing a required field — the schema should already prevent missing fields, but a duplicate is a real finding worth noting in your summary, not a silent discard.
   - Call `get_project_state` for `budgets.maxIdeasAudited` and keep only that many ideas for deep audit (when you must cut, prefer ideas with a non-null `gap_id` and a clearer mechanism).
   - Call `filter_ideas` with `project_id` and `drop_ids` for every idea you are not shortlisting.
7. For each shortlisted idea id, in turn:
   - Delegate to `novelty-auditor` with `project_id` and the idea id. When it returns, call `get_ideas` with that id and verify `novelty_verdict` is non-null before treating novelty as complete for this idea.
   - Delegate to `saturation-detector` with `project_id` and the idea id. When it returns, call `get_ideas` again and verify `saturation` is non-null before treating this idea as fully audited.
   - If either verdict comes back null after delegation, report that idea as not-fully-audited in your summary rather than silently dropping it.
8. Print a compact progress checklist as you go, in this style — use `✓` only for a step that actually succeeded per its verification check above, and `✗` for one that didn't, with a one-line reason:

```
Researching: <problem, one line>

✓ Project created (<project_id>)
✓ Problem analyzed (domain: <domain>)
✓ Literature discovered (<n> retained of <m> discovered)
✓ Gaps found (<g> gaps)
✓ Ideas generated (<i> ideas across <s> strategies)
✓ Ideas audited (<a> audited: <p> PASS / <w> WEAK / <f> FAIL; saturation: <breakdown>)
```

9. Close by telling the user to run `/gaps`, `/ideas`, `/literature`, or `/report`, and that idea mutation, evidence/assumption ledgers, the research graveyard, citation graphs, vector/embedding retrieval, experiment design, and reviewer simulation are not implemented in this build.

Never claim a stage succeeded when its verification step (`has_spec`, `counts.retained`, `counts.gaps`, `counts.ideas_generated`, `novelty_verdict`, `saturation`) failed. Never let `gap-hunter` or `idea-generator` claim novelty or saturation verdicts themselves — those fields must stay `null` until `novelty-auditor` and `saturation-detector` actually run.
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/plugin/agent-research-orchestrator.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add agents/research-orchestrator.md tests/plugin/agent-research-orchestrator.test.ts
git commit -m "feat: extend research-orchestrator with gap/idea/audit pipeline steps"
```

---

### Task 14: Extend `research-methodology` skill in place

**Files:**
- Modify: `skills/research-methodology/SKILL.md`
- Modify: `tests/plugin/skill-research-methodology.test.ts`

**Interfaces:**
- Consumes: nothing (reference content only).
- Produces: skill content read by all six agents (Phase 1's three plus the four new ones — `research-orchestrator` already declares `skills: research-methodology`; the four new leaf agents don't need their own `skills:` frontmatter since they inherit the pipeline's shared vocabulary through the orchestrator's delegation prompts and their own instructions already restate the relevant rules inline, matching how `problem-analyzer`/`literature-scout` work today).

- [ ] **Step 1: Update the failing test first**

Replace `tests/plugin/skill-research-methodology.test.ts` with:

```ts
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { parseFrontmatter } from "../helpers/frontmatter.js";

const content = readFileSync("skills/research-methodology/SKILL.md", "utf-8");
const { data, body } = parseFrontmatter(content);

describe("skills/research-methodology/SKILL.md", () => {
  it("has the expected frontmatter", () => {
    expect(data.name).toBe("research-methodology");
    expect(typeof data.description).toBe("string");
    expect((data.description as string).length).toBeGreaterThan(0);
    expect(data["user-invocable"]).toBe(false);
  });

  it("documents the novelty vocabulary and current phase boundaries", () => {
    expect(body).toMatch(/Genuine research opportunity/);
    expect(body).toMatch(/Saturated/);
    expect(body).toMatch(/not implemented/);
  });

  it("documents gap-hunting evidence discipline", () => {
    expect(body).toMatch(/evidence_paper_ids/);
  });

  it("documents that idea-generator never judges novelty or saturation", () => {
    expect(body).toMatch(/idea-generator/);
    expect(body).toMatch(/no single agent is the sole authority/i);
  });

  it("documents the full saturation vocabulary and the no-citation-signal caveat", () => {
    for (const level of ["UNEXPLORED", "UNDEREXPLORED", "EMERGING", "ACTIVE", "CROWDED", "SATURATED"]) {
      expect(body).toContain(level);
    }
    expect(body).toMatch(/no citation-activity signal/i);
  });

  it("documents that the novelty-auditor search budget is shared, not separate", () => {
    expect(body).toMatch(/shares? the same discovery-search budget|shared.*budget/i);
    expect(body).toMatch(/searches_remaining/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/plugin/skill-research-methodology.test.ts`
Expected: FAIL — current content lacks the new sections.

- [ ] **Step 3: Rewrite the skill**

Replace `skills/research-methodology/SKILL.md` entirely with:

```markdown
---
name: research-methodology
description: Core operating principles for the research-agent pipeline — evidence discipline, budget discipline, the novelty/saturation vocabulary, gap and idea generation discipline, and current phase boundaries.
user-invocable: false
---

# Research Methodology

## Evidence discipline

Never claim an idea or gap is novel because a search returned nothing. Absence of a hit is absence of evidence, not evidence of absence — search coverage is always partial. Every claim about the literature must trace to a specific retained paper (id, title, year). If you cannot point to evidence, say so explicitly rather than asserting confidence.

## Gap-hunting discipline

A gap must cite specific retained papers in `evidence_paper_ids` — never "nobody studied X" purely from a search returning nothing. A gap description should state what has actually been attempted (grounded in the cited papers) before stating what remains unresolved; don't skip straight to the opportunity.

## Idea-generation discipline

`idea-generator` proposes ideas; it never judges their novelty or how crowded their space is. Those fields (`novelty_verdict`, `saturation`) must stay `null` until the dedicated audit passes run — an idea-generator that writes "this is novel" or "this space is unexplored" into its own output is violating the principle that no single agent is the sole authority on novelty.

## Novelty vocabulary

When describing how an idea relates to existing work, use these distinctions and never blur them:

- **Novel** — no close prior work found after a real search; still a confidence judgment, not a guarantee.
- **Novel but weak** — new but unlikely to matter scientifically.
- **Novel but impractical** — new but not feasible to execute or evaluate.
- **Interesting but Saturated** — the space is already crowded with competing work.
- **Useful engineering improvement** — real value, but incremental rather than a research contribution.
- **Genuine research opportunity** — insufficiently explored, scientifically meaningful, technically plausible, and testable.

Never say an idea is "definitely novel."

When auditing novelty, distinguish terminological overlap (same words, different idea), conceptual overlap (same idea, different words), methodological overlap (same mechanism), and experimental overlap (same evaluation setup already tried) — these are different findings and must not be collapsed into one.

## Saturation vocabulary

`saturation-detector` classifies crowdedness into exactly one of `UNEXPLORED`, `UNDEREXPLORED`, `EMERGING`, `ACTIVE`, `CROWDED`, `SATURATED`, using paper counts, publication recency, and title/abstract conceptual overlap only. This build has **no citation-activity signal** — no citation graph exists yet — and that omission must be stated plainly in `saturation_evidence`, never silently treated as "no signal means unexplored."

## Budget discipline

Every search, retrieval, and analysis step draws from a fixed budget (see the project's `budget` record). Respect truncation and capping signals from tools (e.g. `queries_truncated`, `capped`, `{ saved: false, reason: ... }`) instead of working around them — a capped budget is a deliberate constraint, not a bug to route around. `novelty-auditor`'s prior-art searches share the same discovery-search budget as literature discovery rather than a separate pool — check `get_project_state`'s `searches_remaining` before spending it.

## Current phase boundaries

This build implements problem analysis, literature discovery, gap hunting, idea generation, adversarial novelty auditing, and saturation detection. Idea mutation, the evidence/assumption ledgers, the research graveyard, citation graphs, vector/embedding retrieval, experiment design, and reviewer simulation are not implemented yet. Never simulate or fabricate output for a stage that hasn't run — say plainly that it is not available in this build and point to the phase that will add it.
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/plugin/skill-research-methodology.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add skills/research-methodology/SKILL.md tests/plugin/skill-research-methodology.test.ts
git commit -m "docs: extend research-methodology skill with gap/idea/audit guidance"
```

---

### Task 15: `/gaps` command

**Files:**
- Create: `commands/gaps.md`
- Test: `tests/plugin/command-gaps.test.ts`

**Interfaces:**
- Consumes: `get_project_state`, `get_gaps` MCP tools.

- [ ] **Step 1: Write the failing test**

Create `tests/plugin/command-gaps.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { parseFrontmatter } from "../helpers/frontmatter.js";

const content = readFileSync("commands/gaps.md", "utf-8");
const { data, body } = parseFrontmatter(content);

describe("commands/gaps.md", () => {
  it("is user-invoked only, runs inline (no fork)", () => {
    expect(data["disable-model-invocation"]).toBe(true);
    expect(data.context).toBeUndefined();
  });

  it("instructs resolving the project and listing gaps", () => {
    expect(body).toMatch(/get_gaps/);
    expect(body).toMatch(/\$ARGUMENTS/);
  });

  it("says plainly when no gaps exist yet", () => {
    expect(body).toMatch(/no gaps/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/plugin/command-gaps.test.ts`
Expected: FAIL — file does not exist.

- [ ] **Step 3: Create the command**

Create `commands/gaps.md`:

```markdown
---
description: Show the research gaps found so far for the current or specified research project.
argument-hint: [project-id]
disable-model-invocation: true
---
Resolve the research project the same way /literature does: if an argument was given below, treat it as a `project_id` and call `get_project_state` with it; otherwise call `get_project_state` with no `project_id` to get the most recent project. If no project exists, say so and stop.

Call `get_gaps` for that project. If it returns no gaps, say so plainly — gap hunting may not have run yet, or it may have found nothing it could cite from the retained literature.

For each gap, present: title, category, confidence, the evidence paper ids it cites (cross-reference titles via `get_papers` if useful), what has been attempted, what remains unresolved, why it matters, why it's difficult, and the potential opportunity.

Project id argument (optional): $ARGUMENTS
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/plugin/command-gaps.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add commands/gaps.md tests/plugin/command-gaps.test.ts
git commit -m "feat: add /gaps command"
```

---

### Task 16: `/ideas` command

**Files:**
- Create: `commands/ideas.md`
- Test: `tests/plugin/command-ideas.test.ts`

**Interfaces:**
- Consumes: `get_project_state`, `get_ideas` MCP tools.

- [ ] **Step 1: Write the failing test**

Create `tests/plugin/command-ideas.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { parseFrontmatter } from "../helpers/frontmatter.js";

const content = readFileSync("commands/ideas.md", "utf-8");
const { data, body } = parseFrontmatter(content);

describe("commands/ideas.md", () => {
  it("is user-invoked only, runs inline (no fork)", () => {
    expect(data["disable-model-invocation"]).toBe(true);
    expect(data.context).toBeUndefined();
  });

  it("instructs resolving the project and listing ideas with their verdicts", () => {
    expect(body).toMatch(/get_ideas/);
    expect(body).toMatch(/novelty_verdict/);
    expect(body).toMatch(/saturation/);
    expect(body).toMatch(/\$ARGUMENTS/);
  });

  it("says plainly when no ideas exist yet or an audit hasn't completed", () => {
    expect(body).toMatch(/no ideas/i);
    expect(body).toMatch(/null/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/plugin/command-ideas.test.ts`
Expected: FAIL — file does not exist.

- [ ] **Step 3: Create the command**

Create `commands/ideas.md`:

```markdown
---
description: Show the candidate research ideas generated so far, with their novelty and saturation verdicts, for the current or specified research project.
argument-hint: [project-id]
disable-model-invocation: true
---
Resolve the research project the same way /literature does: if an argument was given below, treat it as a `project_id` and call `get_project_state` with it; otherwise call `get_project_state` with no `project_id` to get the most recent project. If no project exists, say so and stop.

Call `get_ideas` for that project. If it returns no ideas, say so plainly — idea generation may not have run yet.

For each idea, present: research question, hypothesis, strategy, and motivating gap (if any). If `novelty_verdict` and `saturation` are both non-null, also present the verdict with its evidence and confidence, and the saturation classification with its evidence. If either is still `null`, say plainly that the audit for that idea hasn't completed rather than omitting the idea or inventing a verdict. Present `filtered_out` ideas in a separate group from ones still in the running, rather than mixing them in silently.

Project id argument (optional): $ARGUMENTS
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/plugin/command-ideas.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add commands/ideas.md tests/plugin/command-ideas.test.ts
git commit -m "feat: add /ideas command"
```

---

### Task 17: Modify `/report` to populate Gaps and Ideas sections

**Files:**
- Modify: `commands/report.md`
- Modify: `tests/plugin/command-report.test.ts`

**Interfaces:**
- Consumes: `get_gaps`, `get_ideas` MCP tools (already existing `get_project_state`/`get_papers`/`get_problem_spec`/`get_literature_summary` calls stay unchanged).

- [ ] **Step 1: Update the failing test first**

Replace `tests/plugin/command-report.test.ts` with:

```ts
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { parseFrontmatter } from "../helpers/frontmatter.js";

const content = readFileSync("commands/report.md", "utf-8");
const { data, body } = parseFrontmatter(content);

describe("commands/report.md", () => {
  it("is user-invoked only, runs inline (no fork)", () => {
    expect(data["disable-model-invocation"]).toBe(true);
    expect(data.context).toBeUndefined();
  });

  it("covers the implemented report sections, including Gaps and Ideas", () => {
    for (const section of [
      "Executive Summary",
      "Problem Interpretation",
      "Assumptions",
      "Research Landscape",
      "Major Research Gaps",
      "Candidate Research Ideas",
      "References",
    ]) {
      expect(body).toContain(section);
    }
  });

  it("instructs pulling gaps and ideas via their own tools", () => {
    expect(body).toMatch(/get_gaps/);
    expect(body).toMatch(/get_ideas/);
  });

  it("instructs ordering ideas by verdict and saturation rather than leaving them unranked", () => {
    expect(body).toMatch(/PASS.*WEAK.*FAIL|order/i);
  });

  it("explicitly marks only the still-unimplemented sections rather than fabricating them", () => {
    expect(body).toMatch(/Not Yet Available/);
    expect(body).toMatch(/Mutated Directions/);
    expect(body).toMatch(/Full Experimental Roadmap/);
    expect(body).toMatch(/never fabricate/i);
  });

  it("instructs reading the spec and literature summary via their own tools, tolerating either being unsaved", () => {
    expect(body).toMatch(/get_problem_spec/);
    expect(body).toMatch(/get_literature_summary/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/plugin/command-report.test.ts`
Expected: FAIL — current body still lists Gaps/Ideas as unimplemented and lacks `get_gaps`/`get_ideas`.

- [ ] **Step 3: Rewrite the command**

Replace `commands/report.md` entirely with:

```markdown
---
description: Generate the research report for the current or specified project from whatever pipeline stages have completed.
argument-hint: [project-id]
disable-model-invocation: true
---
Resolve the research project the same way /literature does, using this optional project id argument: $ARGUMENTS. If no project exists, say so and stop.

Gather the project's state and retained papers via `get_project_state` and `get_papers`, the structured spec via `get_problem_spec`, the literature summary via `get_literature_summary`, the gaps via `get_gaps`, and the ideas via `get_ideas`. `get_problem_spec` and `get_literature_summary` return `{error: "..."}` if nothing has been saved yet — treat that as "not available in this project yet," not as a failure, and say so plainly in the relevant section rather than fabricating content.

Produce a report with these sections, in order:

1. **Executive Summary** — 2-4 sentences on the problem and what's been found so far.
2. **Problem Interpretation** — the research question, domain, and objectives from the spec (say plainly if no spec has been saved yet).
3. **Assumptions** — the assumptions list from the spec (say plainly if no spec has been saved yet).
4. **Research Landscape** — the literature summary plus the retained papers list (title, authors, year, venue, url).
5. **Major Research Gaps** — every gap from `get_gaps`, with its category, confidence, evidence paper ids, and the attempted/unresolved/matters/difficult/opportunity fields. Say plainly if none exist yet.
6. **Candidate Research Ideas** — every idea from `get_ideas`, with its strategy, motivating gap, and (once audited) novelty verdict + evidence + confidence and saturation + evidence. Order the list: `PASS` verdicts first, then `WEAK`, then `FAIL`, then any idea whose audit hasn't completed yet; within `PASS`, order by saturation from `UNEXPLORED` toward `SATURATED` so the most promising, least-crowded ideas surface first. For any idea whose `novelty_verdict` or `saturation` is still null, say plainly that its audit hasn't completed rather than omitting it or inventing a verdict. Say plainly if no ideas exist yet.
7. **References** — every retained paper as a numbered citation with id, title, year, venue, and url; mark any paper missing a url or doi as unverified rather than omitting it silently.

After References, add a final section titled **Not Yet Available** listing, verbatim: Mutated Directions, Evidence/Assumption Ledgers, Research Graveyard, Citation Graph, Vector/Embedding Retrieval, Minimal Validation Experiment, Full Experimental Roadmap, Potential Reviewer Objections — each with the note "requires a later implementation phase, not present in this build." Never fabricate content for these sections.
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/plugin/command-report.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add commands/report.md tests/plugin/command-report.test.ts
git commit -m "feat: populate Gaps and Ideas sections in /report, shrink Not Yet Available list"
```

---

### Task 18: README update

**Files:**
- Modify: `README.md`
- Test: `tests/plugin/readme.test.ts` (already passing once content is present; run to confirm)

**Interfaces:**
- Consumes: none — documentation only, reflects Tasks 1-17.

- [ ] **Step 1: Confirm the existing README test still targets the right assertions**

`tests/plugin/readme.test.ts` already requires `## Installation`, `## Configuration`, `## Commands`, `## Architecture`, `## Example Run`, `## Limitations`, `--plugin-dir`, and mentions of `/research`, `/literature`, `/report`, `/gaps`, `/ideas`. No test changes are needed for this task — it already anticipated Phase 2's commands. Run it now to confirm it currently passes against the Phase 1 README (it does, since `/gaps`/`/ideas` are already named in the Limitations table as not-yet-implemented) and will still pass once the content changes below make those same commands *implemented*.

Run: `npm test -- tests/plugin/readme.test.ts`
Expected: PASS (before and after this task — the test only checks presence of headings/strings, not their surrounding claims)

- [ ] **Step 2: Update README content**

In `README.md`:

- Change the title from `# Research Agent (Phase 1)` to `# Research Agent (Phase 2)` and update the opening paragraph to mention gap hunting, idea generation, novelty auditing, and saturation detection alongside problem analysis and literature discovery.
- In **Configuration**, extend the budget JSON example to include `"maxGaps": 8, "maxRawIdeas": 10, "maxIdeasAudited": 4`.
- In **Commands**, update the table:

```markdown
| Command | Status | What it does |
|---|---|---|
| `/research <problem>` | Implemented | Runs the full pipeline: creates a project, analyzes the problem, discovers literature, hunts gaps, generates ideas, and audits each shortlisted idea for novelty and saturation. |
| `/literature [project-id]` | Implemented | Shows the retained papers and literature summary for a project. |
| `/gaps [project-id]` | Implemented | Shows the research gaps found so far, with their evidence. |
| `/ideas [project-id]` | Implemented | Shows candidate research ideas with their novelty and saturation verdicts. |
| `/report [project-id]` | Implemented | Renders a full report including gaps and ranked ideas; explicitly marks the remaining unimplemented sections rather than fabricating them. |
| `/audit`, `/experiment`, `/review` | **Not implemented in this build** | Arrive in Phases 3-4 alongside the agents that back them (mutation engine, experiment-designer, reviewer). |
```

- In **Architecture**, update the diagram to show the four new agents and the full tool count:

```markdown
Claude Code plugin
  commands/research.md  ──fork──▶  agents/research-orchestrator.md
  commands/literature.md, commands/gaps.md, commands/ideas.md, commands/report.md  (inline, read project state)
                                        │
                        Task-delegates to:
                        agents/problem-analyzer.md
                        agents/literature-scout.md
                        agents/gap-hunter.md
                        agents/idea-generator.md
                        agents/novelty-auditor.md      (per shortlisted idea)
                        agents/saturation-detector.md  (per shortlisted idea, after novelty-auditor)
                                        │
                        all call MCP tools ──▶
                                        │
research-server (src/mcp-server) — 19 tools, thin wrappers over:
                                        │
engine (src/engine) — runtime-independent: schemas, storage (JSON files),
  budget, cache, dedupe, retrieval (arXiv + Semantic Scholar providers),
  search orchestration
                                        │
research-data/ — project.json, spec.json, papers.json, gaps.json, ideas.json,
  idea_search_evidence.json, literature_summary.json, log.jsonl per project;
  on-disk query cache
```

- In **Limitations**, add:

```markdown
- `novelty-auditor`'s prior-art searches share the same `maxDiscoverySearchesPerProject` budget as literature discovery, not a separate pool — a literature-heavy run can leave little search budget for novelty audits; `get_project_state`'s `searches_remaining` surfaces this.
- Saturation classification uses paper counts, publication recency, and title/abstract overlap only — there is no citation graph in this build, so citation-activity signal (a stronger crowdedness indicator) is never used, and agents are instructed to say so rather than omit it silently.
- "Ranked output" is a presentation-level ordering in `/report` (PASS before WEAK before FAIL, then by saturation), not a scored/weighted ranking algorithm.
```

- [ ] **Step 3: Run the README test**

Run: `npm test -- tests/plugin/readme.test.ts`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "docs: update README for Phase 2 (gap hunting, idea generation, novelty/saturation auditing)"
```

---

### Task 19: Full-suite verification and manual end-to-end check

**Files:** none (verification only).

- [ ] **Step 1: Run the full automated test suite**

Run: `npm test`
Expected: PASS — every `tests/engine`, `tests/mcp-server`, and `tests/plugin` file green, including the Phase 1 tests untouched by this plan.

- [ ] **Step 2: Type-check and build**

Run: `npm run build`
Expected: no TypeScript errors; `dist/mcp-server/index.js` and friends are produced.

- [ ] **Step 3: Validate the plugin structure**

Run: `claude plugin validate .`
Expected: no errors — new commands/agents/skill sections parse correctly.

- [ ] **Step 4: Manual end-to-end run**

Following the README's local-dev instructions (from a *different* working directory than the plugin root, per the existing gotcha), run:

```
/research <a real problem statement>
```

Confirm the orchestrator's progress checklist shows all six lines (project, problem analysis, literature, gaps, ideas, audits) either `✓` or an honest `✗` with a reason, then run `/gaps`, `/ideas`, and `/report` and confirm each renders real content (or a plain "not available yet" message) rather than fabricating anything. Watch specifically for: `novelty-auditor` respecting `searches_remaining`, `saturation-detector` reusing persisted search evidence rather than always re-searching, and no idea ever showing a non-null `novelty_verdict`/`saturation` that wasn't actually set by the corresponding audit agent.

If `research-orchestrator`'s `maxTurns: 80` proves insufficient or excessive during this run, note the observed behavior (as Phase 1's README already does for `literature-scout`'s `maxTurns: 20`) rather than silently changing the number without evidence.

- [ ] **Step 5: Commit any fixes found during manual verification**

If the manual run surfaces a real defect (not a budget-tuning observation), fix it with its own test following the TDD pattern from the earlier tasks, then commit separately:

```bash
git add <fixed files>
git commit -m "fix: <description of the defect found during Phase 2 end-to-end verification>"
```
