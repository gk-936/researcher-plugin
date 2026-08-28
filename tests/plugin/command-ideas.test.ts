import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { parseFrontmatter } from "../helpers/frontmatter.js";

const content = readFileSync("commands/ideas.md", "utf-8");
const { data, body } = parseFrontmatter(content);

describe("commands/ideas.md", () => {
  it("is user-invoked only, runs inline (no fork)", () => {
    expect(data["disable-model-invocation"]).toBe(true);
    expect(data.context).toBeUndefined();
  });

  it("instructs resolving the project and listing ideas with their verdicts", () => {
    expect(body).toMatch(/get_ideas/);
    expect(body).toMatch(/novelty_verdict/);
    expect(body).toMatch(/saturation/);
    expect(body).toMatch(/\$ARGUMENTS/);
  });

  it("says plainly when no ideas exist yet or an audit hasn't completed", () => {
    expect(body).toMatch(/no ideas/i);
    expect(body).toMatch(/null/);
  });
});
