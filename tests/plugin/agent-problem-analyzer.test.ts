import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { parseFrontmatter } from "../helpers/frontmatter.js";

const content = readFileSync("agents/problem-analyzer.md", "utf-8");
const { data, body } = parseFrontmatter(content);

describe("agents/problem-analyzer.md", () => {
  it("has the expected frontmatter", () => {
    expect(data.name).toBe("problem-analyzer");
    expect(data.maxTurns).toBe(8);
  });

  it("lists every ResearchSpec field and instructs saving it", () => {
    for (const field of [
      "domain",
      "subdomains",
      "research_question",
      "objectives",
      "constraints",
      "assumptions",
      "target_setting",
      "keywords",
      "synonyms",
      "related_concepts",
      "adjacent_fields",
      "candidate_search_terms",
      "likely_evaluation_criteria",
    ]) {
      expect(body).toMatch(new RegExp(field));
    }
    expect(body).toMatch(/save_problem_spec/);
  });

  it("instructs deriving terminology from the problem rather than hardcoding a domain", () => {
    expect(body).toMatch(/hardcode/);
  });
});
