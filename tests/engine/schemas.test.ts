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
