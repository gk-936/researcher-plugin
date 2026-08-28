import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";

export interface LogEvent {
  ts: string;
  event: string;
  project_id: string;
  data?: Record<string, unknown>;
}

export function logEvent(logPath: string, event: string, projectId: string, data?: Record<string, unknown>): void {
  mkdirSync(dirname(logPath), { recursive: true });
  const entry: LogEvent = { ts: new Date().toISOString(), event, project_id: projectId, data };
  appendFileSync(logPath, JSON.stringify(entry) + "\n", "utf-8");
}

export function readLog(logPath: string): LogEvent[] {
  if (!existsSync(logPath)) return [];
  const raw = readFileSync(logPath, "utf-8");
  return raw
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as LogEvent);
}
