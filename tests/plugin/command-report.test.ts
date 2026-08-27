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

  it("covers the implemented report sections", () => {
    for (const section of ["Executive Summary", "Problem Interpretation", "Assumptions", "Research Landscape", "References"]) {
      expect(body).toContain(section);
    }
  });

  it("explicitly marks unimplemented sections rather than fabricating them", () => {
    expect(body).toMatch(/Not Yet Available/);
    expect(body).toMatch(/Candidate Research Ideas/);
    expect(body).toMatch(/never fabricate/i);
  });
});
