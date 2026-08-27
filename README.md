# Research Agent (Phase 1)

An autonomous research ideation Claude Code plugin. Give it a research problem statement; it analyzes the problem and discovers relevant literature from arXiv and Semantic Scholar. This is **Phase 1** of a larger design — see [Limitations](#limitations) for what's not built yet.

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

## Configuration

The MCP server reads `research-data/config.json` (relative to the data directory) for budget overrides. Any subset of these fields may be set; omitted fields keep their default:

```json
{
  "maxDiscoverySearchesPerProject": 12,
  "maxCandidatesPerProject": 60,
  "maxRetainedPapers": 20,
  "cacheTtlDays": 7,
  "requestTimeoutMs": 15000,
  "arxivMinDelayMs": 3000
}
```

Research project data and the on-disk cache live under `${CLAUDE_PLUGIN_DATA}/research-data` once installed as a plugin (so they survive plugin updates), or under `./research-data` when running the MCP server directly for local development.

## Commands

| Command | Status | What it does |
|---|---|---|
| `/research <problem>` | Implemented | Runs the full Phase 1 pipeline: creates a project, analyzes the problem, discovers and retains literature. |
| `/literature [project-id]` | Implemented | Shows the retained papers and literature summary for a project. |
| `/report [project-id]` | Implemented (partial) | Renders a report from whatever has run so far; explicitly marks unimplemented sections rather than fabricating them. |
| `/gaps`, `/ideas`, `/audit`, `/experiment`, `/review` | **Not implemented in this build** | Arrive in Phases 2-4 alongside the agents that back them (gap-hunter, idea-generator, novelty-auditor, saturation-detector, mutation engine, experiment-designer, reviewer). |

## Architecture

```
Claude Code plugin
  commands/research.md  ──fork──▶  agents/research-orchestrator.md
  commands/literature.md, commands/report.md  (inline, read project state)
                                        │
                        Task-delegates to:
                        agents/problem-analyzer.md
                        agents/literature-scout.md
                                        │
                        both call MCP tools ──▶
                                        │
research-server (src/mcp-server) — 8 tools, thin wrappers over:
                                        │
engine (src/engine) — runtime-independent: schemas, storage (JSON files),
  budget, cache, dedupe, retrieval (arXiv + Semantic Scholar providers),
  search orchestration
                                        │
research-data/ — project.json, spec.json, papers.json,
  literature_summary.json, log.jsonl per project; on-disk query cache
```

`src/engine` has no dependency on `@modelcontextprotocol/sdk` or anything Claude Code-specific, so it can be reused by a different runtime later without rewriting the research logic.

## Example Run

```
/research How can model-based reinforcement learning become substantially
more sample efficient in sparse-reward environments?
```

The orchestrator creates a project, delegates problem analysis (domain, keywords, synonyms, objectives, assumptions), then delegates literature discovery (query expansion, arXiv + Semantic Scholar search, relevance filtering, retention), printing a short progress checklist. Follow up with `/literature` to see the retained papers, or `/report` for the current partial report.

## Limitations

- Only arXiv and Semantic Scholar are searched, both keyless — no OpenAlex, Crossref, ACM/IEEE, or full-text/PDF retrieval.
- No citation graph, embeddings/vector retrieval, gap hunting, idea generation, novelty auditing, saturation detection, idea mutation, assumption/evidence ledgers, research graveyard, experiment design, or reviewer simulation. These are explicitly out of scope for Phase 1 (see the design spec) and are never simulated by the agents in this build.
- Storage is flat JSON files, not a database — fine at the scale of dozens of papers per project, not built for large corpora.
- `source_quality` is a coarse heuristic (venue known vs. not), not a real bibliometric signal.

## Development

```bash
npm install
npm test          # runs the full vitest suite
npm run build      # type-checks and compiles src/ to dist/
npm run dev:mcp    # runs the MCP server directly over stdio, for manual testing
```

## Spec and Plan

- Design: `docs/superpowers/specs/2026-08-27-research-agent-phase1-design.md`
- Implementation plan: `docs/superpowers/plans/2026-08-27-research-agent-phase1.md`
