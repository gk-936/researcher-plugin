import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { parseFrontmatter } from "../helpers/frontmatter.js";

const content = readFileSync("commands/research.md", "utf-8");
const { data, body } = parseFrontmatter(content);

describe("commands/research.md", () => {
  it("forks directly into research-orchestrator, blocking, user-invoked only", () => {
    expect(data.context).toBe("fork");
    expect(data.agent).toBe("research-orchestrator");
    expect(data.background).toBe(false);
    expect(data["disable-model-invocation"]).toBe(true);
    expect(typeof data["argument-hint"]).toBe("string");
  });

  it("passes the problem statement through $ARGUMENTS", () => {
    expect(body).toMatch(/\$ARGUMENTS/);
  });
});
