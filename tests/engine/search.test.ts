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
