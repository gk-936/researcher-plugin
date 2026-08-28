import type { Paper } from "../schemas.js";
import type { PaperSearchProvider } from "./provider.js";
import { ProviderError } from "./provider.js";
import { fetchWithRetry } from "./httpFetch.js";

const S2_API = "https://api.semanticscholar.org/graph/v1/paper/search";
const FIELDS = "title,abstract,year,venue,authors,externalIds,url";

interface S2Paper {
  paperId: string;
  title: string;
  abstract: string | null;
  year: number | null;
  venue: string | null;
  authors: { name: string }[];
  externalIds?: { DOI?: string; ArXiv?: string };
  url: string | null;
}

export function parseSemanticScholarResponse(json: { data?: S2Paper[] }): Paper[] {
  const papers = json.data ?? [];
  return papers.map((p) => ({
    id: `s2:${p.paperId}`,
    title: p.title,
    authors: (p.authors ?? []).map((a) => a.name),
    year: p.year ?? null,
    venue: p.venue || null,
    abstract: p.abstract ?? null,
    url: p.url ?? null,
    doi: p.externalIds?.DOI ?? null,
    arxiv_id: p.externalIds?.ArXiv ?? null,
    source: "semantic_scholar" as const,
    source_quality: p.venue ? 0.7 : 0.4,
    retrieved_at: new Date().toISOString(),
    status: "discovered" as const,
    relevance_note: null,
  }));
}

export class SemanticScholarProvider implements PaperSearchProvider {
  name = "semantic_scholar";
  constructor(private timeoutMs: number) {}

  async search(query: string, limit: number): Promise<Paper[]> {
    const url = `${S2_API}?query=${encodeURIComponent(query)}&limit=${limit}&fields=${FIELDS}`;
    try {
      const response = await fetchWithRetry(url, { timeoutMs: this.timeoutMs });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const json = (await response.json()) as { data?: S2Paper[] };
      return parseSemanticScholarResponse(json);
    } catch (err) {
      throw new ProviderError("semantic_scholar", query, err instanceof Error ? err.message : String(err));
    }
  }
}
