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

## Mutation and rejection discipline

An idea is rejected to the research graveyard when `novelty_verdict === "FAIL"` or `saturation === "SATURATED"` — nothing else triggers rejection, and both together aren't required. A rejected idea gets at most one mutation attempt per generation, bounded by `maxMutationDepth` and `maxMutationsPerProject`; `idea-mutator` must justify its chosen operator against the specific reason the idea was rejected, never apply an operator mechanically. A mutation is re-audited by `novelty-auditor` and `saturation-detector` exactly like an original idea — a mutation is never assumed to have fixed the problem just because it exists.

## Experiment-design and review discipline

A minimal validation experiment must specify a concrete `setup`, `metric`, and `expected_signal` — "run more experiments" is not a minimal validation experiment. Risks must be grounded in what similar retained papers actually encountered, not generic caveats like "results may not generalize." A reviewer's `overall_recommendation` must follow from its own listed objections' severities, never assigned independently of them; a `fatal` objection always yields `reject`.

## Budget discipline

Every search, retrieval, and analysis step draws from a fixed budget (see the project's `budget` record). Respect truncation and capping signals from tools (e.g. `queries_truncated`, `capped`, `{ saved: false, reason: ... }`) instead of working around them — a capped budget is a deliberate constraint, not a bug to route around. `novelty-auditor`'s prior-art searches share the same discovery-search budget as literature discovery rather than a separate pool — check `get_project_state`'s `searches_remaining` before spending it.

## Current phase boundaries

This build implements problem analysis, literature discovery, gap hunting, idea generation, adversarial novelty auditing, saturation detection, idea mutation, the evidence and assumption ledgers, the research graveyard, minimal validation experiment design, full experimental roadmaps, and adversarial reviewer simulation. Citation graphs and vector/embedding retrieval are not implemented yet. Never simulate or fabricate output for a stage that hasn't run — say plainly that it is not available in this build and point to the phase that will add it.
