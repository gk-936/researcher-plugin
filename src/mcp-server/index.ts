import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { join } from "node:path";
import { ProjectStore } from "../engine/storage.js";
import { loadBudget } from "../engine/budget.js";
import { ArxivProvider } from "../engine/retrieval/arxiv.js";
import { SemanticScholarProvider } from "../engine/retrieval/semanticScholar.js";
import * as tools from "./tools.js";

const dataDir = process.env.RESEARCH_DATA_DIR ?? "./research-data";
const budget = loadBudget(join(dataDir, "config.json"));
const store = new ProjectStore(dataDir);
const cacheDir = join(dataDir, "cache");
const providers = [new ArxivProvider(budget.arxivMinDelayMs, budget.requestTimeoutMs), new SemanticScholarProvider(budget.requestTimeoutMs)];
const ctx: tools.ToolContext = { store, providers, budget, cacheDir };

const server = new McpServer({ name: "research-server", version: "0.1.0" });

function respond(result: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(result) }], structuredContent: result as Record<string, unknown> };
}

server.registerTool(
  "create_project",
  {
    title: "Create Research Project",
    description: "Create a new research project for a problem statement, initializing its on-disk state.",
    inputSchema: tools.createProjectInput,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  },
  async (input) => respond(tools.createProject(ctx, input))
);

server.registerTool(
  "get_project_state",
  {
    title: "Get Research Project State",
    description: "Get the state of a research project, or the most recently created one if no project_id is given.",
    inputSchema: tools.getProjectStateInput,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  async (input) => respond(tools.getProjectState(ctx, input))
);

server.registerTool(
  "list_projects",
  {
    title: "List Research Projects",
    description: "List all research projects, newest first.",
    inputSchema: tools.listProjectsInput,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  async (input) => respond(tools.listProjects(ctx, input))
);

server.registerTool(
  "save_problem_spec",
  {
    title: "Save Problem Spec",
    description: "Save the structured research spec produced by problem analysis for a project.",
    inputSchema: tools.saveProblemSpecInput,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  async (input) => respond(tools.saveProblemSpec(ctx, input))
);

server.registerTool(
  "get_problem_spec",
  {
    title: "Get Problem Spec",
    description: "Get the structured research spec saved for a project (domain, keywords, objectives, assumptions, etc.), or an error if none has been saved yet.",
    inputSchema: tools.getProblemSpecInput,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  async (input) => respond(tools.getProblemSpec(ctx, input))
);

server.registerTool(
  "search_papers",
  {
    title: "Search Papers",
    description: "Search arXiv and Semantic Scholar for the given queries, within the project's remaining discovery-search budget, and store the retained candidates.",
    inputSchema: tools.searchPapersInput,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  },
  async (input) => respond(await tools.searchPapersTool(ctx, input))
);

server.registerTool(
  "get_papers",
  {
    title: "Get Papers",
    description: "Get stored papers for a project, optionally filtered by id list, status, or limit.",
    inputSchema: tools.getPapersInput,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  async (input) => respond(tools.getPapers(ctx, input))
);

server.registerTool(
  "retain_papers",
  {
    title: "Retain Papers",
    description: "Mark discovered papers as retained (relevant), each with a one-line relevance note.",
    inputSchema: tools.retainPapersInput,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  async (input) => respond(tools.retainPapers(ctx, input))
);

server.registerTool(
  "save_literature_summary",
  {
    title: "Save Literature Summary",
    description: "Save a short synthesis of the retained literature landscape for a project.",
    inputSchema: tools.saveLiteratureSummaryInput,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  async (input) => respond(tools.saveLiteratureSummary(ctx, input))
);

server.registerTool(
  "get_literature_summary",
  {
    title: "Get Literature Summary",
    description: "Get the saved literature synthesis summary for a project, or an error if none has been saved yet.",
    inputSchema: tools.getLiteratureSummaryInput,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  async (input) => respond(tools.getLiteratureSummary(ctx, input))
);

server.registerTool(
  "save_gaps",
  {
    title: "Save Research Gaps",
    description: "Save a batch of research gaps found for a project, each citing retained papers as evidence. Caps at the project's gap budget.",
    inputSchema: tools.saveGapsInput,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  },
  async (input) => respond(tools.saveGaps(ctx, input))
);

server.registerTool(
  "get_gaps",
  {
    title: "Get Research Gaps",
    description: "Get the research gaps saved for a project, optionally filtered by id.",
    inputSchema: tools.getGapsInput,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  async (input) => respond(tools.getGaps(ctx, input))
);

server.registerTool(
  "save_idea",
  {
    title: "Save Research Idea",
    description: "Create a new candidate research idea record with its generator-owned fields. Novelty and saturation fields start null.",
    inputSchema: tools.saveIdeaInput,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  },
  async (input) => respond(tools.saveIdea(ctx, input))
);

server.registerTool(
  "get_ideas",
  {
    title: "Get Research Ideas",
    description: "Get the research ideas saved for a project, optionally filtered by id, status, or motivating gap.",
    inputSchema: tools.getIdeasInput,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  async (input) => respond(tools.getIdeas(ctx, input))
);

server.registerTool(
  "filter_ideas",
  {
    title: "Filter Research Ideas",
    description: "Mark the given idea ids as filtered_out (e.g. duplicates or over the audit-shortlist budget). Leaves other ideas untouched.",
    inputSchema: tools.filterIdeasInput,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  async (input) => respond(tools.filterIdeas(ctx, input))
);

server.registerTool(
  "update_idea_novelty",
  {
    title: "Update Idea Novelty",
    description: "Write only the novelty_verdict/novelty_evidence/novelty_confidence fields for an idea, from an adversarial prior-art search.",
    inputSchema: tools.updateIdeaNoveltyInput,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  async (input) => respond(tools.updateIdeaNovelty(ctx, input))
);

server.registerTool(
  "update_idea_saturation",
  {
    title: "Update Idea Saturation",
    description: "Write only the saturation/saturation_evidence fields for an idea. Flips the idea to audited once both novelty and saturation are set.",
    inputSchema: tools.updateIdeaSaturationInput,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  async (input) => respond(tools.updateIdeaSaturation(ctx, input))
);

server.registerTool(
  "save_idea_search_evidence",
  {
    title: "Save Idea Search Evidence",
    description: "Persist the queries and papers a novelty audit search found for one idea, so saturation-detector can reuse it without re-searching.",
    inputSchema: tools.saveIdeaSearchEvidenceInput,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  async (input) => respond(tools.saveIdeaSearchEvidence(ctx, input))
);

server.registerTool(
  "get_idea_search_evidence",
  {
    title: "Get Idea Search Evidence",
    description: "Get the search evidence saved for an idea's novelty audit, or an error if none has been saved yet.",
    inputSchema: tools.getIdeaSearchEvidenceInput,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  async (input) => respond(tools.getIdeaSearchEvidence(ctx, input))
);

server.registerTool(
  "reject_idea_to_graveyard",
  {
    title: "Reject Idea To Graveyard",
    description: "Reject a fully-audited idea (novelty FAIL or saturation SATURATED) to the research graveyard, marking it rejected.",
    inputSchema: tools.rejectIdeaToGraveyardInput,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  },
  async (input) => respond(tools.rejectIdeaToGraveyard(ctx, input))
);

server.registerTool(
  "create_idea_mutation",
  {
    title: "Create Idea Mutation",
    description: "Create one mutated idea from a rejected parent using a named mutation operator, within the project's mutation-depth and total-mutation budgets.",
    inputSchema: tools.createIdeaMutationInput,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  },
  async (input) => respond(tools.createIdeaMutationTool(ctx, input))
);

server.registerTool(
  "save_assumptions",
  {
    title: "Save Assumption Ledger Entries",
    description: "Save a batch of structured assumption-ledger entries for a project.",
    inputSchema: tools.saveAssumptionsInput,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  },
  async (input) => respond(tools.saveAssumptions(ctx, input))
);

server.registerTool(
  "get_assumptions",
  {
    title: "Get Assumption Ledger",
    description: "Get the assumption-ledger entries saved for a project.",
    inputSchema: tools.getAssumptionsInput,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  async (input) => respond(tools.getAssumptions(ctx, input))
);

server.registerTool(
  "get_evidence",
  {
    title: "Get Evidence Ledger",
    description: "Get the evidence-ledger entries for a project (currently derived automatically from saved gaps).",
    inputSchema: tools.getEvidenceInput,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  async (input) => respond(tools.getEvidence(ctx, input))
);

server.registerTool(
  "get_graveyard",
  {
    title: "Get Research Graveyard",
    description: "Get the rejected-idea graveyard entries for a project.",
    inputSchema: tools.getGraveyardInput,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  async (input) => respond(tools.getGraveyard(ctx, input))
);

const transport = new StdioServerTransport();
await server.connect(transport);
