import { z } from "zod";
import { ResearchSpecSchema, toCompactPaper, type Budget } from "../engine/schemas.js";
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
    },
    has_spec: ctx.store.getSpec(state.id) !== null,
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
