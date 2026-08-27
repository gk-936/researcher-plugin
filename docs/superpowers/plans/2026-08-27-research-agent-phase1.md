# Research Agent Plugin — Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a working, installable Claude Code plugin where `/research <problem statement>` creates a research project, analyzes the problem into a structured spec, discovers literature from arXiv + Semantic Scholar, and reports progress; `/literature` and `/report` inspect that state without rerunning searches.

**Architecture:** A runtime-independent TypeScript "engine" (`src/engine/`) implements schemas, storage, budgets, caching, dedup, and paper retrieval with no Claude Code or MCP imports. A thin MCP server (`src/mcp-server/`) wraps the engine as 8 tools over stdio. Three plugin agents (`research-orchestrator`, `problem-analyzer`, `literature-scout`) and three commands (`/research`, `/literature`, `/report`) drive the pipeline using those tools.

**Tech Stack:** Node.js 20, TypeScript (strict, `module`/`moduleResolution: Node16`), `@modelcontextprotocol/sdk` (`McpServer` + `registerTool`), `zod` for schema validation, `fast-xml-parser` for arXiv's Atom feed, `vitest` for tests, plain JSON files for storage (no database).

**Spec:** `docs/superpowers/specs/2026-08-27-research-agent-phase1-design.md`

## Global Constraints

- Node 20 / TypeScript, `"type": "module"` in package.json — every relative import in `src/` must use an explicit `.js` extension (Node16 module resolution requirement), even though the source files are `.ts`.
- MCP tool registration uses `server.registerTool(name, { title, description, inputSchema: <ZodObject>.strict(), annotations }, handler)` from `@modelcontextprotocol/sdk/server/mcp.js`. Never use the deprecated `server.tool()` or manual `setRequestHandler(ListToolsRequestSchema, ...)`.
- Storage is plain JSON files under a root data directory (`ProjectStore` in `src/engine/storage.ts`) — no SQLite, no database dependency.
- Literature sources are exactly arXiv and Semantic Scholar, both used keyless. No other provider in Phase 1.
- Budget defaults (from the spec, §4): `maxDiscoverySearchesPerProject: 12`, `maxCandidatesPerProject: 60`, `maxRetainedPapers: 20`, `cacheTtlDays: 7`, `requestTimeoutMs: 15000`, `arxivMinDelayMs: 3000`.
- Never fabricate research findings. A tool/agent that finds nothing must say so explicitly rather than inventing papers, gaps, or ideas. Stages not implemented in Phase 1 (gap hunting, idea generation, novelty auditing, saturation detection, experiment design, reviewer simulation) must never be simulated by an agent — they are explicitly out of scope (spec §13).
- No code comments except where a non-obvious constraint truly requires one — the modules below are intentionally comment-free.
- Every engine module is pure/runtime-independent: no imports from `@modelcontextprotocol/sdk` anywhere under `src/engine/`.

---

### Task 1: Project Scaffolding

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `vitest.config.ts`
- Create: `.gitignore`

**Interfaces:**
- Produces: an npm project with `@modelcontextprotocol/sdk`, `zod`, `fast-xml-parser` as dependencies and `typescript`, `vitest`, `tsx`, `@types/node`, `js-yaml`, `@types/js-yaml` as devDependencies. `npm run build`, `npm test`, and `npm run dev:mcp` scripts. All later tasks assume these are installed.

- [ ] **Step 1: Create directory skeleton**

```bash
mkdir -p src/engine/retrieval src/mcp-server tests/engine/retrieval tests/mcp-server tests/plugin tests/helpers agents commands skills research-data
```

- [ ] **Step 2: Write `package.json`**

```json
{
  "name": "researcher-plugin",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "description": "Autonomous research ideation Claude Code plugin — Phase 1 (problem analysis + literature discovery).",
  "scripts": {
    "build": "tsc",
    "test": "vitest run",
    "dev:mcp": "tsx src/mcp-server/index.ts"
  },
  "engines": { "node": ">=20" },
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.6.1",
    "zod": "^3.23.8",
    "fast-xml-parser": "^4.5.0"
  },
  "devDependencies": {
    "@types/node": "^22.10.0",
    "@types/js-yaml": "^4.0.9",
    "js-yaml": "^4.1.0",
    "tsx": "^4.19.2",
    "typescript": "^5.7.2",
    "vitest": "^2.1.5"
  }
}
```

- [ ] **Step 3: Write `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "Node16",
    "moduleResolution": "Node16",
    "lib": ["ES2022"],
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "sourceMap": true,
    "allowSyntheticDefaultImports": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

- [ ] **Step 4: Write `vitest.config.ts`**

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
  },
});
```

- [ ] **Step 5: Write `.gitignore`**

```
node_modules/
dist/
research-data/
*.log
.DS_Store
```

- [ ] **Step 6: Install dependencies**

Run: `npm install`
Expected: completes with no errors, creates `node_modules/` and `package-lock.json`.

- [ ] **Step 7: Verify toolchain**

Run: `npx tsc --version && npx vitest --version`
Expected: both print version numbers, no errors.

- [ ] **Step 8: Commit**

```bash
git add package.json package-lock.json tsconfig.json vitest.config.ts .gitignore
git commit -m "chore: project scaffolding for research-agent plugin"
```

---

### Task 2: Engine Schemas

**Files:**
- Create: `src/engine/schemas.ts`
- Test: `tests/engine/schemas.test.ts`

**Interfaces:**
- Produces: `ResearchSpecSchema`/`ResearchSpec`, `PaperSchema`/`Paper`, `PaperSourceSchema`, `PaperStatusSchema`, `CompactPaper`, `toCompactPaper(p: Paper): CompactPaper`, `BudgetSchema`/`Budget`, `ProjectStatusSchema`, `ProjectStateSchema`/`ProjectState`. Every later engine/mcp-server task imports from this file.

- [ ] **Step 1: Write the failing test**

```ts
// tests/engine/schemas.test.ts
import { describe, expect, it } from "vitest";
import { ResearchSpecSchema, PaperSchema, BudgetSchema, ProjectStateSchema, toCompactPaper, type Paper } from "../../src/engine/schemas.js";

const validSpec = {
  problem: "How can model-based RL become more sample efficient?",
  domain: "machine learning",
  subdomains: ["reinforcement learning"],
  research_question: "Can sample efficiency improve in sparse-reward settings?",
  objectives: ["reduce sample count"],
  constraints: ["limited compute"],
  assumptions: ["environment is stationary"],
  target_setting: "sparse-reward continuous control",
  keywords: ["model-based RL"],
  synonyms: ["world models"],
  related_concepts: ["latent dynamics"],
  adjacent_fields: ["control theory"],
  candidate_search_terms: ["sample efficient world models"],
  likely_evaluation_criteria: ["sample count to convergence"],
};

describe("ResearchSpecSchema", () => {
  it("accepts a fully-formed spec", () => {
    expect(() => ResearchSpecSchema.parse(validSpec)).not.toThrow();
  });

  it("rejects a spec missing a required field", () => {
    const { research_question: _drop, ...broken } = validSpec;
    expect(() => ResearchSpecSchema.parse(broken)).toThrow();
  });
});

const basePaper: Paper = {
  id: "arxiv:1234.5678",
  title: "A Paper",
  authors: ["A. One", "B. Two", "C. Three"],
  year: 2024,
  venue: "arXiv preprint",
  abstract: "x".repeat(400),
  url: "https://arxiv.org/abs/1234.5678",
  doi: null,
  arxiv_id: "1234.5678",
  source: "arxiv",
  source_quality: 0.5,
  retrieved_at: new Date().toISOString(),
  status: "discovered",
  relevance_note: null,
};

describe("PaperSchema", () => {
  it("accepts a fully-formed paper", () => {
    expect(() => PaperSchema.parse(basePaper)).not.toThrow();
  });

  it("rejects source_quality outside 0-1", () => {
    expect(() => PaperSchema.parse({ ...basePaper, source_quality: 1.5 })).toThrow();
  });
});

describe("toCompactPaper", () => {
  it("truncates the abstract to 280 chars", () => {
    const compact = toCompactPaper(basePaper);
    expect(compact.abstract?.length).toBe(280);
  });

  it("collapses more than 2 authors to 'et al.'", () => {
    const compact = toCompactPaper(basePaper);
    expect(compact.authors).toEqual(["A. One", "B. Two", "et al."]);
  });

  it("keeps 2 or fewer authors as-is", () => {
    const compact = toCompactPaper({ ...basePaper, authors: ["A. One"] });
    expect(compact.authors).toEqual(["A. One"]);
  });
});

describe("BudgetSchema", () => {
  it("accepts the documented default shape", () => {
    const budget = {
      maxDiscoverySearchesPerProject: 12,
      maxCandidatesPerProject: 60,
      maxRetainedPapers: 20,
      cacheTtlDays: 7,
      requestTimeoutMs: 15000,
      arxivMinDelayMs: 3000,
    };
    expect(() => BudgetSchema.parse(budget)).not.toThrow();
  });
});

describe("ProjectStateSchema", () => {
  it("accepts a freshly-created project state", () => {
    const state = {
      id: "sample-efficient-rl-abc12345",
      problem: validSpec.problem,
      created_at: new Date().toISOString(),
      status: "created",
      phases_completed: [],
      searches_run: 0,
      budget: {
        maxDiscoverySearchesPerProject: 12,
        maxCandidatesPerProject: 60,
        maxRetainedPapers: 20,
        cacheTtlDays: 7,
        requestTimeoutMs: 15000,
        arxivMinDelayMs: 3000,
      },
    };
    expect(() => ProjectStateSchema.parse(state)).not.toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/engine/schemas.test.ts`
Expected: FAIL — `Cannot find module '../../src/engine/schemas.js'`

- [ ] **Step 3: Write the implementation**

```ts
// src/engine/schemas.ts
import { z } from "zod";

export const ResearchSpecSchema = z.object({
  problem: z.string().min(1),
  domain: z.string().min(1),
  subdomains: z.array(z.string()),
  research_question: z.string().min(1),
  objectives: z.array(z.string()),
  constraints: z.array(z.string()),
  assumptions: z.array(z.string()),
  target_setting: z.string(),
  keywords: z.array(z.string()),
  synonyms: z.array(z.string()),
  related_concepts: z.array(z.string()),
  adjacent_fields: z.array(z.string()),
  candidate_search_terms: z.array(z.string()),
  likely_evaluation_criteria: z.array(z.string()),
});
export type ResearchSpec = z.infer<typeof ResearchSpecSchema>;

export const PaperSourceSchema = z.enum(["arxiv", "semantic_scholar"]);
export type PaperSource = z.infer<typeof PaperSourceSchema>;

export const PaperStatusSchema = z.enum(["discovered", "retained"]);
export type PaperStatus = z.infer<typeof PaperStatusSchema>;

export const PaperSchema = z.object({
  id: z.string(),
  title: z.string(),
  authors: z.array(z.string()),
  year: z.number().int().nullable(),
  venue: z.string().nullable(),
  abstract: z.string().nullable(),
  url: z.string().nullable(),
  doi: z.string().nullable(),
  arxiv_id: z.string().nullable(),
  source: PaperSourceSchema,
  source_quality: z.number().min(0).max(1),
  retrieved_at: z.string(),
  status: PaperStatusSchema,
  relevance_note: z.string().nullable(),
});
export type Paper = z.infer<typeof PaperSchema>;

export interface CompactPaper {
  id: string;
  title: string;
  authors: string[];
  year: number | null;
  venue: string | null;
  abstract: string | null;
  source: PaperSource;
  url: string | null;
  status: PaperStatus;
}

export function toCompactPaper(p: Paper): CompactPaper {
  const authors = p.authors.length > 2 ? [...p.authors.slice(0, 2), "et al."] : p.authors;
  return {
    id: p.id,
    title: p.title,
    authors,
    year: p.year,
    venue: p.venue,
    abstract: p.abstract ? p.abstract.slice(0, 280) : null,
    source: p.source,
    url: p.url,
    status: p.status,
  };
}

export const BudgetSchema = z.object({
  maxDiscoverySearchesPerProject: z.number().int().positive(),
  maxCandidatesPerProject: z.number().int().positive(),
  maxRetainedPapers: z.number().int().positive(),
  cacheTtlDays: z.number().positive(),
  requestTimeoutMs: z.number().int().positive(),
  arxivMinDelayMs: z.number().int().nonnegative(),
});
export type Budget = z.infer<typeof BudgetSchema>;

export const ProjectStatusSchema = z.enum(["created", "spec_saved", "literature_done"]);
export type ProjectStatus = z.infer<typeof ProjectStatusSchema>;

export const ProjectStateSchema = z.object({
  id: z.string(),
  problem: z.string(),
  created_at: z.string(),
  status: ProjectStatusSchema,
  phases_completed: z.array(z.string()),
  searches_run: z.number().int().nonnegative(),
  budget: BudgetSchema,
});
export type ProjectState = z.infer<typeof ProjectStateSchema>;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/engine/schemas.test.ts`
Expected: PASS (9 tests)

- [ ] **Step 5: Commit**

```bash
git add src/engine/schemas.ts tests/engine/schemas.test.ts
git commit -m "feat: add engine schemas (ResearchSpec, Paper, Budget, ProjectState)"
```

---

### Task 3: Engine IDs

**Files:**
- Create: `src/engine/ids.ts`
- Test: `tests/engine/ids.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `slugify(text: string, maxWords?: number): string`, `createProjectId(problem: string): string`, `hashPaperId(title: string, year: number | null): string`. Used by Task 8 (storage) and Tasks 10-11 (providers).

- [ ] **Step 1: Write the failing test**

```ts
// tests/engine/ids.test.ts
import { describe, expect, it } from "vitest";
import { slugify, createProjectId, hashPaperId } from "../../src/engine/ids.js";

describe("slugify", () => {
  it("lowercases, strips punctuation, and joins with hyphens", () => {
    expect(slugify("How can RL become, more efficient?!")).toBe("how-can-rl-become-more");
  });

  it("truncates to maxWords", () => {
    expect(slugify("one two three four five six seven", 3)).toBe("one-two-three");
  });

  it("falls back to 'project' for empty input", () => {
    expect(slugify("???")).toBe("project");
  });
});

describe("createProjectId", () => {
  it("matches <slug>-<8 hex chars>", () => {
    const id = createProjectId("Sample efficient model-based RL");
    expect(id).toMatch(/^sample-efficient-model-based-rl-[0-9a-f]{8}$/);
  });

  it("produces different ids for the same problem on repeated calls", () => {
    const a = createProjectId("same problem");
    const b = createProjectId("same problem");
    expect(a).not.toBe(b);
  });
});

describe("hashPaperId", () => {
  it("is deterministic for the same title and year", () => {
    const a = hashPaperId("Some Paper Title", 2024);
    const b = hashPaperId("Some Paper Title", 2024);
    expect(a).toBe(b);
  });

  it("differs for a different title", () => {
    const a = hashPaperId("Some Paper Title", 2024);
    const b = hashPaperId("A Different Title", 2024);
    expect(a).not.toBe(b);
  });

  it("starts with 'hash:'", () => {
    expect(hashPaperId("Title", null)).toMatch(/^hash:[0-9a-f]{16}$/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/engine/ids.test.ts`
Expected: FAIL — `Cannot find module '../../src/engine/ids.js'`

- [ ] **Step 3: Write the implementation**

```ts
// src/engine/ids.ts
import { createHash, randomUUID } from "node:crypto";

export function slugify(text: string, maxWords = 6): string {
  const words = text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, maxWords);
  return words.join("-") || "project";
}

export function createProjectId(problem: string): string {
  const suffix = randomUUID().replace(/-/g, "").slice(0, 8);
  return `${slugify(problem)}-${suffix}`;
}

export function hashPaperId(title: string, year: number | null): string {
  const normalized = title.toLowerCase().replace(/[^a-z0-9]/g, "");
  const hash = createHash("sha1").update(`${normalized}:${year ?? ""}`).digest("hex").slice(0, 16);
  return `hash:${hash}`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/engine/ids.test.ts`
Expected: PASS (7 tests)

- [ ] **Step 5: Commit**

```bash
git add src/engine/ids.ts tests/engine/ids.test.ts
git commit -m "feat: add project/paper id generation helpers"
```

---

### Task 4: Engine Budget

**Files:**
- Create: `src/engine/budget.ts`
- Test: `tests/engine/budget.test.ts`

**Interfaces:**
- Consumes: `BudgetSchema`, `Budget` from `./schemas.js` (Task 2).
- Produces: `DEFAULT_BUDGET: Budget`, `loadBudget(configPath: string): Budget`. Used by Task 14 (mcp-server/index.ts).

- [ ] **Step 1: Write the failing test**

```ts
// tests/engine/budget.test.ts
import { describe, expect, it, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_BUDGET, loadBudget } from "../../src/engine/budget.js";

let dir: string;
afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
});

describe("loadBudget", () => {
  it("returns DEFAULT_BUDGET when the config file does not exist", () => {
    dir = mkdtempSync(join(tmpdir(), "budget-test-"));
    const budget = loadBudget(join(dir, "config.json"));
    expect(budget).toEqual(DEFAULT_BUDGET);
  });

  it("merges a partial override on top of defaults", () => {
    dir = mkdtempSync(join(tmpdir(), "budget-test-"));
    const configPath = join(dir, "config.json");
    writeFileSync(configPath, JSON.stringify({ maxRetainedPapers: 5 }));
    const budget = loadBudget(configPath);
    expect(budget.maxRetainedPapers).toBe(5);
    expect(budget.maxDiscoverySearchesPerProject).toBe(DEFAULT_BUDGET.maxDiscoverySearchesPerProject);
  });

  it("throws when the override has an invalid value", () => {
    dir = mkdtempSync(join(tmpdir(), "budget-test-"));
    const configPath = join(dir, "config.json");
    writeFileSync(configPath, JSON.stringify({ maxRetainedPapers: -5 }));
    expect(() => loadBudget(configPath)).toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/engine/budget.test.ts`
Expected: FAIL — `Cannot find module '../../src/engine/budget.js'`

- [ ] **Step 3: Write the implementation**

```ts
// src/engine/budget.ts
import { existsSync, readFileSync } from "node:fs";
import { BudgetSchema, type Budget } from "./schemas.js";

export const DEFAULT_BUDGET: Budget = {
  maxDiscoverySearchesPerProject: 12,
  maxCandidatesPerProject: 60,
  maxRetainedPapers: 20,
  cacheTtlDays: 7,
  requestTimeoutMs: 15000,
  arxivMinDelayMs: 3000,
};

export function loadBudget(configPath: string): Budget {
  if (!existsSync(configPath)) return DEFAULT_BUDGET;
  const raw = JSON.parse(readFileSync(configPath, "utf-8"));
  const merged = { ...DEFAULT_BUDGET, ...raw };
  return BudgetSchema.parse(merged);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/engine/budget.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add src/engine/budget.ts tests/engine/budget.test.ts
git commit -m "feat: add budget defaults and config-file override loading"
```

---

### Task 5: Engine Logging

**Files:**
- Create: `src/engine/logging.ts`
- Test: `tests/engine/logging.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `LogEvent` interface, `logEvent(logPath: string, event: string, projectId: string, data?: Record<string, unknown>): void`, `readLog(logPath: string): LogEvent[]`. Used by Task 8 (storage).

- [ ] **Step 1: Write the failing test**

```ts
// tests/engine/logging.test.ts
import { describe, expect, it, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { logEvent, readLog } from "../../src/engine/logging.js";

let dir: string;
afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
});

describe("logEvent / readLog", () => {
  it("appends JSONL entries and reads them back in order", () => {
    dir = mkdtempSync(join(tmpdir(), "log-test-"));
    const logPath = join(dir, "sub", "log.jsonl");
    logEvent(logPath, "project_created", "proj-1", { problem: "x" });
    logEvent(logPath, "spec_saved", "proj-1");

    const entries = readLog(logPath);
    expect(entries).toHaveLength(2);
    expect(entries[0].event).toBe("project_created");
    expect(entries[0].data).toEqual({ problem: "x" });
    expect(entries[1].event).toBe("spec_saved");
    expect(typeof entries[0].ts).toBe("string");
  });

  it("returns an empty array when the log file does not exist", () => {
    dir = mkdtempSync(join(tmpdir(), "log-test-"));
    expect(readLog(join(dir, "missing.jsonl"))).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/engine/logging.test.ts`
Expected: FAIL — `Cannot find module '../../src/engine/logging.js'`

- [ ] **Step 3: Write the implementation**

```ts
// src/engine/logging.ts
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";

export interface LogEvent {
  ts: string;
  event: string;
  project_id: string;
  data?: Record<string, unknown>;
}

export function logEvent(logPath: string, event: string, projectId: string, data?: Record<string, unknown>): void {
  mkdirSync(dirname(logPath), { recursive: true });
  const entry: LogEvent = { ts: new Date().toISOString(), event, project_id: projectId, data };
  appendFileSync(logPath, JSON.stringify(entry) + "\n", "utf-8");
}

export function readLog(logPath: string): LogEvent[] {
  if (!existsSync(logPath)) return [];
  const raw = readFileSync(logPath, "utf-8");
  return raw
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as LogEvent);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/engine/logging.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add src/engine/logging.ts tests/engine/logging.test.ts
git commit -m "feat: add JSONL structured event logging"
```

---

### Task 6: Engine Cache

**Files:**
- Create: `src/engine/cache.ts`
- Test: `tests/engine/cache.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `cacheKey(provider: string, query: string): string`, `cachePath(cacheDir: string, provider: string, query: string): string`, `readCache<T>(path: string, ttlDays: number): T | null`, `writeCache<T>(path: string, value: T): void`. Used by Task 12 (search).

- [ ] **Step 1: Write the failing test**

```ts
// tests/engine/cache.test.ts
import { describe, expect, it, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cacheKey, cachePath, readCache, writeCache } from "../../src/engine/cache.js";

let dir: string;
afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
  vi.useRealTimers();
});

describe("cacheKey", () => {
  it("is stable for the same provider and query, case-insensitively", () => {
    expect(cacheKey("arxiv", "Sample Efficient RL")).toBe(cacheKey("arxiv", "  sample efficient rl  "));
  });

  it("differs across providers for the same query", () => {
    expect(cacheKey("arxiv", "x")).not.toBe(cacheKey("semantic_scholar", "x"));
  });
});

describe("readCache / writeCache", () => {
  it("returns null when the cache file does not exist", () => {
    dir = mkdtempSync(join(tmpdir(), "cache-test-"));
    expect(readCache(join(dir, "missing.json"), 7)).toBeNull();
  });

  it("writes then reads the same value back", () => {
    dir = mkdtempSync(join(tmpdir(), "cache-test-"));
    const path = cachePath(dir, "arxiv", "query");
    writeCache(path, { hello: "world" });
    expect(readCache<{ hello: string }>(path, 7)).toEqual({ hello: "world" });
  });

  it("returns null once the entry is older than the TTL", () => {
    dir = mkdtempSync(join(tmpdir(), "cache-test-"));
    const path = cachePath(dir, "arxiv", "query");
    mkdirSync(join(dir, "arxiv"), { recursive: true });
    const stale = { cached_at: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString(), value: { hello: "world" } };
    writeFileSync(path, JSON.stringify(stale));
    expect(readCache(path, 7)).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/engine/cache.test.ts`
Expected: FAIL — `Cannot find module '../../src/engine/cache.js'`

- [ ] **Step 3: Write the implementation**

```ts
// src/engine/cache.ts
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { createHash } from "node:crypto";

export interface CacheEntry<T> {
  cached_at: string;
  value: T;
}

export function cacheKey(provider: string, query: string): string {
  const normalized = query.trim().toLowerCase();
  return createHash("sha256").update(`${provider}::${normalized}`).digest("hex");
}

export function cachePath(cacheDir: string, provider: string, query: string): string {
  return join(cacheDir, provider, `${cacheKey(provider, query)}.json`);
}

export function readCache<T>(path: string, ttlDays: number): T | null {
  if (!existsSync(path)) return null;
  const entry = JSON.parse(readFileSync(path, "utf-8")) as CacheEntry<T>;
  const ageMs = Date.now() - new Date(entry.cached_at).getTime();
  if (ageMs > ttlDays * 24 * 60 * 60 * 1000) return null;
  return entry.value;
}

export function writeCache<T>(path: string, value: T): void {
  mkdirSync(dirname(path), { recursive: true });
  const entry: CacheEntry<T> = { cached_at: new Date().toISOString(), value };
  writeFileSync(path, JSON.stringify(entry), "utf-8");
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/engine/cache.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add src/engine/cache.ts tests/engine/cache.test.ts
git commit -m "feat: add on-disk query cache with TTL expiry"
```

---

### Task 7: Engine Dedupe

**Files:**
- Create: `src/engine/dedupe.ts`
- Test: `tests/engine/dedupe.test.ts`

**Interfaces:**
- Consumes: `Paper` from `./schemas.js` (Task 2).
- Produces: `dedupePapers(papers: Paper[]): Paper[]`. Used by Task 12 (search).

- [ ] **Step 1: Write the failing test**

```ts
// tests/engine/dedupe.test.ts
import { describe, expect, it } from "vitest";
import { dedupePapers } from "../../src/engine/dedupe.js";
import type { Paper } from "../../src/engine/schemas.js";

function paper(overrides: Partial<Paper>): Paper {
  return {
    id: "id-1",
    title: "A Great Paper",
    authors: ["Ada Lovelace"],
    year: 2024,
    venue: null,
    abstract: null,
    url: null,
    doi: null,
    arxiv_id: null,
    source: "arxiv",
    source_quality: 0.5,
    retrieved_at: new Date().toISOString(),
    status: "discovered",
    relevance_note: null,
    ...overrides,
  };
}

describe("dedupePapers", () => {
  it("merges two papers with the same arxiv_id into one", () => {
    const a = paper({ id: "arxiv:1", arxiv_id: "1", source_quality: 0.5, abstract: null });
    const b = paper({ id: "s2:xyz", arxiv_id: "1", source: "semantic_scholar", source_quality: 0.7, abstract: "full abstract" });
    const result = dedupePapers([a, b]);
    expect(result).toHaveLength(1);
    expect(result[0].abstract).toBe("full abstract");
  });

  it("keeps papers with different arxiv_ids separate", () => {
    const a = paper({ id: "arxiv:1", arxiv_id: "1" });
    const b = paper({ id: "arxiv:2", arxiv_id: "2" });
    expect(dedupePapers([a, b])).toHaveLength(2);
  });

  it("merges via fuzzy title+author+year match when neither has an id", () => {
    const a = paper({ id: "hash:aaa", title: "Sample Efficient RL!", authors: ["Ada Lovelace"], year: 2024 });
    const b = paper({ id: "hash:bbb", title: "sample efficient rl", authors: ["Ada Lovelace"], year: 2024 });
    expect(dedupePapers([a, b])).toHaveLength(1);
  });

  it("keeps papers with distinct titles separate", () => {
    const a = paper({ id: "hash:aaa", title: "Paper One" });
    const b = paper({ id: "hash:bbb", title: "Paper Two" });
    expect(dedupePapers([a, b])).toHaveLength(2);
  });

  it("prefers the entry with an abstract over one without, regardless of order", () => {
    const withAbstract = paper({ id: "arxiv:1", arxiv_id: "1", abstract: "has content" });
    const without = paper({ id: "arxiv:1b", arxiv_id: "1", abstract: null });
    expect(dedupePapers([without, withAbstract])[0].abstract).toBe("has content");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/engine/dedupe.test.ts`
Expected: FAIL — `Cannot find module '../../src/engine/dedupe.js'`

- [ ] **Step 3: Write the implementation**

```ts
// src/engine/dedupe.ts
import type { Paper } from "./schemas.js";

function normalizeTitle(title: string): string {
  return title.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function fuzzyKey(p: Paper): string {
  const firstAuthor = (p.authors[0] ?? "").toLowerCase().replace(/[^a-z]/g, "");
  return `fuzzy:${normalizeTitle(p.title)}::${firstAuthor}::${p.year ?? ""}`;
}

function keyFor(p: Paper): string {
  if (p.arxiv_id) return `arxiv:${p.arxiv_id}`;
  if (p.doi) return `doi:${p.doi.toLowerCase()}`;
  return fuzzyKey(p);
}

function preferBetter(a: Paper, b: Paper): Paper {
  const score = (p: Paper) => (p.abstract ? 1 : 0) + p.source_quality;
  return score(b) > score(a) ? b : a;
}

export function dedupePapers(papers: Paper[]): Paper[] {
  const groups = new Map<string, Paper>();
  for (const paper of papers) {
    const key = keyFor(paper);
    const existing = groups.get(key);
    groups.set(key, existing ? preferBetter(existing, paper) : paper);
  }
  return Array.from(groups.values());
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/engine/dedupe.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add src/engine/dedupe.ts tests/engine/dedupe.test.ts
git commit -m "feat: add paper dedup by exact id then fuzzy title/author/year match"
```

---

### Task 8: Engine Storage

**Files:**
- Create: `src/engine/storage.ts`
- Test: `tests/engine/storage.test.ts`

**Interfaces:**
- Consumes: `ProjectStateSchema`, `ProjectState`, `ResearchSpecSchema`, `ResearchSpec`, `PaperSchema`, `Paper`, `Budget` from `./schemas.js` (Task 2); `createProjectId` from `./ids.js` (Task 3); `logEvent` from `./logging.js` (Task 5).
- Produces: `class ProjectStore` with constructor `(rootDir: string)` and methods: `createProject(problem: string, budget: Budget): ProjectState`, `getProject(id: string): ProjectState | null`, `listProjects(): ProjectSummary[]`, `mostRecentProject(): ProjectState | null`, `saveSpec(projectId: string, spec: ResearchSpec): void`, `getSpec(projectId: string): ResearchSpec | null`, `getAllPapers(projectId: string): Paper[]`, `upsertPapers(projectId: string, papers: Paper[]): Paper[]`, `getPapers(projectId: string, filter?: { ids?: string[]; status?: Paper["status"]; limit?: number }): Paper[]`, `retainPapers(projectId: string, retained: { id: string; relevance_note: string }[], maxRetained: number): number`, `incrementSearchesRun(projectId: string, count: number): number`, `saveLiteratureSummary(projectId: string, summary: string, taxonomyDimensions?: string[]): void`, `getLiteratureSummary(projectId: string): { summary: string; taxonomy_dimensions: string[] } | null`, `logFilePath(projectId: string): string`. `ProjectSummary` = `{ project_id: string; problem: string; created_at: string; status: ProjectState["status"] }`. Used by Task 12 (search) and Task 13 (mcp tools).

- [ ] **Step 1: Write the failing test**

```ts
// tests/engine/storage.test.ts
import { describe, expect, it, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ProjectStore } from "../../src/engine/storage.js";
import { DEFAULT_BUDGET } from "../../src/engine/budget.js";
import type { Paper, ResearchSpec } from "../../src/engine/schemas.js";

let dir: string;
let store: ProjectStore;
afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
});

function freshStore(): ProjectStore {
  dir = mkdtempSync(join(tmpdir(), "storage-test-"));
  return new ProjectStore(dir);
}

const spec: ResearchSpec = {
  problem: "p",
  domain: "ml",
  subdomains: [],
  research_question: "q",
  objectives: [],
  constraints: [],
  assumptions: [],
  target_setting: "",
  keywords: [],
  synonyms: [],
  related_concepts: [],
  adjacent_fields: [],
  candidate_search_terms: [],
  likely_evaluation_criteria: [],
};

function paper(id: string, overrides: Partial<Paper> = {}): Paper {
  return {
    id,
    title: `Paper ${id}`,
    authors: ["A"],
    year: 2024,
    venue: null,
    abstract: null,
    url: null,
    doi: null,
    arxiv_id: null,
    source: "arxiv",
    source_quality: 0.5,
    retrieved_at: new Date().toISOString(),
    status: "discovered",
    relevance_note: null,
    ...overrides,
  };
}

describe("ProjectStore.createProject / getProject", () => {
  it("round-trips a created project", () => {
    store = freshStore();
    const created = store.createProject("my problem", DEFAULT_BUDGET);
    const fetched = store.getProject(created.id);
    expect(fetched).toEqual(created);
    expect(created.status).toBe("created");
    expect(created.phases_completed).toEqual([]);
  });

  it("returns null for an unknown project", () => {
    store = freshStore();
    expect(store.getProject("nope")).toBeNull();
  });
});

describe("ProjectStore.saveSpec / getSpec", () => {
  it("saves a valid spec and marks problem_analysis complete", () => {
    store = freshStore();
    const project = store.createProject("p", DEFAULT_BUDGET);
    store.saveSpec(project.id, spec);
    expect(store.getSpec(project.id)).toEqual(spec);
    expect(store.getProject(project.id)!.phases_completed).toContain("problem_analysis");
    expect(store.getProject(project.id)!.status).toBe("spec_saved");
  });

  it("rejects an invalid spec", () => {
    store = freshStore();
    const project = store.createProject("p", DEFAULT_BUDGET);
    expect(() => store.saveSpec(project.id, { ...spec, problem: "" })).toThrow();
  });
});

describe("ProjectStore.upsertPapers", () => {
  it("is idempotent and preserves retained status/note on re-upsert", () => {
    store = freshStore();
    const project = store.createProject("p", DEFAULT_BUDGET);
    store.upsertPapers(project.id, [paper("a")]);
    store.retainPapers(project.id, [{ id: "a", relevance_note: "great fit" }], 20);
    store.upsertPapers(project.id, [paper("a", { title: "Updated Title" })]);

    const [result] = store.getAllPapers(project.id);
    expect(result.title).toBe("Updated Title");
    expect(result.status).toBe("retained");
    expect(result.relevance_note).toBe("great fit");
  });
});

describe("ProjectStore.getPapers", () => {
  it("filters by status, ids, and limit", () => {
    store = freshStore();
    const project = store.createProject("p", DEFAULT_BUDGET);
    store.upsertPapers(project.id, [paper("a"), paper("b"), paper("c")]);
    store.retainPapers(project.id, [{ id: "b", relevance_note: "n" }], 20);

    expect(store.getPapers(project.id, { status: "retained" }).map((p) => p.id)).toEqual(["b"]);
    expect(store.getPapers(project.id, { ids: ["a", "c"] }).map((p) => p.id).sort()).toEqual(["a", "c"]);
    expect(store.getPapers(project.id, { limit: 1 })).toHaveLength(1);
  });
});

describe("ProjectStore.retainPapers", () => {
  it("caps at maxRetained and returns only the newly-retained count", () => {
    store = freshStore();
    const project = store.createProject("p", DEFAULT_BUDGET);
    store.upsertPapers(project.id, [paper("a"), paper("b"), paper("c")]);
    const first = store.retainPapers(project.id, [{ id: "a", relevance_note: "n" }, { id: "b", relevance_note: "n" }], 2);
    expect(first).toBe(2);
    const second = store.retainPapers(project.id, [{ id: "c", relevance_note: "n" }], 2);
    expect(second).toBe(0);
  });
});

describe("ProjectStore.listProjects / mostRecentProject", () => {
  it("sorts newest first by created_at", () => {
    store = freshStore();
    const older = store.createProject("older", DEFAULT_BUDGET);
    const newer = store.createProject("newer", DEFAULT_BUDGET);

    const projectFile = (id: string) => join(dir, "projects", id, "project.json");
    const olderState = JSON.parse(readFileSync(projectFile(older.id), "utf-8"));
    const newerState = JSON.parse(readFileSync(projectFile(newer.id), "utf-8"));
    olderState.created_at = "2020-01-01T00:00:00.000Z";
    newerState.created_at = "2025-01-01T00:00:00.000Z";
    writeFileSync(projectFile(older.id), JSON.stringify(olderState));
    writeFileSync(projectFile(newer.id), JSON.stringify(newerState));

    const list = store.listProjects();
    expect(list[0].project_id).toBe(newer.id);
    expect(list[1].project_id).toBe(older.id);
    expect(store.mostRecentProject()!.id).toBe(newer.id);
  });
});

describe("ProjectStore.saveLiteratureSummary / getLiteratureSummary", () => {
  it("saves and marks literature_discovery complete", () => {
    store = freshStore();
    const project = store.createProject("p", DEFAULT_BUDGET);
    store.saveLiteratureSummary(project.id, "a short summary", ["dimension a"]);
    expect(store.getLiteratureSummary(project.id)).toEqual({ summary: "a short summary", taxonomy_dimensions: ["dimension a"] });
    expect(store.getProject(project.id)!.phases_completed).toContain("literature_discovery");
    expect(store.getProject(project.id)!.status).toBe("literature_done");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/engine/storage.test.ts`
Expected: FAIL — `Cannot find module '../../src/engine/storage.js'`

- [ ] **Step 3: Write the implementation**

```ts
// src/engine/storage.ts
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  ProjectStateSchema,
  type ProjectState,
  ResearchSpecSchema,
  type ResearchSpec,
  PaperSchema,
  type Paper,
  type Budget,
} from "./schemas.js";
import { createProjectId } from "./ids.js";
import { logEvent } from "./logging.js";

export interface ProjectSummary {
  project_id: string;
  problem: string;
  created_at: string;
  status: ProjectState["status"];
}

export class ProjectStore {
  constructor(private rootDir: string) {}

  private projectDir(id: string): string {
    return join(this.rootDir, "projects", id);
  }
  private projectFile(id: string): string {
    return join(this.projectDir(id), "project.json");
  }
  private specFile(id: string): string {
    return join(this.projectDir(id), "spec.json");
  }
  private papersFile(id: string): string {
    return join(this.projectDir(id), "papers.json");
  }
  private summaryFile(id: string): string {
    return join(this.projectDir(id), "literature_summary.json");
  }
  private logFile(id: string): string {
    return join(this.projectDir(id), "log.jsonl");
  }

  logFilePath(id: string): string {
    return this.logFile(id);
  }

  createProject(problem: string, budget: Budget): ProjectState {
    const id = createProjectId(problem);
    mkdirSync(this.projectDir(id), { recursive: true });
    const state: ProjectState = {
      id,
      problem,
      created_at: new Date().toISOString(),
      status: "created",
      phases_completed: [],
      searches_run: 0,
      budget,
    };
    writeFileSync(this.projectFile(id), JSON.stringify(state, null, 2), "utf-8");
    writeFileSync(this.papersFile(id), JSON.stringify([], null, 2), "utf-8");
    logEvent(this.logFile(id), "project_created", id, { problem });
    return state;
  }

  getProject(id: string): ProjectState | null {
    if (!existsSync(this.projectFile(id))) return null;
    return ProjectStateSchema.parse(JSON.parse(readFileSync(this.projectFile(id), "utf-8")));
  }

  private saveProject(state: ProjectState): void {
    writeFileSync(this.projectFile(state.id), JSON.stringify(state, null, 2), "utf-8");
  }

  listProjects(): ProjectSummary[] {
    const projectsDir = join(this.rootDir, "projects");
    if (!existsSync(projectsDir)) return [];
    const ids = readdirSync(projectsDir).filter((name) => existsSync(join(projectsDir, name, "project.json")));
    const summaries = ids.map((id) => {
      const state = this.getProject(id)!;
      return { project_id: state.id, problem: state.problem, created_at: state.created_at, status: state.status };
    });
    return summaries.sort((a, b) => (a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : 0));
  }

  mostRecentProject(): ProjectState | null {
    const [first] = this.listProjects();
    return first ? this.getProject(first.project_id) : null;
  }

  saveSpec(projectId: string, spec: ResearchSpec): void {
    const validated = ResearchSpecSchema.parse(spec);
    const state = this.getProject(projectId);
    if (!state) throw new Error(`Unknown project: ${projectId}`);
    writeFileSync(this.specFile(projectId), JSON.stringify(validated, null, 2), "utf-8");
    if (!state.phases_completed.includes("problem_analysis")) {
      state.phases_completed.push("problem_analysis");
    }
    state.status = "spec_saved";
    this.saveProject(state);
    logEvent(this.logFile(projectId), "spec_saved", projectId, {});
  }

  getSpec(projectId: string): ResearchSpec | null {
    if (!existsSync(this.specFile(projectId))) return null;
    return ResearchSpecSchema.parse(JSON.parse(readFileSync(this.specFile(projectId), "utf-8")));
  }

  getAllPapers(projectId: string): Paper[] {
    if (!existsSync(this.papersFile(projectId))) return [];
    const raw = JSON.parse(readFileSync(this.papersFile(projectId), "utf-8"));
    return (raw as unknown[]).map((p) => PaperSchema.parse(p));
  }

  private saveAllPapers(projectId: string, papers: Paper[]): void {
    writeFileSync(this.papersFile(projectId), JSON.stringify(papers, null, 2), "utf-8");
  }

  upsertPapers(projectId: string, papers: Paper[]): Paper[] {
    const existing = this.getAllPapers(projectId);
    const byId = new Map(existing.map((p) => [p.id, p]));
    for (const incoming of papers) {
      const prior = byId.get(incoming.id);
      byId.set(incoming.id, prior ? { ...incoming, status: prior.status, relevance_note: prior.relevance_note } : incoming);
    }
    const merged = Array.from(byId.values());
    this.saveAllPapers(projectId, merged);
    return merged;
  }

  getPapers(projectId: string, filter?: { ids?: string[]; status?: Paper["status"]; limit?: number }): Paper[] {
    let papers = this.getAllPapers(projectId);
    if (filter?.ids) papers = papers.filter((p) => filter.ids!.includes(p.id));
    if (filter?.status) papers = papers.filter((p) => p.status === filter.status);
    if (filter?.limit) papers = papers.slice(0, filter.limit);
    return papers;
  }

  retainPapers(projectId: string, retained: { id: string; relevance_note: string }[], maxRetained: number): number {
    const papers = this.getAllPapers(projectId);
    const byId = new Map(papers.map((p) => [p.id, p]));
    let alreadyRetained = papers.filter((p) => p.status === "retained").length;
    let newlyRetained = 0;
    for (const { id, relevance_note } of retained) {
      if (alreadyRetained + newlyRetained >= maxRetained) break;
      const paper = byId.get(id);
      if (!paper) continue;
      if (paper.status !== "retained") newlyRetained++;
      byId.set(id, { ...paper, status: "retained", relevance_note });
    }
    this.saveAllPapers(projectId, Array.from(byId.values()));
    logEvent(this.logFile(projectId), "papers_retained", projectId, { count: newlyRetained });
    return newlyRetained;
  }

  incrementSearchesRun(projectId: string, count: number): number {
    const state = this.getProject(projectId);
    if (!state) throw new Error(`Unknown project: ${projectId}`);
    state.searches_run += count;
    this.saveProject(state);
    return state.searches_run;
  }

  saveLiteratureSummary(projectId: string, summary: string, taxonomyDimensions?: string[]): void {
    const state = this.getProject(projectId);
    if (!state) throw new Error(`Unknown project: ${projectId}`);
    writeFileSync(
      this.summaryFile(projectId),
      JSON.stringify({ summary, taxonomy_dimensions: taxonomyDimensions ?? [] }, null, 2),
      "utf-8"
    );
    if (!state.phases_completed.includes("literature_discovery")) {
      state.phases_completed.push("literature_discovery");
    }
    state.status = "literature_done";
    this.saveProject(state);
    logEvent(this.logFile(projectId), "literature_summary_saved", projectId, {});
  }

  getLiteratureSummary(projectId: string): { summary: string; taxonomy_dimensions: string[] } | null {
    if (!existsSync(this.summaryFile(projectId))) return null;
    return JSON.parse(readFileSync(this.summaryFile(projectId), "utf-8"));
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/engine/storage.test.ts`
Expected: PASS (9 tests)

- [ ] **Step 5: Commit**

```bash
git add src/engine/storage.ts tests/engine/storage.test.ts
git commit -m "feat: add JSON-file ProjectStore"
```

---

### Task 9: Retrieval Provider Interface and HTTP Helper

**Files:**
- Create: `src/engine/retrieval/provider.ts`
- Create: `src/engine/retrieval/httpFetch.ts`
- Test: `tests/engine/retrieval/httpFetch.test.ts`

**Interfaces:**
- Consumes: `Paper` from `../schemas.js` (Task 2).
- Produces: `class ProviderError extends Error` (fields `provider: string`, `query: string`), `interface PaperSearchProvider { name: string; search(query: string, limit: number): Promise<Paper[]> }`, `fetchWithRetry(url: string, options: { timeoutMs: number; retries?: number; retryDelayMs?: number }): Promise<Response>`. Used by Task 10 (arXiv), Task 11 (Semantic Scholar).

- [ ] **Step 1: Write the failing test**

```ts
// tests/engine/retrieval/httpFetch.test.ts
import { describe, expect, it, vi, afterEach } from "vitest";
import { fetchWithRetry } from "../../../src/engine/retrieval/httpFetch.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("fetchWithRetry", () => {
  it("returns the response on first success", async () => {
    const mockFetch = vi.fn().mockResolvedValue(new Response("ok", { status: 200 }));
    vi.stubGlobal("fetch", mockFetch);
    const res = await fetchWithRetry("https://example.com", { timeoutMs: 1000 });
    expect(res.status).toBe(200);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("retries once on a 500 then succeeds", async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce(new Response("err", { status: 500 }))
      .mockResolvedValueOnce(new Response("ok", { status: 200 }));
    vi.stubGlobal("fetch", mockFetch);
    const res = await fetchWithRetry("https://example.com", { timeoutMs: 1000, retries: 1, retryDelayMs: 1 });
    expect(res.status).toBe(200);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it("throws after exhausting retries", async () => {
    const mockFetch = vi.fn().mockResolvedValue(new Response("err", { status: 500 }));
    vi.stubGlobal("fetch", mockFetch);
    await expect(fetchWithRetry("https://example.com", { timeoutMs: 1000, retries: 1, retryDelayMs: 1 })).rejects.toThrow();
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it("propagates a network-level rejection after exhausting retries", async () => {
    const mockFetch = vi.fn().mockRejectedValue(new Error("network down"));
    vi.stubGlobal("fetch", mockFetch);
    await expect(fetchWithRetry("https://example.com", { timeoutMs: 1000, retries: 0 })).rejects.toThrow("network down");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/engine/retrieval/httpFetch.test.ts`
Expected: FAIL — `Cannot find module '../../../src/engine/retrieval/httpFetch.js'`

- [ ] **Step 3: Write the implementation**

```ts
// src/engine/retrieval/provider.ts
import type { Paper } from "../schemas.js";

export class ProviderError extends Error {
  provider: string;
  query: string;
  constructor(provider: string, query: string, message: string) {
    super(message);
    this.name = "ProviderError";
    this.provider = provider;
    this.query = query;
  }
}

export interface PaperSearchProvider {
  name: string;
  search(query: string, limit: number): Promise<Paper[]>;
}
```

```ts
// src/engine/retrieval/httpFetch.ts
export interface FetchWithRetryOptions {
  timeoutMs: number;
  retries?: number;
  retryDelayMs?: number;
}

export async function fetchWithRetry(url: string, options: FetchWithRetryOptions): Promise<Response> {
  const { timeoutMs, retries = 1, retryDelayMs = 1000 } = options;
  let lastError: unknown;

  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, { signal: controller.signal });
      clearTimeout(timeout);
      if (response.status === 429 || response.status >= 500) {
        lastError = new Error(`HTTP ${response.status}`);
        if (attempt < retries) {
          await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
          continue;
        }
        throw lastError;
      }
      return response;
    } catch (err) {
      clearTimeout(timeout);
      lastError = err;
      if (attempt < retries) {
        await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
        continue;
      }
      throw err;
    }
  }
  throw lastError;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/engine/retrieval/httpFetch.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add src/engine/retrieval/provider.ts src/engine/retrieval/httpFetch.ts tests/engine/retrieval/httpFetch.test.ts
git commit -m "feat: add PaperSearchProvider interface and fetch-with-retry helper"
```

---

### Task 10: ArXiv Provider

**Files:**
- Create: `src/engine/retrieval/arxiv.ts`
- Test: `tests/engine/retrieval/arxiv.test.ts`

**Interfaces:**
- Consumes: `Paper` from `../schemas.js` (Task 2); `PaperSearchProvider`, `ProviderError` from `./provider.js`, `fetchWithRetry` from `./httpFetch.js` (Task 9).
- Produces: `parseArxivFeed(xml: string): Paper[]`, `class ArxivProvider implements PaperSearchProvider` with constructor `(minDelayMs: number, timeoutMs: number)`. Used by Task 12 (search) and Task 14 (mcp-server entrypoint).

- [ ] **Step 1: Write the failing test**

```ts
// tests/engine/retrieval/arxiv.test.ts
import { describe, expect, it, vi, afterEach } from "vitest";
import { parseArxivFeed, ArxivProvider } from "../../../src/engine/retrieval/arxiv.js";

const FIXTURE_FEED = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <entry>
    <id>http://arxiv.org/abs/2401.00001v1</id>
    <published>2024-01-01T00:00:00Z</published>
    <title>  Sample Efficient   World Models  </title>
    <summary>  We study sample efficiency   in world models.  </summary>
    <author><name>Ada Lovelace</name></author>
    <author><name>Alan Turing</name></author>
  </entry>
  <entry>
    <id>http://arxiv.org/abs/2401.00002v2</id>
    <published>2023-06-15T00:00:00Z</published>
    <title>Sparse Reward RL</title>
    <summary>A study of sparse rewards.</summary>
    <author><name>Grace Hopper</name></author>
  </entry>
</feed>`;

const EMPTY_FEED = `<?xml version="1.0" encoding="UTF-8"?><feed xmlns="http://www.w3.org/2005/Atom"></feed>`;

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("parseArxivFeed", () => {
  it("parses multiple entries with normalized whitespace", () => {
    const papers = parseArxivFeed(FIXTURE_FEED);
    expect(papers).toHaveLength(2);
    expect(papers[0].title).toBe("Sample Efficient World Models");
    expect(papers[0].abstract).toBe("We study sample efficiency in world models.");
    expect(papers[0].authors).toEqual(["Ada Lovelace", "Alan Turing"]);
    expect(papers[0].arxiv_id).toBe("2401.00001");
    expect(papers[0].id).toBe("arxiv:2401.00001");
    expect(papers[0].year).toBe(2024);
    expect(papers[0].source).toBe("arxiv");
  });

  it("returns an empty array for a feed with no entries", () => {
    expect(parseArxivFeed(EMPTY_FEED)).toEqual([]);
  });
});

describe("ArxivProvider", () => {
  it("fetches and parses successfully", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(FIXTURE_FEED, { status: 200 })));
    const provider = new ArxivProvider(0, 5000);
    const papers = await provider.search("sample efficient RL", 10);
    expect(papers).toHaveLength(2);
  });

  it("throws a ProviderError when the request ultimately fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("err", { status: 500 })));
    const provider = new ArxivProvider(0, 5000);
    await expect(provider.search("x", 10)).rejects.toMatchObject({ name: "ProviderError", provider: "arxiv" });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/engine/retrieval/arxiv.test.ts`
Expected: FAIL — `Cannot find module '../../../src/engine/retrieval/arxiv.js'`

- [ ] **Step 3: Write the implementation**

```ts
// src/engine/retrieval/arxiv.ts
import { XMLParser } from "fast-xml-parser";
import type { Paper } from "../schemas.js";
import type { PaperSearchProvider } from "./provider.js";
import { ProviderError } from "./provider.js";
import { fetchWithRetry } from "./httpFetch.js";

const ARXIV_API = "https://export.arxiv.org/api/query";

let lastCallAt = 0;

async function politeDelay(minDelayMs: number): Promise<void> {
  const elapsed = Date.now() - lastCallAt;
  if (elapsed < minDelayMs) {
    await new Promise((resolve) => setTimeout(resolve, minDelayMs - elapsed));
  }
  lastCallAt = Date.now();
}

interface ArxivAuthor {
  name: string;
}

interface ArxivEntry {
  id: string;
  title: string;
  summary: string;
  published: string;
  author?: ArxivAuthor | ArxivAuthor[];
}

export function parseArxivFeed(xml: string): Paper[] {
  const parser = new XMLParser({ ignoreAttributes: false });
  const parsed = parser.parse(xml);
  const feed = parsed.feed;
  if (!feed || !feed.entry) return [];
  const entries: ArxivEntry[] = Array.isArray(feed.entry) ? feed.entry : [feed.entry];

  return entries.map((entry) => {
    const idMatch = /abs\/([^v]+)/.exec(entry.id ?? "");
    const arxivId = idMatch ? idMatch[1] : entry.id;
    const authorsRaw = entry.author;
    const authors = Array.isArray(authorsRaw) ? authorsRaw.map((a) => a.name) : authorsRaw ? [authorsRaw.name] : [];
    const year = entry.published ? new Date(entry.published).getFullYear() : null;

    return {
      id: `arxiv:${arxivId}`,
      title: (entry.title ?? "").replace(/\s+/g, " ").trim(),
      authors,
      year,
      venue: "arXiv preprint",
      abstract: entry.summary ? entry.summary.replace(/\s+/g, " ").trim() : null,
      url: entry.id ?? null,
      doi: null,
      arxiv_id: arxivId,
      source: "arxiv" as const,
      source_quality: 0.5,
      retrieved_at: new Date().toISOString(),
      status: "discovered" as const,
      relevance_note: null,
    };
  });
}

export class ArxivProvider implements PaperSearchProvider {
  name = "arxiv";
  constructor(
    private minDelayMs: number,
    private timeoutMs: number
  ) {}

  async search(query: string, limit: number): Promise<Paper[]> {
    await politeDelay(this.minDelayMs);
    const url = `${ARXIV_API}?search_query=${encodeURIComponent(`all:${query}`)}&start=0&max_results=${limit}`;
    try {
      const response = await fetchWithRetry(url, { timeoutMs: this.timeoutMs });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const xml = await response.text();
      return parseArxivFeed(xml);
    } catch (err) {
      throw new ProviderError("arxiv", query, err instanceof Error ? err.message : String(err));
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/engine/retrieval/arxiv.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add src/engine/retrieval/arxiv.ts tests/engine/retrieval/arxiv.test.ts
git commit -m "feat: add arXiv paper search provider"
```

---

### Task 11: Semantic Scholar Provider

**Files:**
- Create: `src/engine/retrieval/semanticScholar.ts`
- Test: `tests/engine/retrieval/semanticScholar.test.ts`

**Interfaces:**
- Consumes: `Paper` from `../schemas.js` (Task 2); `PaperSearchProvider`, `ProviderError` from `./provider.js`, `fetchWithRetry` from `./httpFetch.js` (Task 9).
- Produces: `parseSemanticScholarResponse(json: { data?: S2Paper[] }): Paper[]`, `class SemanticScholarProvider implements PaperSearchProvider` with constructor `(timeoutMs: number)`. Used by Task 12 (search) and Task 14 (mcp-server entrypoint).

- [ ] **Step 1: Write the failing test**

```ts
// tests/engine/retrieval/semanticScholar.test.ts
import { describe, expect, it, vi, afterEach } from "vitest";
import { parseSemanticScholarResponse, SemanticScholarProvider } from "../../../src/engine/retrieval/semanticScholar.js";

const FIXTURE = {
  data: [
    {
      paperId: "abc123",
      title: "Sample Efficient World Models",
      abstract: "We study sample efficiency.",
      year: 2024,
      venue: "NeurIPS",
      authors: [{ name: "Ada Lovelace" }],
      externalIds: { DOI: "10.1000/xyz", ArXiv: "2401.00001" },
      url: "https://www.semanticscholar.org/paper/abc123",
    },
    {
      paperId: "def456",
      title: "Sparse Reward RL",
      abstract: null,
      year: 2023,
      venue: null,
      authors: [{ name: "Grace Hopper" }],
      url: null,
    },
  ],
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("parseSemanticScholarResponse", () => {
  it("parses papers with doi/arxiv_id and venue-based source_quality", () => {
    const papers = parseSemanticScholarResponse(FIXTURE);
    expect(papers).toHaveLength(2);
    expect(papers[0].id).toBe("s2:abc123");
    expect(papers[0].doi).toBe("10.1000/xyz");
    expect(papers[0].arxiv_id).toBe("2401.00001");
    expect(papers[0].source_quality).toBe(0.7);
    expect(papers[1].venue).toBeNull();
    expect(papers[1].source_quality).toBe(0.4);
  });

  it("returns an empty array when data is missing", () => {
    expect(parseSemanticScholarResponse({})).toEqual([]);
  });
});

describe("SemanticScholarProvider", () => {
  it("fetches and parses successfully", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify(FIXTURE), { status: 200 })));
    const provider = new SemanticScholarProvider(5000);
    const papers = await provider.search("sample efficient RL", 10);
    expect(papers).toHaveLength(2);
  });

  it("throws a ProviderError when the request ultimately fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("err", { status: 500 })));
    const provider = new SemanticScholarProvider(5000);
    await expect(provider.search("x", 10)).rejects.toMatchObject({ name: "ProviderError", provider: "semantic_scholar" });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/engine/retrieval/semanticScholar.test.ts`
Expected: FAIL — `Cannot find module '../../../src/engine/retrieval/semanticScholar.js'`

- [ ] **Step 3: Write the implementation**

```ts
// src/engine/retrieval/semanticScholar.ts
import type { Paper } from "../schemas.js";
import type { PaperSearchProvider } from "./provider.js";
import { ProviderError } from "./provider.js";
import { fetchWithRetry } from "./httpFetch.js";

const S2_API = "https://api.semanticscholar.org/graph/v1/paper/search";
const FIELDS = "title,abstract,year,venue,authors,externalIds,url";

interface S2Paper {
  paperId: string;
  title: string;
  abstract: string | null;
  year: number | null;
  venue: string | null;
  authors: { name: string }[];
  externalIds?: { DOI?: string; ArXiv?: string };
  url: string | null;
}

export function parseSemanticScholarResponse(json: { data?: S2Paper[] }): Paper[] {
  const papers = json.data ?? [];
  return papers.map((p) => ({
    id: `s2:${p.paperId}`,
    title: p.title,
    authors: (p.authors ?? []).map((a) => a.name),
    year: p.year ?? null,
    venue: p.venue || null,
    abstract: p.abstract ?? null,
    url: p.url ?? null,
    doi: p.externalIds?.DOI ?? null,
    arxiv_id: p.externalIds?.ArXiv ?? null,
    source: "semantic_scholar" as const,
    source_quality: p.venue ? 0.7 : 0.4,
    retrieved_at: new Date().toISOString(),
    status: "discovered" as const,
    relevance_note: null,
  }));
}

export class SemanticScholarProvider implements PaperSearchProvider {
  name = "semantic_scholar";
  constructor(private timeoutMs: number) {}

  async search(query: string, limit: number): Promise<Paper[]> {
    const url = `${S2_API}?query=${encodeURIComponent(query)}&limit=${limit}&fields=${FIELDS}`;
    try {
      const response = await fetchWithRetry(url, { timeoutMs: this.timeoutMs });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const json = await response.json();
      return parseSemanticScholarResponse(json);
    } catch (err) {
      throw new ProviderError("semantic_scholar", query, err instanceof Error ? err.message : String(err));
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/engine/retrieval/semanticScholar.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add src/engine/retrieval/semanticScholar.ts tests/engine/retrieval/semanticScholar.test.ts
git commit -m "feat: add Semantic Scholar paper search provider"
```

---

### Task 12: Engine Search Orchestration

**Files:**
- Create: `src/engine/search.ts`
- Test: `tests/engine/search.test.ts`

**Interfaces:**
- Consumes: `Paper`, `Budget`, `CompactPaper`, `toCompactPaper` from `./schemas.js` (Task 2); `ProjectStore` from `./storage.js` (Task 8); `PaperSearchProvider` from `./retrieval/provider.js` (Task 9); `dedupePapers` from `./dedupe.js` (Task 7); `cachePath`, `readCache`, `writeCache` from `./cache.js` (Task 6).
- Produces: `interface SearchPapersResult { queries_run: string[]; queries_truncated: number; candidates: CompactPaper[]; provider_errors: { provider: string; query: string; error: string }[] }`, `interface SearchPapersOptions { store: ProjectStore; providers: PaperSearchProvider[]; budget: Budget; cacheDir: string; projectId: string; queries: string[]; perQueryLimit?: number }`, `searchPapers(options: SearchPapersOptions): Promise<SearchPapersResult>`. Used by Task 13 (mcp tools).

- [ ] **Step 1: Write the failing test**

```ts
// tests/engine/search.test.ts
import { describe, expect, it, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { searchPapers } from "../../src/engine/search.js";
import { ProjectStore } from "../../src/engine/storage.js";
import { DEFAULT_BUDGET } from "../../src/engine/budget.js";
import type { Paper } from "../../src/engine/schemas.js";
import type { PaperSearchProvider } from "../../src/engine/retrieval/provider.js";

let dir: string;
afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
});

function setup() {
  dir = mkdtempSync(join(tmpdir(), "search-test-"));
  const store = new ProjectStore(dir);
  const cacheDir = join(dir, "cache");
  return { store, cacheDir };
}

function fakePaper(id: string, overrides: Partial<Paper> = {}): Paper {
  return {
    id,
    title: `Paper ${id}`,
    authors: ["A"],
    year: 2024,
    venue: null,
    abstract: null,
    url: null,
    doi: null,
    arxiv_id: null,
    source: "arxiv",
    source_quality: 0.5,
    retrieved_at: new Date().toISOString(),
    status: "discovered",
    relevance_note: null,
    ...overrides,
  };
}

function fakeProvider(name: string, fn: (query: string) => Promise<Paper[]>): PaperSearchProvider & { calls: string[] } {
  const calls: string[] = [];
  return {
    name,
    calls,
    search: async (query: string) => {
      calls.push(query);
      return fn(query);
    },
  };
}

describe("searchPapers", () => {
  it("runs each query against every provider and returns merged compact candidates", async () => {
    const { store, cacheDir } = setup();
    const project = store.createProject("p", DEFAULT_BUDGET);
    const providerA = fakeProvider("arxiv", async (q) => [fakePaper(`a-${q}`)]);
    const providerB = fakeProvider("semantic_scholar", async (q) => [fakePaper(`b-${q}`, { source: "semantic_scholar" })]);

    const result = await searchPapers({
      store,
      providers: [providerA, providerB],
      budget: DEFAULT_BUDGET,
      cacheDir,
      projectId: project.id,
      queries: ["q1", "q2"],
    });

    expect(result.queries_run).toEqual(["q1", "q2"]);
    expect(result.queries_truncated).toBe(0);
    expect(result.candidates).toHaveLength(4);
    expect(store.getProject(project.id)!.searches_run).toBe(2);
  });

  it("truncates queries beyond the remaining discovery-search budget", async () => {
    const { store, cacheDir } = setup();
    const budget = { ...DEFAULT_BUDGET, maxDiscoverySearchesPerProject: 1 };
    const project = store.createProject("p", budget);
    const provider = fakeProvider("arxiv", async (q) => [fakePaper(`a-${q}`)]);

    const result = await searchPapers({ store, providers: [provider], budget, cacheDir, projectId: project.id, queries: ["q1", "q2"] });

    expect(result.queries_run).toEqual(["q1"]);
    expect(result.queries_truncated).toBe(1);
  });

  it("continues with the other provider's results when one provider throws", async () => {
    const { store, cacheDir } = setup();
    const project = store.createProject("p", DEFAULT_BUDGET);
    const failing = fakeProvider("arxiv", async () => {
      throw new Error("boom");
    });
    const working = fakeProvider("semantic_scholar", async (q) => [fakePaper(`b-${q}`, { source: "semantic_scholar" })]);

    const result = await searchPapers({ store, providers: [failing, working], budget: DEFAULT_BUDGET, cacheDir, projectId: project.id, queries: ["q1"] });

    expect(result.provider_errors).toEqual([{ provider: "arxiv", query: "q1", error: "boom" }]);
    expect(result.candidates).toHaveLength(1);
  });

  it("uses the cache on a repeated query instead of calling the provider again", async () => {
    const { store, cacheDir } = setup();
    const project = store.createProject("p", DEFAULT_BUDGET);
    const provider = fakeProvider("arxiv", async (q) => [fakePaper(`a-${q}`)]);

    await searchPapers({ store, providers: [provider], budget: DEFAULT_BUDGET, cacheDir, projectId: project.id, queries: ["q1"] });
    await searchPapers({ store, providers: [provider], budget: DEFAULT_BUDGET, cacheDir, projectId: project.id, queries: ["q1"] });

    expect(provider.calls).toEqual(["q1"]);
  });

  it("dedupes the same paper returned by two providers in one call", async () => {
    const { store, cacheDir } = setup();
    const project = store.createProject("p", DEFAULT_BUDGET);
    const providerA = fakeProvider("arxiv", async () => [fakePaper("shared", { arxiv_id: "1" })]);
    const providerB = fakeProvider("semantic_scholar", async () => [fakePaper("shared-2", { arxiv_id: "1", source: "semantic_scholar" })]);

    const result = await searchPapers({ store, providers: [providerA, providerB], budget: DEFAULT_BUDGET, cacheDir, projectId: project.id, queries: ["q1"] });

    expect(result.candidates).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/engine/search.test.ts`
Expected: FAIL — `Cannot find module '../../src/engine/search.js'`

- [ ] **Step 3: Write the implementation**

```ts
// src/engine/search.ts
import type { Paper, Budget, CompactPaper } from "./schemas.js";
import { toCompactPaper } from "./schemas.js";
import type { ProjectStore } from "./storage.js";
import type { PaperSearchProvider } from "./retrieval/provider.js";
import { dedupePapers } from "./dedupe.js";
import { cachePath, readCache, writeCache } from "./cache.js";

export interface SearchPapersResult {
  queries_run: string[];
  queries_truncated: number;
  candidates: CompactPaper[];
  provider_errors: { provider: string; query: string; error: string }[];
}

export interface SearchPapersOptions {
  store: ProjectStore;
  providers: PaperSearchProvider[];
  budget: Budget;
  cacheDir: string;
  projectId: string;
  queries: string[];
  perQueryLimit?: number;
}

export async function searchPapers(options: SearchPapersOptions): Promise<SearchPapersResult> {
  const { store, providers, budget, cacheDir, projectId, queries, perQueryLimit = 10 } = options;

  const project = store.getProject(projectId);
  if (!project) throw new Error(`Unknown project: ${projectId}`);

  const remaining = Math.max(0, budget.maxDiscoverySearchesPerProject - project.searches_run);
  const queriesToRun = queries.slice(0, remaining);
  const queriesTruncated = queries.length - queriesToRun.length;

  const providerErrors: { provider: string; query: string; error: string }[] = [];
  const freshPapers: Paper[] = [];

  for (const query of queriesToRun) {
    const results = await Promise.all(
      providers.map(async (provider) => {
        const path = cachePath(cacheDir, provider.name, query);
        const cached = readCache<Paper[]>(path, budget.cacheTtlDays);
        if (cached) return cached;
        try {
          const papers = await provider.search(query, perQueryLimit);
          writeCache(path, papers);
          return papers;
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          providerErrors.push({ provider: provider.name, query, error: message });
          return [];
        }
      })
    );
    freshPapers.push(...results.flat());
  }

  if (queriesToRun.length > 0) {
    store.incrementSearchesRun(projectId, queriesToRun.length);
  }

  const existing = store.getAllPapers(projectId);
  const existingIds = new Set(existing.map((p) => p.id));
  const combined = dedupePapers([...existing, ...freshPapers]);

  const rank = (p: Paper): number => (p.status === "retained" ? 0 : existingIds.has(p.id) ? 1 : 2);
  const capped = [...combined].sort((a, b) => rank(a) - rank(b)).slice(0, budget.maxCandidatesPerProject);

  const merged = store.upsertPapers(projectId, capped);
  const newFreshIds = new Set(dedupePapers(freshPapers).map((p) => p.id));
  const candidates = merged.filter((p) => newFreshIds.has(p.id) && !existingIds.has(p.id)).map(toCompactPaper);

  return { queries_run: queriesToRun, queries_truncated: queriesTruncated, candidates, provider_errors: providerErrors };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/engine/search.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add src/engine/search.ts tests/engine/search.test.ts
git commit -m "feat: add budgeted multi-provider search orchestration"
```

---

### Task 13: MCP Tool Handlers

**Files:**
- Create: `src/mcp-server/tools.ts`
- Test: `tests/mcp-server/tools.test.ts`

**Interfaces:**
- Consumes: `ResearchSpecSchema`, `toCompactPaper` from `../engine/schemas.js`; `ProjectStore` from `../engine/storage.js`; `PaperSearchProvider` from `../engine/retrieval/provider.js`; `searchPapers` from `../engine/search.js`; `Budget` from `../engine/schemas.js`.
- Produces: `interface ToolContext { store: ProjectStore; providers: PaperSearchProvider[]; budget: Budget; cacheDir: string }` and, for each tool, a Zod input schema plus a handler function: `createProjectInput`/`createProject`, `getProjectStateInput`/`getProjectState`, `listProjectsInput`/`listProjects`, `saveProblemSpecInput`/`saveProblemSpec`, `searchPapersInput`/`searchPapersTool`, `getPapersInput`/`getPapers`, `retainPapersInput`/`retainPapers`, `saveLiteratureSummaryInput`/`saveLiteratureSummary`. Used by Task 14 (mcp-server entrypoint).

- [ ] **Step 1: Write the failing test**

```ts
// tests/mcp-server/tools.test.ts
import { describe, expect, it, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as tools from "../../src/mcp-server/tools.js";
import { ProjectStore } from "../../src/engine/storage.js";
import { DEFAULT_BUDGET } from "../../src/engine/budget.js";
import type { Paper } from "../../src/engine/schemas.js";
import type { PaperSearchProvider } from "../../src/engine/retrieval/provider.js";

let dir: string;
afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
});

function setup(): tools.ToolContext {
  dir = mkdtempSync(join(tmpdir(), "tools-test-"));
  const provider: PaperSearchProvider = {
    name: "arxiv",
    search: async (query: string): Promise<Paper[]> => [
      {
        id: `arxiv:${query}`,
        title: `Paper about ${query}`,
        authors: ["A"],
        year: 2024,
        venue: null,
        abstract: null,
        url: null,
        doi: null,
        arxiv_id: query,
        source: "arxiv",
        source_quality: 0.5,
        retrieved_at: new Date().toISOString(),
        status: "discovered",
        relevance_note: null,
      },
    ],
  };
  return { store: new ProjectStore(dir), providers: [provider], budget: DEFAULT_BUDGET, cacheDir: join(dir, "cache") };
}

const validSpec = {
  problem: "p",
  domain: "ml",
  subdomains: [],
  research_question: "q",
  objectives: [],
  constraints: [],
  assumptions: [],
  target_setting: "",
  keywords: [],
  synonyms: [],
  related_concepts: [],
  adjacent_fields: [],
  candidate_search_terms: [],
  likely_evaluation_criteria: [],
};

describe("createProject / getProjectState", () => {
  it("creates a project and reflects it in state", () => {
    const ctx = setup();
    const created = tools.createProject(ctx, { problem: "my problem" });
    const state = tools.getProjectState(ctx, { project_id: created.project_id });
    expect(state).toMatchObject({ project_id: created.project_id, problem: "my problem", status: "created", has_spec: false });
  });

  it("returns an error object when no project exists", () => {
    const ctx = setup();
    expect(tools.getProjectState(ctx, {})).toEqual({ error: "No project found." });
  });
});

describe("saveProblemSpec", () => {
  it("saves a valid spec and get_project_state reflects has_spec", () => {
    const ctx = setup();
    const created = tools.createProject(ctx, { problem: "p" });
    tools.saveProblemSpec(ctx, { project_id: created.project_id, spec: validSpec });
    expect(tools.getProjectState(ctx, { project_id: created.project_id })).toMatchObject({ has_spec: true, status: "spec_saved" });
  });
});

describe("searchPapersTool / getPapers / retainPapers", () => {
  it("runs a search and then retains a paper", async () => {
    const ctx = setup();
    const created = tools.createProject(ctx, { problem: "p" });
    const searchResult = await tools.searchPapersTool(ctx, { project_id: created.project_id, queries: ["q1"] });
    expect(searchResult.candidates.length).toBeGreaterThan(0);

    const discovered = tools.getPapers(ctx, { project_id: created.project_id, status: "discovered" });
    expect(discovered.papers.length).toBeGreaterThan(0);

    const retained = tools.retainPapers(ctx, {
      project_id: created.project_id,
      retained: [{ id: discovered.papers[0].id, relevance_note: "relevant" }],
    });
    expect(retained.retained_count).toBe(1);

    const afterRetain = tools.getPapers(ctx, { project_id: created.project_id, status: "retained" });
    expect(afterRetain.papers).toHaveLength(1);
  });
});

describe("saveLiteratureSummary", () => {
  it("saves the summary", () => {
    const ctx = setup();
    const created = tools.createProject(ctx, { problem: "p" });
    expect(tools.saveLiteratureSummary(ctx, { project_id: created.project_id, summary: "a summary" })).toEqual({ saved: true });
  });
});

describe("listProjects", () => {
  it("lists created projects", () => {
    const ctx = setup();
    tools.createProject(ctx, { problem: "first" });
    tools.createProject(ctx, { problem: "second" });
    expect(tools.listProjects(ctx, {}).projects).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/mcp-server/tools.test.ts`
Expected: FAIL — `Cannot find module '../../src/mcp-server/tools.js'`

- [ ] **Step 3: Write the implementation**

```ts
// src/mcp-server/tools.ts
import { z } from "zod";
import { ResearchSpecSchema, toCompactPaper, type Budget } from "../engine/schemas.js";
import type { ProjectStore } from "../engine/storage.js";
import type { PaperSearchProvider } from "../engine/retrieval/provider.js";
import { searchPapers } from "../engine/search.js";

export interface ToolContext {
  store: ProjectStore;
  providers: PaperSearchProvider[];
  budget: Budget;
  cacheDir: string;
}

export const createProjectInput = z.object({ problem: z.string().min(1) }).strict();
export function createProject(ctx: ToolContext, input: z.infer<typeof createProjectInput>) {
  const state = ctx.store.createProject(input.problem, ctx.budget);
  return { project_id: state.id, created_at: state.created_at };
}

export const getProjectStateInput = z.object({ project_id: z.string().optional() }).strict();
export function getProjectState(ctx: ToolContext, input: z.infer<typeof getProjectStateInput>) {
  const state = input.project_id ? ctx.store.getProject(input.project_id) : ctx.store.mostRecentProject();
  if (!state) return { error: "No project found." };
  const papers = ctx.store.getAllPapers(state.id);
  return {
    project_id: state.id,
    problem: state.problem,
    created_at: state.created_at,
    status: state.status,
    phases_completed: state.phases_completed,
    searches_run: state.searches_run,
    counts: {
      discovered: papers.length,
      retained: papers.filter((p) => p.status === "retained").length,
    },
    has_spec: ctx.store.getSpec(state.id) !== null,
  };
}

export const listProjectsInput = z.object({}).strict();
export function listProjects(ctx: ToolContext, _input: z.infer<typeof listProjectsInput>) {
  return { projects: ctx.store.listProjects() };
}

export const saveProblemSpecInput = z.object({ project_id: z.string(), spec: ResearchSpecSchema }).strict();
export function saveProblemSpec(ctx: ToolContext, input: z.infer<typeof saveProblemSpecInput>) {
  ctx.store.saveSpec(input.project_id, input.spec);
  return { saved: true };
}

export const searchPapersInput = z.object({ project_id: z.string(), queries: z.array(z.string().min(1)).min(1) }).strict();
export async function searchPapersTool(ctx: ToolContext, input: z.infer<typeof searchPapersInput>) {
  return searchPapers({
    store: ctx.store,
    providers: ctx.providers,
    budget: ctx.budget,
    cacheDir: ctx.cacheDir,
    projectId: input.project_id,
    queries: input.queries,
  });
}

export const getPapersInput = z
  .object({
    project_id: z.string(),
    ids: z.array(z.string()).optional(),
    status: z.enum(["discovered", "retained"]).optional(),
    limit: z.number().int().positive().optional(),
  })
  .strict();
export function getPapers(ctx: ToolContext, input: z.infer<typeof getPapersInput>) {
  const papers = ctx.store.getPapers(input.project_id, { ids: input.ids, status: input.status, limit: input.limit });
  return { papers: papers.map(toCompactPaper) };
}

export const retainPapersInput = z
  .object({
    project_id: z.string(),
    retained: z.array(z.object({ id: z.string(), relevance_note: z.string() })).min(1),
  })
  .strict();
export function retainPapers(ctx: ToolContext, input: z.infer<typeof retainPapersInput>) {
  const count = ctx.store.retainPapers(input.project_id, input.retained, ctx.budget.maxRetainedPapers);
  return { retained_count: count };
}

export const saveLiteratureSummaryInput = z
  .object({
    project_id: z.string(),
    summary: z.string().min(1),
    taxonomy_dimensions: z.array(z.string()).optional(),
  })
  .strict();
export function saveLiteratureSummary(ctx: ToolContext, input: z.infer<typeof saveLiteratureSummaryInput>) {
  ctx.store.saveLiteratureSummary(input.project_id, input.summary, input.taxonomy_dimensions);
  return { saved: true };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/mcp-server/tools.test.ts`
Expected: PASS (7 tests)

- [ ] **Step 5: Commit**

```bash
git add src/mcp-server/tools.ts tests/mcp-server/tools.test.ts
git commit -m "feat: add MCP tool handlers wrapping the engine"
```

---

### Task 14: MCP Server Entrypoint

**Files:**
- Create: `src/mcp-server/index.ts`
- Test: `tests/mcp-server/smoke.test.ts`

**Interfaces:**
- Consumes: everything from Task 13 (`tools.ts`); `ProjectStore` from `../engine/storage.js`; `loadBudget` from `../engine/budget.js`; `ArxivProvider` from `../engine/retrieval/arxiv.js`; `SemanticScholarProvider` from `../engine/retrieval/semanticScholar.js`; `McpServer` and `StdioServerTransport` from `@modelcontextprotocol/sdk`.
- Produces: a runnable stdio MCP server registering all 8 tools by name (`create_project`, `get_project_state`, `list_projects`, `save_problem_spec`, `search_papers`, `get_papers`, `retain_papers`, `save_literature_summary`). Used by Task 15 (`.mcp.json` points `node` at the built output of this file).

- [ ] **Step 1: Write the failing test**

```ts
// tests/mcp-server/smoke.test.ts
import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

let dir: string;
let client: Client;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "mcp-smoke-"));
  const transport = new StdioClientTransport({
    command: "npx",
    args: ["tsx", join(process.cwd(), "src/mcp-server/index.ts")],
    env: { ...process.env, RESEARCH_DATA_DIR: dir },
  });
  client = new Client({ name: "smoke-test-client", version: "0.0.0" });
  await client.connect(transport);
}, 30000);

afterAll(async () => {
  await client.close();
  if (dir) rmSync(dir, { recursive: true, force: true });
});

describe("research-server MCP smoke test", () => {
  it("lists exactly the 8 expected tools", async () => {
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name).sort();
    expect(names).toEqual(
      [
        "create_project",
        "get_papers",
        "get_project_state",
        "list_projects",
        "retain_papers",
        "save_literature_summary",
        "save_problem_spec",
        "search_papers",
      ].sort()
    );
  });

  it("can call create_project end-to-end over stdio", async () => {
    const result = await client.callTool({ name: "create_project", arguments: { problem: "smoke test problem" } });
    const content = result.content as { type: string; text: string }[];
    const parsed = JSON.parse(content[0].text);
    expect(parsed.project_id).toMatch(/^smoke-test-problem-[0-9a-f]{8}$/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/mcp-server/smoke.test.ts`
Expected: FAIL — connection error, `src/mcp-server/index.ts` does not exist yet

- [ ] **Step 3: Write the implementation**

```ts
// src/mcp-server/index.ts
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { join } from "node:path";
import { ProjectStore } from "../engine/storage.js";
import { loadBudget } from "../engine/budget.js";
import { ArxivProvider } from "../engine/retrieval/arxiv.js";
import { SemanticScholarProvider } from "../engine/retrieval/semanticScholar.js";
import * as tools from "./tools.js";

const dataDir = process.env.RESEARCH_DATA_DIR ?? "./research-data";
const budget = loadBudget(join(dataDir, "config.json"));
const store = new ProjectStore(dataDir);
const cacheDir = join(dataDir, "cache");
const providers = [new ArxivProvider(budget.arxivMinDelayMs, budget.requestTimeoutMs), new SemanticScholarProvider(budget.requestTimeoutMs)];
const ctx: tools.ToolContext = { store, providers, budget, cacheDir };

const server = new McpServer({ name: "research-server", version: "0.1.0" });

function respond(result: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(result) }], structuredContent: result as Record<string, unknown> };
}

server.registerTool(
  "create_project",
  {
    title: "Create Research Project",
    description: "Create a new research project for a problem statement, initializing its on-disk state.",
    inputSchema: tools.createProjectInput,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  },
  async (input) => respond(tools.createProject(ctx, input))
);

server.registerTool(
  "get_project_state",
  {
    title: "Get Research Project State",
    description: "Get the state of a research project, or the most recently created one if no project_id is given.",
    inputSchema: tools.getProjectStateInput,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  async (input) => respond(tools.getProjectState(ctx, input))
);

server.registerTool(
  "list_projects",
  {
    title: "List Research Projects",
    description: "List all research projects, newest first.",
    inputSchema: tools.listProjectsInput,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  async (input) => respond(tools.listProjects(ctx, input))
);

server.registerTool(
  "save_problem_spec",
  {
    title: "Save Problem Spec",
    description: "Save the structured research spec produced by problem analysis for a project.",
    inputSchema: tools.saveProblemSpecInput,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  async (input) => respond(tools.saveProblemSpec(ctx, input))
);

server.registerTool(
  "search_papers",
  {
    title: "Search Papers",
    description: "Search arXiv and Semantic Scholar for the given queries, within the project's remaining discovery-search budget, and store the retained candidates.",
    inputSchema: tools.searchPapersInput,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  },
  async (input) => respond(await tools.searchPapersTool(ctx, input))
);

server.registerTool(
  "get_papers",
  {
    title: "Get Papers",
    description: "Get stored papers for a project, optionally filtered by id list, status, or limit.",
    inputSchema: tools.getPapersInput,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  async (input) => respond(tools.getPapers(ctx, input))
);

server.registerTool(
  "retain_papers",
  {
    title: "Retain Papers",
    description: "Mark discovered papers as retained (relevant), each with a one-line relevance note.",
    inputSchema: tools.retainPapersInput,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  async (input) => respond(tools.retainPapers(ctx, input))
);

server.registerTool(
  "save_literature_summary",
  {
    title: "Save Literature Summary",
    description: "Save a short synthesis of the retained literature landscape for a project.",
    inputSchema: tools.saveLiteratureSummaryInput,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  async (input) => respond(tools.saveLiteratureSummary(ctx, input))
);

const transport = new StdioServerTransport();
await server.connect(transport);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/mcp-server/smoke.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add src/mcp-server/index.ts tests/mcp-server/smoke.test.ts
git commit -m "feat: add MCP server entrypoint registering all 8 research tools"
```

---

### Task 15: Plugin Manifest and MCP Registration

**Files:**
- Create: `.claude-plugin/plugin.json`
- Create: `.mcp.json`

**Interfaces:**
- Consumes: the built `dist/mcp-server/index.js` (from Task 14, compiled).
- Produces: a valid plugin manifest and MCP server registration that Claude Code can load with `--plugin-dir`. Used implicitly by every remaining task (agents/commands/skill live under this plugin root).

- [ ] **Step 1: Write `.claude-plugin/plugin.json`**

```bash
mkdir -p .claude-plugin
```

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

- [ ] **Step 2: Write `.mcp.json`**

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

- [ ] **Step 3: Build and verify the compiled server starts**

Run: `npm run build`
Expected: `dist/mcp-server/index.js` and the full `dist/engine/**` tree exist, no TypeScript errors.

Run (from bash, macOS/Linux-style; on Windows Git Bash this also works):
```bash
RESEARCH_DATA_DIR=./research-data timeout 3 node dist/mcp-server/index.js; test $? -eq 124
```
Expected: the process starts and blocks waiting on stdio (killed by `timeout` after 3s, exit code 124) rather than crashing immediately with a stack trace.

- [ ] **Step 4: Validate the plugin structure**

Run: `npx @anthropic-ai/claude-code plugin validate .` (or `claude plugin validate .` if the `claude` CLI is on PATH)
Expected: `✔ Validation passed` (warnings acceptable at this stage; a hard error is not).

- [ ] **Step 5: Commit**

```bash
git add .claude-plugin/plugin.json .mcp.json
git commit -m "feat: add plugin manifest and MCP server registration"
```

---

### Task 16: Research Methodology Skill

**Files:**
- Create: `skills/research-methodology/SKILL.md`
- Create: `tests/helpers/frontmatter.ts`
- Test: `tests/helpers/frontmatter.test.ts`
- Test: `tests/plugin/skill-research-methodology.test.ts`

**Interfaces:**
- Produces: `parseFrontmatter(content: string): { data: Record<string, unknown>; body: string }`. Used by Tasks 17-22 (agent/command content tests).

- [ ] **Step 1: Write the failing tests**

```ts
// tests/helpers/frontmatter.test.ts
import { describe, expect, it } from "vitest";
import { parseFrontmatter } from "./frontmatter.js";

describe("parseFrontmatter", () => {
  it("parses YAML frontmatter and separates it from the body", () => {
    const content = "---\nname: example\ndescription: does a thing\n---\nBody text here.\n";
    const { data, body } = parseFrontmatter(content);
    expect(data).toEqual({ name: "example", description: "does a thing" });
    expect(body.trim()).toBe("Body text here.");
  });

  it("returns empty data and the full content when there is no frontmatter", () => {
    const { data, body } = parseFrontmatter("Just a body, no frontmatter.");
    expect(data).toEqual({});
    expect(body).toBe("Just a body, no frontmatter.");
  });
});
```

```ts
// tests/plugin/skill-research-methodology.test.ts
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { parseFrontmatter } from "../helpers/frontmatter.js";

const content = readFileSync("skills/research-methodology/SKILL.md", "utf-8");
const { data, body } = parseFrontmatter(content);

describe("skills/research-methodology/SKILL.md", () => {
  it("has the expected frontmatter", () => {
    expect(data.name).toBe("research-methodology");
    expect(typeof data.description).toBe("string");
    expect((data.description as string).length).toBeGreaterThan(0);
    expect(data["user-invocable"]).toBe(false);
  });

  it("documents the novelty vocabulary and current phase boundaries", () => {
    expect(body).toMatch(/Genuine research opportunity/);
    expect(body).toMatch(/Saturated/);
    expect(body).toMatch(/not implemented/);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/helpers/frontmatter.test.ts tests/plugin/skill-research-methodology.test.ts`
Expected: FAIL — `tests/helpers/frontmatter.ts` and `skills/research-methodology/SKILL.md` don't exist yet

- [ ] **Step 3: Write `tests/helpers/frontmatter.ts`**

```ts
// tests/helpers/frontmatter.ts
import { load } from "js-yaml";

export function parseFrontmatter(content: string): { data: Record<string, unknown>; body: string } {
  const match = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(content);
  if (!match) return { data: {}, body: content };
  const data = (load(match[1]) as Record<string, unknown>) ?? {};
  return { data, body: match[2] };
}
```

- [ ] **Step 4: Write `skills/research-methodology/SKILL.md`**

```bash
mkdir -p skills/research-methodology
```

```markdown
---
name: research-methodology
description: Core operating principles for the research-agent pipeline — evidence discipline, budget discipline, the novelty/saturation vocabulary, and current phase boundaries.
user-invocable: false
---

# Research Methodology

## Evidence discipline

Never claim an idea or gap is novel because a search returned nothing. Absence of a hit is absence of evidence, not evidence of absence — search coverage is always partial. Every claim about the literature must trace to a specific retained paper (id, title, year). If you cannot point to evidence, say so explicitly rather than asserting confidence.

## Novelty vocabulary

When describing how an idea relates to existing work, use these distinctions and never blur them:

- **Novel** — no close prior work found after a real search; still a confidence judgment, not a guarantee.
- **Novel but weak** — new but unlikely to matter scientifically.
- **Novel but impractical** — new but not feasible to execute or evaluate.
- **Interesting but saturated** — the space is already crowded with competing work.
- **Useful engineering improvement** — real value, but incremental rather than a research contribution.
- **Genuine research opportunity** — insufficiently explored, scientifically meaningful, technically plausible, and testable.

Never say an idea is "definitely novel."

## Budget discipline

Every search, retrieval, and analysis step draws from a fixed budget (see the project's `budget` record). Respect truncation signals from tools (e.g. `queries_truncated`) instead of working around them — a capped budget is a deliberate constraint, not a bug to route around.

## Current phase boundaries

This build implements only problem analysis and literature discovery. Gap hunting, idea generation, adversarial novelty auditing, saturation detection, idea mutation, experiment design, and reviewer simulation are not implemented yet. Never simulate or fabricate output for a stage that hasn't run — say plainly that it is not available in this build and point to the phase that will add it.
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run tests/helpers/frontmatter.test.ts tests/plugin/skill-research-methodology.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 6: Commit**

```bash
git add tests/helpers/frontmatter.ts skills/research-methodology/SKILL.md tests/helpers/frontmatter.test.ts tests/plugin/skill-research-methodology.test.ts
git commit -m "feat: add research-methodology skill and frontmatter test helper"
```

---

### Task 17: Agent — research-orchestrator

**Files:**
- Create: `agents/research-orchestrator.md`
- Test: `tests/plugin/agent-research-orchestrator.test.ts`

**Interfaces:**
- Consumes: `parseFrontmatter` from `../helpers/frontmatter.js` (Task 16).
- Produces: the orchestrator agent definition. Referenced by name (`research-orchestrator`) from Task 20's `/research` command frontmatter.

- [ ] **Step 1: Write the failing test**

```ts
// tests/plugin/agent-research-orchestrator.test.ts
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { parseFrontmatter } from "../helpers/frontmatter.js";

const content = readFileSync("agents/research-orchestrator.md", "utf-8");
const { data, body } = parseFrontmatter(content);

describe("agents/research-orchestrator.md", () => {
  it("has the expected frontmatter", () => {
    expect(data.name).toBe("research-orchestrator");
    expect(data.skills).toBe("research-methodology");
    expect(data.maxTurns).toBe(40);
  });

  it("instructs creating a project and delegating to both sub-agents", () => {
    expect(body).toMatch(/create_project/);
    expect(body).toMatch(/problem-analyzer/);
    expect(body).toMatch(/literature-scout/);
  });

  it("instructs verifying results before reporting success", () => {
    expect(body).toMatch(/has_spec/);
    expect(body).toMatch(/counts\.retained/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/plugin/agent-research-orchestrator.test.ts`
Expected: FAIL — `agents/research-orchestrator.md` does not exist

- [ ] **Step 3: Write `agents/research-orchestrator.md`**

```markdown
---
name: research-orchestrator
description: Runs the Phase 1 research pipeline end-to-end for a problem statement — creates the project, delegates problem analysis and literature discovery, verifies results, and reports progress. Invoked only via /research.
skills: research-methodology
maxTurns: 40
---

You are the research orchestrator. You run the Phase 1 pipeline for one research problem statement and you do not blindly trust what other agents report back to you.

## Steps

1. Call the `create_project` tool with the raw problem statement. Record the returned `project_id`.
2. Delegate to the `problem-analyzer` subagent. Give it the problem statement and the `project_id`, and tell it to call `save_problem_spec` when done. When it returns, call `get_project_state` and verify `has_spec` is true. If it is not, treat this as a failure: report it to the user plainly and stop rather than continuing with a missing spec.
3. Delegate to the `literature-scout` subagent. Give it the `project_id`. When it returns, call `get_project_state` and check `counts.retained`. If it is zero, do not describe the search as a success — report exactly what happened (which queries ran, which providers failed) and say the literature base is empty.
4. Print a compact progress checklist as you go, in this style:

```
Researching: <problem, one line>

✓ Project created (<project_id>)
✓ Problem analyzed (domain: <domain>)
✓ Literature discovered (<n> retained of <m> discovered)
```

5. Close by telling the user to run `/literature` for the retained papers or `/report` for the current report, and that gap hunting, idea generation, novelty auditing, and experiment design are not implemented in this build.

Never claim a stage succeeded when its verification step (`has_spec`, `counts.retained`) failed. Never generate gaps, ideas, novelty verdicts, or experiments yourself — those stages don't exist yet in this build.
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/plugin/agent-research-orchestrator.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add agents/research-orchestrator.md tests/plugin/agent-research-orchestrator.test.ts
git commit -m "feat: add research-orchestrator agent"
```

---

### Task 18: Agent — problem-analyzer

**Files:**
- Create: `agents/problem-analyzer.md`
- Test: `tests/plugin/agent-problem-analyzer.test.ts`

**Interfaces:**
- Consumes: `parseFrontmatter` from `../helpers/frontmatter.js` (Task 16).
- Produces: the problem-analyzer agent definition. Referenced by name from `agents/research-orchestrator.md` (Task 17).

- [ ] **Step 1: Write the failing test**

```ts
// tests/plugin/agent-problem-analyzer.test.ts
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { parseFrontmatter } from "../helpers/frontmatter.js";

const content = readFileSync("agents/problem-analyzer.md", "utf-8");
const { data, body } = parseFrontmatter(content);

describe("agents/problem-analyzer.md", () => {
  it("has the expected frontmatter", () => {
    expect(data.name).toBe("problem-analyzer");
    expect(data.maxTurns).toBe(8);
  });

  it("lists every ResearchSpec field and instructs saving it", () => {
    for (const field of [
      "domain",
      "subdomains",
      "research_question",
      "objectives",
      "constraints",
      "assumptions",
      "target_setting",
      "keywords",
      "synonyms",
      "related_concepts",
      "adjacent_fields",
      "candidate_search_terms",
      "likely_evaluation_criteria",
    ]) {
      expect(body).toMatch(new RegExp(field));
    }
    expect(body).toMatch(/save_problem_spec/);
  });

  it("instructs deriving terminology from the problem rather than hardcoding a domain", () => {
    expect(body).toMatch(/hardcode/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/plugin/agent-problem-analyzer.test.ts`
Expected: FAIL — `agents/problem-analyzer.md` does not exist

- [ ] **Step 3: Write `agents/problem-analyzer.md`**

```markdown
---
name: problem-analyzer
description: Turns a raw research problem statement into a structured ResearchSpec (domain, keywords, synonyms, related concepts, adjacent fields, objectives, assumptions). Used internally by research-orchestrator.
maxTurns: 8
---

You are the problem analyzer. You receive a raw research problem statement and a `project_id`. Your only job is to produce a structured spec and save it.

Extract every one of these fields, grounded in the actual problem text — never hardcode terminology from any one field (ML, biology, systems, HCI, etc.); derive everything from what's actually in front of you:

- `problem`: the problem statement, verbatim or lightly cleaned up.
- `domain`: the primary research field.
- `subdomains`: more specific areas within the domain.
- `research_question`: the core question as a single sentence.
- `objectives`: what a solution would need to achieve.
- `constraints`: limits implied or stated (compute, data, deployment, theory, etc.).
- `assumptions`: things the problem statement takes for granted.
- `target_setting`: the concrete setting/context the problem lives in.
- `keywords`: the core technical terms.
- `synonyms`: alternate terms researchers might use for the same ideas.
- `related_concepts`: concepts that show up in work adjacent to this problem.
- `adjacent_fields`: other fields likely to have relevant work.
- `candidate_search_terms`: terms you'd actually search a paper database with.
- `likely_evaluation_criteria`: how work in this space is typically judged.

When information is missing from the problem statement, make an explicit, stated assumption rather than blocking — note it in `assumptions`.

When you're done, call `save_problem_spec` with `project_id` and the full spec object. Report back to the orchestrator only a short confirmation plus the `domain` and `research_question` you extracted.
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/plugin/agent-problem-analyzer.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add agents/problem-analyzer.md tests/plugin/agent-problem-analyzer.test.ts
git commit -m "feat: add problem-analyzer agent"
```

---

### Task 19: Agent — literature-scout

**Files:**
- Create: `agents/literature-scout.md`
- Test: `tests/plugin/agent-literature-scout.test.ts`

**Interfaces:**
- Consumes: `parseFrontmatter` from `../helpers/frontmatter.js` (Task 16).
- Produces: the literature-scout agent definition. Referenced by name from `agents/research-orchestrator.md` (Task 17).

- [ ] **Step 1: Write the failing test**

```ts
// tests/plugin/agent-literature-scout.test.ts
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { parseFrontmatter } from "../helpers/frontmatter.js";

const content = readFileSync("agents/literature-scout.md", "utf-8");
const { data, body } = parseFrontmatter(content);

describe("agents/literature-scout.md", () => {
  it("has the expected frontmatter", () => {
    expect(data.name).toBe("literature-scout");
    expect(data.maxTurns).toBe(20);
  });

  it("instructs the full search-retain-summarize flow", () => {
    expect(body).toMatch(/search_papers/);
    expect(body).toMatch(/retain_papers/);
    expect(body).toMatch(/save_literature_summary/);
  });

  it("instructs honest reporting on truncation and provider failures", () => {
    expect(body).toMatch(/queries_truncated/);
    expect(body).toMatch(/provider_errors/);
    expect(body).toMatch(/[Dd]o not invent papers/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/plugin/agent-literature-scout.test.ts`
Expected: FAIL — `agents/literature-scout.md` does not exist

- [ ] **Step 3: Write `agents/literature-scout.md`**

```markdown
---
name: literature-scout
description: Expands a ResearchSpec into search-query families and discovers/retains relevant literature from arXiv and Semantic Scholar within budget. Used internally by research-orchestrator.
maxTurns: 20
---

You are the literature scout. You receive a `project_id` whose spec has already been saved.

## Steps

1. Call `get_project_state` for the `project_id` to see the current search/retention counts, and read the spec you were given to get the domain, keywords, synonyms, related concepts, and adjacent fields.
2. Draft a bounded list of search queries across different families — the exact problem phrasing, synonym variants, method/mechanism terms, and adjacent-field terms. Don't just repeat the same query with minor wording changes; each query should probe a genuinely different angle. Keep the list short enough to respect the project's discovery-search budget (check `get_project_state` for `searches_run`; when in doubt, draft fewer, sharper queries rather than many redundant ones).
3. Call `search_papers` with `project_id` and your query list. Read `queries_truncated` and `provider_errors` in the response — if either is non-zero, factor that into your final report rather than ignoring it.
4. From the returned candidates, judge relevance against the spec's research question and objectives — not just keyword overlap. Call `retain_papers` with the ids you judge relevant and a one-line `relevance_note` for each explaining why.
5. Write a short (3-6 sentence) synthesis of what the retained literature covers and call `save_literature_summary` with it.
6. Report back to the orchestrator: how many queries ran, how many papers were retained, and any provider failures — plainly, without inflating a sparse result into a success.

If both providers fail for every query, say so directly. Do not invent papers.
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/plugin/agent-literature-scout.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add agents/literature-scout.md tests/plugin/agent-literature-scout.test.ts
git commit -m "feat: add literature-scout agent"
```

---

### Task 20: Command — /research

**Files:**
- Create: `commands/research.md`
- Test: `tests/plugin/command-research.test.ts`

**Interfaces:**
- Consumes: `parseFrontmatter` from `../helpers/frontmatter.js` (Task 16); the `research-orchestrator` agent name (Task 17).
- Produces: the `/research` command. Terminal entry point for the pipeline.

- [ ] **Step 1: Write the failing test**

```ts
// tests/plugin/command-research.test.ts
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { parseFrontmatter } from "../helpers/frontmatter.js";

const content = readFileSync("commands/research.md", "utf-8");
const { data, body } = parseFrontmatter(content);

describe("commands/research.md", () => {
  it("forks directly into research-orchestrator, blocking, user-invoked only", () => {
    expect(data.context).toBe("fork");
    expect(data.agent).toBe("research-orchestrator");
    expect(data.background).toBe(false);
    expect(data["disable-model-invocation"]).toBe(true);
    expect(typeof data["argument-hint"]).toBe("string");
  });

  it("passes the problem statement through $ARGUMENTS", () => {
    expect(body).toMatch(/\$ARGUMENTS/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/plugin/command-research.test.ts`
Expected: FAIL — `commands/research.md` does not exist

- [ ] **Step 3: Write `commands/research.md`**

```markdown
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

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/plugin/command-research.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add commands/research.md tests/plugin/command-research.test.ts
git commit -m "feat: add /research command"
```

---

### Task 21: Command — /literature

**Files:**
- Create: `commands/literature.md`
- Test: `tests/plugin/command-literature.test.ts`

**Interfaces:**
- Consumes: `parseFrontmatter` from `../helpers/frontmatter.js` (Task 16).
- Produces: the `/literature` command.

- [ ] **Step 1: Write the failing test**

```ts
// tests/plugin/command-literature.test.ts
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { parseFrontmatter } from "../helpers/frontmatter.js";

const content = readFileSync("commands/literature.md", "utf-8");
const { data, body } = parseFrontmatter(content);

describe("commands/literature.md", () => {
  it("is user-invoked only, runs inline (no fork)", () => {
    expect(data["disable-model-invocation"]).toBe(true);
    expect(data.context).toBeUndefined();
  });

  it("instructs resolving the project and listing retained papers", () => {
    expect(body).toMatch(/get_project_state/);
    expect(body).toMatch(/get_papers/);
    expect(body).toMatch(/retained/);
    expect(body).toMatch(/\$ARGUMENTS/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/plugin/command-literature.test.ts`
Expected: FAIL — `commands/literature.md` does not exist

- [ ] **Step 3: Write `commands/literature.md`**

```markdown
---
description: Show the accumulated literature landscape for the current or specified research project.
argument-hint: [project-id]
disable-model-invocation: true
---
Resolve the research project: if an argument was given below, treat it as a `project_id` and call `get_project_state` with it; otherwise call `get_project_state` with no `project_id` to get the most recent project. If no project exists, say so and stop.

Then call `get_papers` for that project with `status: "retained"`, and read the saved literature summary if one exists.

Present the result as:

1. The problem statement and domain.
2. The literature summary paragraph, if saved.
3. Each retained paper as a bulleted line: title, authors, year, venue, url, and its relevance note.

If no papers have been retained yet, say so plainly instead of presenting an empty section as if it were complete.

Project id argument (optional): $ARGUMENTS
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/plugin/command-literature.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add commands/literature.md tests/plugin/command-literature.test.ts
git commit -m "feat: add /literature command"
```

---

### Task 22: Command — /report

**Files:**
- Create: `commands/report.md`
- Test: `tests/plugin/command-report.test.ts`

**Interfaces:**
- Consumes: `parseFrontmatter` from `../helpers/frontmatter.js` (Task 16).
- Produces: the `/report` command.

- [ ] **Step 1: Write the failing test**

```ts
// tests/plugin/command-report.test.ts
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { parseFrontmatter } from "../helpers/frontmatter.js";

const content = readFileSync("commands/report.md", "utf-8");
const { data, body } = parseFrontmatter(content);

describe("commands/report.md", () => {
  it("is user-invoked only, runs inline (no fork)", () => {
    expect(data["disable-model-invocation"]).toBe(true);
    expect(data.context).toBeUndefined();
  });

  it("covers the implemented report sections", () => {
    for (const section of ["Executive Summary", "Problem Interpretation", "Assumptions", "Research Landscape", "References"]) {
      expect(body).toContain(section);
    }
  });

  it("explicitly marks unimplemented sections rather than fabricating them", () => {
    expect(body).toMatch(/Not Yet Available/);
    expect(body).toMatch(/Candidate Research Ideas/);
    expect(body).toMatch(/never fabricate/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/plugin/command-report.test.ts`
Expected: FAIL — `commands/report.md` does not exist

- [ ] **Step 3: Write `commands/report.md`**

```markdown
---
description: Generate the research report for the current or specified project from whatever pipeline stages have completed.
argument-hint: [project-id]
disable-model-invocation: true
---
Resolve the research project the same way `/literature` does, using this optional project id argument: $ARGUMENTS. If no project exists, say so and stop.

Gather the project's state, spec, and retained papers via the `get_project_state` and `get_papers` tools, and the literature summary if saved.

Produce a report with these sections, in order:

1. **Executive Summary** — 2-4 sentences on the problem and what's been found so far.
2. **Problem Interpretation** — the research question, domain, and objectives from the spec.
3. **Assumptions** — the assumptions list from the spec.
4. **Research Landscape** — the literature summary plus the retained papers list (title, authors, year, venue, url).
5. **References** — every retained paper as a numbered citation with id, title, year, venue, and url; mark any paper missing a url or doi as unverified rather than omitting it silently.

After References, add a final section titled **Not Yet Available** listing, verbatim: Major Research Gaps, Candidate Research Ideas, Saturated/Rejected Directions, Mutated Directions, Ranked Research Opportunities, Minimal Validation Experiment, Full Experimental Roadmap, Potential Reviewer Objections — each with the note "requires a later implementation phase, not present in this build." Never fabricate content for these sections.
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/plugin/command-report.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add commands/report.md tests/plugin/command-report.test.ts
git commit -m "feat: add /report command"
```

---

### Task 23: README

**Files:**
- Create: `README.md`
- Test: `tests/plugin/readme.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: top-level documentation for install, configuration, commands, architecture, example run, and limitations.

- [ ] **Step 1: Write the failing test**

```ts
// tests/plugin/readme.test.ts
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const readme = readFileSync("README.md", "utf-8");

describe("README.md", () => {
  it("documents installation, configuration, commands, architecture, and limitations", () => {
    for (const heading of ["## Installation", "## Configuration", "## Commands", "## Architecture", "## Example Run", "## Limitations"]) {
      expect(readme).toContain(heading);
    }
  });

  it("documents --plugin-dir as the local dev install path", () => {
    expect(readme).toMatch(/--plugin-dir/);
  });

  it("names /research, /literature, and /report, and flags the not-yet-implemented commands", () => {
    expect(readme).toMatch(/\/research/);
    expect(readme).toMatch(/\/literature/);
    expect(readme).toMatch(/\/report/);
    expect(readme).toMatch(/\/gaps/);
    expect(readme).toMatch(/\/ideas/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/plugin/readme.test.ts`
Expected: FAIL — `README.md` does not exist

- [ ] **Step 3: Write `README.md`**

```markdown
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/plugin/readme.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add README.md tests/plugin/readme.test.ts
git commit -m "docs: add README covering install, config, commands, architecture, limitations"
```

---

### Task 24: Full Verification Pass

**Files:** none created; this task only runs and confirms.

**Interfaces:** none — this is the project-wide gate before the plan is considered done.

- [ ] **Step 1: Clean install and build**

Run: `rm -rf node_modules dist && npm install && npm run build`
Expected: no errors; `dist/mcp-server/index.js` and `dist/engine/**` exist.

- [ ] **Step 2: Run the full test suite**

Run: `npm test`
Expected: every test file from Tasks 2-23 passes (schemas, ids, budget, logging, cache, dedupe, storage, httpFetch, arxiv, semanticScholar, search, mcp-server/tools, mcp-server/smoke, helpers/frontmatter, plugin/skill+agents+commands+readme). Zero failures.

- [ ] **Step 3: Validate the plugin manifest**

Run: `claude plugin validate .`
Expected: `✔ Validation passed` (or "with warnings" — no hard failure).

- [ ] **Step 4: Confirm working tree is clean**

Run: `git status`
Expected: nothing to commit, working tree clean (every prior task already committed its own files).

- [ ] **Step 5: Manual smoke test (not automatable here — run once, by hand)**

```bash
claude --plugin-dir "$(pwd)"
```
Inside the session: run `/research <a real problem statement>` and confirm it produces the progress checklist and a non-empty literature result (or an honest empty/failure report if the network is unavailable); then run `/literature` and `/report` and confirm they read back the same project without re-running searches. This step has no automated assertion — it's the live confirmation that the spec's own Phase 1 exit criterion ("verify `/research <problem>` can execute successfully") is met.

No commit for this task — it only verifies work already committed in Tasks 1-23.
