# Phase 4 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add experiment design (minimal validation experiment + full roadmap) and adversarial reviewer simulation for the top surviving ideas from each `/research` run, closing out the 4-phase roadmap.

**Architecture:** Two new leaf agents (`experiment-designer`, `reviewer`), each Task-delegated once per top-`maxIdeasEvaluated` PASS-verdict idea by `research-orchestrator` after its existing mutation loop. Two new schemas (`Experiment`, `Review`) with one-record-per-idea storage and matching `save_*`/`get_*` MCP tools, following the exact pattern already used for gaps/ideas/graveyard/assumptions. `/report` gains three new sections; two new read-only inline commands (`/experiment`, `/review`) mirror `/gaps`.

**Tech Stack:** TypeScript (Node16 module resolution, explicit `.js` import extensions), Zod schemas, `@modelcontextprotocol/sdk`'s `McpServer`/`registerTool`, vitest, Claude Code plugin agents/commands/skills (Markdown + YAML frontmatter).

**Spec:** `docs/superpowers/specs/2026-08-28-research-agent-phase4-design.md`

## Global Constraints

- Every new Zod object schema for MCP tool input uses `.strict()`.
- Relative TypeScript imports use explicit `.js` extensions (Node16 module resolution).
- `id` fields on stored records always use the `` `prefix-${String(index).padStart(3,"0")}` `` convention via a dedicated `src/engine/ids.ts` function — never inline string interpolation elsewhere.
- Every task follows RED → GREEN → commit. Run the stated test command and confirm the failure text before implementing, then confirm the pass before committing.
- New agent `.md` files use `maxTurns: 12` (matching `idea-mutator`'s scope) unless a task says otherwise.
- New MCP tools are wired in both `src/mcp-server/tools.ts` (schema + handler function) and `src/mcp-server/index.ts` (`server.registerTool(...)` call) in the same task.
- Total tool count after Task 3: **31** (was 25).

---

### Task 1: Schemas, ids, and budget field

**Files:**
- Modify: `src/engine/schemas.ts`
- Modify: `src/engine/ids.ts`
- Modify: `src/engine/budget.ts`
- Test: `tests/engine/schemas.test.ts`
- Test: `tests/engine/ids.test.ts`
- Test: `tests/engine/budget.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `ExperimentSchema`/`NewExperimentSchema`/`Experiment`/`NewExperiment`, `ReviewSchema`/`NewReviewSchema`/`Review`/`NewReview`, `ObjectionCategorySchema`, `ObjectionSeveritySchema`, `RecommendationSchema`, `createExperimentId(index)`, `createReviewId(index)`, `Budget.maxIdeasEvaluated` — all consumed by Task 2 (storage) and Task 3 (MCP tools).

- [ ] **Step 1: Write the failing test additions**

Read `tests/engine/schemas.test.ts`, `tests/engine/ids.test.ts`, and `tests/engine/budget.test.ts` in full first (do not guess their existing content — prior phases each had pre-existing fixtures elsewhere in these files that broke on schema extension; check for a shared `Budget` object literal here too). Then append:

To `tests/engine/schemas.test.ts`:

```ts
describe("ExperimentSchema", () => {
  const validExperiment = {
    id: "experiment-001",
    idea_id: "idea-001",
    minimal_validation: {
      setup: "Train a small model on a held-out split",
      metric: "sample efficiency vs. baseline",
      expected_signal: "significant reduction in samples-to-threshold",
      estimated_effort: "2-3 days, single GPU",
    },
    full_roadmap: ["Minimal validation", "Ablation across environments", "Scale to larger models"],
    risks: ["Baseline may already be tuned for this metric"],
  };

  it("accepts a valid experiment record", () => {
    expect(() => ExperimentSchema.parse(validExperiment)).not.toThrow();
  });

  it("requires at least one full_roadmap step", () => {
    expect(() => ExperimentSchema.parse({ ...validExperiment, full_roadmap: [] })).toThrow();
  });

  it("NewExperimentSchema omits id", () => {
    const { id, ...rest } = validExperiment;
    expect(() => NewExperimentSchema.parse(rest)).not.toThrow();
  });
});

describe("ReviewSchema", () => {
  const validReview = {
    id: "review-001",
    idea_id: "idea-001",
    objections: [{ category: "feasibility" as const, objection: "No access to the compute this requires", severity: "major" as const }],
    overall_recommendation: "weak_accept" as const,
  };

  it("accepts a valid review record", () => {
    expect(() => ReviewSchema.parse(validReview)).not.toThrow();
  });

  it("accepts an empty objections list", () => {
    expect(() => ReviewSchema.parse({ ...validReview, objections: [] })).not.toThrow();
  });

  it("rejects an unknown objection category", () => {
    expect(() =>
      ReviewSchema.parse({ ...validReview, objections: [{ category: "bogus", objection: "x", severity: "minor" }] })
    ).toThrow();
  });

  it("rejects an unknown recommendation", () => {
    expect(() => ReviewSchema.parse({ ...validReview, overall_recommendation: "maybe" })).toThrow();
  });

  it("NewReviewSchema omits id", () => {
    const { id, ...rest } = validReview;
    expect(() => NewReviewSchema.parse(rest)).not.toThrow();
  });
});
```

Add the corresponding imports (`ExperimentSchema`, `NewExperimentSchema`, `ReviewSchema`, `NewReviewSchema`) to this test file's existing import block from `../../src/engine/schemas.js`.

To `tests/engine/ids.test.ts`, inside the existing describe structure (match its current style):

```ts
describe("createExperimentId", () => {
  it("formats with zero-padded index", () => {
    expect(createExperimentId(1)).toBe("experiment-001");
    expect(createExperimentId(12)).toBe("experiment-012");
  });
});

describe("createReviewId", () => {
  it("formats with zero-padded index", () => {
    expect(createReviewId(1)).toBe("review-001");
  });
});
```

Add `createExperimentId`, `createReviewId` to this file's existing import from `../../src/engine/ids.js`.

To `tests/engine/budget.test.ts`, add an assertion for the new field wherever the existing tests check `DEFAULT_BUDGET`'s shape (append a line, don't restructure):

```ts
  it("DEFAULT_BUDGET includes maxIdeasEvaluated", () => {
    expect(DEFAULT_BUDGET.maxIdeasEvaluated).toBe(3);
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/engine/schemas.test.ts tests/engine/ids.test.ts tests/engine/budget.test.ts`
Expected: FAIL — `ExperimentSchema`/`ReviewSchema`/`createExperimentId`/`createReviewId`/`maxIdeasEvaluated` don't exist yet.

- [ ] **Step 3: Implement in `src/engine/schemas.ts`**

Add immediately after the existing `EvidenceLedgerEntrySchema` block (before `export const BudgetSchema`):

```ts
export const ExperimentSchema = z.object({
  id: z.string(),
  idea_id: z.string(),
  minimal_validation: z.object({
    setup: z.string(),
    metric: z.string(),
    expected_signal: z.string(),
    estimated_effort: z.string(),
  }),
  full_roadmap: z.array(z.string()).min(1),
  risks: z.array(z.string()),
});
export type Experiment = z.infer<typeof ExperimentSchema>;

export const NewExperimentSchema = ExperimentSchema.omit({ id: true });
export type NewExperiment = z.infer<typeof NewExperimentSchema>;

export const ObjectionCategorySchema = z.enum(["novelty", "feasibility", "significance", "evaluation_validity"]);
export type ObjectionCategory = z.infer<typeof ObjectionCategorySchema>;

export const ObjectionSeveritySchema = z.enum(["minor", "major", "fatal"]);
export type ObjectionSeverity = z.infer<typeof ObjectionSeveritySchema>;

export const RecommendationSchema = z.enum(["accept", "weak_accept", "weak_reject", "reject"]);
export type Recommendation = z.infer<typeof RecommendationSchema>;

export const ReviewSchema = z.object({
  id: z.string(),
  idea_id: z.string(),
  objections: z.array(
    z.object({
      category: ObjectionCategorySchema,
      objection: z.string(),
      severity: ObjectionSeveritySchema,
    })
  ),
  overall_recommendation: RecommendationSchema,
});
export type Review = z.infer<typeof ReviewSchema>;

export const NewReviewSchema = ReviewSchema.omit({ id: true });
export type NewReview = z.infer<typeof NewReviewSchema>;
```

Add `maxIdeasEvaluated: z.number().int().positive(),` to `BudgetSchema`, after the existing `maxMutationsPerProject` field.

- [ ] **Step 4: Implement in `src/engine/ids.ts`**

Append:

```ts
export function createExperimentId(index: number): string {
  return `experiment-${String(index).padStart(3, "0")}`;
}

export function createReviewId(index: number): string {
  return `review-${String(index).padStart(3, "0")}`;
}
```

- [ ] **Step 5: Implement in `src/engine/budget.ts`**

Add `maxIdeasEvaluated: 3,` to `DEFAULT_BUDGET`, after the existing `maxMutationsPerProject: 3,` line.

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx vitest run tests/engine/schemas.test.ts tests/engine/ids.test.ts tests/engine/budget.test.ts`
Expected: PASS, including all pre-existing assertions in these three files. If a pre-existing `Budget` or `ProjectStateSchema` fixture elsewhere in `tests/engine/schemas.test.ts` or `tests/engine/budget.test.ts` breaks because it constructs a `Budget` object literal without `maxIdeasEvaluated`, add the field to that fixture (this happened three times in Phase 3A's Task 1 — check for it, don't assume it won't recur).

- [ ] **Step 7: Commit**

```bash
git add src/engine/schemas.ts src/engine/ids.ts src/engine/budget.ts tests/engine/schemas.test.ts tests/engine/ids.test.ts tests/engine/budget.test.ts
git commit -m "feat: add Experiment/Review schemas, ids, and maxIdeasEvaluated budget"
```

---

### Task 2: Storage layer for experiments and reviews

**Files:**
- Modify: `src/engine/storage.ts`
- Test: `tests/engine/storage.test.ts`

**Interfaces:**
- Consumes: `ExperimentSchema`, `NewExperiment`, `Experiment`, `ReviewSchema`, `NewReview`, `Review`, `createExperimentId`, `createReviewId` (Task 1).
- Produces: `ProjectStore.saveExperiment(projectId, ideaId, experiment: NewExperiment): Experiment`, `getExperiment(projectId, ideaId): Experiment | null`, `getAllExperiments(projectId): Experiment[]`, `saveReview(projectId, ideaId, review: NewReview): Review`, `getReview(projectId, ideaId): Review | null`, `getAllReviews(projectId): Review[]` — consumed by Task 3 (MCP tools).

- [ ] **Step 1: Write the failing test additions**

Read `tests/engine/storage.test.ts` in full first — reuse its existing `newIdea`/`newGap`-style helper functions and setup pattern rather than inventing new ones (Phase 3A's Task 2 deliberately matched established helpers over a plan's own proposed helper; do the same here). Append tests exercising:

```ts
describe("saveExperiment / getExperiment / getAllExperiments", () => {
  it("saves an experiment for an idea and retrieves it", () => {
    const store = new ProjectStore(dir);
    const project = store.createProject("problem", DEFAULT_BUDGET);
    const idea = store.saveIdea(project.id, newIdea(), DEFAULT_BUDGET.maxRawIdeas)!;
    const experiment = store.saveExperiment(project.id, idea.id, {
      idea_id: idea.id,
      minimal_validation: { setup: "s", metric: "m", expected_signal: "e", estimated_effort: "1 day" },
      full_roadmap: ["step 1"],
      risks: [],
    });
    expect(experiment.id).toBe("experiment-001");
    expect(store.getExperiment(project.id, idea.id)).toEqual(experiment);
  });

  it("returns null for an idea with no saved experiment", () => {
    const store = new ProjectStore(dir);
    const project = store.createProject("problem", DEFAULT_BUDGET);
    expect(store.getExperiment(project.id, "idea-999")).toBeNull();
  });

  it("overwrites an existing experiment for the same idea rather than duplicating", () => {
    const store = new ProjectStore(dir);
    const project = store.createProject("problem", DEFAULT_BUDGET);
    const idea = store.saveIdea(project.id, newIdea(), DEFAULT_BUDGET.maxRawIdeas)!;
    store.saveExperiment(project.id, idea.id, {
      idea_id: idea.id,
      minimal_validation: { setup: "s1", metric: "m", expected_signal: "e", estimated_effort: "1 day" },
      full_roadmap: ["step 1"],
      risks: [],
    });
    store.saveExperiment(project.id, idea.id, {
      idea_id: idea.id,
      minimal_validation: { setup: "s2", metric: "m", expected_signal: "e", estimated_effort: "1 day" },
      full_roadmap: ["step 1"],
      risks: [],
    });
    expect(store.getAllExperiments(project.id)).toHaveLength(1);
    expect(store.getExperiment(project.id, idea.id)!.minimal_validation.setup).toBe("s2");
  });
});

describe("saveReview / getReview / getAllReviews", () => {
  it("saves a review for an idea and retrieves it", () => {
    const store = new ProjectStore(dir);
    const project = store.createProject("problem", DEFAULT_BUDGET);
    const idea = store.saveIdea(project.id, newIdea(), DEFAULT_BUDGET.maxRawIdeas)!;
    const review = store.saveReview(project.id, idea.id, {
      idea_id: idea.id,
      objections: [{ category: "novelty", objection: "close prior work exists", severity: "major" }],
      overall_recommendation: "weak_reject",
    });
    expect(review.id).toBe("review-001");
    expect(store.getReview(project.id, idea.id)).toEqual(review);
  });

  it("returns null for an idea with no saved review", () => {
    const store = new ProjectStore(dir);
    const project = store.createProject("problem", DEFAULT_BUDGET);
    expect(store.getReview(project.id, "idea-999")).toBeNull();
  });

  it("overwrites an existing review for the same idea rather than duplicating", () => {
    const store = new ProjectStore(dir);
    const project = store.createProject("problem", DEFAULT_BUDGET);
    const idea = store.saveIdea(project.id, newIdea(), DEFAULT_BUDGET.maxRawIdeas)!;
    store.saveReview(project.id, idea.id, { idea_id: idea.id, objections: [], overall_recommendation: "accept" });
    store.saveReview(project.id, idea.id, { idea_id: idea.id, objections: [], overall_recommendation: "reject" });
    expect(store.getAllReviews(project.id)).toHaveLength(1);
    expect(store.getReview(project.id, idea.id)!.overall_recommendation).toBe("reject");
  });
});
```

Adjust the exact `newIdea()`/setup calls to match whatever the file's real helpers are named and how `dir`/`beforeEach` are structured — read the file first, this is illustrative of intent, not literal copy-paste.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/engine/storage.test.ts`
Expected: FAIL — `saveExperiment`/`getExperiment`/`getAllExperiments`/`saveReview`/`getReview`/`getAllReviews` don't exist on `ProjectStore` yet.

- [ ] **Step 3: Implement in `src/engine/storage.ts`**

Add to the import block from `./schemas.js`: `ExperimentSchema`, `type Experiment`, `type NewExperiment`, `ReviewSchema`, `type Review`, `type NewReview`. Add to the import from `./ids.js`: `createExperimentId`, `createReviewId`.

Add two new private file-path methods after `evidenceFile`:

```ts
  private experimentsFile(id: string): string {
    return join(this.projectDir(id), "experiments.json");
  }
  private reviewsFile(id: string): string {
    return join(this.projectDir(id), "reviews.json");
  }
```

Append at the end of the class (after `createIdeaMutation`):

```ts
  private getAllExperimentsRaw(projectId: string): Experiment[] {
    if (!existsSync(this.experimentsFile(projectId))) return [];
    const raw = JSON.parse(readFileSync(this.experimentsFile(projectId), "utf-8"));
    return (raw as unknown[]).map((e) => ExperimentSchema.parse(e));
  }

  private saveAllExperiments(projectId: string, experiments: Experiment[]): void {
    writeFileSync(this.experimentsFile(projectId), JSON.stringify(experiments, null, 2), "utf-8");
  }

  getAllExperiments(projectId: string): Experiment[] {
    return this.getAllExperimentsRaw(projectId);
  }

  getExperiment(projectId: string, ideaId: string): Experiment | null {
    return this.getAllExperimentsRaw(projectId).find((e) => e.idea_id === ideaId) ?? null;
  }

  saveExperiment(projectId: string, ideaId: string, experiment: NewExperiment): Experiment {
    if (!this.getProject(projectId)) throw new Error(`Unknown project: ${projectId}`);
    const existing = this.getAllExperimentsRaw(projectId);
    const withoutThisIdea = existing.filter((e) => e.idea_id !== ideaId);
    const created: Experiment = { ...experiment, id: createExperimentId(existing.length + 1) };
    this.saveAllExperiments(projectId, [...withoutThisIdea, created]);
    logEvent(this.logFile(projectId), "experiment_saved", projectId, { idea_id: ideaId });
    return created;
  }

  private getAllReviewsRaw(projectId: string): Review[] {
    if (!existsSync(this.reviewsFile(projectId))) return [];
    const raw = JSON.parse(readFileSync(this.reviewsFile(projectId), "utf-8"));
    return (raw as unknown[]).map((r) => ReviewSchema.parse(r));
  }

  private saveAllReviews(projectId: string, reviews: Review[]): void {
    writeFileSync(this.reviewsFile(projectId), JSON.stringify(reviews, null, 2), "utf-8");
  }

  getAllReviews(projectId: string): Review[] {
    return this.getAllReviewsRaw(projectId);
  }

  getReview(projectId: string, ideaId: string): Review | null {
    return this.getAllReviewsRaw(projectId).find((r) => r.idea_id === ideaId) ?? null;
  }

  saveReview(projectId: string, ideaId: string, review: NewReview): Review {
    if (!this.getProject(projectId)) throw new Error(`Unknown project: ${projectId}`);
    const existing = this.getAllReviewsRaw(projectId);
    const withoutThisIdea = existing.filter((r) => r.idea_id !== ideaId);
    const created: Review = { ...review, id: createReviewId(existing.length + 1) };
    this.saveAllReviews(projectId, [...withoutThisIdea, created]);
    logEvent(this.logFile(projectId), "review_saved", projectId, { idea_id: ideaId });
    return created;
  }
```

Note the overwrite semantics: `id` is always freshly assigned from the post-filter length, so re-saving for the same idea produces a new id each time — this is acceptable since the record is looked up by `idea_id`, not by remembering its own id across calls.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/engine/storage.test.ts`
Expected: PASS, including all pre-existing assertions in this file.

- [ ] **Step 5: Commit**

```bash
git add src/engine/storage.ts tests/engine/storage.test.ts
git commit -m "feat: add experiment and review storage (one record per idea, overwrite on re-save)"
```

---

### Task 3: MCP tools for experiments and reviews

**Files:**
- Modify: `src/mcp-server/tools.ts`
- Modify: `src/mcp-server/index.ts`
- Test: `tests/mcp-server/tools.test.ts`
- Test: `tests/mcp-server/smoke.test.ts`

**Interfaces:**
- Consumes: `NewExperimentSchema`, `NewReviewSchema` (Task 1); `ProjectStore.saveExperiment`/`getExperiment`/`getAllExperiments`/`saveReview`/`getReview`/`getAllReviews` (Task 2).
- Produces: MCP tools `save_experiment`, `get_experiment`, `get_experiments`, `save_review`, `get_review`, `get_reviews` — consumed by Task 4 (`experiment-designer`), Task 5 (`reviewer`), Task 8 (`/report`), Tasks 9-10 (`/experiment`, `/review`).

- [ ] **Step 1: Write the failing test additions**

Read `tests/mcp-server/tools.test.ts` in full first (reuse its existing `setup()`/helper pattern). Append:

```ts
describe("save_experiment / get_experiment / get_experiments", () => {
  it("saves and retrieves an experiment for an idea", () => {
    const ctx = setup();
    const project = tools.createProject(ctx, { problem: "p" });
    const idea = tools.saveIdea(ctx, { project_id: project.project_id, idea: baseIdeaInput() });
    const result = tools.saveExperiment(ctx, {
      project_id: project.project_id,
      idea_id: idea.idea!.id,
      experiment: {
        idea_id: idea.idea!.id,
        minimal_validation: { setup: "s", metric: "m", expected_signal: "e", estimated_effort: "1 day" },
        full_roadmap: ["step 1"],
        risks: [],
      },
    });
    expect(result.saved).toBe(true);
    expect(tools.getExperiment(ctx, { project_id: project.project_id, idea_id: idea.idea!.id })).toMatchObject({
      idea_id: idea.idea!.id,
    });
    expect(tools.getExperiments(ctx, { project_id: project.project_id }).experiments).toHaveLength(1);
  });

  it("get_experiment returns an error for an idea with no saved experiment", () => {
    const ctx = setup();
    const project = tools.createProject(ctx, { problem: "p" });
    const result = tools.getExperiment(ctx, { project_id: project.project_id, idea_id: "idea-999" });
    expect(result).toEqual({ error: "No experiment saved for this idea." });
  });
});

describe("save_review / get_review / get_reviews", () => {
  it("saves and retrieves a review for an idea", () => {
    const ctx = setup();
    const project = tools.createProject(ctx, { problem: "p" });
    const idea = tools.saveIdea(ctx, { project_id: project.project_id, idea: baseIdeaInput() });
    const result = tools.saveReview(ctx, {
      project_id: project.project_id,
      idea_id: idea.idea!.id,
      review: { idea_id: idea.idea!.id, objections: [], overall_recommendation: "accept" },
    });
    expect(result.saved).toBe(true);
    expect(tools.getReview(ctx, { project_id: project.project_id, idea_id: idea.idea!.id })).toMatchObject({
      idea_id: idea.idea!.id,
    });
    expect(tools.getReviews(ctx, { project_id: project.project_id }).reviews).toHaveLength(1);
  });

  it("get_review returns an error for an idea with no saved review", () => {
    const ctx = setup();
    const project = tools.createProject(ctx, { problem: "p" });
    const result = tools.getReview(ctx, { project_id: project.project_id, idea_id: "idea-999" });
    expect(result).toEqual({ error: "No review saved for this idea." });
  });
});
```

Use whichever `baseIdeaInput()`-equivalent helper already exists in this file (Phase 3A's Task 3 added one — check before adding a duplicate).

To `tests/mcp-server/smoke.test.ts`, update the expected tool-name array to add `save_experiment`, `get_experiment`, `get_experiments`, `save_review`, `get_review`, `get_reviews`, and update the test description from "25 expected tools" to "31 expected tools".

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/mcp-server/tools.test.ts tests/mcp-server/smoke.test.ts`
Expected: FAIL — the six new tool functions don't exist, and the smoke test's tool list doesn't match yet.

- [ ] **Step 3: Implement in `src/mcp-server/tools.ts`**

Add `NewExperimentSchema`, `NewReviewSchema` to the import block from `../engine/schemas.js`. Append at the end of the file:

```ts
export const saveExperimentInput = z
  .object({ project_id: z.string(), idea_id: z.string(), experiment: NewExperimentSchema })
  .strict();
export function saveExperiment(ctx: ToolContext, input: z.infer<typeof saveExperimentInput>) {
  const experiment = ctx.store.saveExperiment(input.project_id, input.idea_id, input.experiment);
  return { saved: true as const, experiment };
}

export const getExperimentInput = z.object({ project_id: z.string(), idea_id: z.string() }).strict();
export function getExperiment(ctx: ToolContext, input: z.infer<typeof getExperimentInput>) {
  const experiment = ctx.store.getExperiment(input.project_id, input.idea_id);
  if (!experiment) return { error: "No experiment saved for this idea." };
  return experiment;
}

export const getExperimentsInput = z.object({ project_id: z.string() }).strict();
export function getExperiments(ctx: ToolContext, input: z.infer<typeof getExperimentsInput>) {
  return { experiments: ctx.store.getAllExperiments(input.project_id) };
}

export const saveReviewInput = z.object({ project_id: z.string(), idea_id: z.string(), review: NewReviewSchema }).strict();
export function saveReview(ctx: ToolContext, input: z.infer<typeof saveReviewInput>) {
  const review = ctx.store.saveReview(input.project_id, input.idea_id, input.review);
  return { saved: true as const, review };
}

export const getReviewInput = z.object({ project_id: z.string(), idea_id: z.string() }).strict();
export function getReview(ctx: ToolContext, input: z.infer<typeof getReviewInput>) {
  const review = ctx.store.getReview(input.project_id, input.idea_id);
  if (!review) return { error: "No review saved for this idea." };
  return review;
}

export const getReviewsInput = z.object({ project_id: z.string() }).strict();
export function getReviews(ctx: ToolContext, input: z.infer<typeof getReviewsInput>) {
  return { reviews: ctx.store.getAllReviews(input.project_id) };
}
```

- [ ] **Step 4: Implement in `src/mcp-server/index.ts`**

Add six `server.registerTool(...)` calls before `const transport = new StdioServerTransport();`, following the exact style of the existing calls (e.g. `reject_idea_to_graveyard`):

```ts
server.registerTool(
  "save_experiment",
  {
    title: "Save Experiment Design",
    description: "Save the minimal validation experiment, full experimental roadmap, and risks for one evaluated idea.",
    inputSchema: tools.saveExperimentInput,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  async (input) => respond(tools.saveExperiment(ctx, input))
);

server.registerTool(
  "get_experiment",
  {
    title: "Get Experiment Design",
    description: "Get the saved experiment design for one idea, or an error if it hasn't been evaluated.",
    inputSchema: tools.getExperimentInput,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  async (input) => respond(tools.getExperiment(ctx, input))
);

server.registerTool(
  "get_experiments",
  {
    title: "Get All Experiment Designs",
    description: "Get every saved experiment design for a project.",
    inputSchema: tools.getExperimentsInput,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  async (input) => respond(tools.getExperiments(ctx, input))
);

server.registerTool(
  "save_review",
  {
    title: "Save Reviewer Objections",
    description: "Save the simulated reviewer's objections and overall recommendation for one evaluated idea.",
    inputSchema: tools.saveReviewInput,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  async (input) => respond(tools.saveReview(ctx, input))
);

server.registerTool(
  "get_review",
  {
    title: "Get Reviewer Objections",
    description: "Get the saved reviewer objections for one idea, or an error if it hasn't been evaluated.",
    inputSchema: tools.getReviewInput,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  async (input) => respond(tools.getReview(ctx, input))
);

server.registerTool(
  "get_reviews",
  {
    title: "Get All Reviewer Objections",
    description: "Get every saved review for a project.",
    inputSchema: tools.getReviewsInput,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  async (input) => respond(tools.getReviews(ctx, input))
);
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run tests/mcp-server/tools.test.ts tests/mcp-server/smoke.test.ts`
Expected: PASS, including all pre-existing assertions in both files.

- [ ] **Step 6: Commit**

```bash
git add src/mcp-server/tools.ts src/mcp-server/index.ts tests/mcp-server/tools.test.ts tests/mcp-server/smoke.test.ts
git commit -m "feat: add save/get MCP tools for experiments and reviews (31 tools total, up from 25)"
```

---

### Task 4: New Agent — experiment-designer

**Files:**
- Create: `agents/experiment-designer.md`
- Test: `tests/plugin/agent-experiment-designer.test.ts`

**Interfaces:**
- Consumes: `get_ideas`, `get_gaps`, `get_papers`, `save_experiment` (existing + Task 3).
- Produces: `agents/experiment-designer.md`, delegated to by `research-orchestrator` (Task 6).

- [ ] **Step 1: Write the failing test**

Create `tests/plugin/agent-experiment-designer.test.ts`, modeled on `tests/plugin/agent-idea-mutator.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { parseFrontmatter } from "../helpers/frontmatter.js";

const content = readFileSync("agents/experiment-designer.md", "utf-8");
const { data, body } = parseFrontmatter(content);

describe("agents/experiment-designer.md", () => {
  it("has the expected frontmatter", () => {
    expect(data.name).toBe("experiment-designer");
    expect(typeof data.maxTurns).toBe("number");
  });

  it("instructs reading the idea and grounding evidence before designing", () => {
    expect(body).toMatch(/get_ideas/);
    expect(body).toMatch(/get_papers/);
    expect(body).toMatch(/save_experiment/);
  });

  it("requires setup, metric, and expected_signal in the minimal validation experiment", () => {
    expect(body).toMatch(/setup/);
    expect(body).toMatch(/metric/);
    expect(body).toMatch(/expected_signal/);
  });

  it("requires risks to be grounded in retained literature, not generic caveats", () => {
    expect(body).toMatch(/risk/i);
    expect(body).toMatch(/generic/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/plugin/agent-experiment-designer.test.ts`
Expected: FAIL — `agents/experiment-designer.md` doesn't exist.

- [ ] **Step 3: Create `agents/experiment-designer.md`**

```markdown
---
name: experiment-designer
description: Proposes a minimal validation experiment and a fuller experimental roadmap for one evaluated idea, grounded in the idea's mechanism and the retained literature. Used internally by research-orchestrator, one idea per invocation.
maxTurns: 12
---

You are the experiment designer. You receive a `project_id` and one evaluated `idea_id`. Your job is to propose a concrete, minimal-first experimental path for testing this idea's hypothesis — not a generic research plan.

## Steps

1. Call `get_ideas` with `ids: [idea_id]` for the `research_question`, `hypothesis`, `mechanism`, and `expected_contribution`. If the idea has a `gap_id`, call `get_gaps` with `ids: [gap_id]` for what's already been attempted. Call `get_papers` with `status: "retained"` for literature to ground risks in.
2. Design the minimal validation experiment: the smallest experiment that would give real signal on the hypothesis.
   - `setup` — what is actually run (the model/method, the data, the comparison).
   - `metric` — what is measured.
   - `expected_signal` — what result would support the hypothesis, and what result would refute it. A vague "if it works" is not an expected signal.
   - `estimated_effort` — a rough scale (hours/days/weeks, compute needed).
3. Write the full experimental roadmap: an ordered list of steps starting from the minimal validation experiment and building toward a complete case for the idea (e.g. ablations, scaling, held-out generalization checks).
4. Write risks: concrete ways the experiment could fail to produce a clean signal — confounds, missing baselines, evaluation validity concerns. Ground each risk in something a similar retained paper actually ran into, not a generic caveat like "results may not generalize." If you cannot ground a risk in the literature you read, say so rather than inventing one anyway.
5. Call `save_experiment` with `project_id`, `idea_id`, and the experiment content from steps 2-4.
6. Report back to the orchestrator: a one-line summary of the minimal validation experiment and how many roadmap steps you proposed.

Never propose a minimal validation experiment without a concrete `setup`, `metric`, and `expected_signal` — "run more experiments" is not a minimal validation experiment.
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/plugin/agent-experiment-designer.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add agents/experiment-designer.md tests/plugin/agent-experiment-designer.test.ts
git commit -m "feat: add experiment-designer agent"
```

---

### Task 5: New Agent — reviewer

**Files:**
- Create: `agents/reviewer.md`
- Test: `tests/plugin/agent-reviewer.test.ts`

**Interfaces:**
- Consumes: `get_ideas`, `get_experiment`, `save_review` (existing + Tasks 3-4).
- Produces: `agents/reviewer.md`, delegated to by `research-orchestrator` (Task 6).

- [ ] **Step 1: Write the failing test**

Create `tests/plugin/agent-reviewer.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { parseFrontmatter } from "../helpers/frontmatter.js";

const content = readFileSync("agents/reviewer.md", "utf-8");
const { data, body } = parseFrontmatter(content);

describe("agents/reviewer.md", () => {
  it("has the expected frontmatter", () => {
    expect(data.name).toBe("reviewer");
    expect(typeof data.maxTurns).toBe("number");
  });

  it("instructs reading the idea and its experiment design before reviewing", () => {
    expect(body).toMatch(/get_ideas/);
    expect(body).toMatch(/get_experiment/);
    expect(body).toMatch(/save_review/);
  });

  it("documents all four objection categories", () => {
    for (const category of ["novelty", "feasibility", "significance", "evaluation_validity"]) {
      expect(body).toContain(category);
    }
  });

  it("requires overall_recommendation to follow from objection severities, not be assigned independently", () => {
    expect(body).toMatch(/fatal/);
    expect(body).toMatch(/reject/);
    expect(body).toMatch(/independently/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/plugin/agent-reviewer.test.ts`
Expected: FAIL — `agents/reviewer.md` doesn't exist.

- [ ] **Step 3: Create `agents/reviewer.md`**

```markdown
---
name: reviewer
description: Simulates an adversarial peer-reviewer pass on one evaluated idea, raising objections by category and issuing a recommendation grounded in those objections. Used internally by research-orchestrator, one idea per invocation.
maxTurns: 12
---

You are the reviewer. You receive a `project_id` and one evaluated `idea_id`. Your job is to raise the objections a skeptical peer reviewer would actually raise, not to rubber-stamp the idea.

## Steps

1. Call `get_ideas` with `ids: [idea_id]` for the `research_question`, `hypothesis`, `novelty_verdict`, `novelty_evidence`, `saturation`, and `saturation_evidence`. Call `get_experiment` with `project_id` and `idea_id` — if one exists, a reviewer who has seen the proposed validation plan can raise sharper, more specific objections than one who hasn't; if none exists (`{error: ...}`), review the idea on its own terms.
2. Raise objections across up to four categories — `novelty`, `feasibility`, `significance`, `evaluation_validity` — but only where a real objection exists. Not every category needs an objection; a category with nothing wrong should be omitted rather than padded with a manufactured concern. For each real objection, assign a `severity`: `minor`, `major`, or `fatal`.
3. Determine `overall_recommendation` from the objections you actually wrote, never independently of them: any `fatal` objection means `reject`; a `major` objection with no `fatal` means `weak_reject` or `weak_accept` depending on whether the idea's own strengths (novelty PASS, clear mechanism, grounded minimal validation experiment) outweigh it; no `major` or `fatal` objections means `accept` or `weak_accept`. Justify the recommendation in your report by naming the specific objection(s) that drove it.
4. Call `save_review` with `project_id`, `idea_id`, `objections`, and `overall_recommendation`.
5. Report back to the orchestrator: how many objections you raised by category, and the overall recommendation with its justification.

Never assign `overall_recommendation` independently of the objections you listed — a `fatal` objection with an `accept` recommendation is a contradiction, not a judgment call.
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/plugin/agent-reviewer.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add agents/reviewer.md tests/plugin/agent-reviewer.test.ts
git commit -m "feat: add reviewer agent"
```

---

### Task 6: Extend research-orchestrator with the evaluation stage

**Files:**
- Modify: `agents/research-orchestrator.md`
- Modify: `tests/plugin/agent-research-orchestrator.test.ts`

**Interfaces:**
- Consumes: `experiment-designer` (Task 4), `reviewer` (Task 5), `get_experiment`/`get_review` (Task 3), `Budget.maxIdeasEvaluated` (Task 1).
- Produces: no new interface — extends the existing agent's pipeline and test coverage.

- [ ] **Step 1: Write the failing test additions**

Read `tests/plugin/agent-research-orchestrator.test.ts` in full first. Its existing frontmatter test checks `typeof data.maxTurns === "number"` (loosened during Phase 3A) and its own `"has maxTurns increased for the extended pipeline"` test checks `toBeGreaterThan(80)` — update that test's threshold to `toBeGreaterThan(150)` since this task raises it further, and append:

```ts
  it("instructs selecting top PASS ideas by maxIdeasEvaluated and delegating experiment-designer/reviewer", () => {
    expect(body).toMatch(/maxIdeasEvaluated/);
    expect(body).toMatch(/experiment-designer/);
    expect(body).toMatch(/reviewer/);
    expect(body).toMatch(/novelty_verdict.*PASS|PASS.*novelty_verdict/s);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/plugin/agent-research-orchestrator.test.ts`
Expected: FAIL — no mention of `maxIdeasEvaluated`/`experiment-designer`/`reviewer` yet, and `maxTurns` is still `150` (fails the raised `toBeGreaterThan(150)` threshold).

- [ ] **Step 3: Modify `agents/research-orchestrator.md`**

Change the frontmatter `maxTurns: 150` to `maxTurns: 200`.

Insert a new step 10 (renumbering the existing checklist step from 9 to 10 becomes 11, and the closing step from 10 to 11 becomes 12 — read the file first and renumber its real current steps, since Phase 3A's step numbers are what's actually there now) between the existing mutation loop (current step 8) and the checklist step:

```markdown
9. Among ideas with `status !== "rejected"` and `novelty_verdict === "PASS"` (including any surviving mutations), rank by saturation from `UNEXPLORED` toward `CROWDED` — the same ordering `/report` uses — and select the top `maxIdeasEvaluated` (from `get_project_state`'s `budgets`; call `get_project_state` again here if needed since more ideas may exist now than at pipeline start). For each selected idea:
   - Delegate to `experiment-designer` with `project_id` and the idea id. When it returns, call `get_experiment` and verify it does not return `{error: ...}` before treating the experiment as designed.
   - Delegate to `reviewer` with `project_id` and the idea id. When it returns, call `get_review` and verify it does not return `{error: ...}` before treating the review as complete.
   - If more eligible ideas exist than `maxIdeasEvaluated`, note in your summary how many were skipped by the cap — this is expected budget discipline, not an error.
```

Modify the checklist template to add an evaluation line:
```
✓ Ideas evaluated (<e> evaluated of <p> PASS, capped at <maxIdeasEvaluated>)
```

Modify the closing step to shrink its "not implemented" list — remove "citation graphs, vector/embedding retrieval, experiment design, and reviewer simulation" and replace with just "citation graphs and vector/embedding retrieval" (read the file's actual current closing-step wording first and edit its real text).

Also modify the final "Never claim a stage succeeded..." paragraph to add: "Never select an idea for experiment design/review that isn't `novelty_verdict === \"PASS\"` and not rejected, and never exceed `maxIdeasEvaluated`."

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/plugin/agent-research-orchestrator.test.ts`
Expected: PASS, including all pre-existing assertions in this file.

- [ ] **Step 5: Commit**

```bash
git add agents/research-orchestrator.md tests/plugin/agent-research-orchestrator.test.ts
git commit -m "feat: extend research-orchestrator with the experiment-design/review evaluation stage"
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

Read `tests/plugin/skill-research-methodology.test.ts` in full first, then append:

```ts
  it("documents experiment-design and review discipline, and the Phase 4 phase boundary", () => {
    expect(body).toMatch(/minimal validation experiment/i);
    expect(body).toMatch(/fatal/);
    expect(body).toMatch(/independently/i);
    expect(body).not.toMatch(/Citation graphs and vector\/embedding retrieval.*not implemented[\s\S]*Citation graphs and vector\/embedding retrieval.*not implemented/);
  });
```

(The final assertion is a light sanity check that the phase-boundaries text was actually edited, not duplicated — not a strict content check, since the exact wording is set in Step 3 below.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/plugin/skill-research-methodology.test.ts`
Expected: FAIL — no experiment-design/review section exists yet.

- [ ] **Step 3: Modify `skills/research-methodology/SKILL.md`**

Add a new section after the existing "## Mutation and rejection discipline" section and before "## Budget discipline":

```markdown
## Experiment-design and review discipline

A minimal validation experiment must specify a concrete `setup`, `metric`, and `expected_signal` — "run more experiments" is not a minimal validation experiment. Risks must be grounded in what similar retained papers actually encountered, not generic caveats like "results may not generalize." A reviewer's `overall_recommendation` must follow from its own listed objections' severities, never assigned independently of them; a `fatal` objection always yields `reject`.
```

Modify the existing "## Current phase boundaries" section's body text — replace:
```
This build implements problem analysis, literature discovery, gap hunting, idea generation, adversarial novelty auditing, saturation detection, idea mutation, the evidence and assumption ledgers, and the research graveyard. Citation graphs, vector/embedding retrieval, experiment design, and reviewer simulation are not implemented yet. Never simulate or fabricate output for a stage that hasn't run — say plainly that it is not available in this build and point to the phase that will add it.
```
with:
```
This build implements problem analysis, literature discovery, gap hunting, idea generation, adversarial novelty auditing, saturation detection, idea mutation, the evidence and assumption ledgers, the research graveyard, minimal validation experiment design, full experimental roadmaps, and adversarial reviewer simulation. Citation graphs and vector/embedding retrieval are not implemented yet. Never simulate or fabricate output for a stage that hasn't run — say plainly that it is not available in this build and point to the phase that will add it.
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/plugin/skill-research-methodology.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add skills/research-methodology/SKILL.md tests/plugin/skill-research-methodology.test.ts
git commit -m "docs: extend research-methodology skill with experiment-design/review discipline"
```

---

### Task 8: Extend /report

**Files:**
- Modify: `commands/report.md`
- Modify: `tests/plugin/command-report.test.ts`

**Interfaces:**
- Consumes: `get_experiments`, `get_reviews` (Task 3).
- Produces: no new interface — extends existing command content and test coverage.

- [ ] **Step 1: Write the failing test additions**

Read `tests/plugin/command-report.test.ts` in full first (note its existing "Phase 3A sections" test uses a `notYetAvailableLine` helper pattern found by locating the line containing `"listing, verbatim"` — reuse the same technique here rather than a naive substring/regex match across the whole body, since the earlier literal-regex approach from the Phase 3A plan proved unsatisfiable by construction). Append:

```ts
  it("covers the newly-implemented Phase 4 sections and shrinks the not-yet-available list to just the two permanent exclusions", () => {
    expect(body).toContain("Minimal Validation Experiment");
    expect(body).toContain("Full Experimental Roadmap");
    expect(body).toContain("Potential Reviewer Objections");
    expect(body).toMatch(/get_experiments/);
    expect(body).toMatch(/get_reviews/);
    const notYetAvailableLine = body.split("\n").find((l) => l.includes("listing, verbatim"));
    expect(notYetAvailableLine).toBeDefined();
    expect(notYetAvailableLine).toContain("Citation Graph");
    expect(notYetAvailableLine).toContain("Vector/Embedding Retrieval");
    expect(notYetAvailableLine).not.toMatch(/Minimal Validation Experiment/);
    expect(notYetAvailableLine).not.toMatch(/Full Experimental Roadmap/);
    expect(notYetAvailableLine).not.toMatch(/Potential Reviewer Objections/);
  });
```

Note: the existing test `"explicitly marks only the still-unimplemented sections rather than fabricating them"` asserts `expect(body).toMatch(/Full Experimental Roadmap/)` — this still passes since "Full Experimental Roadmap" now appears as a real section header instead of in the Not Yet Available list; no change needed to that existing test.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/plugin/command-report.test.ts`
Expected: FAIL — the three new sections don't exist, and the Not Yet Available line still lists them.

- [ ] **Step 3: Modify `commands/report.md`**

Modify the tool-gathering paragraph to add the two new calls (append to the existing sentence naming `get_graveyard`/`get_assumptions`): `, the evaluated ideas' experiments via `get_experiments`, and their reviews via `get_reviews``.

Add three new sections after the existing "Mutated Directions" section and before "References" (renumber "References" and "Not Yet Available" accordingly — read the file's actual current numbering first):

```markdown
9. **Minimal Validation Experiment** — for each idea with a saved experiment (from `get_experiments`), grouped under its research question: `setup`, `metric`, `expected_signal`, and `estimated_effort`. Say plainly if no ideas have been evaluated yet.
10. **Full Experimental Roadmap** — for each evaluated idea, its ordered `full_roadmap` steps and `risks`. Say plainly if none exist.
11. **Potential Reviewer Objections** — for each evaluated idea (from `get_reviews`), its objections grouped by `category` with `severity`, and its `overall_recommendation`. Say plainly if none exist.
```

Modify the final "Not Yet Available" paragraph — replace:
```markdown
After References, add a final section titled **Not Yet Available** listing, verbatim: Citation Graph, Vector/Embedding Retrieval, Minimal Validation Experiment, Full Experimental Roadmap, Potential Reviewer Objections — each with the note "requires a later implementation phase, not present in this build." Never fabricate content for these sections.
```
with:
```markdown
After References, add a final section titled **Not Yet Available** listing, verbatim: Citation Graph, Vector/Embedding Retrieval — each with the note "requires a later implementation phase, not present in this build." Never fabricate content for these sections.
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/plugin/command-report.test.ts`
Expected: PASS, including all pre-existing assertions in this file.

- [ ] **Step 5: Commit**

```bash
git add commands/report.md tests/plugin/command-report.test.ts
git commit -m "feat: populate Minimal Validation Experiment, Full Experimental Roadmap, and Potential Reviewer Objections in /report"
```

---

### Task 9: New Command — /experiment

**Files:**
- Create: `commands/experiment.md`
- Test: `tests/plugin/command-experiment.test.ts`

**Interfaces:**
- Consumes: `get_project_state`, `get_ideas`, `get_experiments`, `get_experiment` (existing + Task 3).
- Produces: `commands/experiment.md`.

- [ ] **Step 1: Write the failing test**

Create `tests/plugin/command-experiment.test.ts`, modeled on `tests/plugin/command-gaps.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { parseFrontmatter } from "../helpers/frontmatter.js";

const content = readFileSync("commands/experiment.md", "utf-8");
const { data, body } = parseFrontmatter(content);

describe("commands/experiment.md", () => {
  it("is user-invoked only, runs inline (no fork)", () => {
    expect(data["disable-model-invocation"]).toBe(true);
    expect(data.context).toBeUndefined();
  });

  it("instructs resolving the project and listing experiments", () => {
    expect(body).toMatch(/get_experiments/);
    expect(body).toMatch(/\$ARGUMENTS/);
  });

  it("distinguishes an unevaluated idea from a nonexistent one", () => {
    expect(body).toMatch(/get_ideas/);
    expect(body).toMatch(/not evaluated/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/plugin/command-experiment.test.ts`
Expected: FAIL — `commands/experiment.md` doesn't exist.

- [ ] **Step 3: Create `commands/experiment.md`**

```markdown
---
description: Show the experiment design (minimal validation experiment and full roadmap) for evaluated ideas in the current or specified research project.
argument-hint: [project-id] [idea-id]
disable-model-invocation: true
---
Resolve the research project the same way /literature does: if the first argument below looks like a project id, treat it as `project_id` and call `get_project_state` with it; otherwise call `get_project_state` with no `project_id` to get the most recent project. If no project exists, say so and stop.

If an idea id was also given, call `get_experiment` for that project and idea id. If it returns `{error: "No experiment saved for this idea."}`, check `get_ideas` for that id: if the idea exists but has no experiment, say plainly that it was not evaluated in this run (it may have been outside the `maxIdeasEvaluated` cap, or not a PASS-verdict idea); if no such idea exists, say so instead.

If no idea id was given, call `get_experiments` for the project. If it returns none, say so plainly — no ideas have been evaluated yet. Otherwise present each evaluated idea's minimal validation experiment (setup, metric, expected signal, estimated effort), full roadmap, and risks, grouped under its research question (cross-reference via `get_ideas`).

Project id and idea id arguments (optional): $ARGUMENTS
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/plugin/command-experiment.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add commands/experiment.md tests/plugin/command-experiment.test.ts
git commit -m "feat: add /experiment command"
```

---

### Task 10: New Command — /review

**Files:**
- Create: `commands/review.md`
- Test: `tests/plugin/command-review.test.ts`

**Interfaces:**
- Consumes: `get_project_state`, `get_ideas`, `get_reviews`, `get_review` (existing + Task 3).
- Produces: `commands/review.md`.

- [ ] **Step 1: Write the failing test**

Create `tests/plugin/command-review.test.ts`, mirroring Task 9's test:

```ts
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { parseFrontmatter } from "../helpers/frontmatter.js";

const content = readFileSync("commands/review.md", "utf-8");
const { data, body } = parseFrontmatter(content);

describe("commands/review.md", () => {
  it("is user-invoked only, runs inline (no fork)", () => {
    expect(data["disable-model-invocation"]).toBe(true);
    expect(data.context).toBeUndefined();
  });

  it("instructs resolving the project and listing reviews", () => {
    expect(body).toMatch(/get_reviews/);
    expect(body).toMatch(/\$ARGUMENTS/);
  });

  it("distinguishes an unevaluated idea from a nonexistent one", () => {
    expect(body).toMatch(/get_ideas/);
    expect(body).toMatch(/not evaluated/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/plugin/command-review.test.ts`
Expected: FAIL — `commands/review.md` doesn't exist.

- [ ] **Step 3: Create `commands/review.md`**

```markdown
---
description: Show the simulated reviewer objections and recommendation for evaluated ideas in the current or specified research project.
argument-hint: [project-id] [idea-id]
disable-model-invocation: true
---
Resolve the research project the same way /literature does: if the first argument below looks like a project id, treat it as `project_id` and call `get_project_state` with it; otherwise call `get_project_state` with no `project_id` to get the most recent project. If no project exists, say so and stop.

If an idea id was also given, call `get_review` for that project and idea id. If it returns `{error: "No review saved for this idea."}`, check `get_ideas` for that id: if the idea exists but has no review, say plainly that it was not evaluated in this run (it may have been outside the `maxIdeasEvaluated` cap, or not a PASS-verdict idea); if no such idea exists, say so instead.

If no idea id was given, call `get_reviews` for the project. If it returns none, say so plainly — no ideas have been evaluated yet. Otherwise present each evaluated idea's objections grouped by category with severity, and its overall recommendation, grouped under its research question (cross-reference via `get_ideas`).

Project id and idea id arguments (optional): $ARGUMENTS
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/plugin/command-review.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add commands/review.md tests/plugin/command-review.test.ts
git commit -m "feat: add /review command"
```

---

### Task 11: README Update

**Files:**
- Modify: `README.md`
- Modify: `tests/plugin/readme.test.ts` (only if it hard-checks a tool count or command list that changed — read it first; Phase 3A's version had no such hard check)

**Interfaces:** none.

- [ ] **Step 1: Read the current README and readme.test.ts**

Read both files in full before editing — do not guess their current content.

- [ ] **Step 2: Update README.md**

- Title: `# Research Agent (Phase 3A)` → `# Research Agent (Phase 4)`; intro paragraph gains a clause about proposing minimal validation experiments and simulating adversarial review for top surviving ideas, and "**Phase 3A**" → "**Phase 4**" (this is the final phase — note that in the sentence, e.g. "the final phase of this design").
- Configuration's example `config.json` block: add `"maxIdeasEvaluated": 3` after `"maxMutationsPerProject"` if that key is present in the current block, else after whatever the last budget key currently listed is (read the current block first — it may not yet list every `Budget` field; match its existing style rather than listing every field for the first time).
- Commands table: change the `/experiment`, `/review` row from "**Not implemented in this build**" to "Implemented", with a description ("Shows the minimal validation experiment / full roadmap and risks for evaluated ideas" / "Shows the simulated reviewer's objections and recommendation for evaluated ideas"). Update the `/research` row's description to mention the evaluation stage.
- Architecture diagram: add `agents/experiment-designer.md` and `agents/reviewer.md` (per evaluated idea, after the mutation loop) to the delegate list; update tool count `25` → `31`; add `experiments.json, reviews.json` to the `research-data/` file list.
- Example Run paragraph: add a sentence about the evaluation stage (top `maxIdeasEvaluated` PASS ideas get an experiment design and a review) and update the follow-up command list to include `/experiment`, `/review`.
- Limitations: remove the line "No citation graph, embeddings/vector retrieval, experiment design, or reviewer simulation" and replace with "No citation graph or embeddings/vector retrieval — these are permanently out of scope for the phased roadmap (see the design specs)." Add a line noting: only the top `maxIdeasEvaluated` PASS-verdict ideas get an experiment design and review per run — WEAK ideas and ideas past the cap are never evaluated, by design.
- Spec and Plan section: add Phase 4 design/plan doc paths.

- [ ] **Step 3: Run the README test**

Run: `npx vitest run tests/plugin/readme.test.ts`
Expected: PASS. If it fails on a hard-coded assertion this task's edits touched, update that assertion to match the new, correct content (do not revert the README edit to make an assertion pass — the assertion is stale, not the content).

- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "docs: update README for Phase 4 (experiment design, reviewer simulation)"
```

(Add `tests/plugin/readme.test.ts` to the `git add` if Step 3 required changing it.)

---

### Task 12: Full Verification Pass

**Files:** none created.

- [ ] **Step 1: Clean build**

Run: `npm run build`
Expected: no TypeScript errors.

- [ ] **Step 2: Full test suite**

Run: `npm test`
Expected: every test file passes, zero failures — should be noticeably more than Phase 3A's 197 tests.

- [ ] **Step 3: Plugin validation**

Run: `npx @anthropic-ai/claude-code plugin validate .`
Expected: `✔ Validation passed`.

- [ ] **Step 4: Working tree clean**

Run: `git status`
Expected: nothing to commit (aside from any pre-existing untracked scratch directories from prior sessions, which are not this plan's concern).

No commit for this task — it only verifies work already committed in Tasks 1-11.
