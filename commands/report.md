---
description: Generate the research report for the current or specified project from whatever pipeline stages have completed.
argument-hint: [project-id]
disable-model-invocation: true
---
Resolve the research project the same way /literature does, using this optional project id argument: $ARGUMENTS. If no project exists, say so and stop.

Gather the project's state, spec, and retained papers via the get_project_state and get_papers tools, and the literature summary if saved.

Produce a report with these sections, in order:

1. **Executive Summary** — 2-4 sentences on the problem and what's been found so far.
2. **Problem Interpretation** — the research question, domain, and objectives from the spec.
3. **Assumptions** — the assumptions list from the spec.
4. **Research Landscape** — the literature summary plus the retained papers list (title, authors, year, venue, url).
5. **References** — every retained paper as a numbered citation with id, title, year, venue, and url; mark any paper missing a url or doi as unverified rather than omitting it silently.

After References, add a final section titled **Not Yet Available** listing, verbatim: Major Research Gaps, Candidate Research Ideas, Saturated/Rejected Directions, Mutated Directions, Ranked Research Opportunities, Minimal Validation Experiment, Full Experimental Roadmap, Potential Reviewer Objections — each with the note "requires a later implementation phase, not present in this build." Never fabricate content for these sections.