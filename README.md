# Research Agent (Phase 4)

An autonomous research ideation Claude Code plugin. Give it a research problem statement; it analyzes the problem, discovers relevant literature from arXiv and Semantic Scholar, hunts for research gaps grounded in that literature, generates candidate research ideas, adversarially audits each shortlisted idea for novelty and saturation, rejects ideas that fail that audit to a research graveyard, mutates rejected ideas into new candidates along a targeted operator before re-auditing them, and — for the top surviving ideas — proposes a minimal validation experiment plus a full experimental roadmap and simulates an adversarial reviewer pass. This is **Phase 4**, the final phase of this design — see [Limitations](#limitations) for what remains permanently out of scope.

## Installation

**Via marketplace** (recommended for regular use): this repo hosts itself as a marketplace via `.claude-plugin/marketplace.json`. Inside any Claude Code session:

```
/plugin marketplace add gk-936/researcher-plugin
/plugin install researcher@researcher-marketplace
```

**For local development**, load the plugin directly from a working copy without installing it:

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
  "maxIdeasAudited": 4,
  "maxMutationDepth": 2,
  "maxMutationsPerProject": 3,
  "maxIdeasEvaluated": 3
}
```

Research project data and the on-disk cache live under `${CLAUDE_PLUGIN_DATA}/research-data` once installed as a plugin (so they survive plugin updates), or under `./research-data` when running the MCP server directly for local development.

## Commands

| Command | Status | What it does |
|---|---|---|
| `/research <problem>` | Implemented | Runs the full pipeline: creates a project, analyzes the problem, discovers literature, hunts gaps, generates ideas, audits each shortlisted idea for novelty and saturation, rejects FAIL/SATURATED ideas to the graveyard, mutates each rejected idea once (within budget) before re-auditing the mutation, then designs an experiment and simulates a review for the top `maxIdeasEvaluated` PASS-verdict ideas. |
| `/literature [project-id]` | Implemented | Shows the retained papers and literature summary for a project. |
| `/gaps [project-id]` | Implemented | Shows the research gaps found so far, with their evidence. |
| `/ideas [project-id]` | Implemented | Shows candidate research ideas with their novelty and saturation verdicts. |
| `/report [project-id]` | Implemented | Renders a full report including gaps, ranked active ideas, rejected/saturated directions, mutated directions, experiment designs, and reviewer objections; explicitly marks the remaining unimplemented sections rather than fabricating them. |
| `/experiment [project-id] [idea-id]` | Implemented | Shows the minimal validation experiment, full roadmap, and risks for evaluated ideas. |
| `/review [project-id] [idea-id]` | Implemented | Shows the simulated reviewer's objections and recommendation for evaluated ideas. |

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
                        agents/idea-mutator.md         (per rejected idea, within mutation budget)
                        agents/experiment-designer.md  (per top-N PASS idea, after the mutation loop)
                        agents/reviewer.md              (per top-N PASS idea, after experiment-designer)
                                        │
                        all call MCP tools ──▶
                                        │
research-server (src/mcp-server) — 31 tools, thin wrappers over:
                                        │
engine (src/engine) — runtime-independent: schemas, storage (JSON files),
  budget, cache, dedupe, retrieval (arXiv + Semantic Scholar providers),
  search orchestration
                                        │
research-data/ — project.json, spec.json, papers.json, gaps.json, ideas.json,
  idea_search_evidence.json, literature_summary.json, graveyard.json,
  assumptions.json, evidence.json, experiments.json, reviews.json, log.jsonl
  per project; on-disk query cache
```

`src/engine` has no dependency on `@modelcontextprotocol/sdk` or anything Claude Code-specific, so it can be reused by a different runtime later without rewriting the research logic.

## Example Run

```
/research How can model-based reinforcement learning become substantially
more sample efficient in sparse-reward environments?
```

The orchestrator creates a project, delegates problem analysis (domain, keywords, synonyms, objectives, assumptions), literature discovery (query expansion, arXiv + Semantic Scholar search, relevance filtering, retention), gap hunting (evidence-grounded gaps from the retained literature, plus assumption-ledger entries), idea generation (candidate ideas across distinct strategies), and then, for a shortlisted subset, a novelty audit and a saturation classification per idea. Any idea whose `novelty_verdict` is `FAIL` or whose `saturation` is `SATURATED` is rejected to the research graveyard and given one bounded mutation attempt, with the mutation re-audited exactly like an original idea. Finally, the top `maxIdeasEvaluated` surviving `PASS`-verdict ideas each get a minimal validation experiment design and a simulated adversarial review — printing a short progress checklist throughout. Follow up with `/gaps`, `/ideas`, `/literature`, `/report`, `/experiment`, or `/review`.

## Limitations

- Only arXiv and Semantic Scholar are searched, both keyless — no OpenAlex, Crossref, ACM/IEEE, or full-text/PDF retrieval.
- No citation graph or embeddings/vector retrieval — these are permanently out of scope for the phased roadmap (see the design specs), not deferred to a future phase.
- The evidence ledger is currently sourced only from gaps (auto-derived per saved gap), not from novelty-audit findings — this is a deliberate MVP scope cut documented in the Phase 3A design spec, not a bug.
- Only the top `maxIdeasEvaluated` `PASS`-verdict ideas get an experiment design and review per `/research` run — `WEAK`-verdict ideas and ideas past the cap are never evaluated, by design (see the Phase 4 design spec for the eligibility rule).
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
- Phase 3A design: `docs/superpowers/specs/2026-08-28-research-agent-phase3a-design.md`
- Phase 3A implementation plan: `docs/superpowers/plans/2026-08-28-research-agent-phase3a.md`
- Phase 4 design: `docs/superpowers/specs/2026-08-28-research-agent-phase4-design.md`
- Phase 4 implementation plan: `docs/superpowers/plans/2026-08-28-research-agent-phase4.md`
