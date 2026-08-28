import { createHash, randomUUID } from "node:crypto";

export function slugify(text: string, maxWords = 5): string {
  const words = text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, maxWords);
  return words.join("-") || "project";
}

export function createProjectId(problem: string): string {
  const suffix = randomUUID().replace(/-/g, "").slice(0, 8);
  return `${slugify(problem)}-${suffix}`;
}

export function hashPaperId(title: string, year: number | null): string {
  const normalized = title.toLowerCase().replace(/[^a-z0-9]/g, "");
  const hash = createHash("sha1").update(`${normalized}:${year ?? ""}`).digest("hex").slice(0, 16);
  return `hash:${hash}`;
}

export function createGapId(index: number): string {
  return `gap-${String(index).padStart(3, "0")}`;
}

export function createIdeaId(index: number): string {
  return `idea-${String(index).padStart(3, "0")}`;
}
