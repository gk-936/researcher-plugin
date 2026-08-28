# Research Agent Plugin — Phase 2 Design

Status: approved in chat discussion, not yet spec-self-reviewed or user-confirmed as a written doc. Work was handed off to a new session before the plan/implementation stage — read this doc plus `docs/superpowers/specs/2026-08-27-research-agent-phase1-design.md` (Phase 1, already merged to `master`) for full context before proceeding.

## 1. Goal

Extend the Phase 1 plugin (problem analysis + literature discovery, already merged) with gap hunting, idea generation, adversarial novelty auditing, and saturation detection — matching the parent 73-section brief's own §57 Phase 2 boundary. `/research <problem>` becomes an end-to-end pipeline producing ranked, novelty-audited candidate research ideas grounded in the retained literature.

**Explicitly out of scope** (parent brief's own §58 Phase 3 boundary — do not let these creep in):
- Idea mutation engine
- Evidence ledger / assumption ledger
- Research graveyard
- Citation graph
- Vector/embedding retrieval

Saturation detection in this phase works from paper counts, publication recency, and title/abstract conceptual overlap only — **no citation-activity signal**, since no citation graph exists yet.

## 2. Pipeline Trigger Decision

Confirmed with the user: gap-hunting and idea-generation run **automatically inside `/research`**, not as separate opt-in steps. `research-orchestrator` (Phase 1 agent, already built and merged) is extended with two more mandatory delegation steps after literature discovery.

## 3. Depth Discipline

All four new agents (`gap-hunter`, `idea-generator`, `novelty-auditor`, `saturation-detector`) are **direct children of `research-orchestrator`** — never nested under each other. Concretely: `research-orchestrator` calls `gap-hunter`, then `idea-generator`, then for each shortlisted idea calls `novelty-auditor` and `saturation-detector` itself (not idea-generator calling them). This keeps every delegation at depth 2 from the `/research` fork, well clear of Claude Code's default depth-3 subagent-spawn ceiling, and matches the parent brief's own principle that "no single agent is the sole authority on novelty" — the orchestrator stays the verifying hub, not idea-generator.

## 4. Funnel and Budgets

Deliberately smaller than the parent brief's full-system numbers (§42), matching Phase 1's already-established MVP-scaling precedent:

```
Retained literature (from Phase 1)
  → gap-hunter: up to ~8 gaps, each citing specific retained papers as evidence
  → idea-generator: up to ~10 raw ideas across genuinely different §20 strategies
  → cheap orchestrator-side filter (no subagent): dedupe near-identical ideas,
    drop any missing required fields, cap to ~4 for deep audit
  → per shortlisted idea: novelty-auditor pass + saturation-detector pass
  → final ranked output
```

Exact numeric defaults (maxGaps, maxRawIdeas, maxIdeasAudited) need to be finalized during planning — treat the numbers above as starting points, not final budget-schema values. They should extend `src/engine/budget.ts`'s `Budget` interface and `DEFAULT_BUDGET`, following the same pattern as Phase 1's search budgets.

## 5. Schemas

Two new per-project JSON files, following the exact pattern `ProjectStore` already established for `papers.json` in Phase 1 (`src/engine/storage.ts`).

**Gap** (`gaps.json`):
```ts
{
  id: string,                    // "gap-001"
  title: string,
  category: string,              // e.g. "efficiency gap", "evaluation gap" — derived from evidence, not a fixed enum
  description: string,
  evidence_paper_ids: string[],  // ids into papers.json — every gap must cite retained papers, never inferred from absence alone
  what_has_been_attempted: string,
  what_remains_unresolved: string,
  why_it_matters: string,
  why_it_is_difficult: string,
  potential_opportunity: string,
  confidence: "low" | "medium" | "high",
}
```

**Idea** (`ideas.json`) — a single record enriched progressively across the pipeline, mirroring how Phase 1's `Paper` record gets enriched from `discovered` → `retained`:
```ts
{
  id: string,                    // "idea-001"
  gap_id: string | null,         // which gap (if any) motivated it
  strategy: string,              // which §20 generation strategy produced it (REMOVE_ASSUMPTION, CHANGE_EVALUATION, ...)
  research_question: string,
  hypothesis: string,
  motivation: string,
  mechanism: string,
  expected_contribution: string,
  closest_prior_work: string[],  // paper ids
  why_not_solved: string,
  why_now: string,
  status: "generated" | "filtered_out" | "audited",

  // filled in by novelty-auditor (null until that pass runs):
  novelty_verdict: "PASS" | "WEAK" | "FAIL" | null,
  novelty_evidence: string,      // closest prior work, conceptual/methodological overlap, what's genuinely different
  novelty_confidence: "low" | "medium" | "high" | null,

  // filled in by saturation-detector (null until that pass runs):
  saturation: "UNEXPLORED" | "UNDEREXPLORED" | "EMERGING" | "ACTIVE" | "CROWDED" | "SATURATED" | null,
  saturation_evidence: string,
}
```

## 6. Agents (all new, all direct children of research-orchestrator)

- **`gap-hunter`** — reads retained literature + saved spec. Looks for gap categories from the parent brief's §18 (performance, generalization, robustness, efficiency, evaluation, theoretical, assumption gaps, etc.). Every gap must cite specific retained papers as evidence in `evidence_paper_ids` — never "nobody studied X" purely from a search returning nothing (this is the same evidence-discipline principle `research-methodology` skill already establishes for Phase 1; extend that skill's content rather than duplicating it in a new skill). Caps output at the gap budget.
- **`idea-generator`** — takes gaps + spec, generates ideas using genuinely different strategies from the parent brief's §20 list, tags each idea with the strategy that produced it (`strategy` field), caps at the raw-idea budget. Must not decide novelty itself — that's explicitly `novelty-auditor`'s job (parent brief anti-pattern §55 #4).
- **`novelty-auditor`** — adversarial, not supportive. For one idea at a time: actively searches for prior art via the existing `search_papers` MCP tool (this **shares the same project-wide discovery-search budget** as Phase 1's literature discovery — flag this explicitly to the user/plan as a real resource-contention point to resolve during planning: either give novelty audits their own budget pool, or accept they compete with literature discovery for the same `maxDiscoverySearchesPerProject` counter). Distinguishes terminological vs. conceptual vs. methodological vs. experimental novelty (parent brief §22). Outputs `PASS`/`WEAK`/`FAIL` plus evidence. Rewarded for finding prior art, not for agreeing with idea-generator.
- **`saturation-detector`** — classifies crowdedness (`UNEXPLORED` through `SATURATED`, parent brief §24) using paper counts, publication recency, and conceptual overlap from titles/abstracts already available in `papers.json` and whatever `novelty-auditor` already searched for that idea (reuse its search results where possible rather than re-searching — another real design point to nail down during planning: how does saturation-detector access novelty-auditor's search results, given they're separate agent invocations with separate contexts?). Explicitly does **not** use citation activity — no citation graph exists yet, and the agent's own instructions should say so rather than silently omitting that signal.

## 7. research-orchestrator Changes (modifying the Phase 1 agent, not creating fresh)

This is a **modification** to an already-merged, already-tested file (`agents/research-orchestrator.md`, plus its test `tests/plugin/agent-research-orchestrator.test.ts`). Handle it the way Phase 1's plan handled modifying shared files — plan the diff precisely, don't just append.

- Add two mandatory steps after literature discovery: delegate to `gap-hunter`, verify it produced gaps (or plainly report zero found), delegate to `idea-generator`, verify it produced ideas.
- Add the cheap orchestrator-side filter step (dedupe/validate/cap — no subagent).
- Add a loop: for each shortlisted idea, delegate to `novelty-auditor` then `saturation-detector`, verify each returned a real verdict (not null) before treating that idea as "audited."
- `maxTurns` needs a real increase from Phase 1's `40` — proposed `80`, but confirm against actual behavior during planning/testing rather than picking a number blind.
- Progress checklist and closing summary extend to cover gaps found, ideas generated, and audit verdicts (PASS/WEAK/FAIL counts, saturation distribution). The "not implemented in this build" disclosure shrinks to just: mutation, ledgers, research graveyard, citation graph, vector retrieval, experiment design, reviewer simulation.
- Never let `idea-generator` or `gap-hunter` claim novelty/saturation verdicts themselves — those fields must stay `null` until the dedicated audit passes actually run, exactly matching the parent brief's anti-pattern #4 and #7.

## 8. New MCP Tools (extending `src/mcp-server/tools.ts` and `src/mcp-server/index.ts`, same pattern as Phase 1's 10 tools)

- `save_gaps` / `get_gaps`
- `save_idea` (creates a new idea record with the generator-owned fields) / `get_ideas` (list/filter)
- `update_idea_novelty` (writes only `novelty_verdict`/`novelty_evidence`/`novelty_confidence`)
- `update_idea_saturation` (writes only `saturation`/`saturation_evidence`)

Narrow, single-purpose write tools — mirrors Phase 1's `retain_papers` pattern (each agent only touches the fields it owns) rather than one do-everything `update_idea` tool.

## 9. New/Changed Commands

- **`/gaps`** — new, inline (not forked), read-only. Same pattern as `/literature`: resolve project, call `get_gaps`, present with evidence paper references. Say plainly if none exist yet.
- **`/ideas`** — new, inline, read-only. Call `get_ideas`, present each with its strategy, novelty verdict, saturation classification. Say plainly if none exist yet or if audits haven't run.
- **`/report`** — modify (not create fresh): promote "Major Research Gaps" and "Candidate Research Ideas" out of the "Not Yet Available" section into real populated sections. The remaining "Not Yet Available" items shrink to match §7's disclosure list above.

## 10. Storage Layer Changes

Extend `ProjectStore` (`src/engine/storage.ts`) with methods for gaps and ideas following the exact same shape as the existing paper methods (`getAllPapers`/`upsertPapers`/`getPapers` → analogous `getAllGaps`/`saveGaps`/`getGaps`, `getAllIdeas`/`saveIdea`/`getIdeas`/`updateIdeaNovelty`/`updateIdeaSaturation`). `ProjectState.phases_completed` gains `"gap_hunting"` and `"idea_generation"` entries.

## 11. Open Questions for the Planning Session

Flagging rather than resolving, since these surfaced during design discussion and need concrete decisions before/during plan-writing:

1. Does `novelty-auditor` share the literature-discovery search budget or get its own? (§6 above)
2. How does `saturation-detector` access `novelty-auditor`'s search results across separate agent invocations — new MCP tool to persist per-idea search evidence, or does saturation-detector just re-search cheaply itself?
3. Exact numeric budget defaults (maxGaps, maxRawIdeas, maxIdeasAudited) — proposed as ~8/~10/~4 in §4, not finalized.
4. Exact `maxTurns` for the extended `research-orchestrator` — proposed 80, needs validation.
5. Whether `research-methodology` skill's content should be extended in place (recommended, avoids duplicating evidence-discipline guidance) or a new skill created for gap/idea-specific guidance.
