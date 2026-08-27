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
});
