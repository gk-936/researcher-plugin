# Research Agent (Phase 2)

An autonomous research ideation Claude Code plugin. Give it a research problem statement; it analyzes the problem, discovers relevant literature from arXiv and Semantic Scholar, hunts for research gaps grounded in that literature, generates candidate research ideas, and adversarially audits each shortlisted idea for novelty and saturation. This is **Phase 2** of a larger design — see [Limitations](#limitations) for what's not built yet.

## Installation

For local development, load the plugin directly without installing it:

```bash
npm install
npm run build
claude --plugin-dir /path/to/researcher-plugin
```

Then, inside that Claude Code session, run `/research <a problem statement>`.

After editing plugin files (agents, commands, skills), run `/reload-plugins` inside the session to pick up the changes without restarting; after editing TypeScript under `src/`, re-run `npm run build` first.

To validate the plugin structure independently: `claude plugin validate .`

**Testing gotcha:** if you invoke `claude --plugin-dir` from the *same* directory as the plugin itself (i.e. your shell's cwd equals the plugin root), Claude Code treats the plugin's `.mcp.json` as a project-level config rather than a plugin-bundled one, so `${CLAUDE_PLUGIN_ROOT}`/`${CLAUDE_PLUGIN_DATA}` never get substituted and the research-server MCP connection fails (`CONNECTION_CLOSED`). Run `claude --plugin-dir /path/to/researcher-plugin` from a *different* working directory (any other project folder) to avoid this. In non-interactive (`-p`) sessions, invoke the command by its full namespaced form (`/researcher:research ...`) — the bare `/research` isn't reliably recognized outside an interactive session.

## Configuration

The MCP server reads `research-data/config.json` (relative to the data directory) for budget overrides. Any subset of these fields may be set; omitted fields keep their default:

```json
{
  "maxDiscoverySearchesPerProject": 12,
  "maxCandidatesPerProject": 60,
  "maxRetainedPapers": 20,
  "cacheTtlDays": 7,
  "requestTimeoutMs": 15000,
  "arxivMinDelayMs": 3000,
  "maxGaps": 8,
  "maxRawIdeas": 10,
  "maxIdeasAudited": 4
}
```

Research project data and the on-disk cache live under `${CLAUDE_PLUGIN_DATA}/research-data` once installed as a plugin (so they survive plugin updates), or under `./research-data` when running the MCP server directly for local development.

## Commands

| Command | Status | What it does |
|---|---|---|
| `/research <problem>` | Implemented | Runs the full pipeline: creates a project, analyzes the problem, discovers literature, hunts gaps, generates ideas, and audits each shortlisted idea for novelty and saturation. |
| `/literature [project-id]` | Implemented | Shows the retained papers and literature summary for a project. |
| `/gaps [project-id]` | Implemented | Shows the research gaps found so far, with their evidence. |
| `/ideas [project-id]` | Implemented | Shows candidate research ideas with their novelty and saturation verdicts. |
| `/report [project-id]` | Implemented | Renders a full report including gaps and ranked ideas; explicitly marks the remaining unimplemented sections rather than fabricating them. |
| `/audit`, `/experiment`, `/review` | **Not implemented in this build** | Arrive in Phases 3-4 alongside the agents that back them (mutation engine, experiment-designer, reviewer). |

## Architecture

```
Claude Code plugin
  commands/research.md  ──fork──▶  agents/research-orchestrator.md
  commands/literature.md, commands/gaps.md, commands/ideas.md, commands/report.md  (inline, read project state)
                                        │
                        Task-delegates to:
                        agents/problem-analyzer.md
                        agents/literature-scout.md
                        agents/gap-hunter.md
                        agents/idea-generator.md
                        agents/novelty-auditor.md      (per shortlisted idea)
                        agents/saturation-detector.md  (per shortlisted idea, after novelty-auditor)
                                        │
                        all call MCP tools ──▶
                                        │
research-server (src/mcp-server) — 19 tools, thin wrappers over:
                                        │
engine (src/engine) — runtime-independent: schemas, storage (JSON files),
  budget, cache, dedupe, retrieval (arXiv + Semantic Scholar providers),
  search orchestration
                                        │
research-data/ — project.json, spec.json, papers.json, gaps.json, ideas.json,
  idea_search_evidence.json, literature_summary.json, log.jsonl per project;
  on-disk query cache
```

`src/engine` has no dependency on `@modelcontextprotocol/sdk` or anything Claude Code-specific, so it can be reused by a different runtime later without rewriting the research logic.

## Example Run

```
/research How can model-based reinforcement learning become substantially
more sample efficient in sparse-reward environments?
```

The orchestrator creates a project, delegates problem analysis (domain, keywords, synonyms, objectives, assumptions), literature discovery (query expansion, arXiv + Semantic Scholar search, relevance filtering, retention), gap hunting (evidence-grounded gaps from the retained literature), idea generation (candidate ideas across distinct strategies), and then, for a shortlisted subset, a novelty audit and a saturation classification per idea — printing a short progress checklist throughout. Follow up with `/gaps`, `/ideas`, `/literature`, or `/report`.

## Limitations

- Only arXiv and Semantic Scholar are searched, both keyless — no OpenAlex, Crossref, ACM/IEEE, or full-text/PDF retrieval.
- No citation graph, embeddings/vector retrieval, idea mutation, assumption/evidence ledgers, research graveyard, experiment design, or reviewer simulation. These are explicitly out of scope for Phase 2 (see the design spec) and are never simulated by the agents in this build.
- Storage is flat JSON files, not a database — fine at the scale of dozens of papers per project, not built for large corpora.
- `source_quality` is a coarse heuristic (venue known vs. not), not a real bibliometric signal.
- Search queries within one `search_papers` call run sequentially (parallel across the two providers per query, but not across queries), and neither the on-disk cache nor the JSONL log validates its own file contents against corruption — acceptable at Phase 1's scale, worth hardening before higher-volume use.
- `search_papers`'s response reports query-level truncation (`queries_truncated`) but not candidate-level truncation when a project's `maxCandidatesPerProject` cap drops newly-discovered (not-yet-retained) papers — the cap never evicts already-retained papers, but a dropped new candidate currently has no signal in the response.
- Observed live: under a real, near-budget run (12 searches), `literature-scout` completed search and retention but skipped writing per-paper relevance notes and the literature summary — likely a turn-budget effect (`maxTurns: 20`) on complex queries, not a code defect. If you see this, a smaller/sharper query set or a higher `maxTurns` may help.
- `novelty-auditor`'s prior-art searches share the same `maxDiscoverySearchesPerProject` budget as literature discovery, not a separate pool — a literature-heavy run can leave little search budget for novelty audits; `get_project_state`'s `searches_remaining` surfaces this.
- Saturation classification uses paper counts, publication recency, and title/abstract overlap only — there is no citation graph in this build, so citation-activity signal (a stronger crowdedness indicator) is never used, and agents are instructed to say so rather than omit it silently.
- "Ranked output" is a presentation-level ordering in `/report` (PASS before WEAK before FAIL, then by saturation), not a scored/weighted ranking algorithm.

## Development

```bash
npm install
npm test          # runs the full vitest suite
npm run build      # type-checks and compiles src/ to dist/
npm run dev:mcp    # runs the MCP server directly over stdio, for manual testing
```

## Spec and Plan

- Phase 1 design: `docs/superpowers/specs/2026-08-27-research-agent-phase1-design.md`
- Phase 1 implementation plan: `docs/superpowers/plans/2026-08-27-research-agent-phase1.md`
- Phase 2 design: `docs/superpowers/specs/2026-08-28-research-agent-phase2-design.md`
- Phase 2 implementation plan: `docs/superpowers/plans/2026-08-28-research-agent-phase2.md`
