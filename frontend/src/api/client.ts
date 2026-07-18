import type { components, paths } from "./schema";

type HealthResponse =
  paths["/api/health"]["get"]["responses"][200]["content"]["application/json"];

export async function getHealth(): Promise<HealthResponse> {
  const res = await fetch("/api/health");
  if (!res.ok) {
    throw new Error(`GET /api/health failed: ${res.status}`);
  }
  return res.json() as Promise<HealthResponse>;
}

export type Plant = components["schemas"]["Plant"];
export type PlantDetail = components["schemas"]["PlantDetail"];
export type PlantUpdate = components["schemas"]["PlantUpdate"];
export type PlantDataSource = components["schemas"]["PlantDataSource"];
export type PlantPeriod = components["schemas"]["PlantPeriod"];
export type PlantCompanion = components["schemas"]["PlantCompanion"];
export type PlantBeddingNeed = components["schemas"]["PlantBeddingNeed"];
export type PlantPestInteraction = components["schemas"]["PlantPestInteraction"];
export type PlantGrowingInformation = components["schemas"]["PlantGrowingInformation"];
export type SeedInfo = components["schemas"]["SeedInfo"];
export type PeriodType = components["schemas"]["PeriodType"];

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  if (!res.ok) {
    throw new Error(`${init?.method ?? "GET"} ${path} failed: ${res.status}`);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export function listPlants(limit = 500): Promise<Plant[]> {
  return apiFetch(`/api/plants?limit=${limit}`);
}

export function getPlant(slug: string): Promise<PlantDetail> {
  return apiFetch(`/api/plants/${encodeURIComponent(slug)}`);
}

export function updatePlant(slug: string, patch: PlantUpdate): Promise<Plant> {
  return apiFetch(`/api/plants/${encodeURIComponent(slug)}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
}

export function listPeriodTypes(): Promise<PeriodType[]> {
  return apiFetch(`/api/period-types`);
}

function satellitePath(slug: string, segment: string): string {
  return `/api/plants/${encodeURIComponent(slug)}/${segment}`;
}

/** Every satellite table shaped like (int id PK, plant_slug FK, ...rest) -
 * data_sources/periods/bedding_needs/pest_interactions/growing_information
 * - only supports list/create/delete on the backend, so that's all that's
 * exposed here. Mirrors the backend's own _register_satellite_routes. */
function satelliteApi<T extends { id?: number | null }>(segment: string) {
  return {
    create: (slug: string, item: Omit<T, "id" | "plant_slug">): Promise<T> =>
      apiFetch(satellitePath(slug, segment), {
        method: "POST",
        body: JSON.stringify({ ...item, plant_slug: slug }),
      }),
    remove: (slug: string, id: number): Promise<void> =>
      apiFetch(`${satellitePath(slug, segment)}/${id}`, { method: "DELETE" }),
  };
}

export const dataSourceApi = satelliteApi<PlantDataSource>("data-sources");
export const periodApi = satelliteApi<PlantPeriod>("periods");
export const beddingNeedApi = satelliteApi<PlantBeddingNeed>("bedding-needs");
export const pestInteractionApi = satelliteApi<PlantPestInteraction>("pest-interactions");
export const growingInfoApi = satelliteApi<PlantGrowingInformation>("growing-information");

export function createCompanion(
  slug: string,
  item: Omit<PlantCompanion, "plant_slug">,
): Promise<PlantCompanion> {
  return apiFetch(satellitePath(slug, "companions"), {
    method: "POST",
    body: JSON.stringify({ ...item, plant_slug: slug }),
  });
}

export function deleteCompanion(slug: string, companionSlug: string): Promise<void> {
  return apiFetch(`${satellitePath(slug, "companions")}/${encodeURIComponent(companionSlug)}`, {
    method: "DELETE",
  });
}

export function upsertSeedInfo(
  slug: string,
  item: Omit<SeedInfo, "plant_slug">,
): Promise<SeedInfo> {
  return apiFetch(satellitePath(slug, "seed-info"), {
    method: "PUT",
    body: JSON.stringify({ ...item, plant_slug: slug }),
  });
}

export function deleteSeedInfo(slug: string): Promise<void> {
  return apiFetch(satellitePath(slug, "seed-info"), { method: "DELETE" });
}
