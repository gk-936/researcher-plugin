import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { parseFrontmatter } from "../helpers/frontmatter.js";

const content = readFileSync("skills/research-methodology/SKILL.md", "utf-8");
const { data, body } = parseFrontmatter(content);

describe("skills/research-methodology/SKILL.md", () => {
  it("has the expected frontmatter", () => {
    expect(data.name).toBe("research-methodology");
    expect(typeof data.description).toBe("string");
    expect((data.description as string).length).toBeGreaterThan(0);
    expect(data["user-invocable"]).toBe(false);
  });

  it("documents the novelty vocabulary and current phase boundaries", () => {
    expect(body).toMatch(/Genuine research opportunity/);
    expect(body).toMatch(/Saturated/);
    expect(body).toMatch(/not implemented/);
  });

  it("documents gap-hunting evidence discipline", () => {
    expect(body).toMatch(/evidence_paper_ids/);
  });

  it("documents that idea-generator never judges novelty or saturation", () => {
    expect(body).toMatch(/idea-generator/);
    expect(body).toMatch(/no single agent is the sole authority/i);
  });

  it("documents the full saturation vocabulary and the no-citation-signal caveat", () => {
    for (const level of ["UNEXPLORED", "UNDEREXPLORED", "EMERGING", "ACTIVE", "CROWDED", "SATURATED"]) {
      expect(body).toContain(level);
    }
    expect(body).toMatch(/no citation-activity signal/i);
  });

  it("documents that the novelty-auditor search budget is shared, not separate", () => {
    expect(body).toMatch(/shares? the same discovery-search budget|shared.*budget/i);
    expect(body).toMatch(/searches_remaining/);
  });

  it("documents the rejection rule and mutation/ledger phase boundary update", () => {
    expect(body).toMatch(/FAIL.*SATURATED|SATURATED.*FAIL/s);
    expect(body).toMatch(/mutation/i);
    expect(body).not.toMatch(/Idea mutation, the evidence\/assumption ledgers, the research graveyard.*not implemented/s);
  });

  it("documents experiment-design and review discipline, and the Phase 4 phase boundary", () => {
    expect(body).toMatch(/minimal validation experiment/i);
    expect(body).toMatch(/fatal/);
    expect(body).toMatch(/independently/i);
    expect(body).not.toMatch(/Citation graphs, vector\/embedding retrieval, experiment design, and reviewer simulation are not implemented/);
  });
});
