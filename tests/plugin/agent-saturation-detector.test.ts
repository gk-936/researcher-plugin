import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { parseFrontmatter } from "../helpers/frontmatter.js";

const content = readFileSync("agents/saturation-detector.md", "utf-8");
const { data, body } = parseFrontmatter(content);

describe("agents/saturation-detector.md", () => {
  it("has the expected frontmatter", () => {
    expect(data.name).toBe("saturation-detector");
    expect(typeof data.maxTurns).toBe("number");
  });

  it("instructs reusing novelty-auditor's search evidence before re-searching", () => {
    expect(body).toMatch(/get_idea_search_evidence/);
    expect(body).toMatch(/re-search/i);
  });

  it("names the full saturation vocabulary", () => {
    for (const level of ["UNEXPLORED", "UNDEREXPLORED", "EMERGING", "ACTIVE", "CROWDED", "SATURATED"]) {
      expect(body).toContain(level);
    }
  });

  it("states explicitly that no citation-activity signal is used", () => {
    expect(body).toMatch(/citation/i);
    expect(body).toMatch(/no citation graph/i);
  });

  it("writes the saturation verdict", () => {
    expect(body).toMatch(/update_idea_saturation/);
  });
});
