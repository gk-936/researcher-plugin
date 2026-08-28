import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { parseFrontmatter } from "../helpers/frontmatter.js";

const content = readFileSync("agents/idea-mutator.md", "utf-8");
const { data, body } = parseFrontmatter(content);

describe("agents/idea-mutator.md", () => {
  it("has the expected frontmatter", () => {
    expect(data.name).toBe("idea-mutator");
    expect(typeof data.maxTurns).toBe("number");
  });

  it("instructs reading the graveyard entry and choosing one targeted operator", () => {
    expect(body).toMatch(/get_graveyard/);
    expect(body).toMatch(/create_idea_mutation/);
    expect(body).toMatch(/CHANGE_TASK/);
  });

  it("instructs producing exactly one mutation, not a mechanical default", () => {
    expect(body).toMatch(/one/i);
  });
});
