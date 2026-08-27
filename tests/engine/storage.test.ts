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
