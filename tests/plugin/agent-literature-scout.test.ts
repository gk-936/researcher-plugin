import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { parseFrontmatter } from "../helpers/frontmatter.js";

const content = readFileSync("agents/literature-scout.md", "utf-8");
const { data, body } = parseFrontmatter(content);

describe("agents/literature-scout.md", () => {
  it("has the expected frontmatter", () => {
    expect(data.name).toBe("literature-scout");
    expect(data.maxTurns).toBe(20);
  });

  it("instructs the full search-retain-summarize flow", () => {
    expect(body).toMatch(/search_papers/);
    expect(body).toMatch(/retain_papers/);
    expect(body).toMatch(/save_literature_summary/);
  });

  it("instructs honest reporting on truncation and provider failures", () => {
    expect(body).toMatch(/queries_truncated/);
    expect(body).toMatch(/provider_errors/);
    expect(body).toMatch(/[Dd]o not invent papers/);
  });
});
