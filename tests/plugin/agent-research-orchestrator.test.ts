import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { parseFrontmatter } from "../helpers/frontmatter.js";

const content = readFileSync("agents/research-orchestrator.md", "utf-8");
const { data, body } = parseFrontmatter(content);

describe("agents/research-orchestrator.md", () => {
  it("has the expected frontmatter", () => {
    expect(data.name).toBe("research-orchestrator");
    expect(data.skills).toBe("research-methodology");
    expect(data.maxTurns).toBe(80);
  });

  it("instructs creating a project and delegating through all Phase 1+2 sub-agents", () => {
    expect(body).toMatch(/create_project/);
    expect(body).toMatch(/problem-analyzer/);
    expect(body).toMatch(/literature-scout/);
    expect(body).toMatch(/gap-hunter/);
    expect(body).toMatch(/idea-generator/);
    expect(body).toMatch(/novelty-auditor/);
    expect(body).toMatch(/saturation-detector/);
  });

  it("instructs verifying results before reporting success at every stage", () => {
    expect(body).toMatch(/has_spec/);
    expect(body).toMatch(/counts\.retained/);
    expect(body).toMatch(/counts\.gaps/);
    expect(body).toMatch(/counts\.ideas_generated/);
    expect(body).toMatch(/novelty_verdict/);
    expect(body).toMatch(/saturation/);
  });

  it("instructs the cheap orchestrator-side filter step using filter_ideas", () => {
    expect(body).toMatch(/filter_ideas/);
    expect(body).toMatch(/maxIdeasAudited/);
  });

  it("forbids gap-hunter and idea-generator from claiming audit verdicts", () => {
    expect(body).toMatch(/[Nn]ever let `?gap-hunter`?/);
    expect(body).toMatch(/null/);
  });

  it("shrinks the not-implemented disclosure to the Phase 3/4 boundary", () => {
    expect(body).toMatch(/mutation/i);
    expect(body).toMatch(/citation graph/i);
    expect(body).toMatch(/reviewer simulation/i);
  });
});
