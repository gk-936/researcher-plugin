import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { parseFrontmatter } from "../helpers/frontmatter.js";

const content = readFileSync("agents/experiment-designer.md", "utf-8");
const { data, body } = parseFrontmatter(content);

describe("agents/experiment-designer.md", () => {
  it("has the expected frontmatter", () => {
    expect(data.name).toBe("experiment-designer");
    expect(typeof data.maxTurns).toBe("number");
  });

  it("instructs reading the idea and grounding evidence before designing", () => {
    expect(body).toMatch(/get_ideas/);
    expect(body).toMatch(/get_papers/);
    expect(body).toMatch(/save_experiment/);
  });

  it("requires setup, metric, and expected_signal in the minimal validation experiment", () => {
    expect(body).toMatch(/setup/);
    expect(body).toMatch(/metric/);
    expect(body).toMatch(/expected_signal/);
  });

  it("requires risks to be grounded in retained literature, not generic caveats", () => {
    expect(body).toMatch(/risk/i);
    expect(body).toMatch(/generic/i);
  });
});
