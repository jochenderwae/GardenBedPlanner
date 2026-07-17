import type { paths } from "./schema";

type HealthResponse =
  paths["/api/health"]["get"]["responses"][200]["content"]["application/json"];

export async function getHealth(): Promise<HealthResponse> {
  const res = await fetch("/api/health");
  if (!res.ok) {
    throw new Error(`GET /api/health failed: ${res.status}`);
  }
  return res.json() as Promise<HealthResponse>;
}
