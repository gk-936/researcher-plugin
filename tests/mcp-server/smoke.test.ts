import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

let dir: string;
let client: Client;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "mcp-smoke-"));
  const transport = new StdioClientTransport({
    command: "npx",
    args: ["tsx", join(process.cwd(), "src/mcp-server/index.ts")],
    env: { ...process.env, RESEARCH_DATA_DIR: dir },
  });
  client = new Client({ name: "smoke-test-client", version: "0.0.0" });
  await client.connect(transport);
}, 30000);

afterAll(async () => {
  await client.close();
  if (dir) rmSync(dir, { recursive: true, force: true });
});

describe("research-server MCP smoke test", () => {
  it("lists exactly the 19 expected tools", async () => {
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name).sort();
    expect(names).toEqual(
      [
        "create_project",
        "filter_ideas",
        "get_gaps",
        "get_idea_search_evidence",
        "get_ideas",
        "get_literature_summary",
        "get_papers",
        "get_problem_spec",
        "get_project_state",
        "list_projects",
        "retain_papers",
        "save_gaps",
        "save_idea",
        "save_idea_search_evidence",
        "save_literature_summary",
        "save_problem_spec",
        "search_papers",
        "update_idea_novelty",
        "update_idea_saturation",
      ].sort()
    );
  });

  it("can call create_project end-to-end over stdio", async () => {
    const result = await client.callTool({ name: "create_project", arguments: { problem: "smoke test problem" } });
    const content = result.content as { type: string; text: string }[];
    const parsed = JSON.parse(content[0].text);
    expect(parsed.project_id).toMatch(/^smoke-test-problem-[0-9a-f]{8}$/);
  });
});
