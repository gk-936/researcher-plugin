import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const readme = readFileSync("README.md", "utf-8");

describe("README.md", () => {
  it("documents installation, configuration, commands, architecture, and limitations", () => {
    for (const heading of ["## Installation", "## Configuration", "## Commands", "## Architecture", "## Example Run", "## Limitations"]) {
      expect(readme).toContain(heading);
    }
  });

  it("documents --plugin-dir as the local dev install path", () => {
    expect(readme).toMatch(/--plugin-dir/);
  });

  it("names /research, /literature, and /report, and flags the not-yet-implemented commands", () => {
    expect(readme).toMatch(/\/research/);
    expect(readme).toMatch(/\/literature/);
    expect(readme).toMatch(/\/report/);
    expect(readme).toMatch(/\/gaps/);
    expect(readme).toMatch(/\/ideas/);
  });
});
