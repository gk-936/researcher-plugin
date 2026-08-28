import { describe, expect, it, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ProjectStore } from "../../src/engine/storage.js";
import { DEFAULT_BUDGET } from "../../src/engine/budget.js";
import type { Paper, ResearchSpec, NewGap, NewIdea } from "../../src/engine/schemas.js";

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

describe("ProjectStore.upsertPapers / retainPapers unknown project guard", () => {
  it("upsertPapers throws on an unknown project id", () => {
    store = freshStore();
    expect(() => store.upsertPapers("nope", [])).toThrow();
  });

  it("retainPapers throws on an unknown project id", () => {
    store = freshStore();
    expect(() => store.retainPapers("nope", [], 20)).toThrow();
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

function newGap(title: string, overrides: Partial<NewGap> = {}): NewGap {
  return {
    title,
    category: "efficiency gap",
    description: "d",
    evidence_paper_ids: ["a"],
    what_has_been_attempted: "x",
    what_remains_unresolved: "y",
    why_it_matters: "z",
    why_it_is_difficult: "w",
    potential_opportunity: "o",
    confidence: "medium",
    ...overrides,
  };
}

describe("ProjectStore.saveGaps / getGaps", () => {
  it("assigns sequential ids and marks gap_hunting complete", () => {
    store = freshStore();
    const project = store.createProject("p", DEFAULT_BUDGET);
    const result = store.saveGaps(project.id, [newGap("Gap A"), newGap("Gap B")], 8);
    expect(result.saved.map((g) => g.id)).toEqual(["gap-001", "gap-002"]);
    expect(result.capped).toBe(0);
    expect(store.getProject(project.id)!.phases_completed).toContain("gap_hunting");
    expect(store.getAllGaps(project.id)).toHaveLength(2);
  });

  it("caps at maxGaps and reports the capped count", () => {
    store = freshStore();
    const project = store.createProject("p", DEFAULT_BUDGET);
    const result = store.saveGaps(project.id, [newGap("A"), newGap("B"), newGap("C")], 2);
    expect(result.saved).toHaveLength(2);
    expect(result.capped).toBe(1);
  });

  it("continues numbering across multiple saveGaps calls", () => {
    store = freshStore();
    const project = store.createProject("p", DEFAULT_BUDGET);
    store.saveGaps(project.id, [newGap("A")], 8);
    const second = store.saveGaps(project.id, [newGap("B")], 8);
    expect(second.saved[0].id).toBe("gap-002");
  });

  it("filters by ids", () => {
    store = freshStore();
    const project = store.createProject("p", DEFAULT_BUDGET);
    store.saveGaps(project.id, [newGap("A"), newGap("B")], 8);
    expect(store.getGaps(project.id, { ids: ["gap-002"] }).map((g) => g.title)).toEqual(["B"]);
  });

  it("throws on an unknown project id", () => {
    store = freshStore();
    expect(() => store.saveGaps("nope", [], 8)).toThrow();
  });
});

function newIdea(question: string, overrides: Partial<NewIdea> = {}): NewIdea {
  return {
    gap_id: null,
    strategy: "REMOVE_ASSUMPTION",
    research_question: question,
    hypothesis: "h",
    motivation: "m",
    mechanism: "mech",
    expected_contribution: "c",
    closest_prior_work: [],
    why_not_solved: "n",
    why_now: "now",
    ...overrides,
  };
}

describe("ProjectStore.saveIdea / getIdeas", () => {
  it("assigns sequential ids, defaults audit fields to null, marks idea_generation complete", () => {
    store = freshStore();
    const project = store.createProject("p", DEFAULT_BUDGET);
    const idea = store.saveIdea(project.id, newIdea("Q1"), 10);
    expect(idea!.id).toBe("idea-001");
    expect(idea!.status).toBe("generated");
    expect(idea!.novelty_verdict).toBeNull();
    expect(idea!.saturation).toBeNull();
    expect(store.getProject(project.id)!.phases_completed).toContain("idea_generation");
  });

  it("returns null once maxRawIdeas is reached", () => {
    store = freshStore();
    const project = store.createProject("p", DEFAULT_BUDGET);
    store.saveIdea(project.id, newIdea("Q1"), 1);
    expect(store.saveIdea(project.id, newIdea("Q2"), 1)).toBeNull();
  });

  it("filters by status and gap_id", () => {
    store = freshStore();
    const project = store.createProject("p", DEFAULT_BUDGET);
    store.saveIdea(project.id, newIdea("Q1", { gap_id: "gap-001" }), 10);
    store.saveIdea(project.id, newIdea("Q2", { gap_id: null }), 10);
    expect(store.getIdeas(project.id, { gap_id: "gap-001" }).map((i) => i.research_question)).toEqual(["Q1"]);
    expect(store.getIdeas(project.id, { status: "generated" })).toHaveLength(2);
  });
});

describe("ProjectStore.filterIdeas", () => {
  it("marks dropped ideas filtered_out and leaves the rest untouched", () => {
    store = freshStore();
    const project = store.createProject("p", DEFAULT_BUDGET);
    const a = store.saveIdea(project.id, newIdea("Q1"), 10)!;
    const b = store.saveIdea(project.id, newIdea("Q2"), 10)!;
    const count = store.filterIdeas(project.id, [a.id]);
    expect(count).toBe(1);
    expect(store.getIdeas(project.id, { ids: [a.id] })[0].status).toBe("filtered_out");
    expect(store.getIdeas(project.id, { ids: [b.id] })[0].status).toBe("generated");
  });
});

describe("ProjectStore.updateIdeaNovelty / updateIdeaSaturation", () => {
  it("writes only the owned fields and flips to audited once both passes complete", () => {
    store = freshStore();
    const project = store.createProject("p", DEFAULT_BUDGET);
    const idea = store.saveIdea(project.id, newIdea("Q1"), 10)!;

    const afterNovelty = store.updateIdeaNovelty(project.id, idea.id, "PASS", "No close prior work found.", "high");
    expect(afterNovelty.novelty_verdict).toBe("PASS");
    expect(afterNovelty.status).toBe("generated");
    expect(afterNovelty.saturation).toBeNull();

    const afterSaturation = store.updateIdeaSaturation(project.id, idea.id, "UNEXPLORED", "No matching papers.");
    expect(afterSaturation.saturation).toBe("UNEXPLORED");
    expect(afterSaturation.status).toBe("audited");
  });

  it("does not flip to audited from saturation alone if novelty hasn't run", () => {
    store = freshStore();
    const project = store.createProject("p", DEFAULT_BUDGET);
    const idea = store.saveIdea(project.id, newIdea("Q1"), 10)!;
    const result = store.updateIdeaSaturation(project.id, idea.id, "CROWDED", "Many variants exist.");
    expect(result.status).toBe("generated");
  });

  it("throws on an unknown idea id", () => {
    store = freshStore();
    const project = store.createProject("p", DEFAULT_BUDGET);
    expect(() => store.updateIdeaNovelty(project.id, "idea-999", "PASS", "e", "low")).toThrow();
  });
});

describe("ProjectStore.saveIdeaSearchEvidence / getIdeaSearchEvidence", () => {
  it("round-trips evidence for an idea", () => {
    store = freshStore();
    const project = store.createProject("p", DEFAULT_BUDGET);
    store.saveIdeaSearchEvidence(project.id, {
      idea_id: "idea-001",
      queries: ["q1"],
      papers: [{ id: "arxiv:1", title: "T", year: 2024 }],
      notes: "n",
    });
    expect(store.getIdeaSearchEvidence(project.id, "idea-001")).toEqual({
      idea_id: "idea-001",
      queries: ["q1"],
      papers: [{ id: "arxiv:1", title: "T", year: 2024 }],
      notes: "n",
    });
  });

  it("returns null when no evidence has been saved for that idea", () => {
    store = freshStore();
    const project = store.createProject("p", DEFAULT_BUDGET);
    expect(store.getIdeaSearchEvidence(project.id, "idea-999")).toBeNull();
  });

  it("replaces prior evidence for the same idea rather than duplicating", () => {
    store = freshStore();
    const project = store.createProject("p", DEFAULT_BUDGET);
    store.saveIdeaSearchEvidence(project.id, { idea_id: "idea-001", queries: ["q1"], papers: [], notes: "first" });
    store.saveIdeaSearchEvidence(project.id, { idea_id: "idea-001", queries: ["q2"], papers: [], notes: "second" });
    expect(store.getIdeaSearchEvidence(project.id, "idea-001")!.notes).toBe("second");
  });
});

describe("ProjectStore.saveIdea mutation defaults", () => {
  it("sets mutation_depth 0 and null lineage on an original idea", () => {
    store = freshStore();
    const project = store.createProject("p", DEFAULT_BUDGET);
    const idea = store.saveIdea(project.id, newIdea("Q1"), DEFAULT_BUDGET.maxRawIdeas)!;
    expect(idea.mutation_depth).toBe(0);
    expect(idea.mutated_from).toBeNull();
    expect(idea.mutation_operator).toBeNull();
  });
});

describe("ProjectStore.saveGaps auto-derives evidence", () => {
  it("creates one evidence entry per saved gap", () => {
    store = freshStore();
    const project = store.createProject("p", DEFAULT_BUDGET);
    store.saveGaps(project.id, [newGap("Gap A", { description: "method X is data-hungry", evidence_paper_ids: ["arxiv:1"], confidence: "medium" })], DEFAULT_BUDGET.maxGaps);
    const evidence = store.getEvidence(project.id);
    expect(evidence).toHaveLength(1);
    expect(evidence[0]).toMatchObject({
      claim: "method X is data-hungry",
      evidence_paper_ids: ["arxiv:1"],
      evidence_type: "observational",
      confidence: "medium",
      status: "verified",
      source: "gap",
    });
  });
});

describe("ProjectStore.saveAssumptions / getAssumptions", () => {
  it("assigns ids and round-trips", () => {
    store = freshStore();
    const project = store.createProject("p", DEFAULT_BUDGET);
    const created = store.saveAssumptions(project.id, [
      { assumption: "env is stationary", papers_supporting: ["arxiv:1"], papers_challenging: [], status: "assumed", remaining_question: "q" },
    ]);
    expect(created[0].id).toBe("assumption-001");
    expect(store.getAssumptions(project.id)).toHaveLength(1);
  });
});

describe("ProjectStore.rejectIdeaToGraveyard", () => {
  it("creates a graveyard entry and marks the idea rejected", () => {
    store = freshStore();
    const project = store.createProject("p", DEFAULT_BUDGET);
    const idea = store.saveIdea(project.id, newIdea("Q1"), DEFAULT_BUDGET.maxRawIdeas)!;
    store.updateIdeaNovelty(project.id, idea.id, "FAIL", "already done", "high");
    store.updateIdeaSaturation(project.id, idea.id, "SATURATED", "many variants exist");

    const entry = store.rejectIdeaToGraveyard(project.id, idea.id, "novelty FAIL", "try a different task");

    expect(entry.idea_id).toBe(idea.id);
    expect(entry.novelty_verdict).toBe("FAIL");
    expect(entry.saturation).toBe("SATURATED");
    expect(entry.mutated_into).toBeNull();
    expect(store.getIdeas(project.id, { ids: [idea.id] })[0].status).toBe("rejected");
    expect(store.getGraveyard(project.id)).toHaveLength(1);
  });

  it("throws if the idea has not been fully audited yet", () => {
    store = freshStore();
    const project = store.createProject("p", DEFAULT_BUDGET);
    const idea = store.saveIdea(project.id, newIdea("Q1"), DEFAULT_BUDGET.maxRawIdeas)!;
    expect(() => store.rejectIdeaToGraveyard(project.id, idea.id, "reason", null)).toThrow();
  });
});

describe("ProjectStore.createIdeaMutation", () => {
  function rejectedIdea(project: { id: string }) {
    const idea = store.saveIdea(project.id, newIdea("Q1"), DEFAULT_BUDGET.maxRawIdeas)!;
    store.updateIdeaNovelty(project.id, idea.id, "FAIL", "already done", "high");
    store.updateIdeaSaturation(project.id, idea.id, "SATURATED", "many variants exist");
    store.rejectIdeaToGraveyard(project.id, idea.id, "novelty FAIL", null);
    return idea;
  }

  it("creates a mutated idea linked to its parent and updates the graveyard entry", () => {
    store = freshStore();
    const project = store.createProject("p", DEFAULT_BUDGET);
    const parent = rejectedIdea(project);

    const result = store.createIdeaMutation(
      project.id,
      parent.id,
      "CHANGE_TASK",
      newIdea("mutated Q1"),
      DEFAULT_BUDGET.maxMutationDepth,
      DEFAULT_BUDGET.maxMutationsPerProject
    );

    expect(result.saved).toBe(true);
    if (!result.saved) throw new Error("expected saved");
    expect(result.idea.mutation_depth).toBe(1);
    expect(result.idea.mutated_from).toBe(parent.id);
    expect(result.idea.mutation_operator).toBe("CHANGE_TASK");

    const graveyard = store.getGraveyard(project.id);
    expect(graveyard[0].mutated_into).toBe(result.idea.id);
  });

  it("refuses a mutation once maxMutationDepth is reached", () => {
    store = freshStore();
    const project = store.createProject("p", DEFAULT_BUDGET);
    const parent = rejectedIdea(project);

    const result = store.createIdeaMutation(project.id, parent.id, "CHANGE_TASK", newIdea("Q2"), 0, DEFAULT_BUDGET.maxMutationsPerProject);

    expect(result).toEqual({ saved: false, reason: "maxMutationDepth reached" });
  });

  it("refuses a mutation once maxMutationsPerProject is exhausted", () => {
    store = freshStore();
    const project = store.createProject("p", DEFAULT_BUDGET);
    const parent = rejectedIdea(project);

    const result = store.createIdeaMutation(
      project.id,
      parent.id,
      "CHANGE_TASK",
      newIdea("Q2"),
      DEFAULT_BUDGET.maxMutationDepth,
      0
    );

    expect(result).toEqual({ saved: false, reason: "maxMutationsPerProject budget exhausted" });
  });
});
