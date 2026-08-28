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

describe("saveGaps / getGaps", () => {
  it("saves gaps and reads them back", () => {
    const ctx = setup();
    const created = tools.createProject(ctx, { problem: "p" });
    const result = tools.saveGaps(ctx, {
      project_id: created.project_id,
      gaps: [
        {
          title: "Gap A",
          category: "efficiency gap",
          description: "d",
          evidence_paper_ids: ["a"],
          what_has_been_attempted: "x",
          what_remains_unresolved: "y",
          why_it_matters: "z",
          why_it_is_difficult: "w",
          potential_opportunity: "o",
          confidence: "medium",
        },
      ],
    });
    expect(result.saved_count).toBe(1);
    expect(result.capped).toBe(0);
    expect(tools.getGaps(ctx, { project_id: created.project_id }).gaps).toHaveLength(1);
  });
});

describe("getProjectState Phase 2 fields", () => {
  it("reports gap/idea counts, searches_remaining, and budgets", () => {
    const ctx = setup();
    const created = tools.createProject(ctx, { problem: "p" });
    const state = tools.getProjectState(ctx, { project_id: created.project_id }) as Record<string, unknown>;
    expect(state.counts).toMatchObject({ gaps: 0, ideas_generated: 0, ideas_audited: 0 });
    expect(state.searches_remaining).toBe(DEFAULT_BUDGET.maxDiscoverySearchesPerProject);
    expect(state.budgets).toEqual({
      maxGaps: DEFAULT_BUDGET.maxGaps,
      maxRawIdeas: DEFAULT_BUDGET.maxRawIdeas,
      maxIdeasAudited: DEFAULT_BUDGET.maxIdeasAudited,
    });
  });
});

const validNewIdea = {
  gap_id: null,
  strategy: "REMOVE_ASSUMPTION",
  research_question: "q",
  hypothesis: "h",
  motivation: "m",
  mechanism: "mech",
  expected_contribution: "c",
  closest_prior_work: [],
  why_not_solved: "n",
  why_now: "now",
};

describe("saveIdea / getIdeas / filterIdeas", () => {
  it("saves an idea, lists it, then filters it out", () => {
    const ctx = setup();
    const created = tools.createProject(ctx, { problem: "p" });
    const saved = tools.saveIdea(ctx, { project_id: created.project_id, idea: validNewIdea });
    expect(saved.saved).toBe(true);
    expect(saved.idea!.id).toBe("idea-001");

    expect(tools.getIdeas(ctx, { project_id: created.project_id }).ideas).toHaveLength(1);

    const filtered = tools.filterIdeas(ctx, { project_id: created.project_id, drop_ids: [saved.idea!.id] });
    expect(filtered.filtered_count).toBe(1);
    expect(tools.getIdeas(ctx, { project_id: created.project_id, status: "filtered_out" }).ideas).toHaveLength(1);
  });

  it("reports budget exhaustion instead of throwing", () => {
    const ctx = setup();
    ctx.budget = { ...ctx.budget, maxRawIdeas: 1 };
    const created = tools.createProject(ctx, { problem: "p" });
    tools.saveIdea(ctx, { project_id: created.project_id, idea: validNewIdea });
    const second = tools.saveIdea(ctx, { project_id: created.project_id, idea: validNewIdea });
    expect(second).toEqual({ saved: false, reason: "maxRawIdeas budget exhausted" });
  });
});

describe("updateIdeaNovelty / updateIdeaSaturation", () => {
  it("updates novelty then saturation, flipping status to audited", () => {
    const ctx = setup();
    const created = tools.createProject(ctx, { problem: "p" });
    const saved = tools.saveIdea(ctx, { project_id: created.project_id, idea: validNewIdea });
    const ideaId = saved.idea!.id;

    const afterNovelty = tools.updateIdeaNovelty(ctx, {
      project_id: created.project_id,
      idea_id: ideaId,
      novelty_verdict: "PASS",
      novelty_evidence: "No close prior work.",
      novelty_confidence: "high",
    });
    expect(afterNovelty.idea.novelty_verdict).toBe("PASS");

    const afterSaturation = tools.updateIdeaSaturation(ctx, {
      project_id: created.project_id,
      idea_id: ideaId,
      saturation: "UNEXPLORED",
      saturation_evidence: "No matching papers.",
    });
    expect(afterSaturation.idea.status).toBe("audited");
  });
});

describe("saveIdeaSearchEvidence / getIdeaSearchEvidence", () => {
  it("round-trips evidence", () => {
    const ctx = setup();
    const created = tools.createProject(ctx, { problem: "p" });
    tools.saveIdeaSearchEvidence(ctx, {
      project_id: created.project_id,
      idea_id: "idea-001",
      queries: ["q1"],
      papers: [{ id: "arxiv:1", title: "T", year: 2024 }],
      notes: "n",
    });
    expect(tools.getIdeaSearchEvidence(ctx, { project_id: created.project_id, idea_id: "idea-001" })).toEqual({
      idea_id: "idea-001",
      queries: ["q1"],
      papers: [{ id: "arxiv:1", title: "T", year: 2024 }],
      notes: "n",
    });
  });

  it("returns an error object when no evidence has been saved", () => {
    const ctx = setup();
    const created = tools.createProject(ctx, { problem: "p" });
    expect(tools.getIdeaSearchEvidence(ctx, { project_id: created.project_id, idea_id: "idea-999" })).toEqual({
      error: "No search evidence saved for this idea.",
    });
  });
});

function baseIdeaInput() {
  return {
    gap_id: null,
    strategy: "REMOVE_ASSUMPTION",
    research_question: "q",
    hypothesis: "h",
    motivation: "m",
    mechanism: "mech",
    expected_contribution: "c",
    closest_prior_work: [],
    why_not_solved: "w",
    why_now: "n",
  };
}

describe("rejectIdeaToGraveyard / createIdeaMutation", () => {
  it("rejects a fully-audited idea and creates a mutation for it", () => {
    const ctx = setup();
    const created = tools.createProject(ctx, { problem: "p" });
    const saved = tools.saveIdea(ctx, { project_id: created.project_id, idea: baseIdeaInput() });
    if (!saved.saved) throw new Error("expected saved");
    tools.updateIdeaNovelty(ctx, {
      project_id: created.project_id,
      idea_id: saved.idea.id,
      novelty_verdict: "FAIL",
      novelty_evidence: "already done",
      novelty_confidence: "high",
    });
    tools.updateIdeaSaturation(ctx, {
      project_id: created.project_id,
      idea_id: saved.idea.id,
      saturation: "SATURATED",
      saturation_evidence: "many variants",
    });

    const rejected = tools.rejectIdeaToGraveyard(ctx, {
      project_id: created.project_id,
      idea_id: saved.idea.id,
      reason_rejected: "novelty FAIL",
    });
    expect(rejected.idea_id).toBe(saved.idea.id);

    const mutation = tools.createIdeaMutationTool(ctx, {
      project_id: created.project_id,
      parent_idea_id: saved.idea.id,
      operator: "CHANGE_TASK",
      idea: baseIdeaInput(),
    });
    expect(mutation.saved).toBe(true);
  });
});

describe("saveAssumptions / getAssumptions", () => {
  it("saves and reads back", () => {
    const ctx = setup();
    const created = tools.createProject(ctx, { problem: "p" });
    tools.saveAssumptions(ctx, {
      project_id: created.project_id,
      assumptions: [
        { assumption: "env is stationary", papers_supporting: [], papers_challenging: [], status: "assumed", remaining_question: "q" },
      ],
    });
    expect(tools.getAssumptions(ctx, { project_id: created.project_id }).assumptions).toHaveLength(1);
  });
});

describe("getEvidence / getGraveyard", () => {
  it("returns empty arrays for a fresh project", () => {
    const ctx = setup();
    const created = tools.createProject(ctx, { problem: "p" });
    expect(tools.getEvidence(ctx, { project_id: created.project_id }).evidence).toEqual([]);
    expect(tools.getGraveyard(ctx, { project_id: created.project_id }).graveyard).toEqual([]);
  });
});
