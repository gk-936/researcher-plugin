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

const transport = new StdioServerTransport();
await server.connect(transport);
