import type { Paper } from "./schemas.js";

function normalizeTitle(title: string): string {
  return title.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function fuzzyKey(p: Paper): string {
  const firstAuthor = (p.authors[0] ?? "").toLowerCase().replace(/[^a-z]/g, "");
  return `fuzzy:${normalizeTitle(p.title)}::${firstAuthor}::${p.year ?? ""}`;
}

function keyFor(p: Paper): string {
  if (p.arxiv_id) return `arxiv:${p.arxiv_id}`;
  if (p.doi) return `doi:${p.doi.toLowerCase()}`;

  // Check for degenerate fuzzy key and fall back to unique id
  const normalizedTitle = normalizeTitle(p.title);
  const firstAuthor = (p.authors[0] ?? "").toLowerCase().replace(/[^a-z]/g, "");
  const isDegenerate = normalizedTitle === "" && firstAuthor === "" && p.year === null;

  if (isDegenerate) {
    return `unique:${p.id}`;
  }

  return fuzzyKey(p);
}

function preferBetter(a: Paper, b: Paper): Paper {
  const score = (p: Paper) => (p.abstract ? 1 : 0) + p.source_quality;
  return score(b) > score(a) ? b : a;
}

export function dedupePapers(papers: Paper[]): Paper[] {
  const groups = new Map<string, Paper>();
  for (const paper of papers) {
    const key = keyFor(paper);
    const existing = groups.get(key);
    groups.set(key, existing ? preferBetter(existing, paper) : paper);
  }
  return Array.from(groups.values());
}
