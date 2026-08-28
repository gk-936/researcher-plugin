import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { parseFrontmatter } from "../helpers/frontmatter.js";

const content = readFileSync("commands/gaps.md", "utf-8");
const { data, body } = parseFrontmatter(content);

describe("commands/gaps.md", () => {
  it("is user-invoked only, runs inline (no fork)", () => {
    expect(data["disable-model-invocation"]).toBe(true);
    expect(data.context).toBeUndefined();
  });

  it("instructs resolving the project and listing gaps", () => {
    expect(body).toMatch(/get_gaps/);
    expect(body).toMatch(/\$ARGUMENTS/);
  });

  it("says plainly when no gaps exist yet", () => {
    expect(body).toMatch(/no gaps/i);
  });
});
