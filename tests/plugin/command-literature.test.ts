import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { parseFrontmatter } from "../helpers/frontmatter.js";

const content = readFileSync("commands/literature.md", "utf-8");
const { data, body } = parseFrontmatter(content);

describe("commands/literature.md", () => {
  it("is user-invoked only, runs inline (no fork)", () => {
    expect(data["disable-model-invocation"]).toBe(true);
    expect(data.context).toBeUndefined();
  });

  it("instructs resolving the project and listing retained papers", () => {
    expect(body).toMatch(/get_project_state/);
    expect(body).toMatch(/get_papers/);
    expect(body).toMatch(/retained/);
    expect(body).toMatch(/\$ARGUMENTS/);
  });

  it("instructs reading the spec and literature summary via their own tools, tolerating either being unsaved", () => {
    expect(body).toMatch(/get_problem_spec/);
    expect(body).toMatch(/get_literature_summary/);
    expect(body).toMatch(/No problem spec saved/);
    expect(body).toMatch(/No literature summary saved/);
  });
});
