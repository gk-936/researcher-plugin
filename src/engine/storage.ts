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
  GraveyardEntrySchema,
  type GraveyardEntry,
  AssumptionLedgerEntrySchema,
  type AssumptionLedgerEntry,
  type NewAssumptionLedgerEntry,
  EvidenceLedgerEntrySchema,
  type EvidenceLedgerEntry,
  type MutationOperator,
  ExperimentSchema,
  type Experiment,
  type NewExperiment,
  ReviewSchema,
  type Review,
  type NewReview,
} from "./schemas.js";
import {
  createProjectId,
  createGapId,
  createIdeaId,
  createGraveyardEntryId,
  createAssumptionId,
  createEvidenceId,
  createExperimentId,
  createReviewId,
} from "./ids.js";
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
  private graveyardFile(id: string): string {
    return join(this.projectDir(id), "graveyard.json");
  }
  private assumptionsFile(id: string): string {
    return join(this.projectDir(id), "assumptions.json");
  }
  private evidenceFile(id: string): string {
    return join(this.projectDir(id), "evidence.json");
  }
  private experimentsFile(id: string): string {
    return join(this.projectDir(id), "experiments.json");
  }
  private reviewsFile(id: string): string {
    return join(this.projectDir(id), "reviews.json");
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

    const existingEvidence = this.getEvidence(projectId);
    let nextEvidenceIndex = existingEvidence.length + 1;
    const newEvidence: EvidenceLedgerEntry[] = created.map((g) => ({
      id: createEvidenceId(nextEvidenceIndex++),
      claim: g.description,
      evidence_paper_ids: g.evidence_paper_ids,
      evidence_type: "observational",
      confidence: g.confidence,
      status: "verified",
      source: "gap",
    }));
    this.saveAllEvidence(projectId, [...existingEvidence, ...newEvidence]);

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
      mutation_depth: 0,
      mutated_from: null,
      mutation_operator: null,
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

  getEvidence(projectId: string): EvidenceLedgerEntry[] {
    if (!existsSync(this.evidenceFile(projectId))) return [];
    const raw = JSON.parse(readFileSync(this.evidenceFile(projectId), "utf-8"));
    return (raw as unknown[]).map((e) => EvidenceLedgerEntrySchema.parse(e));
  }

  private saveAllEvidence(projectId: string, evidence: EvidenceLedgerEntry[]): void {
    writeFileSync(this.evidenceFile(projectId), JSON.stringify(evidence, null, 2), "utf-8");
  }

  getAllAssumptions(projectId: string): AssumptionLedgerEntry[] {
    if (!existsSync(this.assumptionsFile(projectId))) return [];
    const raw = JSON.parse(readFileSync(this.assumptionsFile(projectId), "utf-8"));
    return (raw as unknown[]).map((a) => AssumptionLedgerEntrySchema.parse(a));
  }

  private saveAllAssumptions(projectId: string, assumptions: AssumptionLedgerEntry[]): void {
    writeFileSync(this.assumptionsFile(projectId), JSON.stringify(assumptions, null, 2), "utf-8");
  }

  saveAssumptions(projectId: string, assumptions: NewAssumptionLedgerEntry[]): AssumptionLedgerEntry[] {
    if (!this.getProject(projectId)) throw new Error(`Unknown project: ${projectId}`);
    const existing = this.getAllAssumptions(projectId);
    let nextIndex = existing.length + 1;
    const created = assumptions.map((a) => ({ ...a, id: createAssumptionId(nextIndex++) }));
    this.saveAllAssumptions(projectId, [...existing, ...created]);
    logEvent(this.logFile(projectId), "assumptions_saved", projectId, { count: created.length });
    return created;
  }

  getAssumptions(projectId: string): AssumptionLedgerEntry[] {
    return this.getAllAssumptions(projectId);
  }

  getAllGraveyardEntries(projectId: string): GraveyardEntry[] {
    if (!existsSync(this.graveyardFile(projectId))) return [];
    const raw = JSON.parse(readFileSync(this.graveyardFile(projectId), "utf-8"));
    return (raw as unknown[]).map((g) => GraveyardEntrySchema.parse(g));
  }

  private saveAllGraveyardEntries(projectId: string, entries: GraveyardEntry[]): void {
    writeFileSync(this.graveyardFile(projectId), JSON.stringify(entries, null, 2), "utf-8");
  }

  getGraveyard(projectId: string): GraveyardEntry[] {
    return this.getAllGraveyardEntries(projectId);
  }

  rejectIdeaToGraveyard(
    projectId: string,
    ideaId: string,
    reasonRejected: string,
    potentialRevivalDirection: string | null
  ): GraveyardEntry {
    const idea = this.getAllIdeas(projectId).find((i) => i.id === ideaId);
    if (!idea) throw new Error(`Unknown idea: ${ideaId}`);
    if (idea.novelty_verdict === null || idea.saturation === null) {
      throw new Error(`Idea ${ideaId} must be fully audited before rejection`);
    }
    const existing = this.getAllGraveyardEntries(projectId);
    const entry: GraveyardEntry = {
      id: createGraveyardEntryId(existing.length + 1),
      idea_id: ideaId,
      research_question: idea.research_question,
      hypothesis: idea.hypothesis,
      reason_rejected: reasonRejected,
      novelty_verdict: idea.novelty_verdict,
      saturation: idea.saturation,
      closest_prior_work: idea.closest_prior_work,
      potential_revival_direction: potentialRevivalDirection,
      mutated_into: null,
      rejected_at: new Date().toISOString(),
    };
    this.saveAllGraveyardEntries(projectId, [...existing, entry]);
    this.updateIdea(projectId, ideaId, { status: "rejected" });
    logEvent(this.logFile(projectId), "idea_rejected_to_graveyard", projectId, { idea_id: ideaId });
    return entry;
  }

  createIdeaMutation(
    projectId: string,
    parentIdeaId: string,
    operator: MutationOperator,
    content: NewIdea,
    maxMutationDepth: number,
    maxMutationsPerProject: number
  ): { saved: true; idea: Idea } | { saved: false; reason: string } {
    const state = this.getProject(projectId);
    if (!state) throw new Error(`Unknown project: ${projectId}`);
    const parent = this.getAllIdeas(projectId).find((i) => i.id === parentIdeaId);
    if (!parent) throw new Error(`Unknown idea: ${parentIdeaId}`);
    if (parent.mutation_depth >= maxMutationDepth) {
      return { saved: false, reason: "maxMutationDepth reached" };
    }
    const allIdeas = this.getAllIdeas(projectId);
    const totalMutations = allIdeas.filter((i) => i.mutation_depth > 0).length;
    if (totalMutations >= maxMutationsPerProject) {
      return { saved: false, reason: "maxMutationsPerProject budget exhausted" };
    }
    const created: Idea = {
      ...content,
      id: createIdeaId(allIdeas.length + 1),
      status: "generated",
      novelty_verdict: null,
      novelty_evidence: null,
      novelty_confidence: null,
      saturation: null,
      saturation_evidence: null,
      mutation_depth: parent.mutation_depth + 1,
      mutated_from: parentIdeaId,
      mutation_operator: operator,
    };
    this.saveAllIdeas(projectId, [...allIdeas, created]);

    const graveyard = this.getAllGraveyardEntries(projectId);
    const idx = graveyard.findIndex((g) => g.idea_id === parentIdeaId);
    if (idx !== -1) {
      graveyard[idx] = { ...graveyard[idx], mutated_into: created.id };
      this.saveAllGraveyardEntries(projectId, graveyard);
    }

    if (!state.phases_completed.includes("idea_mutation")) {
      state.phases_completed.push("idea_mutation");
      this.saveProject(state);
    }
    logEvent(this.logFile(projectId), "idea_mutation_created", projectId, {
      parent_idea_id: parentIdeaId,
      new_idea_id: created.id,
      operator,
    });
    return { saved: true, idea: created };
  }

  private getAllExperimentsRaw(projectId: string): Experiment[] {
    if (!existsSync(this.experimentsFile(projectId))) return [];
    const raw = JSON.parse(readFileSync(this.experimentsFile(projectId), "utf-8"));
    return (raw as unknown[]).map((e) => ExperimentSchema.parse(e));
  }

  private saveAllExperiments(projectId: string, experiments: Experiment[]): void {
    writeFileSync(this.experimentsFile(projectId), JSON.stringify(experiments, null, 2), "utf-8");
  }

  getAllExperiments(projectId: string): Experiment[] {
    return this.getAllExperimentsRaw(projectId);
  }

  getExperiment(projectId: string, ideaId: string): Experiment | null {
    return this.getAllExperimentsRaw(projectId).find((e) => e.idea_id === ideaId) ?? null;
  }

  saveExperiment(projectId: string, ideaId: string, experiment: NewExperiment): Experiment {
    if (!this.getProject(projectId)) throw new Error(`Unknown project: ${projectId}`);
    const existing = this.getAllExperimentsRaw(projectId);
    const withoutThisIdea = existing.filter((e) => e.idea_id !== ideaId);
    const created: Experiment = { ...experiment, id: createExperimentId(existing.length + 1) };
    this.saveAllExperiments(projectId, [...withoutThisIdea, created]);
    logEvent(this.logFile(projectId), "experiment_saved", projectId, { idea_id: ideaId });
    return created;
  }

  private getAllReviewsRaw(projectId: string): Review[] {
    if (!existsSync(this.reviewsFile(projectId))) return [];
    const raw = JSON.parse(readFileSync(this.reviewsFile(projectId), "utf-8"));
    return (raw as unknown[]).map((r) => ReviewSchema.parse(r));
  }

  private saveAllReviews(projectId: string, reviews: Review[]): void {
    writeFileSync(this.reviewsFile(projectId), JSON.stringify(reviews, null, 2), "utf-8");
  }

  getAllReviews(projectId: string): Review[] {
    return this.getAllReviewsRaw(projectId);
  }

  getReview(projectId: string, ideaId: string): Review | null {
    return this.getAllReviewsRaw(projectId).find((r) => r.idea_id === ideaId) ?? null;
  }

  saveReview(projectId: string, ideaId: string, review: NewReview): Review {
    if (!this.getProject(projectId)) throw new Error(`Unknown project: ${projectId}`);
    const existing = this.getAllReviewsRaw(projectId);
    const withoutThisIdea = existing.filter((r) => r.idea_id !== ideaId);
    const created: Review = { ...review, id: createReviewId(existing.length + 1) };
    this.saveAllReviews(projectId, [...withoutThisIdea, created]);
    logEvent(this.logFile(projectId), "review_saved", projectId, { idea_id: ideaId });
    return created;
  }
}
