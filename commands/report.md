---
description: Generate the research report for the current or specified project from whatever pipeline stages have completed.
argument-hint: [project-id]
disable-model-invocation: true
---
Resolve the research project the same way /literature does, using this optional project id argument: $ARGUMENTS. If no project exists, say so and stop.

Gather the project's state and retained papers via `get_project_state` and `get_papers`, the structured spec via `get_problem_spec`, the literature summary via `get_literature_summary`, the gaps via `get_gaps`, the ideas via `get_ideas`, the graveyard via `get_graveyard`, and the assumption ledger via `get_assumptions`. `get_problem_spec` and `get_literature_summary` return `{error: "..."}` if nothing has been saved yet — treat that as "not available in this project yet," not as a failure, and say so plainly in the relevant section rather than fabricating content.

Produce a report with these sections, in order:

1. **Executive Summary** — 2-4 sentences on the problem and what's been found so far.
2. **Problem Interpretation** — the research question, domain, and objectives from the spec (say plainly if no spec has been saved yet).
3. **Assumptions** — the assumptions list from the spec (say plainly if no spec has been saved yet), followed by the structured assumption-ledger entries from `get_assumptions` where they exist (supporting/challenging papers, status, remaining question) — say plainly if the ledger is empty rather than omitting the subsection.
4. **Research Landscape** — the literature summary plus the retained papers list (title, authors, year, venue, url).
5. **Major Research Gaps** — every gap from `get_gaps`, with its category, confidence, evidence paper ids, and the attempted/unresolved/matters/difficult/opportunity fields. Say plainly if none exist yet.
6. **Candidate Research Ideas** — every idea from `get_ideas` whose `status` is NOT `"rejected"` (rejected ideas appear in the Saturated/Rejected Directions section instead), with its strategy, motivating gap, and (once audited) novelty verdict + evidence + confidence and saturation + evidence. Order the list: `PASS` verdicts first, then `WEAK`, then any idea whose audit hasn't completed yet; within `PASS`, order by saturation from `UNEXPLORED` toward `CROWDED` so the most promising, least-crowded ideas surface first. For any idea whose `novelty_verdict` or `saturation` is still null, say plainly that its audit hasn't completed rather than omitting it or inventing a verdict. Say plainly if no active ideas exist yet.
7. **Saturated / Rejected Directions** — every entry from `get_graveyard`, with `reason_rejected`, `novelty_verdict`, `saturation`, `closest_prior_work`, and `mutated_into` (naming which idea it was mutated into, if any — "not mutated" if `mutated_into` is null). Say plainly if the graveyard is empty.
8. **Mutated Directions** — every idea from `get_ideas` with `mutation_depth > 0`, showing its `mutation_operator`, its `mutated_from` parent, and (once audited) its own novelty/saturation verdicts — state plainly whether the mutation survived (didn't meet the rejection rule) or was itself rejected. Say plainly if no mutations exist yet.
9. **References** — every retained paper as a numbered citation with id, title, year, venue, and url; mark any paper missing a url or doi as unverified rather than omitting it silently.

After References, add a final section titled **Not Yet Available** listing, verbatim: Citation Graph, Vector/Embedding Retrieval, Minimal Validation Experiment, Full Experimental Roadmap, Potential Reviewer Objections — each with the note "requires a later implementation phase, not present in this build." Never fabricate content for these sections.
