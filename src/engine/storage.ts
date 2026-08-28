import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  ProjectStateSchema,
  type ProjectState,
  ResearchSpecSchema,
  type ResearchSpec,
  PaperSchema,
  type Paper,
  GapSchema,
  type Gap,
  type NewGap,
  IdeaSchema,
  type Idea,
  type NewIdea,
  type NoveltyVerdict,
  type NoveltyConfidence,
  type Saturation,
  type IdeaSearchEvidence,
  type Budget,
} from "./schemas.js";
import { createProjectId, createGapId, createIdeaId } from "./ids.js";
import { logEvent } from "./logging.js";

export interface ProjectSummary {
  project_id: string;
  problem: string;
  created_at: string;
  status: ProjectState["status"];
}

export class ProjectStore {
  constructor(private rootDir: string) {}

  private projectDir(id: string): string {
    return join(this.rootDir, "projects", id);
  }
  private projectFile(id: string): string {
    return join(this.projectDir(id), "project.json");
  }
  private specFile(id: string): string {
    return join(this.projectDir(id), "spec.json");
  }
  private papersFile(id: string): string {
    return join(this.projectDir(id), "papers.json");
  }
  private summaryFile(id: string): string {
    return join(this.projectDir(id), "literature_summary.json");
  }
  private gapsFile(id: string): string {
    return join(this.projectDir(id), "gaps.json");
  }
  private ideasFile(id: string): string {
    return join(this.projectDir(id), "ideas.json");
  }
  private ideaSearchEvidenceFile(id: string): string {
    return join(this.projectDir(id), "idea_search_evidence.json");
  }
  private logFile(id: string): string {
    return join(this.projectDir(id), "log.jsonl");
  }

  logFilePath(id: string): string {
    return this.logFile(id);
  }

  createProject(problem: string, budget: Budget): ProjectState {
    const id = createProjectId(problem);
    mkdirSync(this.projectDir(id), { recursive: true });
    const state: ProjectState = {
      id,
      problem,
      created_at: new Date().toISOString(),
      status: "created",
      phases_completed: [],
      searches_run: 0,
      budget,
    };
    writeFileSync(this.projectFile(id), JSON.stringify(state, null, 2), "utf-8");
    writeFileSync(this.papersFile(id), JSON.stringify([], null, 2), "utf-8");
    logEvent(this.logFile(id), "project_created", id, { problem });
    return state;
  }

  getProject(id: string): ProjectState | null {
    if (!existsSync(this.projectFile(id))) return null;
    return ProjectStateSchema.parse(JSON.parse(readFileSync(this.projectFile(id), "utf-8")));
  }

  private saveProject(state: ProjectState): void {
    writeFileSync(this.projectFile(state.id), JSON.stringify(state, null, 2), "utf-8");
  }

  listProjects(): ProjectSummary[] {
    const projectsDir = join(this.rootDir, "projects");
    if (!existsSync(projectsDir)) return [];
    const ids = readdirSync(projectsDir).filter((name) => existsSync(join(projectsDir, name, "project.json")));
    const summaries = ids.map((id) => {
      const state = this.getProject(id)!;
      return { project_id: state.id, problem: state.problem, created_at: state.created_at, status: state.status };
    });
    return summaries.sort((a, b) => (a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : 0));
  }

  mostRecentProject(): ProjectState | null {
    const [first] = this.listProjects();
    return first ? this.getProject(first.project_id) : null;
  }

  saveSpec(projectId: string, spec: ResearchSpec): void {
    const validated = ResearchSpecSchema.parse(spec);
    const state = this.getProject(projectId);
    if (!state) throw new Error(`Unknown project: ${projectId}`);
    writeFileSync(this.specFile(projectId), JSON.stringify(validated, null, 2), "utf-8");
    if (!state.phases_completed.includes("problem_analysis")) {
      state.phases_completed.push("problem_analysis");
    }
    state.status = "spec_saved";
    this.saveProject(state);
    logEvent(this.logFile(projectId), "spec_saved", projectId, {});
  }

  getSpec(projectId: string): ResearchSpec | null {
    if (!existsSync(this.specFile(projectId))) return null;
    return ResearchSpecSchema.parse(JSON.parse(readFileSync(this.specFile(projectId), "utf-8")));
  }

  getAllPapers(projectId: string): Paper[] {
    if (!existsSync(this.papersFile(projectId))) return [];
    const raw = JSON.parse(readFileSync(this.papersFile(projectId), "utf-8"));
    return (raw as unknown[]).map((p) => PaperSchema.parse(p));
  }

  private saveAllPapers(projectId: string, papers: Paper[]): void {
    writeFileSync(this.papersFile(projectId), JSON.stringify(papers, null, 2), "utf-8");
  }

  upsertPapers(projectId: string, papers: Paper[]): Paper[] {
    if (!this.getProject(projectId)) throw new Error(`Unknown project: ${projectId}`);
    const existing = this.getAllPapers(projectId);
    const byId = new Map(existing.map((p) => [p.id, p]));
    for (const incoming of papers) {
      const prior = byId.get(incoming.id);
      byId.set(incoming.id, prior ? { ...incoming, status: prior.status, relevance_note: prior.relevance_note } : incoming);
    }
    const merged = Array.from(byId.values());
    this.saveAllPapers(projectId, merged);
    return merged;
  }

  getPapers(projectId: string, filter?: { ids?: string[]; status?: Paper["status"]; limit?: number }): Paper[] {
    let papers = this.getAllPapers(projectId);
    if (filter?.ids) papers = papers.filter((p) => filter.ids!.includes(p.id));
    if (filter?.status) papers = papers.filter((p) => p.status === filter.status);
    if (filter?.limit) papers = papers.slice(0, filter.limit);
    return papers;
  }

  retainPapers(projectId: string, retained: { id: string; relevance_note: string }[], maxRetained: number): number {
    if (!this.getProject(projectId)) throw new Error(`Unknown project: ${projectId}`);
    const papers = this.getAllPapers(projectId);
    const byId = new Map(papers.map((p) => [p.id, p]));
    const alreadyRetained = papers.filter((p) => p.status === "retained").length;
    let newlyRetained = 0;
    for (const { id, relevance_note } of retained) {
      if (alreadyRetained + newlyRetained >= maxRetained) break;
      const paper = byId.get(id);
      if (!paper) continue;
      if (paper.status !== "retained") newlyRetained++;
      byId.set(id, { ...paper, status: "retained", relevance_note });
    }
    this.saveAllPapers(projectId, Array.from(byId.values()));
    logEvent(this.logFile(projectId), "papers_retained", projectId, { count: newlyRetained });
    return newlyRetained;
  }

  incrementSearchesRun(projectId: string, count: number): number {
    const state = this.getProject(projectId);
    if (!state) throw new Error(`Unknown project: ${projectId}`);
    state.searches_run += count;
    this.saveProject(state);
    return state.searches_run;
  }

  saveLiteratureSummary(projectId: string, summary: string, taxonomyDimensions?: string[]): void {
    const state = this.getProject(projectId);
    if (!state) throw new Error(`Unknown project: ${projectId}`);
    writeFileSync(
      this.summaryFile(projectId),
      JSON.stringify({ summary, taxonomy_dimensions: taxonomyDimensions ?? [] }, null, 2),
      "utf-8"
    );
    if (!state.phases_completed.includes("literature_discovery")) {
      state.phases_completed.push("literature_discovery");
    }
    state.status = "literature_done";
    this.saveProject(state);
    logEvent(this.logFile(projectId), "literature_summary_saved", projectId, {});
  }

  getLiteratureSummary(projectId: string): { summary: string; taxonomy_dimensions: string[] } | null {
    if (!existsSync(this.summaryFile(projectId))) return null;
    return JSON.parse(readFileSync(this.summaryFile(projectId), "utf-8"));
  }

  getAllGaps(projectId: string): Gap[] {
    if (!existsSync(this.gapsFile(projectId))) return [];
    const raw = JSON.parse(readFileSync(this.gapsFile(projectId), "utf-8"));
    return (raw as unknown[]).map((g) => GapSchema.parse(g));
  }

  private saveAllGaps(projectId: string, gaps: Gap[]): void {
    writeFileSync(this.gapsFile(projectId), JSON.stringify(gaps, null, 2), "utf-8");
  }

  saveGaps(projectId: string, gaps: NewGap[], maxGaps: number): { saved: Gap[]; capped: number } {
    const state = this.getProject(projectId);
    if (!state) throw new Error(`Unknown project: ${projectId}`);
    const existing = this.getAllGaps(projectId);
    const remaining = Math.max(0, maxGaps - existing.length);
    const toSave = gaps.slice(0, remaining);
    const capped = gaps.length - toSave.length;
    let nextIndex = existing.length + 1;
    const created = toSave.map((g) => ({ ...g, id: createGapId(nextIndex++) }));
    this.saveAllGaps(projectId, [...existing, ...created]);
    if (!state.phases_completed.includes("gap_hunting")) {
      state.phases_completed.push("gap_hunting");
      this.saveProject(state);
    }
    logEvent(this.logFile(projectId), "gaps_saved", projectId, { count: created.length, capped });
    return { saved: created, capped };
  }

  getGaps(projectId: string, filter?: { ids?: string[] }): Gap[] {
    let gaps = this.getAllGaps(projectId);
    if (filter?.ids) gaps = gaps.filter((g) => filter.ids!.includes(g.id));
    return gaps;
  }

  getAllIdeas(projectId: string): Idea[] {
    if (!existsSync(this.ideasFile(projectId))) return [];
    const raw = JSON.parse(readFileSync(this.ideasFile(projectId), "utf-8"));
    return (raw as unknown[]).map((i) => IdeaSchema.parse(i));
  }

  private saveAllIdeas(projectId: string, ideas: Idea[]): void {
    writeFileSync(this.ideasFile(projectId), JSON.stringify(ideas, null, 2), "utf-8");
  }

  saveIdea(projectId: string, idea: NewIdea, maxRawIdeas: number): Idea | null {
    const state = this.getProject(projectId);
    if (!state) throw new Error(`Unknown project: ${projectId}`);
    const existing = this.getAllIdeas(projectId);
    if (existing.length >= maxRawIdeas) return null;
    const created: Idea = {
      ...idea,
      id: createIdeaId(existing.length + 1),
      status: "generated",
      novelty_verdict: null,
      novelty_evidence: null,
      novelty_confidence: null,
      saturation: null,
      saturation_evidence: null,
    };
    this.saveAllIdeas(projectId, [...existing, created]);
    if (!state.phases_completed.includes("idea_generation")) {
      state.phases_completed.push("idea_generation");
      this.saveProject(state);
    }
    logEvent(this.logFile(projectId), "idea_saved", projectId, { id: created.id });
    return created;
  }

  getIdeas(projectId: string, filter?: { ids?: string[]; status?: Idea["status"]; gap_id?: string | null }): Idea[] {
    let ideas = this.getAllIdeas(projectId);
    if (filter?.ids) ideas = ideas.filter((i) => filter.ids!.includes(i.id));
    if (filter?.status) ideas = ideas.filter((i) => i.status === filter.status);
    if (filter?.gap_id !== undefined) ideas = ideas.filter((i) => i.gap_id === filter.gap_id);
    return ideas;
  }

  filterIdeas(projectId: string, dropIds: string[]): number {
    const ideas = this.getAllIdeas(projectId);
    const dropSet = new Set(dropIds);
    let count = 0;
    const updated = ideas.map((i) => {
      if (dropSet.has(i.id) && i.status !== "filtered_out") {
        count++;
        return { ...i, status: "filtered_out" as const };
      }
      return i;
    });
    this.saveAllIdeas(projectId, updated);
    logEvent(this.logFile(projectId), "ideas_filtered", projectId, { count });
    return count;
  }

  private updateIdea(projectId: string, ideaId: string, patch: Partial<Idea>): Idea {
    const ideas = this.getAllIdeas(projectId);
    const idx = ideas.findIndex((i) => i.id === ideaId);
    if (idx === -1) throw new Error(`Unknown idea: ${ideaId}`);
    ideas[idx] = { ...ideas[idx], ...patch };
    this.saveAllIdeas(projectId, ideas);
    return ideas[idx];
  }

  updateIdeaNovelty(
    projectId: string,
    ideaId: string,
    verdict: NoveltyVerdict,
    evidence: string,
    confidence: NoveltyConfidence
  ): Idea {
    const updated = this.updateIdea(projectId, ideaId, {
      novelty_verdict: verdict,
      novelty_evidence: evidence,
      novelty_confidence: confidence,
    });
    logEvent(this.logFile(projectId), "idea_novelty_updated", projectId, { id: ideaId, verdict });
    return updated;
  }

  updateIdeaSaturation(projectId: string, ideaId: string, saturation: Saturation, evidence: string): Idea {
    const current = this.getAllIdeas(projectId).find((i) => i.id === ideaId);
    if (!current) throw new Error(`Unknown idea: ${ideaId}`);
    const status = current.novelty_verdict !== null ? "audited" : current.status;
    const updated = this.updateIdea(projectId, ideaId, { saturation, saturation_evidence: evidence, status });
    logEvent(this.logFile(projectId), "idea_saturation_updated", projectId, { id: ideaId, saturation });
    return updated;
  }

  private getAllIdeaSearchEvidence(projectId: string): IdeaSearchEvidence[] {
    if (!existsSync(this.ideaSearchEvidenceFile(projectId))) return [];
    return JSON.parse(readFileSync(this.ideaSearchEvidenceFile(projectId), "utf-8"));
  }

  saveIdeaSearchEvidence(projectId: string, evidence: IdeaSearchEvidence): void {
    const existing = this.getAllIdeaSearchEvidence(projectId).filter((e) => e.idea_id !== evidence.idea_id);
    writeFileSync(
      this.ideaSearchEvidenceFile(projectId),
      JSON.stringify([...existing, evidence], null, 2),
      "utf-8"
    );
    logEvent(this.logFile(projectId), "idea_search_evidence_saved", projectId, { idea_id: evidence.idea_id });
  }

  getIdeaSearchEvidence(projectId: string, ideaId: string): IdeaSearchEvidence | null {
    return this.getAllIdeaSearchEvidence(projectId).find((e) => e.idea_id === ideaId) ?? null;
  }
}
