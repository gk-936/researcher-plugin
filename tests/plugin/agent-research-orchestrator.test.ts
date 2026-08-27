import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { parseFrontmatter } from "../helpers/frontmatter.js";

const content = readFileSync("agents/research-orchestrator.md", "utf-8");
const { data, body } = parseFrontmatter(content);

describe("agents/research-orchestrator.md", () => {
  it("has the expected frontmatter", () => {
    expect(data.name).toBe("research-orchestrator");
    expect(data.skills).toBe("research-methodology");
    expect(data.maxTurns).toBe(40);
  });

  it("instructs creating a project and delegating to both sub-agents", () => {
    expect(body).toMatch(/create_project/);
    expect(body).toMatch(/problem-analyzer/);
    expect(body).toMatch(/literature-scout/);
  });

  it("instructs verifying results before reporting success", () => {
    expect(body).toMatch(/has_spec/);
    expect(body).toMatch(/counts\.retained/);
  });
});
