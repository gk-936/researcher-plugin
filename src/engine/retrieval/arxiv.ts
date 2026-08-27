import { XMLParser } from "fast-xml-parser";
import type { Paper } from "../schemas.js";
import type { PaperSearchProvider } from "./provider.js";
import { ProviderError } from "./provider.js";
import { fetchWithRetry } from "./httpFetch.js";

const ARXIV_API = "https://export.arxiv.org/api/query";

let lastCallAt = 0;

async function politeDelay(minDelayMs: number): Promise<void> {
  const elapsed = Date.now() - lastCallAt;
  if (elapsed < minDelayMs) {
    await new Promise((resolve) => setTimeout(resolve, minDelayMs - elapsed));
  }
  lastCallAt = Date.now();
}

interface ArxivAuthor {
  name: string;
}

interface ArxivEntry {
  id: string;
  title: string;
  summary: string;
  published: string;
  author?: ArxivAuthor | ArxivAuthor[];
}

export function parseArxivFeed(xml: string): Paper[] {
  const parser = new XMLParser({ ignoreAttributes: false });
  const parsed = parser.parse(xml);
  const feed = parsed.feed;
  if (!feed || !feed.entry) return [];
  const entries: ArxivEntry[] = Array.isArray(feed.entry) ? feed.entry : [feed.entry];

  return entries.map((entry) => {
    const idMatch = /abs\/([^v]+)/.exec(entry.id ?? "");
    const arxivId = idMatch ? idMatch[1] : entry.id;
    const authorsRaw = entry.author;
    const authors = Array.isArray(authorsRaw) ? authorsRaw.map((a) => a.name) : authorsRaw ? [authorsRaw.name] : [];
    const year = entry.published ? new Date(entry.published).getFullYear() : null;

    return {
      id: `arxiv:${arxivId}`,
      title: (entry.title ?? "").replace(/\s+/g, " ").trim(),
      authors,
      year,
      venue: "arXiv preprint",
      abstract: entry.summary ? entry.summary.replace(/\s+/g, " ").trim() : null,
      url: entry.id ?? null,
      doi: null,
      arxiv_id: arxivId,
      source: "arxiv" as const,
      source_quality: 0.5,
      retrieved_at: new Date().toISOString(),
      status: "discovered" as const,
      relevance_note: null,
    };
  });
}

export class ArxivProvider implements PaperSearchProvider {
  name = "arxiv";
  constructor(
    private minDelayMs: number,
    private timeoutMs: number
  ) {}

  async search(query: string, limit: number): Promise<Paper[]> {
    await politeDelay(this.minDelayMs);
    const url = `${ARXIV_API}?search_query=${encodeURIComponent(`all:${query}`)}&start=0&max_results=${limit}`;
    try {
      const response = await fetchWithRetry(url, { timeoutMs: this.timeoutMs });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const xml = await response.text();
      return parseArxivFeed(xml);
    } catch (err) {
      throw new ProviderError("arxiv", query, err instanceof Error ? err.message : String(err));
    }
  }
}
