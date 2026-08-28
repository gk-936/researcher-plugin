# Research Agent Plugin — Phase 3A Design (Idea Quality & Provenance)

Status: approved by user ("yes go straight for the implementation plan and proceed with inline"). Grounded directly in the actual merged Phase 1/2 code (`agents/*.md`, `src/engine/schemas.ts`, `src/mcp-server/tools.ts` as they exist on `master` at commit `93a5f25`), not just the original 73-section brief.

## 1. Scope

Adds mutation engine, research graveyard, assumption ledger, and evidence ledger — the "idea quality and provenance" cluster of the parent brief's §58 Phase 3, chosen because all four extend Phase 2's existing idea/gap pipeline and storage directly with no new external provider integrations. Citation graph and vector/embedding retrieval (Phase 3B) are explicitly deferred — they need their own provider-selection design.

## 2. Rejection Rule

An audited idea is rejected to the graveyard when `novelty_verdict === "FAIL"` **or** `saturation === "SATURATED"`. Everything else (any `PASS`/`WEAK` combined with `UNEXPLORED` through `CROWDED`) stays an active candidate. Stated explicitly and simply so `research-orchestrator`'s instructions can apply it mechanically rather than needing judgment calls.

## 3. Schema Changes (`src/engine/schemas.ts`)

- `IdeaStatusSchema`: add `"rejected"` to the existing `["generated", "filtered_out", "audited"]` enum.
- `IdeaSchema` gains three fields: `mutation_depth: number` (0 for original ideas), `mutated_from: string | null` (parent idea id), `mutation_operator: string | null`.
- New `MutationOperatorSchema`: enum of the parent brief's §27 operators — `REMOVE_ASSUMPTION`, `ADD_CONSTRAINT`, `CHANGE_OBJECTIVE`, `CHANGE_EVALUATION`, `CHANGE_DATA`, `CHANGE_SCALE`, `CHANGE_RESOURCE_LIMIT`, `CHANGE_ENVIRONMENT`, `CHANGE_TASK`, `CHANGE_MODEL_CLASS`, `COMBINE_WITH_ADJACENT_FIELD`, `STRESS_TEST`, `REVERSE_DIRECTION`.
- New `GraveyardEntrySchema`: `{ id, idea_id, research_question, hypothesis, reason_rejected, novelty_verdict, saturation, closest_prior_work: string[], potential_revival_direction: string | null, mutated_into: string | null, rejected_at: string }`.
- New `AssumptionStatusSchema`: enum `["assumed", "partially_challenged", "refuted", "supported"]`.
- New `AssumptionLedgerEntrySchema`: `{ id, assumption: string, papers_supporting: string[], papers_challenging: string[], status: AssumptionStatus, remaining_question: string }`.
- New `EvidenceTypeSchema`: enum `["experimental", "theoretical", "observational", "survey", "benchmark", "author_claim", "inference"]`.
- New `EvidenceLedgerEntrySchema`: `{ id, claim: string, evidence_paper_ids: string[], evidence_type: EvidenceType, confidence: "low" | "medium" | "high", status: "verified" | "unverified" | "disputed", source: string }` — `confidence` matches the existing `GapConfidenceSchema` scale for consistency, not a 0-1 float.
- `BudgetSchema` gains `maxMutationDepth: number` and `maxMutationsPerProject: number`. `DEFAULT_BUDGET` sets `maxMutationDepth: 2`, `maxMutationsPerProject: 3` — deliberately more conservative than the parent brief's "default to 3 generations," because each mutation cycle costs the orchestrator ~6-8 turns (graveyard write + mutator delegation + 2 audit delegations + verification calls), and `research-orchestrator`'s `maxTurns` is already substantial before mutation exists. `maxTurns` on `research-orchestrator` itself needs to increase from `80` — plan should size this against the actual mutation-loop turn cost, not guess blind (propose `150` as a starting point, confirm during planning).

## 4. Evidence Ledger — MVP Sourcing Decision

Rather than adding agent turns for a dedicated evidence-ledger-writing step, `save_gaps` (in `src/mcp-server/tools.ts`) **automatically derives one evidence-ledger entry per saved gap** server-side: `claim = gap.description`, `evidence_paper_ids = gap.evidence_paper_ids`, `evidence_type: "observational"`, `confidence = gap.confidence`, `status: "verified"`, `source: "gap"`. This is a deliberate scope cut — novelty-audit findings are NOT auto-promoted to evidence-ledger entries in Phase 3A, since `novelty_evidence` is free text without a structured paper-id list today; extracting that cleanly is left for a later pass. Document this limitation in the README.

## 5. Assumption Ledger — Population Point

Extend `gap-hunter` (not a new agent) with an additional step: after identifying gaps, review the spec's `assumptions` list (already extracted by `problem-analyzer` in Phase 1) against the retained literature for explicit support/challenge signals, and call a new batch `save_assumptions` tool. `gap-hunter` already has spec + literature loaded in context for gap-finding, so this reuses that read rather than adding a new agent and a new context load.

## 6. New Agent: `idea-mutator`

Receives `project_id` + one rejected `idea_id`. Reads the graveyard entry (`reason_rejected`, `novelty_verdict`/`novelty_evidence`, `saturation`/`saturation_evidence`) to understand *why* it failed, and chooses the **one** mutation operator that most directly addresses that specific reason (e.g. FAIL against an identical mechanism on the same task → `CHANGE_TASK` or `CHANGE_DATA`; `SATURATED` → `CROSS_DOMAIN_TRANSFER` or `COMBINE_WITH_ADJACENT_FIELD`; a narrow fixable overlap → `REMOVE_ASSUMPTION` or `ADD_CONSTRAINT`) — never applies an operator mechanically without justifying the choice against the specific failure reason. Produces exactly one new idea via `create_idea_mutation`. Reports back the operator chosen and why.

## 7. New MCP Tools (extending `src/mcp-server/tools.ts` + `index.ts`, same pattern as Phase 1/2)

- `reject_idea_to_graveyard` — input `{project_id, idea_id, reason_rejected, potential_revival_direction?}`. Reads the idea (must already be audited — `novelty_verdict`/`saturation` non-null), creates the `GraveyardEntry`, sets `idea.status = "rejected"`. Atomic (single tool call), mirrors how `retain_papers` already does a transform-and-persist operation.
- `create_idea_mutation` — input `{project_id, parent_idea_id, operator, ...NewIdea fields}`. Validates `parent.mutation_depth < maxMutationDepth` and the project's total mutation count `< maxMutationsPerProject`; if either would be exceeded, returns `{saved: false, reason: "..."}` rather than an error (matching `save_idea`'s existing budget-exhaustion pattern) — the orchestrator must treat that as expected, not a failure to fix. On success, creates a new `Idea` with `mutation_depth: parent.mutation_depth + 1`, `mutated_from: parent_idea_id`, `mutation_operator: operator`, `status: "generated"`, and sets the parent's graveyard entry `mutated_into` to the new idea's id.
- `save_assumptions` (batch, mirrors `save_gaps`) / `get_assumptions`.
- `get_evidence` (read-only; entries are written automatically by `save_gaps` per §4, no separate write tool).
- `get_graveyard`.

## 8. `research-orchestrator` Changes

After the existing per-idea novelty+saturation audit loop (current step 7), add a mutation loop: for each idea meeting the §2 rejection rule, call `reject_idea_to_graveyard`, then — if under both mutation budgets — delegate to `idea-mutator`, and if it produced a new idea, run that new idea through the *same* novelty-auditor → saturation-detector → rejection-check cycle (bounded recursion, capped by `maxMutationDepth`/`maxMutationsPerProject` enforced server-side by `create_idea_mutation`, not just trusted client-side). Progress checklist gains a line for mutations attempted/survived. Closing disclosure list shrinks: drop "Mutated Directions", "Evidence/Assumption Ledgers", "Research Graveyard" — keep "citation graphs, vector/embedding retrieval, experiment design, reviewer simulation."

## 9. `commands/report.md` Changes

No new commands (the parent brief's own §7 required-command list doesn't name graveyard/ledger-specific commands). Promote three items out of "Not Yet Available" into real sections, matching the parent brief's §50 report structure:
- **Candidate Research Ideas** section already exists (Phase 2) — restrict it to active (non-`"rejected"`) ideas only.
- New **Saturated / Rejected Directions** section — every `GraveyardEntry`, with `reason_rejected`, verdicts, and `mutated_into` (linking to the mutation if one exists).
- New **Mutated Directions** section — every idea with `mutation_depth > 0`, showing its `mutation_operator`, parent idea, and (once audited) its own verdict — i.e. did the mutation survive where the original didn't.
- New **Assumptions** subsection addition (existing "Assumptions" section currently just lists the spec's free-text assumptions) — append the structured assumption-ledger entries (support/challenge papers, status) where they exist.
- Remaining "Not Yet Available": Citation Graph, Vector/Embedding Retrieval, Minimal Validation Experiment, Full Experimental Roadmap, Potential Reviewer Objections.

## 10. Storage Layer (`src/engine/storage.ts`)

Extend `ProjectStore` with methods following the exact existing pattern (`getAllGaps`/`saveGaps`/`getGaps` as the template): `getAllGraveyardEntries`/`rejectIdeaToGraveyard`, `getAllAssumptions`/`saveAssumptions`/`getAssumptions`, `getAllEvidence`/`getEvidence`, `createIdeaMutation`. `ProjectState.phases_completed` gains `"idea_mutation"` when at least one mutation cycle ran (not required if none did — mutation is conditional, not a mandatory pipeline stage).

## 11. Explicitly Out of Scope (Phase 3B, later)

Citation graph, vector/embedding retrieval — need their own provider-selection design (which citation API, which embedding provider) before a spec can be written.
