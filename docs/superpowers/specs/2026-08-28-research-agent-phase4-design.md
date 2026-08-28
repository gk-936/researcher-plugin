# Phase 4 Design: Experiment Design and Reviewer Simulation

## 1. Scope

Phase 4 closes the roadmap's last two stages: for each idea that survives audit and mutation, propose a minimal validation experiment and a fuller experimental roadmap, and simulate an adversarial peer-reviewer pass raising likely objections. This is the final phase of the original 4-phase plan; citation graphs and vector/embedding retrieval remain permanently out of scope (never on the phased roadmap).

Out of scope for Phase 4 (unchanged from Phase 3A's boundary): citation graphs, vector/embedding retrieval.

## 2. Trigger model

`research-orchestrator` auto-runs both stages as the final part of the `/research` pipeline, after the mutation loop (Phase 3A's step 8). This mirrors how novelty/saturation auditing already auto-chains — a stage that only ran when separately invoked would leave `/report` silently incomplete after a normal `/research` call, which conflicts with the project's evidence-discipline norm of never leaving a stage's absence ambiguous.

`/experiment [idea-id]` and `/review [idea-id]` are read-only inline commands, matching `/gaps`/`/ideas`/`/literature`: they show whatever `research-orchestrator` already saved for the given idea (or the most recent project's ideas if no id given — matching `/ideas`'s existing resolution pattern), and say plainly "not evaluated in this run" for an idea outside the top-N budget rather than triggering new work. This keeps read commands cheap and consistent with the rest of the command surface; only `/research` spends budget.

## 3. Eligibility and budget cap

A new `Budget` field, `maxIdeasEvaluated` (default `3`), caps how many ideas get experiment-design + review per project — same pattern as `maxIdeasAudited` capping the audit stage.

Eligible ideas: `status !== "rejected"` **and** `novelty_verdict === "PASS"`. This is a stricter bar than the rejection rule's own (FAIL/SATURATED reject) — WEAK ideas are not rejected but are also not run through the expensive experiment/review stages, since PASS is the existing top tier in `/report`'s ordering and the clearest survivor signal.

Selection: rank eligible ideas the same way `/report` already orders `PASS` ideas — by saturation from `UNEXPLORED` toward `CROWDED` — and take the top `maxIdeasEvaluated`. Ideas past the cap are left unevaluated; `research-orchestrator` states the cap plainly in its progress checklist and closing summary, not silently.

Mutated ideas are eligible on the same terms as originals once re-audited to `PASS` — no special-casing; `mutation_depth`/`mutated_from` don't affect eligibility or ranking.

## 4. Schemas

Two new schemas in `src/engine/schemas.ts`, following the existing `Gap`/`GraveyardEntry` pattern (full record with `id`, `New*` variant via `.omit({ id: true })`):

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

`BudgetSchema` gains `maxIdeasEvaluated: z.number().int().positive()`; `DEFAULT_BUDGET` gains `maxIdeasEvaluated: 3`.

`src/engine/ids.ts` gains `createExperimentId` and `createReviewId`, following the existing `` `prefix-${String(index).padStart(3,"0")}` `` pattern.

## 5. Storage

`ProjectStore` (`src/engine/storage.ts`) gains, following the exact shape of the existing `saveAssumptions`/`getAssumptions`/`saveGaps`-style methods:

- `saveExperiment(projectId, ideaId, experiment: NewExperiment): Experiment` — one experiment per idea; overwrites if called again for the same `idea_id` (an idea is only ever evaluated once per run, but re-running `/research` on an existing project should not accumulate duplicates).
- `getExperiment(projectId, ideaId): Experiment | null`
- `getAllExperiments(projectId): Experiment[]`
- `saveReview(projectId, ideaId, review: NewReview): Review` — same overwrite semantics.
- `getReview(projectId, ideaId): Review | null`
- `getAllReviews(projectId): Review[]`

New per-project files: `experiments.json`, `reviews.json`, following the existing `graveyard.json`/`assumptions.json`/`evidence.json` pattern (private `experimentsFile`/`reviewsFile` path methods, private `saveAllExperiments`/`saveAllReviews` writers).

## 6. New agents

### `agents/experiment-designer.md`

Receives `project_id` and one eligible `idea_id`. Reads the idea (`get_ideas`), its motivating gap if any (`get_gaps`), and retained literature (`get_papers`) for grounding. Proposes:
- **Minimal validation experiment**: the smallest experiment that would give real signal on the hypothesis — `setup` (what's run), `metric` (what's measured), `expected_signal` (what result would support vs. refute the hypothesis), `estimated_effort` (rough scale: hours/days/weeks, compute needed).
- **Full experimental roadmap**: an ordered list of follow-up experiments that would build a complete case, starting from the minimal validation experiment.
- **Risks**: concrete ways the experiment could fail to produce a clean signal (confounds, missing baselines, evaluation validity concerns) — grounded in what similar retained papers actually ran into, not generic caveats.

Calls `save_experiment`. `maxTurns: 12` (matching `idea-mutator`'s scope).

### `agents/reviewer.md`

Receives `project_id` and one eligible `idea_id`. Reads the idea, its novelty/saturation evidence, and (if one exists) its experiment design (`get_experiment`) — a reviewer who has seen the proposed validation plan can raise sharper objections than one who hasn't. Produces objections across the four categories (`novelty`, `feasibility`, `significance`, `evaluation_validity`) — not every category needs an objection, and a category with no real objection should be omitted rather than padded. Each objection gets a `severity`. An `overall_recommendation` follows from the objections' severities (any `fatal` → `reject`; a `major` with no `fatal` → `weak_reject` or `weak_accept` depending on whether the idea's own strengths outweigh it; no `major`/`fatal` → `accept`/`weak_accept`) — the agent must justify the recommendation against the specific objections, not assign it independently.

Calls `save_review`. `maxTurns: 12`.

Both agents inherit the `research-methodology` skill's evidence discipline (no fabricated objections/risks without grounding) — no new skill file needed; Phase 4 principles get folded into the existing skill (see §8).

## 7. MCP tools

Six new tools in `src/mcp-server/tools.ts` + `index.ts`, following the exact `save_X`/`get_X` pattern already used for every other stage:

- `save_experiment` — `{ project_id, idea_id, experiment: NewExperimentSchema }` → `{ saved: true, experiment }`.
- `get_experiment` — `{ project_id, idea_id }` → the `Experiment` or `{ error: "..." }` if none saved.
- `get_experiments` — `{ project_id }` → `{ experiments: Experiment[] }` (all experiments for the project, for `/report`).
- `save_review` — `{ project_id, idea_id, review: NewReviewSchema }` → `{ saved: true, review }`.
- `get_review` — `{ project_id, idea_id }` → the `Review` or `{ error: "..." }`.
- `get_reviews` — `{ project_id }` → `{ reviews: Review[] }`.

Total: 25 → 31 tools.

## 8. Orchestrator changes

`research-orchestrator.md`: after step 8 (mutation loop), insert a new step 9:

> Among ideas with `status !== "rejected"` and `novelty_verdict === "PASS"`, rank by saturation (`UNEXPLORED` toward `CROWDED`) and select the top `maxIdeasEvaluated` (from `get_project_state`'s budget). For each selected idea: delegate to `experiment-designer`, verify `get_experiment` returns a non-null result; delegate to `reviewer`, verify `get_review` returns a non-null result. If more eligible ideas exist than the cap, state the cap and how many were skipped.

Renumber the existing checklist/closing steps (9→10, 10→11). Checklist gains a line: `✓ Ideas evaluated (<e> evaluated of <p> PASS, capped at <maxIdeasEvaluated>)`. Closing step's "not implemented" list shrinks to just Citation Graph and Vector/Embedding Retrieval. `maxTurns` increases from 150 to 200 (two more delegations per evaluated idea, up to `maxIdeasEvaluated` times).

`skills/research-methodology/SKILL.md` gains a new section:

> ## Experiment-design and review discipline
>
> A minimal validation experiment must specify a concrete `setup`, `metric`, and `expected_signal` — "run more experiments" is not a minimal validation experiment. Risks must be grounded in what similar retained papers actually encountered, not generic caveats. A reviewer's `overall_recommendation` must follow from its own listed objections' severities, never assigned independently of them; a `fatal` objection always yields `reject`.

Phase-boundaries paragraph updated to: "...idea mutation, the evidence and assumption ledgers, the research graveyard, minimal validation experiment design, full experimental roadmaps, and adversarial reviewer simulation. Citation graphs and vector/embedding retrieval are not implemented yet."

## 9. `/report` changes

Tool-gathering paragraph adds `get_experiments`, `get_reviews`.

Two new sections after "Mutated Directions" (renumbering "References" and "Not Yet Available" accordingly):

- **Minimal Validation Experiment** (per evaluated idea): setup, metric, expected signal, estimated effort — grouped under each idea's research question. Say plainly if no ideas were evaluated yet.
- **Full Experimental Roadmap** (per evaluated idea): the ordered roadmap list and risks. Say plainly if none exist.
- **Potential Reviewer Objections** (per evaluated idea): objections grouped by category with severity, and the overall recommendation. Say plainly if none exist.

Final **Not Yet Available** section shrinks to just: Citation Graph, Vector/Embedding Retrieval.

## 10. New commands

`commands/experiment.md` and `commands/review.md`, modeled directly on `commands/gaps.md`'s structure (resolve project the same way, `disable-model-invocation: true`, inline read-only). Each takes an optional `idea-id` argument-hint; with no id, shows all evaluated ideas' experiments/reviews for the resolved project. `/experiment` calls `get_experiments` (or `get_experiment` for a single id); `/review` calls `get_reviews`/`get_review`. Both say plainly "not evaluated in this run" for a valid idea id that has no saved experiment/review, distinguishing that from "no such idea" (checked via `get_ideas`).

## 11. Testing

Same TDD pattern as every prior phase — no new testing approach:
- `tests/engine/schemas.test.ts` — `Experiment`/`Review`/`New*` schema round-trips, enum coverage.
- `tests/engine/ids.test.ts` — new id generators.
- `tests/engine/budget.test.ts` — `maxIdeasEvaluated` default and override.
- `tests/engine/storage.test.ts` — save/get/getAll for experiments and reviews, overwrite-on-rerun semantics.
- `tests/mcp-server/tools.test.ts` — all six new tool functions.
- `tests/mcp-server/smoke.test.ts` — tool list grows to 31.
- `tests/plugin/agent-experiment-designer.test.ts`, `agent-reviewer.test.ts` — frontmatter + required tool-call/vocabulary mentions in body.
- `tests/plugin/agent-research-orchestrator.test.ts` — new step 9 mentions (`maxIdeasEvaluated`, `experiment-designer`, `reviewer`), `maxTurns` increased.
- `tests/plugin/skill-research-methodology.test.ts` — new section present, phase-boundaries text updated.
- `tests/plugin/command-report.test.ts` — three new sections present, Not Yet Available list shrunk further.
- `tests/plugin/command-experiment.test.ts`, `command-review.test.ts` — new command tests, modeled on `command-gaps.test.ts`.
- `tests/plugin/readme.test.ts` — no new hard assertions expected; README content updated regardless (tool count, commands table, architecture diagram, limitations).
