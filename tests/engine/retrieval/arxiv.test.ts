import { describe, expect, it, vi, afterEach } from "vitest";
import { parseArxivFeed, ArxivProvider } from "../../../src/engine/retrieval/arxiv.js";

const FIXTURE_FEED = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <entry>
    <id>http://arxiv.org/abs/2401.00001v1</id>
    <published>2024-01-01T00:00:00Z</published>
    <title>  Sample Efficient   World Models  </title>
    <summary>  We study sample efficiency   in world models.  </summary>
    <author><name>Ada Lovelace</name></author>
    <author><name>Alan Turing</name></author>
  </entry>
  <entry>
    <id>http://arxiv.org/abs/2401.00002v2</id>
    <published>2023-06-15T00:00:00Z</published>
    <title>Sparse Reward RL</title>
    <summary>A study of sparse rewards.</summary>
    <author><name>Grace Hopper</name></author>
  </entry>
</feed>`;

const EMPTY_FEED = `<?xml version="1.0" encoding="UTF-8"?><feed xmlns="http://www.w3.org/2005/Atom"></feed>`;

const SINGLE_ENTRY_FEED = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <entry>
    <id>http://arxiv.org/abs/2401.00003v1</id>
    <published>2022-03-10T00:00:00Z</published>
    <title>Solo Entry Feed</title>
    <summary>A feed with just one entry.</summary>
    <author><name>Katherine Johnson</name></author>
  </entry>
</feed>`;

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("parseArxivFeed", () => {
  it("parses multiple entries with normalized whitespace", () => {
    const papers = parseArxivFeed(FIXTURE_FEED);
    expect(papers).toHaveLength(2);
    expect(papers[0].title).toBe("Sample Efficient World Models");
    expect(papers[0].abstract).toBe("We study sample efficiency in world models.");
    expect(papers[0].authors).toEqual(["Ada Lovelace", "Alan Turing"]);
    expect(papers[0].arxiv_id).toBe("2401.00001");
    expect(papers[0].id).toBe("arxiv:2401.00001");
    expect(papers[0].year).toBe(2024);
    expect(papers[0].source).toBe("arxiv");

    expect(papers[1].title).toBe("Sparse Reward RL");
    expect(papers[1].abstract).toBe("A study of sparse rewards.");
    expect(papers[1].authors).toEqual(["Grace Hopper"]);
    expect(papers[1].arxiv_id).toBe("2401.00002");
    expect(papers[1].id).toBe("arxiv:2401.00002");
    expect(papers[1].year).toBe(2023);
  });

  it("returns an empty array for a feed with no entries", () => {
    expect(parseArxivFeed(EMPTY_FEED)).toEqual([]);
  });

  it("parses a feed with a single entry (non-array author/entry branches)", () => {
    const papers = parseArxivFeed(SINGLE_ENTRY_FEED);
    expect(papers).toHaveLength(1);
    expect(papers[0].title).toBe("Solo Entry Feed");
    expect(papers[0].id).toBe("arxiv:2401.00003");
    expect(papers[0].arxiv_id).toBe("2401.00003");
    expect(papers[0].authors).toEqual(["Katherine Johnson"]);
    expect(papers[0].year).toBe(2022);
  });
});

describe("ArxivProvider", () => {
  it("fetches and parses successfully", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(FIXTURE_FEED, { status: 200 })));
    const provider = new ArxivProvider(0, 5000);
    const papers = await provider.search("sample efficient RL", 10);
    expect(papers).toHaveLength(2);
  });

  it("throws a ProviderError when the request ultimately fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("err", { status: 500 })));
    const provider = new ArxivProvider(0, 5000);
    await expect(provider.search("x", 10)).rejects.toMatchObject({ name: "ProviderError", provider: "arxiv" });
  });
});
