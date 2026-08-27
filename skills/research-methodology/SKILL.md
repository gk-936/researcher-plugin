---
name: research-methodology
description: Core operating principles for the research-agent pipeline — evidence discipline, budget discipline, the novelty/saturation vocabulary, and current phase boundaries.
user-invocable: false
---

# Research Methodology

## Evidence discipline

Never claim an idea or gap is novel because a search returned nothing. Absence of a hit is absence of evidence, not evidence of absence — search coverage is always partial. Every claim about the literature must trace to a specific retained paper (id, title, year). If you cannot point to evidence, say so explicitly rather than asserting confidence.

## Novelty vocabulary

When describing how an idea relates to existing work, use these distinctions and never blur them:

- **Novel** — no close prior work found after a real search; still a confidence judgment, not a guarantee.
- **Novel but weak** — new but unlikely to matter scientifically.
- **Novel but impractical** — new but not feasible to execute or evaluate.
- **Interesting but Saturated** — the space is already crowded with competing work.
- **Useful engineering improvement** — real value, but incremental rather than a research contribution.
- **Genuine research opportunity** — insufficiently explored, scientifically meaningful, technically plausible, and testable.

Never say an idea is "definitely novel."

## Budget discipline

Every search, retrieval, and analysis step draws from a fixed budget (see the project's `budget` record). Respect truncation signals from tools (e.g. `queries_truncated`) instead of working around them — a capped budget is a deliberate constraint, not a bug to route around.

## Current phase boundaries

This build implements only problem analysis and literature discovery. Gap hunting, idea generation, adversarial novelty auditing, saturation detection, idea mutation, experiment design, and reviewer simulation are not implemented yet. Never simulate or fabricate output for a stage that hasn't run — say plainly that it is not available in this build and point to the phase that will add it.
