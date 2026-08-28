import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { parseFrontmatter } from "../helpers/frontmatter.js";

const content = readFileSync("agents/research-orchestrator.md", "utf-8");
const { data, body } = parseFrontmatter(content);

describe("agents/research-orchestrator.md", () => {
  it("has the expected frontmatter", () => {
    expect(data.name).toBe("research-orchestrator");
    expect(data.skills).toBe("research-methodology");
    expect(typeof data.maxTurns).toBe("number");
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

  it("shrinks the not-implemented disclosure to the permanent-exclusion boundary", () => {
    expect(body).toMatch(/mutation/i);
    expect(body).toMatch(/citation graph/i);
  });

  it("instructs the rejection rule and delegates mutation for FAIL/SATURATED ideas", () => {
    expect(body).toMatch(/novelty_verdict.*FAIL/s);
    expect(body).toMatch(/SATURATED/);
    expect(body).toMatch(/reject_idea_to_graveyard/);
    expect(body).toMatch(/idea-mutator/);
  });

  it("has maxTurns increased for the extended pipeline", () => {
    expect(data.maxTurns).toBeGreaterThan(150);
  });

  it("instructs selecting top PASS ideas by maxIdeasEvaluated and delegating experiment-designer/reviewer", () => {
    expect(body).toMatch(/maxIdeasEvaluated/);
    expect(body).toMatch(/experiment-designer/);
    expect(body).toMatch(/reviewer/);
    expect(body).toMatch(/novelty_verdict.*PASS|PASS.*novelty_verdict/s);
  });
});
