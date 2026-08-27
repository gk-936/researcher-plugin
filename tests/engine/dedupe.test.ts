import { describe, expect, it } from "vitest";
import { dedupePapers } from "../../src/engine/dedupe.js";
import type { Paper } from "../../src/engine/schemas.js";

function paper(overrides: Partial<Paper>): Paper {
  return {
    id: "id-1",
    title: "A Great Paper",
    authors: ["Ada Lovelace"],
    year: 2024,
    venue: null,
    abstract: null,
    url: null,
    doi: null,
    arxiv_id: null,
    source: "arxiv",
    source_quality: 0.5,
    retrieved_at: new Date().toISOString(),
    status: "discovered",
    relevance_note: null,
    ...overrides,
  };
}

describe("dedupePapers", () => {
  it("merges two papers with the same arxiv_id into one", () => {
    const a = paper({ id: "arxiv:1", arxiv_id: "1", source_quality: 0.5, abstract: null });
    const b = paper({ id: "s2:xyz", arxiv_id: "1", source: "semantic_scholar", source_quality: 0.7, abstract: "full abstract" });
    const result = dedupePapers([a, b]);
    expect(result).toHaveLength(1);
    expect(result[0].abstract).toBe("full abstract");
  });

  it("keeps papers with different arxiv_ids separate", () => {
    const a = paper({ id: "arxiv:1", arxiv_id: "1" });
    const b = paper({ id: "arxiv:2", arxiv_id: "2" });
    expect(dedupePapers([a, b])).toHaveLength(2);
  });

  it("merges via fuzzy title+author+year match when neither has an id", () => {
    const a = paper({ id: "hash:aaa", title: "Sample Efficient RL!", authors: ["Ada Lovelace"], year: 2024 });
    const b = paper({ id: "hash:bbb", title: "sample efficient rl", authors: ["Ada Lovelace"], year: 2024 });
    expect(dedupePapers([a, b])).toHaveLength(1);
  });

  it("keeps papers with distinct titles separate", () => {
    const a = paper({ id: "hash:aaa", title: "Paper One" });
    const b = paper({ id: "hash:bbb", title: "Paper Two" });
    expect(dedupePapers([a, b])).toHaveLength(2);
  });

  it("prefers the entry with an abstract over one without, regardless of order", () => {
    const withAbstract = paper({ id: "arxiv:1", arxiv_id: "1", abstract: "has content" });
    const without = paper({ id: "arxiv:1b", arxiv_id: "1", abstract: null });
    expect(dedupePapers([without, withAbstract])[0].abstract).toBe("has content");
  });
});
