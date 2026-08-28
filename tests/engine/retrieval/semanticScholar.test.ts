import { describe, expect, it, vi, afterEach } from "vitest";
import { parseSemanticScholarResponse, SemanticScholarProvider } from "../../../src/engine/retrieval/semanticScholar.js";

const FIXTURE = {
  data: [
    {
      paperId: "abc123",
      title: "Sample Efficient World Models",
      abstract: "We study sample efficiency.",
      year: 2024,
      venue: "NeurIPS",
      authors: [{ name: "Ada Lovelace" }],
      externalIds: { DOI: "10.1000/xyz", ArXiv: "2401.00001" },
      url: "https://www.semanticscholar.org/paper/abc123",
    },
    {
      paperId: "def456",
      title: "Sparse Reward RL",
      abstract: null,
      year: 2023,
      venue: null,
      authors: [{ name: "Grace Hopper" }],
      url: null,
    },
  ],
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("parseSemanticScholarResponse", () => {
  it("parses papers with doi/arxiv_id and venue-based source_quality", () => {
    const papers = parseSemanticScholarResponse(FIXTURE);
    expect(papers).toHaveLength(2);
    expect(papers[0].id).toBe("s2:abc123");
    expect(papers[0].doi).toBe("10.1000/xyz");
    expect(papers[0].arxiv_id).toBe("2401.00001");
    expect(papers[0].source_quality).toBe(0.7);
    expect(papers[1].venue).toBeNull();
    expect(papers[1].source_quality).toBe(0.4);
  });

  it("returns an empty array when data is missing", () => {
    expect(parseSemanticScholarResponse({})).toEqual([]);
  });
});

describe("SemanticScholarProvider", () => {
  it("fetches and parses successfully", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify(FIXTURE), { status: 200 })));
    const provider = new SemanticScholarProvider(5000);
    const papers = await provider.search("sample efficient RL", 10);
    expect(papers).toHaveLength(2);
  });

  it("throws a ProviderError when the request ultimately fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("err", { status: 500 })));
    const provider = new SemanticScholarProvider(5000);
    await expect(provider.search("x", 10)).rejects.toMatchObject({ name: "ProviderError", provider: "semantic_scholar" });
  });
});
