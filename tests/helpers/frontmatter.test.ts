import { describe, expect, it } from "vitest";
import { parseFrontmatter } from "./frontmatter.js";

describe("parseFrontmatter", () => {
  it("parses YAML frontmatter and separates it from the body", () => {
    const content = "---\nname: example\ndescription: does a thing\n---\nBody text here.\n";
    const { data, body } = parseFrontmatter(content);
    expect(data).toEqual({ name: "example", description: "does a thing" });
    expect(body.trim()).toBe("Body text here.");
  });

  it("returns empty data and the full content when there is no frontmatter", () => {
    const { data, body } = parseFrontmatter("Just a body, no frontmatter.");
    expect(data).toEqual({});
    expect(body).toBe("Just a body, no frontmatter.");
  });
});
