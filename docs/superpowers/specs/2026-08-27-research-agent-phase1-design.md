# Research Agent Plugin — Phase 1 Design

Status: approved for implementation (Phase 1 only)
Parent spec: the full 73-section autonomous-research-ideation-plugin brief (see task history). That brief describes a 4-phase build; this document specs **Phase 1 only**, per its own §56 instruction not to implement the whole architecture at once.

## 1. Goal

Ship a working, installable Claude Code plugin where `/research <problem statement>` autonomously: creates a research project, analyzes the problem into a structured spec, expands it into search-term families, discovers literature from arXiv + Semantic Scholar, retains the relevant subset, and reports progress + a partial summary. `/literature` and `/report` let the user inspect and re-render that state without rerunning searches.

Everything downstream of literature discovery — gap hunting, idea generation, novelty auditing, saturation detection, mutation, experiment design, reviewer simulation, citation graphs, embeddings, the evidence/assumption ledgers, the research graveyard — is explicitly **out of scope** for this phase (§13 below) and arrives in Phases 2–4 as the parent brief prescribes.

## 2. Directory Structure

```
researcher-plugin/
├── .claude-plugin/
│   └── plugin.json
├── .mcp.json
├── commands/
│   ├── research.md
│   ├── literature.md
│   └── report.md
├── agents/
│   ├── research-orchestrator.md
│   ├── problem-analyzer.md
│   └── literature-scout.md
├── skills/
│   └── research-methodology/
│       └── SKILL.md
├── src/
│   ├── engine/                      # runtime-independent — no MCP/Claude Code imports
│   │   ├── schemas.ts               # zod schemas: ResearchSpec, Paper, ProjectState, Budget
│   │   ├── ids.ts                   # project id / paper id generation
│   │   ├── storage.ts               # JSON-file ProjectStore
│   │   ├── budget.ts                # default budget + config loading
│   │   ├── cache.ts                 # on-disk query/paper cache
│   │   ├── dedupe.ts                # paper dedup + merge
│   │   ├── logging.ts               # JSONL structured logger
│   │   └── retrieval/
│   │       ├── provider.ts          # PaperSearchProvider interface
│   │       ├── arxiv.ts
│   │       └── semanticScholar.ts
│   └── mcp-server/
│       ├── index.ts                 # server entrypoint, tool registration
│       └── tools.ts                 # tool handlers, thin wrappers over engine/
├── tests/
│   └── engine/
│       ├── dedupe.test.ts
│       ├── storage.test.ts
│       ├── cache.test.ts
│       ├── budget.test.ts
│       └── retrieval.test.ts        # parses fixture API responses
├── research-data/                   # gitignored; created at runtime
│   ├── cache/
│   └── projects/
├── package.json
├── tsconfig.json
├── .gitignore
└── README.md
```

## 3. Plugin Manifest

`.claude-plugin/plugin.json`:

```json
{
  "name": "researcher",
  "displayName": "Research Agent",
  "version": "0.1.0",
  "description": "Autonomous research ideation assistant: analyzes a problem statement and discovers literature (Phase 1). Gap hunting, idea generation, novelty auditing and experiment design arrive in later phases.",
  "author": { "email": "gokuld088@gmail.com" },
  "keywords": ["research", "literature-review", "ideation", "science"]
}
```

Default component locations are used (`commands/`, `agents/`, `skills/`, `.mcp.json`) — no custom path fields needed.

## 4. Data Schemas (`src/engine/schemas.ts`, zod)

**ResearchSpec** (problem-analyzer output, §9 of parent brief):
```ts
{
  problem: string
  domain: string
  subdomains: string[]
  research_question: string
  objectives: string[]
  constraints: string[]
  assumptions: string[]
  target_setting: string
  keywords: string[]
  synonyms: string[]
  related_concepts: string[]
  adjacent_fields: string[]
  candidate_search_terms: string[]
  likely_evaluation_criteria: string[]
}
```

**Paper** (stored, full record — subset of §13's schema; fields requiring deep-read like `methods`/`claims`/`limitations` are omitted until Phase 2's deep-analysis stage exists):
```ts
{
  id: string                 // "arxiv:<id>" | "s2:<paperId>" | "doi:<doi>" | "hash:<sha1(title+year)>"
  title: string
  authors: string[]
  year: number | null
  venue: string | null
  abstract: string | null
  url: string | null
  doi: string | null
  arxiv_id: string | null
  source: "arxiv" | "semantic_scholar"
  source_quality: number     // 0-1 heuristic: peer-reviewed venue known > preprint > unknown
  retrieved_at: string       // ISO timestamp
  status: "discovered" | "retained"
  relevance_note: string | null
}
```

**CompactPaper** (what agents/tools receive back — never the full corpus): `id, title, authors (first 2 + "et al" if more), year, venue, abstract (≤280 chars), source, url, status`.

**ProjectState** (`project.json`):
```ts
{
  id: string
  problem: string
  created_at: string
  status: "created" | "spec_saved" | "literature_done"
  phases_completed: string[]   // e.g. ["problem_analysis", "literature_discovery"]
  searches_run: number
  budget: Budget                // snapshot, so later resumes stay consistent
}
```

**Budget** (`src/engine/budget.ts`, overridable via `research-data/config.json`):
```ts
{
  maxDiscoverySearchesPerProject: 12,
  maxCandidatesPerProject: 60,
  maxRetainedPapers: 20,
  cacheTtlDays: 7,
  requestTimeoutMs: 15000,
  arxivMinDelayMs: 3000        // politeness delay between arXiv calls
}
```
These are intentionally scaled down from the parent brief's §42 full-system defaults (e.g. 200 candidates, 30 deep-reads) since Phase 1 has no deep-read stage.

## 5. Storage Layout

```
research-data/
├── config.json                       # optional budget overrides
├── cache/
│   ├── arxiv/<sha256(query)>.json
│   └── semantic_scholar/<sha256(query)>.json
└── projects/
    └── <project-id>/
        ├── project.json
        ├── spec.json
        ├── papers.json               # all discovered/retained Paper records
        ├── literature_summary.json
        └── log.jsonl
```

`storage.ts` exposes a `ProjectStore` interface (`createProject`, `getProject`, `listProjects`, `saveSpec`, `upsertPapers`, `getPapers`, `retainPapers`, `saveLiteratureSummary`) so the JSON-file implementation can be swapped later (e.g. for SQLite) without touching callers.

## 6. Retrieval Providers

`PaperSearchProvider` interface: `search(query: string, limit: number): Promise<Paper[]>`, throws a typed `ProviderError` on failure (never throws raw network errors up to callers).

- **ArxivProvider**: Atom/XML API (`export.arxiv.org/api/query`), parsed with `fast-xml-parser`. Enforces `arxivMinDelayMs` between calls (politeness).
- **SemanticScholarProvider**: JSON REST API (`api.semanticscholar.org/graph/v1/paper/search`), keyless tier.

Both wrapped with `requestTimeoutMs` timeout and a single retry on 429/5xx with backoff. A provider failure is logged and excluded from results — it never aborts the whole search (§48: partial results, not total failure).

**Dedup** (`dedupe.ts`): merge by exact `arxiv_id`/`doi` match first, then fall back to normalized-title + first-author + year fuzzy match. On merge, prefer the record with a non-null abstract and higher `source_quality`.

**Cache** (`cache.ts`): key = `sha256(provider + "::" + normalized query)`, TTL from budget config, stored as the raw provider response pre-normalization so re-parsing logic changes don't require re-fetching.

## 7. MCP Server (`src/mcp-server`)

Registered in `.mcp.json`:
```json
{
  "mcpServers": {
    "research-server": {
      "command": "node",
      "args": ["${CLAUDE_PLUGIN_ROOT}/dist/mcp-server/index.js"],
      "env": { "RESEARCH_DATA_DIR": "${CLAUDE_PLUGIN_DATA}/research-data" }
    }
  }
}
```
`RESEARCH_DATA_DIR` falls back to `./research-data` (relative to cwd) when unset, so tests and local dev work without a plugin install.

### Tools

| Tool | Input | Output | Notes |
|---|---|---|---|
| `create_project` | `{ problem }` | `{ project_id, created_at }` | id = kebab-slug of first ~6 problem words + 8 hex chars from `crypto.randomUUID()`. Initializes `project.json`, `log.jsonl`. |
| `get_project_state` | `{ project_id? }` | `{ project_id, problem, created_at, status, phases_completed, searches_run, counts: { discovered, retained }, has_spec }` | Omitted `project_id` → most recently created project. |
| `list_projects` | `{}` | `{ projects: [{ project_id, problem (truncated), created_at, status }] }` | Sorted newest first. |
| `save_problem_spec` | `{ project_id, spec: ResearchSpec }` | `{ saved: true }` | Validates against zod schema; rejects with field errors on mismatch. |
| `search_papers` | `{ project_id, queries: string[] }` | `{ queries_run, queries_truncated, candidates: CompactPaper[], provider_errors }` | Truncates to remaining discovery-search budget. Runs both providers per query in parallel, dedupes, upserts into `papers.json` as `status: "discovered"`, caps total to `maxCandidatesPerProject`. |
| `get_papers` | `{ project_id, ids?, status?, limit? }` | `{ papers: CompactPaper[] }` | |
| `retain_papers` | `{ project_id, retained: [{ id, relevance_note }] }` | `{ retained_count }` | Marks `status: "retained"`, caps to `maxRetainedPapers`. |
| `save_literature_summary` | `{ project_id, summary, taxonomy_dimensions? }` | `{ saved: true }` | Sets `phases_completed += "literature_discovery"`. |

Every tool call appends a structured event to `log.jsonl` (`{ ts, event, project_id, data }`) — this is the Phase 1 slice of §63 observability (search counts, cache hit/miss, provider errors, retained counts).

## 8. Agents

All three omit an explicit `tools:` frontmatter field, so each inherits the tool pool for its execution context rather than a hardcoded allowlist — the exact scoped MCP tool name (e.g. `mcp__plugin_researcher_research-server__create_project`) is discovered by the model from its tool list at runtime, avoiding a name that silently breaks if the plugin is renamed. `research-orchestrator` is the direct fork target of `/research`, so it runs foreground and inherits everything, including `Task` (needed to delegate to the other two) and every plugin MCP tool. `problem-analyzer` and `literature-scout` are leaf agents spawned via `Task` by the orchestrator and never need to delegate further, so it doesn't matter whether they resolve foreground or background: both pools include all plugin MCP tools, which is all they need. Tool restriction can be tightened once the system has been exercised once and the scoped names are confirmed empirically.

**`agents/research-orchestrator.md`**
```yaml
---
name: research-orchestrator
description: Runs the Phase 1 research pipeline end-to-end for a problem statement — creates the project, delegates problem analysis and literature discovery, verifies results, and reports progress. Invoked only via /research.
skills: research-methodology
maxTurns: 40
---
```
Body instructs it to: call `create_project`; delegate to `problem-analyzer` with the raw problem text and project id, then verify the returned spec is non-empty and call `save_problem_spec` (or instruct the sub-agent to); delegate to `literature-scout` with the project id and spec; verify literature-scout actually retained ≥1 paper or explicitly surfaced a zero-results/failure state (never claim success on empty results — §8.1 "never blindly trust"); print a compact progress checklist in the style of §52 as it goes; end by telling the user to run `/literature` or `/report`, and that gap/idea/novelty stages aren't implemented yet in this build.

**`agents/problem-analyzer.md`**
```yaml
---
name: problem-analyzer
description: Turns a raw research problem statement into a structured ResearchSpec (domain, keywords, synonyms, related concepts, adjacent fields, objectives, assumptions). Used internally by research-orchestrator.
maxTurns: 8
---
```
Body: extract every ResearchSpec field from schema §4; when information is missing, make explicit, stated assumptions rather than blocking (§9); do not hardcode any domain's terminology — derive it from the problem text itself so the same agent works for ML, biology, systems, HCI, etc. (§54); call `save_problem_spec`.

**`agents/literature-scout.md`**
```yaml
---
name: literature-scout
description: Expands a ResearchSpec into search-query families and discovers/retains relevant literature from arXiv and Semantic Scholar within budget. Used internally by research-orchestrator.
maxTurns: 20
---
```
Body: draft query families (exact problem, synonyms, method/mechanism terms, adjacent-field terms — §10) bounded by remaining budget; call `search_papers`; from the compact candidates, decide which are actually relevant (title/abstract match to the spec, not just keyword presence) and call `retain_papers` with a one-line relevance note per paper; write a short landscape synthesis via `save_literature_summary`; if a provider failed or results are sparse, say so plainly rather than papering over it (§48).

## 9. Skill: `skills/research-methodology/SKILL.md`

```yaml
---
name: research-methodology
description: Core operating principles for the research-agent pipeline — evidence discipline, budget discipline, the novelty/saturation vocabulary, and current phase boundaries.
user-invocable: false
---
```
Content (reference, not task): the Novel / Novel-but-weak / Novel-but-impractical / Saturated / Genuine-opportunity vocabulary (§3); the rule that novelty and gaps are confidence judgments backed by evidence, never "search found nothing so it must be novel" (§18, §55 anti-pattern 3); the funnel discipline and budget-respect principle (§28, §43); the anti-patterns list (§55) condensed to what's relevant at this phase; an explicit statement of which pipeline stages exist in this build (problem analysis, literature discovery) versus which don't yet (gap hunting onward), so agents never claim to have run a stage that isn't implemented.

## 10. Commands

**`commands/research.md`**
```yaml
---
description: Run the Phase 1 research pipeline (problem analysis + literature discovery) for a research problem statement.
argument-hint: <research problem statement>
context: fork
agent: research-orchestrator
background: false
disable-model-invocation: true
---
Research problem statement:

$ARGUMENTS
```

**`commands/literature.md`** (inline, not forked)
```yaml
---
description: Show the accumulated literature landscape for the current or specified research project.
argument-hint: [project-id]
disable-model-invocation: true
---
```
Instructs Claude to resolve the project (via `get_project_state`/`list_projects` using `$ARGUMENTS` as an optional project id), fetch retained papers via `get_papers`, and present them with title/authors/year/venue/url plus the saved literature summary. Says plainly if no project or no literature exists yet.

**`commands/report.md`** (inline, not forked)
```yaml
---
description: Generate the research report for the current or specified project from whatever pipeline stages have completed.
argument-hint: [project-id]
disable-model-invocation: true
---
```
Produces a report following the parent brief's §50 structure, populating only: Executive Summary, Problem Interpretation, Assumptions, Research Landscape (from the spec + retained papers), References. Every other §50 section (Gaps, Candidate Ideas, Saturated Directions, Mutations, Ranked Opportunities, Experiments, Reviewer Objections) is explicitly rendered as "Not yet available — requires Phase 2/3/4 (not implemented in this build)" rather than fabricated.

`/gaps`, `/ideas`, `/audit`, `/experiment`, `/review` are **not created** in Phase 1 — they ship alongside the agents that back them in later phases. The README documents this explicitly.

## 11. Testing Plan

- `tests/engine/dedupe.test.ts` — exact-id merge, fuzzy title/author/year merge, quality-preference on conflict.
- `tests/engine/storage.test.ts` — project create/read round-trip, spec save/validate-reject, paper upsert idempotency, retain capping at budget.
- `tests/engine/cache.test.ts` — write/read/TTL-expiry.
- `tests/engine/budget.test.ts` — default budget shape, config-file override merge.
- `tests/engine/retrieval.test.ts` — parses fixture arXiv Atom XML and fixture Semantic Scholar JSON into `Paper[]` correctly; simulates a provider timeout/500 and asserts the other provider's results still come back with the failure logged, not thrown.
- MCP smoke test — server starts, `tools/list` returns the 8 tools with the expected input schemas (using the MCP SDK's in-memory/stdio test transport).
- Manual end-to-end: `/research <problem>` run against a real problem statement once implementation lands, per parent brief §56's own verification instruction.

## 12. Failure Handling (§48 applied to Phase 1)

- Provider unreachable/rate-limited → log, exclude from that query's results, continue with the other provider; if both fail for every query, `literature-scout` reports zero results honestly rather than inventing papers.
- Malformed/partial provider response → skip that record, log a `provider_error` event, don't crash the tool call.
- Spec validation failure → `save_problem_spec` returns field-level errors; `problem-analyzer` is instructed to fix and retry once, not silently drop fields.
- Budget exhausted mid-run → tools truncate and report `queries_truncated`/cap counts rather than silently ignoring the excess.

## 13. Explicitly Out of Scope for Phase 1

PDF/full-text retrieval and parsing, citation graph, embeddings/vector retrieval, gap-hunter, idea-generator, novelty-auditor, saturation-detector, mutation engine, assumption ledger, evidence ledger (beyond the basic JSONL log), research graveyard, experiment-designer, reviewer simulator, `/gaps` `/ideas` `/audit` `/experiment` `/review` commands, OpenAlex/Crossref/other providers, cheap-vs-expensive model routing, citation-analyst agent. These are Phases 2–4 per the parent brief's own §57–59 phasing and are not stubbed here.

## 14. Dependencies

`@modelcontextprotocol/sdk`, `zod`, `fast-xml-parser`, `typescript`, `vitest`, `tsx` (dev). Node's built-in `fetch` and `crypto.randomUUID` cover HTTP and ID generation — no `axios`/`node-fetch`/`nanoid` needed.
