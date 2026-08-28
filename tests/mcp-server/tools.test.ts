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

describe("saveLiteratureSummary / getLiteratureSummary", () => {
  it("saves the summary", () => {
    const ctx = setup();
    const created = tools.createProject(ctx, { problem: "p" });
    expect(tools.saveLiteratureSummary(ctx, { project_id: created.project_id, summary: "a summary" })).toEqual({ saved: true });
  });

  it("reads back a saved summary", () => {
    const ctx = setup();
    const created = tools.createProject(ctx, { problem: "p" });
    tools.saveLiteratureSummary(ctx, { project_id: created.project_id, summary: "a summary", taxonomy_dimensions: ["dim"] });
    expect(tools.getLiteratureSummary(ctx, { project_id: created.project_id })).toEqual({
      summary: "a summary",
      taxonomy_dimensions: ["dim"],
    });
  });

  it("returns an error object when no summary has been saved", () => {
    const ctx = setup();
    const created = tools.createProject(ctx, { problem: "p" });
    expect(tools.getLiteratureSummary(ctx, { project_id: created.project_id })).toEqual({ error: "No literature summary saved." });
  });
});

describe("saveProblemSpec / getProblemSpec", () => {
  it("reads back a saved spec", () => {
    const ctx = setup();
    const created = tools.createProject(ctx, { problem: "p" });
    tools.saveProblemSpec(ctx, { project_id: created.project_id, spec: validSpec });
    expect(tools.getProblemSpec(ctx, { project_id: created.project_id })).toEqual(validSpec);
  });

  it("returns an error object when no spec has been saved", () => {
    const ctx = setup();
    const created = tools.createProject(ctx, { problem: "p" });
    expect(tools.getProblemSpec(ctx, { project_id: created.project_id })).toEqual({ error: "No problem spec saved." });
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
