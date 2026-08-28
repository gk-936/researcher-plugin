import { describe, expect, it, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cacheKey, cachePath, readCache, writeCache } from "../../src/engine/cache.js";

let dir: string;
afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
  vi.useRealTimers();
});

describe("cacheKey", () => {
  it("is stable for the same provider and query, case-insensitively", () => {
    expect(cacheKey("arxiv", "Sample Efficient RL")).toBe(cacheKey("arxiv", "  sample efficient rl  "));
  });

  it("differs across providers for the same query", () => {
    expect(cacheKey("arxiv", "x")).not.toBe(cacheKey("semantic_scholar", "x"));
  });
});

describe("readCache / writeCache", () => {
  it("returns null when the cache file does not exist", () => {
    dir = mkdtempSync(join(tmpdir(), "cache-test-"));
    expect(readCache(join(dir, "missing.json"), 7)).toBeNull();
  });

  it("writes then reads the same value back", () => {
    dir = mkdtempSync(join(tmpdir(), "cache-test-"));
    const path = cachePath(dir, "arxiv", "query");
    writeCache(path, { hello: "world" });
    expect(readCache<{ hello: string }>(path, 7)).toEqual({ hello: "world" });
  });

  it("returns null once the entry is older than the TTL", () => {
    dir = mkdtempSync(join(tmpdir(), "cache-test-"));
    const path = cachePath(dir, "arxiv", "query");
    mkdirSync(join(dir, "arxiv"), { recursive: true });
    const stale = { cached_at: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString(), value: { hello: "world" } };
    writeFileSync(path, JSON.stringify(stale));
    expect(readCache(path, 7)).toBeNull();
  });
});
