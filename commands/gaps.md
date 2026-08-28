---
description: Show the research gaps found so far for the current or specified research project.
argument-hint: [project-id]
disable-model-invocation: true
---
Resolve the research project the same way /literature does: if an argument was given below, treat it as a `project_id` and call `get_project_state` with it; otherwise call `get_project_state` with no `project_id` to get the most recent project. If no project exists, say so and stop.

Call `get_gaps` for that project. If it returns no gaps, say so plainly — gap hunting may not have run yet, or it may have found nothing it could cite from the retained literature.

For each gap, present: title, category, confidence, the evidence paper ids it cites (cross-reference titles via `get_papers` if useful), what has been attempted, what remains unresolved, why it matters, why it's difficult, and the potential opportunity.

Project id argument (optional): $ARGUMENTS
