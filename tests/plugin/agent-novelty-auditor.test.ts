import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { parseFrontmatter } from "../helpers/frontmatter.js";

const content = readFileSync("agents/novelty-auditor.md", "utf-8");
const { data, body } = parseFrontmatter(content);

describe("agents/novelty-auditor.md", () => {
  it("has the expected frontmatter", () => {
    expect(data.name).toBe("novelty-auditor");
    expect(typeof data.maxTurns).toBe("number");
  });

  it("instructs searching for prior art and checking the shared search budget first", () => {
    expect(body).toMatch(/search_papers/);
    expect(body).toMatch(/searches_remaining/);
  });

  it("distinguishes terminological, conceptual, methodological, and experimental overlap", () => {
    expect(body).toMatch(/terminological/);
    expect(body).toMatch(/conceptual/);
    expect(body).toMatch(/methodological/);
    expect(body).toMatch(/experimental/);
  });

  it("persists search evidence and writes the novelty verdict", () => {
    expect(body).toMatch(/save_idea_search_evidence/);
    expect(body).toMatch(/update_idea_novelty/);
    expect(body).toMatch(/PASS/);
    expect(body).toMatch(/WEAK/);
    expect(body).toMatch(/FAIL/);
  });
});
