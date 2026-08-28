import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { parseFrontmatter } from "../helpers/frontmatter.js";

const content = readFileSync("agents/gap-hunter.md", "utf-8");
const { data, body } = parseFrontmatter(content);

describe("agents/gap-hunter.md", () => {
  it("has the expected frontmatter", () => {
    expect(data.name).toBe("gap-hunter");
    expect(typeof data.maxTurns).toBe("number");
  });

  it("instructs reading the spec and retained literature before saving gaps", () => {
    expect(body).toMatch(/get_problem_spec/);
    expect(body).toMatch(/get_papers/);
    expect(body).toMatch(/save_gaps/);
  });

  it("requires evidence_paper_ids and forbids inventing gaps from absence", () => {
    expect(body).toMatch(/evidence_paper_ids/);
    expect(body).toMatch(/absence/i);
  });
});
