import { load } from "js-yaml";

export function parseFrontmatter(content: string): { data: Record<string, unknown>; body: string } {
  const normalized = content.replace(/\r\n/g, "\n");
  const match = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(normalized);
  if (!match) return { data: {}, body: content };
  const data = (load(match[1]) as Record<string, unknown>) ?? {};
  return { data, body: match[2] };
}
