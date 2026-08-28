import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { parseFrontmatter } from "../helpers/frontmatter.js";

const content = readFileSync("agents/reviewer.md", "utf-8");
const { data, body } = parseFrontmatter(content);

describe("agents/reviewer.md", () => {
  it("has the expected frontmatter", () => {
    expect(data.name).toBe("reviewer");
    expect(typeof data.maxTurns).toBe("number");
  });

  it("instructs reading the idea and its experiment design before reviewing", () => {
    expect(body).toMatch(/get_ideas/);
    expect(body).toMatch(/get_experiment/);
    expect(body).toMatch(/save_review/);
  });

  it("documents all four objection categories", () => {
    for (const category of ["novelty", "feasibility", "significance", "evaluation_validity"]) {
      expect(body).toContain(category);
    }
  });

  it("requires overall_recommendation to follow from objection severities, not be assigned independently", () => {
    expect(body).toMatch(/fatal/);
    expect(body).toMatch(/reject/);
    expect(body).toMatch(/independently/i);
  });
});
