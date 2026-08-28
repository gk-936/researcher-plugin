import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { parseFrontmatter } from "../helpers/frontmatter.js";

const content = readFileSync("agents/idea-generator.md", "utf-8");
const { data, body } = parseFrontmatter(content);

describe("agents/idea-generator.md", () => {
  it("has the expected frontmatter", () => {
    expect(data.name).toBe("idea-generator");
    expect(typeof data.maxTurns).toBe("number");
  });

  it("instructs reading gaps and the spec before saving ideas one at a time", () => {
    expect(body).toMatch(/get_gaps/);
    expect(body).toMatch(/get_problem_spec/);
    expect(body).toMatch(/save_idea\b/);
  });

  it("instructs tagging each idea with a distinct strategy", () => {
    expect(body).toMatch(/strategy/);
  });

  it("forbids the generator from judging novelty or saturation", () => {
    expect(body).toMatch(/never (?:set|sets|impl)/i);
    expect(body).toMatch(/null/);
  });
});
