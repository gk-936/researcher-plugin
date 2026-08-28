import type { Paper, Budget, CompactPaper } from "./schemas.js";
import { toCompactPaper } from "./schemas.js";
import type { ProjectStore } from "./storage.js";
import type { PaperSearchProvider } from "./retrieval/provider.js";
import { dedupePapers } from "./dedupe.js";
import { cachePath, readCache, writeCache } from "./cache.js";

export interface SearchPapersResult {
  queries_run: string[];
  queries_truncated: number;
  candidates: CompactPaper[];
  provider_errors: { provider: string; query: string; error: string }[];
}

export interface SearchPapersOptions {
  store: ProjectStore;
  providers: PaperSearchProvider[];
  budget: Budget;
  cacheDir: string;
  projectId: string;
  queries: string[];
  perQueryLimit?: number;
}

function reconcileWithExisting(combined: Paper[], existing: Paper[]): Paper[] {
  return combined.map((paper) => {
    const match = existing.find((e) => dedupePapers([e, paper]).length === 1);
    if (!match || match.id === paper.id) return paper;
    return { ...paper, id: match.id, status: match.status, relevance_note: match.relevance_note };
  });
}

export async function searchPapers(options: SearchPapersOptions): Promise<SearchPapersResult> {
  const { store, providers, budget, cacheDir, projectId, queries, perQueryLimit = 10 } = options;

  const project = store.getProject(projectId);
  if (!project) throw new Error(`Unknown project: ${projectId}`);

  const remaining = Math.max(0, budget.maxDiscoverySearchesPerProject - project.searches_run);
  const queriesToRun = queries.slice(0, remaining);
  const queriesTruncated = queries.length - queriesToRun.length;

  const providerErrors: { provider: string; query: string; error: string }[] = [];
  const freshPapers: Paper[] = [];

  for (const query of queriesToRun) {
    const results = await Promise.all(
      providers.map(async (provider) => {
        const path = cachePath(cacheDir, provider.name, query);
        const cached = readCache<Paper[]>(path, budget.cacheTtlDays);
        if (cached) return cached;
        try {
          const papers = await provider.search(query, perQueryLimit);
          writeCache(path, papers);
          return papers;
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          providerErrors.push({ provider: provider.name, query, error: message });
          return [];
        }
      })
    );
    freshPapers.push(...results.flat());
  }

  if (queriesToRun.length > 0) {
    store.incrementSearchesRun(projectId, queriesToRun.length);
  }

  const existing = store.getAllPapers(projectId);
  const existingIds = new Set(existing.map((p) => p.id));
  const combined = reconcileWithExisting(dedupePapers([...existing, ...freshPapers]), existing);

  const rank = (p: Paper): number => (p.status === "retained" ? 0 : existingIds.has(p.id) ? 1 : 2);
  const capped = [...combined].sort((a, b) => rank(a) - rank(b)).slice(0, budget.maxCandidatesPerProject);

  const merged = store.upsertPapers(projectId, capped);
  const newFreshIds = new Set(dedupePapers(freshPapers).map((p) => p.id));
  const candidates = merged.filter((p) => newFreshIds.has(p.id) && !existingIds.has(p.id)).map(toCompactPaper);

  return { queries_run: queriesToRun, queries_truncated: queriesTruncated, candidates, provider_errors: providerErrors };
}
