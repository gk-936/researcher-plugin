import { describe, expect, it } from "vitest";
import {
  ResearchSpecSchema,
  PaperSchema,
  BudgetSchema,
  ProjectStateSchema,
  toCompactPaper,
  type Paper,
  GapSchema,
  IdeaSchema,
  IdeaSearchEvidenceSchema,
  NewGapSchema,
  NewIdeaSchema,
} from "../../src/engine/schemas.js";

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
      maxGaps: 8,
      maxRawIdeas: 10,
      maxIdeasAudited: 4,
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
        maxGaps: 8,
        maxRawIdeas: 10,
        maxIdeasAudited: 4,
      },
    };
    expect(() => ProjectStateSchema.parse(state)).not.toThrow();
  });
});

const validGap = {
  id: "gap-001",
  title: "No efficient sparse-reward baseline exists",
  category: "efficiency gap",
  description: "Retained work assumes dense reward.",
  evidence_paper_ids: ["arxiv:1234.5678"],
  what_has_been_attempted: "Dense-reward model-based RL.",
  what_remains_unresolved: "Sparse-reward sample efficiency.",
  why_it_matters: "Sparse reward is the common real-world case.",
  why_it_is_difficult: "Credit assignment is harder without dense signal.",
  potential_opportunity: "A sparse-reward-native world model.",
  confidence: "medium" as const,
};

describe("GapSchema", () => {
  it("accepts a fully-formed gap", () => {
    expect(() => GapSchema.parse(validGap)).not.toThrow();
  });

  it("rejects a gap with no evidence paper ids", () => {
    expect(() => GapSchema.parse({ ...validGap, evidence_paper_ids: [] })).toThrow();
  });
});

describe("NewGapSchema", () => {
  it("accepts a gap without an id", () => {
    const { id: _drop, ...withoutId } = validGap;
    expect(() => NewGapSchema.parse(withoutId)).not.toThrow();
  });
});

const validIdea = {
  id: "idea-001",
  gap_id: "gap-001",
  strategy: "REMOVE_ASSUMPTION",
  research_question: "Can sparse-reward sample efficiency improve without dense shaping?",
  hypothesis: "A learned intrinsic signal substitutes for dense reward.",
  motivation: "Dense-reward assumption blocks real-world deployment.",
  mechanism: "Train an auxiliary predictor as an intrinsic reward.",
  expected_contribution: "A sparse-reward-native sample efficiency gain.",
  closest_prior_work: ["arxiv:1234.5678"],
  why_not_solved: "Prior work assumes reward density.",
  why_now: "Auxiliary predictors are now cheap to train.",
  status: "generated" as const,
  novelty_verdict: null,
  novelty_evidence: null,
  novelty_confidence: null,
  saturation: null,
  saturation_evidence: null,
};

describe("IdeaSchema", () => {
  it("accepts a freshly-generated idea with null audit fields", () => {
    expect(() => IdeaSchema.parse(validIdea)).not.toThrow();
  });

  it("accepts an audited idea", () => {
    expect(() =>
      IdeaSchema.parse({
        ...validIdea,
        status: "audited",
        novelty_verdict: "PASS",
        novelty_evidence: "No close prior work found.",
        novelty_confidence: "high",
        saturation: "UNEXPLORED",
        saturation_evidence: "No matching papers in the retained set.",
      })
    ).not.toThrow();
  });

  it("rejects an invalid saturation value", () => {
    expect(() => IdeaSchema.parse({ ...validIdea, saturation: "MADE_UP" })).toThrow();
  });
});

describe("NewIdeaSchema", () => {
  it("accepts the generator-owned fields only", () => {
    const { id: _id, status: _status, novelty_verdict: _nv, novelty_evidence: _ne, novelty_confidence: _nc, saturation: _s, saturation_evidence: _se, ...generatorOwned } = validIdea;
    expect(() => NewIdeaSchema.parse(generatorOwned)).not.toThrow();
  });
});

describe("IdeaSearchEvidenceSchema", () => {
  it("accepts a search evidence record", () => {
    expect(() =>
      IdeaSearchEvidenceSchema.parse({
        idea_id: "idea-001",
        queries: ["sparse reward intrinsic motivation sample efficiency"],
        papers: [{ id: "arxiv:1234.5678", title: "A Paper", year: 2024 }],
        notes: "Closest match trains a fixed intrinsic bonus, not a learned one.",
      })
    ).not.toThrow();
  });
});
