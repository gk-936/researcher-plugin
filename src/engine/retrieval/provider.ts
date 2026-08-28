import type { Paper } from "../schemas.js";

export class ProviderError extends Error {
  provider: string;
  query: string;
  constructor(provider: string, query: string, message: string) {
    super(message);
    this.name = "ProviderError";
    this.provider = provider;
    this.query = query;
  }
}

export interface PaperSearchProvider {
  name: string;
  search(query: string, limit: number): Promise<Paper[]>;
}
