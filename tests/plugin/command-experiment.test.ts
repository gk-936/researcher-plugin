import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { parseFrontmatter } from "../helpers/frontmatter.js";

const content = readFileSync("commands/experiment.md", "utf-8");
const { data, body } = parseFrontmatter(content);

describe("commands/experiment.md", () => {
  it("is user-invoked only, runs inline (no fork)", () => {
    expect(data["disable-model-invocation"]).toBe(true);
    expect(data.context).toBeUndefined();
  });

  it("instructs resolving the project and listing experiments", () => {
    expect(body).toMatch(/get_experiments/);
    expect(body).toMatch(/\$ARGUMENTS/);
  });

  it("distinguishes an unevaluated idea from a nonexistent one", () => {
    expect(body).toMatch(/get_ideas/);
    expect(body).toMatch(/not evaluated/i);
  });
});
