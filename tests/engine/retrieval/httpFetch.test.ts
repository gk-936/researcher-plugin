import { describe, expect, it, vi, afterEach } from "vitest";
import { fetchWithRetry } from "../../../src/engine/retrieval/httpFetch.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("fetchWithRetry", () => {
  it("returns the response on first success", async () => {
    const mockFetch = vi.fn().mockResolvedValue(new Response("ok", { status: 200 }));
    vi.stubGlobal("fetch", mockFetch);
    const res = await fetchWithRetry("https://example.com", { timeoutMs: 1000 });
    expect(res.status).toBe(200);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("retries once on a 500 then succeeds", async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce(new Response("err", { status: 500 }))
      .mockResolvedValueOnce(new Response("ok", { status: 200 }));
    vi.stubGlobal("fetch", mockFetch);
    const res = await fetchWithRetry("https://example.com", { timeoutMs: 1000, retries: 1, retryDelayMs: 1 });
    expect(res.status).toBe(200);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it("throws after exhausting retries", async () => {
    const mockFetch = vi.fn().mockResolvedValue(new Response("err", { status: 500 }));
    vi.stubGlobal("fetch", mockFetch);
    await expect(fetchWithRetry("https://example.com", { timeoutMs: 1000, retries: 1, retryDelayMs: 1 })).rejects.toThrow();
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it("propagates a network-level rejection after exhausting retries", async () => {
    const mockFetch = vi.fn().mockRejectedValue(new Error("network down"));
    vi.stubGlobal("fetch", mockFetch);
    await expect(fetchWithRetry("https://example.com", { timeoutMs: 1000, retries: 0 })).rejects.toThrow("network down");
  });
});
