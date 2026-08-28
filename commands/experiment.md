---
description: Show the experiment design (minimal validation experiment and full roadmap) for evaluated ideas in the current or specified research project.
argument-hint: "[project-id] [idea-id]"
disable-model-invocation: true
---
Resolve the research project the same way /literature does: if the first argument below looks like a project id, treat it as `project_id` and call `get_project_state` with it; otherwise call `get_project_state` with no `project_id` to get the most recent project. If no project exists, say so and stop.

If an idea id was also given, call `get_experiment` for that project and idea id. If it returns `{error: "No experiment saved for this idea."}`, check `get_ideas` for that id: if the idea exists but has no experiment, say plainly that it was not evaluated in this run (it may have been outside the `maxIdeasEvaluated` cap, or not a PASS-verdict idea); if no such idea exists, say so instead.

If no idea id was given, call `get_experiments` for the project. If it returns none, say so plainly — no ideas have been evaluated yet. Otherwise present each evaluated idea's minimal validation experiment (setup, metric, expected signal, estimated effort), full roadmap, and risks, grouped under its research question (cross-reference via `get_ideas`).

Project id and idea id arguments (optional): $ARGUMENTS
