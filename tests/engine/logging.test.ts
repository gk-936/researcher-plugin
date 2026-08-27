import { describe, expect, it, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { logEvent, readLog } from "../../src/engine/logging.js";

let dir: string;
afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
});

describe("logEvent / readLog", () => {
  it("appends JSONL entries and reads them back in order", () => {
    dir = mkdtempSync(join(tmpdir(), "log-test-"));
    const logPath = join(dir, "sub", "log.jsonl");
    logEvent(logPath, "project_created", "proj-1", { problem: "x" });
    logEvent(logPath, "spec_saved", "proj-1");

    const entries = readLog(logPath);
    expect(entries).toHaveLength(2);
    expect(entries[0].event).toBe("project_created");
    expect(entries[0].data).toEqual({ problem: "x" });
    expect(entries[1].event).toBe("spec_saved");
    expect(typeof entries[0].ts).toBe("string");
  });

  it("returns an empty array when the log file does not exist", () => {
    dir = mkdtempSync(join(tmpdir(), "log-test-"));
    expect(readLog(join(dir, "missing.jsonl"))).toEqual([]);
  });
});
