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

export const GapConfidenceSchema = z.enum(["low", "medium", "high"]);
export type GapConfidence = z.infer<typeof GapConfidenceSchema>;

export const GapSchema = z.object({
  id: z.string(),
  title: z.string(),
  category: z.string(),
  description: z.string(),
  evidence_paper_ids: z.array(z.string()).min(1),
  what_has_been_attempted: z.string(),
  what_remains_unresolved: z.string(),
  why_it_matters: z.string(),
  why_it_is_difficult: z.string(),
  potential_opportunity: z.string(),
  confidence: GapConfidenceSchema,
});
export type Gap = z.infer<typeof GapSchema>;

export const NewGapSchema = GapSchema.omit({ id: true });
export type NewGap = z.infer<typeof NewGapSchema>;

export const NoveltyVerdictSchema = z.enum(["PASS", "WEAK", "FAIL"]);
export type NoveltyVerdict = z.infer<typeof NoveltyVerdictSchema>;

export const NoveltyConfidenceSchema = z.enum(["low", "medium", "high"]);
export type NoveltyConfidence = z.infer<typeof NoveltyConfidenceSchema>;

export const SaturationSchema = z.enum(["UNEXPLORED", "UNDEREXPLORED", "EMERGING", "ACTIVE", "CROWDED", "SATURATED"]);
export type Saturation = z.infer<typeof SaturationSchema>;

export const IdeaStatusSchema = z.enum(["generated", "filtered_out", "audited", "rejected"]);
export type IdeaStatus = z.infer<typeof IdeaStatusSchema>;

export const MutationOperatorSchema = z.enum([
  "REMOVE_ASSUMPTION",
  "ADD_CONSTRAINT",
  "CHANGE_OBJECTIVE",
  "CHANGE_EVALUATION",
  "CHANGE_DATA",
  "CHANGE_SCALE",
  "CHANGE_RESOURCE_LIMIT",
  "CHANGE_ENVIRONMENT",
  "CHANGE_TASK",
  "CHANGE_MODEL_CLASS",
  "COMBINE_WITH_ADJACENT_FIELD",
  "STRESS_TEST",
  "REVERSE_DIRECTION",
]);
export type MutationOperator = z.infer<typeof MutationOperatorSchema>;

export const IdeaSchema = z.object({
  id: z.string(),
  gap_id: z.string().nullable(),
  strategy: z.string(),
  research_question: z.string(),
  hypothesis: z.string(),
  motivation: z.string(),
  mechanism: z.string(),
  expected_contribution: z.string(),
  closest_prior_work: z.array(z.string()),
  why_not_solved: z.string(),
  why_now: z.string(),
  status: IdeaStatusSchema,
  novelty_verdict: NoveltyVerdictSchema.nullable(),
  novelty_evidence: z.string().nullable(),
  novelty_confidence: NoveltyConfidenceSchema.nullable(),
  saturation: SaturationSchema.nullable(),
  saturation_evidence: z.string().nullable(),
  mutation_depth: z.number().int().nonnegative(),
  mutated_from: z.string().nullable(),
  mutation_operator: MutationOperatorSchema.nullable(),
});
export type Idea = z.infer<typeof IdeaSchema>;

export const NewIdeaSchema = z.object({
  gap_id: z.string().nullable(),
  strategy: z.string().min(1),
  research_question: z.string().min(1),
  hypothesis: z.string().min(1),
  motivation: z.string().min(1),
  mechanism: z.string().min(1),
  expected_contribution: z.string().min(1),
  closest_prior_work: z.array(z.string()),
  why_not_solved: z.string().min(1),
  why_now: z.string().min(1),
});
export type NewIdea = z.infer<typeof NewIdeaSchema>;

export const IdeaSearchEvidenceSchema = z.object({
  idea_id: z.string(),
  queries: z.array(z.string()),
  papers: z.array(z.object({ id: z.string(), title: z.string(), year: z.number().int().nullable() })),
  notes: z.string(),
});
export type IdeaSearchEvidence = z.infer<typeof IdeaSearchEvidenceSchema>;

export const GraveyardEntrySchema = z.object({
  id: z.string(),
  idea_id: z.string(),
  research_question: z.string(),
  hypothesis: z.string(),
  reason_rejected: z.string(),
  novelty_verdict: NoveltyVerdictSchema,
  saturation: SaturationSchema,
  closest_prior_work: z.array(z.string()),
  potential_revival_direction: z.string().nullable(),
  mutated_into: z.string().nullable(),
  rejected_at: z.string(),
});
export type GraveyardEntry = z.infer<typeof GraveyardEntrySchema>;

export const AssumptionStatusSchema = z.enum(["assumed", "partially_challenged", "refuted", "supported"]);
export type AssumptionStatus = z.infer<typeof AssumptionStatusSchema>;

export const AssumptionLedgerEntrySchema = z.object({
  id: z.string(),
  assumption: z.string(),
  papers_supporting: z.array(z.string()),
  papers_challenging: z.array(z.string()),
  status: AssumptionStatusSchema,
  remaining_question: z.string(),
});
export type AssumptionLedgerEntry = z.infer<typeof AssumptionLedgerEntrySchema>;

export const NewAssumptionLedgerEntrySchema = AssumptionLedgerEntrySchema.omit({ id: true });
export type NewAssumptionLedgerEntry = z.infer<typeof NewAssumptionLedgerEntrySchema>;

export const EvidenceTypeSchema = z.enum([
  "experimental",
  "theoretical",
  "observational",
  "survey",
  "benchmark",
  "author_claim",
  "inference",
]);
export type EvidenceType = z.infer<typeof EvidenceTypeSchema>;

export const EvidenceLedgerEntrySchema = z.object({
  id: z.string(),
  claim: z.string(),
  evidence_paper_ids: z.array(z.string()),
  evidence_type: EvidenceTypeSchema,
  confidence: GapConfidenceSchema,
  status: z.enum(["verified", "unverified", "disputed"]),
  source: z.string(),
});
export type EvidenceLedgerEntry = z.infer<typeof EvidenceLedgerEntrySchema>;

export const ExperimentSchema = z.object({
  id: z.string(),
  idea_id: z.string(),
  minimal_validation: z.object({
    setup: z.string(),
    metric: z.string(),
    expected_signal: z.string(),
    estimated_effort: z.string(),
  }),
  full_roadmap: z.array(z.string()).min(1),
  risks: z.array(z.string()),
});
export type Experiment = z.infer<typeof ExperimentSchema>;

export const NewExperimentSchema = ExperimentSchema.omit({ id: true });
export type NewExperiment = z.infer<typeof NewExperimentSchema>;

export const ObjectionCategorySchema = z.enum(["novelty", "feasibility", "significance", "evaluation_validity"]);
export type ObjectionCategory = z.infer<typeof ObjectionCategorySchema>;

export const ObjectionSeveritySchema = z.enum(["minor", "major", "fatal"]);
export type ObjectionSeverity = z.infer<typeof ObjectionSeveritySchema>;

export const RecommendationSchema = z.enum(["accept", "weak_accept", "weak_reject", "reject"]);
export type Recommendation = z.infer<typeof RecommendationSchema>;

export const ReviewSchema = z.object({
  id: z.string(),
  idea_id: z.string(),
  objections: z.array(
    z.object({
      category: ObjectionCategorySchema,
      objection: z.string(),
      severity: ObjectionSeveritySchema,
    })
  ),
  overall_recommendation: RecommendationSchema,
});
export type Review = z.infer<typeof ReviewSchema>;

export const NewReviewSchema = ReviewSchema.omit({ id: true });
export type NewReview = z.infer<typeof NewReviewSchema>;

export const BudgetSchema = z.object({
  maxDiscoverySearchesPerProject: z.number().int().positive(),
  maxCandidatesPerProject: z.number().int().positive(),
  maxRetainedPapers: z.number().int().positive(),
  cacheTtlDays: z.number().positive(),
  requestTimeoutMs: z.number().int().positive(),
  arxivMinDelayMs: z.number().int().nonnegative(),
  maxGaps: z.number().int().positive(),
  maxRawIdeas: z.number().int().positive(),
  maxIdeasAudited: z.number().int().positive(),
  maxMutationDepth: z.number().int().nonnegative(),
  maxMutationsPerProject: z.number().int().nonnegative(),
  maxIdeasEvaluated: z.number().int().positive(),
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
