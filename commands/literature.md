---
description: Show the accumulated literature landscape for the current or specified research project.
argument-hint: [project-id]
disable-model-invocation: true
---
Resolve the research project: if an argument was given below, treat it as a `project_id` and call `get_project_state` with it; otherwise call `get_project_state` with no `project_id` to get the most recent project. If no project exists, say so and stop.

Then call `get_papers` for that project with `status: "retained"`, and call `get_literature_summary` to read the saved synthesis (it returns `{error: "No literature summary saved."}` if none exists yet — treat that as "not saved," not as a failure).

Present the result as:

1. The problem statement and domain (call `get_problem_spec`; if it returns `{error: "No problem spec saved."}`, just use the problem statement from `get_project_state` and say the structured spec isn't available yet).
2. The literature summary paragraph, if saved.
3. Each retained paper as a bulleted line: title, authors, year, venue, url, and its relevance note.

If no papers have been retained yet, say so plainly instead of presenting an empty section as if it were complete.

Project id argument (optional): $ARGUMENTS
