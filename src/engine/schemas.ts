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

export const IdeaStatusSchema = z.enum(["generated", "filtered_out", "audited"]);
export type IdeaStatus = z.infer<typeof IdeaStatusSchema>;

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
