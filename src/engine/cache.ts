import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { createHash } from "node:crypto";

export interface CacheEntry<T> {
  cached_at: string;
  value: T;
}

export function cacheKey(provider: string, query: string): string {
  const normalized = query.trim().toLowerCase();
  return createHash("sha256").update(`${provider}::${normalized}`).digest("hex");
}

export function cachePath(cacheDir: string, provider: string, query: string): string {
  return join(cacheDir, provider, `${cacheKey(provider, query)}.json`);
}

export function readCache<T>(path: string, ttlDays: number): T | null {
  if (!existsSync(path)) return null;
  const entry = JSON.parse(readFileSync(path, "utf-8")) as CacheEntry<T>;
  const ageMs = Date.now() - new Date(entry.cached_at).getTime();
  if (ageMs > ttlDays * 24 * 60 * 60 * 1000) return null;
  return entry.value;
}

export function writeCache<T>(path: string, value: T): void {
  mkdirSync(dirname(path), { recursive: true });
  const entry: CacheEntry<T> = { cached_at: new Date().toISOString(), value };
  writeFileSync(path, JSON.stringify(entry), "utf-8");
}
