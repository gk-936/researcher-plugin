import { z } from "zod";
import {
  ResearchSpecSchema,
  toCompactPaper,
  NewGapSchema,
  NewIdeaSchema,
  IdeaStatusSchema,
  NoveltyVerdictSchema,
  NoveltyConfidenceSchema,
  SaturationSchema,
  NewAssumptionLedgerEntrySchema,
  MutationOperatorSchema,
  type Budget,
} from "../engine/schemas.js";
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
  const gaps = ctx.store.getAllGaps(state.id);
  const ideas = ctx.store.getAllIdeas(state.id);
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
      gaps: gaps.length,
      ideas_generated: ideas.filter((i) => i.status !== "filtered_out").length,
      ideas_audited: ideas.filter((i) => i.status === "audited").length,
    },
    has_spec: ctx.store.getSpec(state.id) !== null,
    searches_remaining: Math.max(0, ctx.budget.maxDiscoverySearchesPerProject - state.searches_run),
    budgets: { maxGaps: ctx.budget.maxGaps, maxRawIdeas: ctx.budget.maxRawIdeas, maxIdeasAudited: ctx.budget.maxIdeasAudited },
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

export const getProblemSpecInput = z.object({ project_id: z.string() }).strict();
export function getProblemSpec(ctx: ToolContext, input: z.infer<typeof getProblemSpecInput>) {
  const spec = ctx.store.getSpec(input.project_id);
  if (!spec) return { error: "No problem spec saved." };
  return spec;
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

export const getLiteratureSummaryInput = z.object({ project_id: z.string() }).strict();
export function getLiteratureSummary(ctx: ToolContext, input: z.infer<typeof getLiteratureSummaryInput>) {
  const summary = ctx.store.getLiteratureSummary(input.project_id);
  if (!summary) return { error: "No literature summary saved." };
  return summary;
}

export const saveGapsInput = z.object({ project_id: z.string(), gaps: z.array(NewGapSchema).min(1) }).strict();
export function saveGaps(ctx: ToolContext, input: z.infer<typeof saveGapsInput>) {
  const result = ctx.store.saveGaps(input.project_id, input.gaps, ctx.budget.maxGaps);
  return { saved: result.saved, saved_count: result.saved.length, capped: result.capped };
}

export const getGapsInput = z.object({ project_id: z.string(), ids: z.array(z.string()).optional() }).strict();
export function getGaps(ctx: ToolContext, input: z.infer<typeof getGapsInput>) {
  return { gaps: ctx.store.getGaps(input.project_id, { ids: input.ids }) };
}

export const saveIdeaInput = z.object({ project_id: z.string(), idea: NewIdeaSchema }).strict();
export function saveIdea(ctx: ToolContext, input: z.infer<typeof saveIdeaInput>) {
  const created = ctx.store.saveIdea(input.project_id, input.idea, ctx.budget.maxRawIdeas);
  if (!created) return { saved: false as const, reason: "maxRawIdeas budget exhausted" };
  return { saved: true as const, idea: created };
}

export const getIdeasInput = z
  .object({
    project_id: z.string(),
    ids: z.array(z.string()).optional(),
    status: IdeaStatusSchema.optional(),
    gap_id: z.string().nullable().optional(),
  })
  .strict();
export function getIdeas(ctx: ToolContext, input: z.infer<typeof getIdeasInput>) {
  return { ideas: ctx.store.getIdeas(input.project_id, { ids: input.ids, status: input.status, gap_id: input.gap_id }) };
}

export const filterIdeasInput = z.object({ project_id: z.string(), drop_ids: z.array(z.string()) }).strict();
export function filterIdeas(ctx: ToolContext, input: z.infer<typeof filterIdeasInput>) {
  return { filtered_count: ctx.store.filterIdeas(input.project_id, input.drop_ids) };
}

export const updateIdeaNoveltyInput = z
  .object({
    project_id: z.string(),
    idea_id: z.string(),
    novelty_verdict: NoveltyVerdictSchema,
    novelty_evidence: z.string().min(1),
    novelty_confidence: NoveltyConfidenceSchema,
  })
  .strict();
export function updateIdeaNovelty(ctx: ToolContext, input: z.infer<typeof updateIdeaNoveltyInput>) {
  const idea = ctx.store.updateIdeaNovelty(
    input.project_id,
    input.idea_id,
    input.novelty_verdict,
    input.novelty_evidence,
    input.novelty_confidence
  );
  return { idea };
}

export const updateIdeaSaturationInput = z
  .object({
    project_id: z.string(),
    idea_id: z.string(),
    saturation: SaturationSchema,
    saturation_evidence: z.string().min(1),
  })
  .strict();
export function updateIdeaSaturation(ctx: ToolContext, input: z.infer<typeof updateIdeaSaturationInput>) {
  const idea = ctx.store.updateIdeaSaturation(input.project_id, input.idea_id, input.saturation, input.saturation_evidence);
  return { idea };
}

export const saveIdeaSearchEvidenceInput = z
  .object({
    project_id: z.string(),
    idea_id: z.string(),
    queries: z.array(z.string()),
    papers: z.array(z.object({ id: z.string(), title: z.string(), year: z.number().int().nullable() })),
    notes: z.string(),
  })
  .strict();
export function saveIdeaSearchEvidence(ctx: ToolContext, input: z.infer<typeof saveIdeaSearchEvidenceInput>) {
  ctx.store.saveIdeaSearchEvidence(input.project_id, {
    idea_id: input.idea_id,
    queries: input.queries,
    papers: input.papers,
    notes: input.notes,
  });
  return { saved: true };
}

export const getIdeaSearchEvidenceInput = z.object({ project_id: z.string(), idea_id: z.string() }).strict();
export function getIdeaSearchEvidence(ctx: ToolContext, input: z.infer<typeof getIdeaSearchEvidenceInput>) {
  const evidence = ctx.store.getIdeaSearchEvidence(input.project_id, input.idea_id);
  if (!evidence) return { error: "No search evidence saved for this idea." };
  return evidence;
}

export const rejectIdeaToGraveyardInput = z
  .object({
    project_id: z.string(),
    idea_id: z.string(),
    reason_rejected: z.string().min(1),
    potential_revival_direction: z.string().optional(),
  })
  .strict();
export function rejectIdeaToGraveyard(ctx: ToolContext, input: z.infer<typeof rejectIdeaToGraveyardInput>) {
  return ctx.store.rejectIdeaToGraveyard(
    input.project_id,
    input.idea_id,
    input.reason_rejected,
    input.potential_revival_direction ?? null
  );
}

export const createIdeaMutationInput = z
  .object({
    project_id: z.string(),
    parent_idea_id: z.string(),
    operator: MutationOperatorSchema,
    idea: NewIdeaSchema,
  })
  .strict();
export function createIdeaMutationTool(ctx: ToolContext, input: z.infer<typeof createIdeaMutationInput>) {
  return ctx.store.createIdeaMutation(
    input.project_id,
    input.parent_idea_id,
    input.operator,
    input.idea,
    ctx.budget.maxMutationDepth,
    ctx.budget.maxMutationsPerProject
  );
}

export const saveAssumptionsInput = z
  .object({ project_id: z.string(), assumptions: z.array(NewAssumptionLedgerEntrySchema).min(1) })
  .strict();
export function saveAssumptions(ctx: ToolContext, input: z.infer<typeof saveAssumptionsInput>) {
  return { assumptions: ctx.store.saveAssumptions(input.project_id, input.assumptions) };
}

export const getAssumptionsInput = z.object({ project_id: z.string() }).strict();
export function getAssumptions(ctx: ToolContext, input: z.infer<typeof getAssumptionsInput>) {
  return { assumptions: ctx.store.getAssumptions(input.project_id) };
}

export const getEvidenceInput = z.object({ project_id: z.string() }).strict();
export function getEvidence(ctx: ToolContext, input: z.infer<typeof getEvidenceInput>) {
  return { evidence: ctx.store.getEvidence(input.project_id) };
}

export const getGraveyardInput = z.object({ project_id: z.string() }).strict();
export function getGraveyard(ctx: ToolContext, input: z.infer<typeof getGraveyardInput>) {
  return { graveyard: ctx.store.getGraveyard(input.project_id) };
}
