import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { parseFrontmatter } from "../helpers/frontmatter.js";

const content = readFileSync("commands/report.md", "utf-8");
const { data, body } = parseFrontmatter(content);

describe("commands/report.md", () => {
  it("is user-invoked only, runs inline (no fork)", () => {
    expect(data["disable-model-invocation"]).toBe(true);
    expect(data.context).toBeUndefined();
  });

  it("covers the implemented report sections, including Gaps and Ideas", () => {
    for (const section of [
      "Executive Summary",
      "Problem Interpretation",
      "Assumptions",
      "Research Landscape",
      "Major Research Gaps",
      "Candidate Research Ideas",
      "References",
    ]) {
      expect(body).toContain(section);
    }
  });

  it("instructs pulling gaps and ideas via their own tools", () => {
    expect(body).toMatch(/get_gaps/);
    expect(body).toMatch(/get_ideas/);
  });

  it("instructs ordering ideas by verdict and saturation rather than leaving them unranked", () => {
    expect(body).toMatch(/PASS.*WEAK.*FAIL|order/i);
  });

  it("explicitly marks only the still-unimplemented sections rather than fabricating them", () => {
    expect(body).toMatch(/Not Yet Available/);
    expect(body).toMatch(/Mutated Directions/);
    expect(body).toMatch(/Full Experimental Roadmap/);
    expect(body).toMatch(/never fabricate/i);
  });

  it("instructs reading the spec and literature summary via their own tools, tolerating either being unsaved", () => {
    expect(body).toMatch(/get_problem_spec/);
    expect(body).toMatch(/get_literature_summary/);
  });

  it("covers the newly-implemented Phase 3A sections and restricts the not-yet-available list", () => {
    expect(body).toContain("Saturated / Rejected Directions");
    expect(body).toContain("Mutated Directions");
    expect(body).toMatch(/get_graveyard/);
    expect(body).toMatch(/get_assumptions/);
    const notYetAvailableLine = body.split("\n").find((l) => l.includes("listing, verbatim"));
    expect(notYetAvailableLine).toBeDefined();
    expect(notYetAvailableLine).not.toMatch(/Mutated Directions/);
    expect(notYetAvailableLine).not.toMatch(/Evidence\/Assumption Ledgers/);
    expect(notYetAvailableLine).not.toMatch(/Research Graveyard/);
  });

  it("covers the newly-implemented Phase 4 sections and shrinks the not-yet-available list to just the two permanent exclusions", () => {
    expect(body).toContain("Minimal Validation Experiment");
    expect(body).toContain("Full Experimental Roadmap");
    expect(body).toContain("Potential Reviewer Objections");
    expect(body).toMatch(/get_experiments/);
    expect(body).toMatch(/get_reviews/);
    const notYetAvailableLine = body.split("\n").find((l) => l.includes("listing, verbatim"));
    expect(notYetAvailableLine).toBeDefined();
    expect(notYetAvailableLine).toContain("Citation Graph");
    expect(notYetAvailableLine).toContain("Vector/Embedding Retrieval");
    expect(notYetAvailableLine).not.toMatch(/Minimal Validation Experiment/);
    expect(notYetAvailableLine).not.toMatch(/Full Experimental Roadmap/);
    expect(notYetAvailableLine).not.toMatch(/Potential Reviewer Objections/);
  });
});
