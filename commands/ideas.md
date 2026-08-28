---
description: Show the candidate research ideas generated so far, with their novelty and saturation verdicts, for the current or specified research project.
argument-hint: [project-id]
disable-model-invocation: true
---
Resolve the research project the same way /literature does: if an argument was given below, treat it as a `project_id` and call `get_project_state` with it; otherwise call `get_project_state` with no `project_id` to get the most recent project. If no project exists, say so and stop.

Call `get_ideas` for that project. If it returns no ideas, say so plainly — idea generation may not have run yet.

For each idea, present: research question, hypothesis, strategy, and motivating gap (if any). If `novelty_verdict` and `saturation` are both non-null, also present the verdict with its evidence and confidence, and the saturation classification with its evidence. If either is still `null`, say plainly that the audit for that idea hasn't completed rather than omitting the idea or inventing a verdict. Present `filtered_out` ideas in a separate group from ones still in the running, rather than mixing them in silently.

Project id argument (optional): $ARGUMENTS
