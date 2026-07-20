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

export type Bed = components["schemas"]["Bed"];
export type BedCreate = components["schemas"]["BedCreate"];
export type BedUpdate = components["schemas"]["BedUpdate"];
export type RectangleGeometry = components["schemas"]["RectangleGeometry"];
export type PolygonGeometry = components["schemas"]["PolygonGeometry"];
export type Geometry = RectangleGeometry | PolygonGeometry;
export type Garden = components["schemas"]["Garden"];
export type GardenPut = components["schemas"]["GardenPut"];
export type ExampleGarden = components["schemas"]["ExampleGarden"];
export type ExampleBed = components["schemas"]["ExampleBed"];
export type ExamplePlanting = components["schemas"]["ExamplePlanting"];

export type Planting = components["schemas"]["Planting"];
export type PlantingCreate = components["schemas"]["PlantingCreate"];
export type PlantingUpdate = components["schemas"]["PlantingUpdate"];
export type PlacementType = components["schemas"]["PlacementType"];
export type BedEquipment = components["schemas"]["BedEquipment"];
export type BedEquipmentCreate = components["schemas"]["BedEquipmentCreate"];
export type BedEquipmentUpdate = components["schemas"]["BedEquipmentUpdate"];

export type Plant = components["schemas"]["Plant"];
export type PlantDetail = components["schemas"]["PlantDetail"];
export type PlantCreate = components["schemas"]["PlantCreate"];
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

export function listBeds(): Promise<Bed[]> {
  return apiFetch(`/api/beds`);
}

export function createBed(bed: BedCreate): Promise<Bed> {
  return apiFetch(`/api/beds`, {
    method: "POST",
    body: JSON.stringify(bed),
  });
}

export function updateBed(id: number, patch: BedUpdate): Promise<Bed> {
  return apiFetch(`/api/beds/${id}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
}

export function deleteBed(id: number): Promise<void> {
  return apiFetch(`/api/beds/${id}`, { method: "DELETE" });
}

/** null means "not created yet" (backend 404s until the first PUT) - not an
 * error, callers should treat it as the garden-setup empty state. */
export async function getGarden(): Promise<Garden | null> {
  const res = await fetch(`/api/garden`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`GET /api/garden failed: ${res.status}`);
  return res.json() as Promise<Garden>;
}

export function putGarden(garden: GardenPut): Promise<Garden> {
  return apiFetch(`/api/garden`, {
    method: "PUT",
    body: JSON.stringify(garden),
  });
}

export function getExampleGarden(): Promise<ExampleGarden> {
  return apiFetch(`/api/example-garden`);
}

export function listPlantings(): Promise<Planting[]> {
  return apiFetch(`/api/plantings`);
}

export function createPlanting(planting: PlantingCreate): Promise<Planting> {
  return apiFetch(`/api/plantings`, {
    method: "POST",
    body: JSON.stringify(planting),
  });
}

export function updatePlanting(id: number, patch: PlantingUpdate): Promise<Planting> {
  return apiFetch(`/api/plantings/${id}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
}

export function deletePlanting(id: number): Promise<void> {
  return apiFetch(`/api/plantings/${id}`, { method: "DELETE" });
}

export function listBedEquipment(): Promise<BedEquipment[]> {
  return apiFetch(`/api/bed-equipment`);
}

export function createBedEquipment(equipment: BedEquipmentCreate): Promise<BedEquipment> {
  return apiFetch(`/api/bed-equipment`, {
    method: "POST",
    body: JSON.stringify(equipment),
  });
}

export function updateBedEquipment(id: number, patch: BedEquipmentUpdate): Promise<BedEquipment> {
  return apiFetch(`/api/bed-equipment/${id}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
}

export function deleteBedEquipment(id: number): Promise<void> {
  return apiFetch(`/api/bed-equipment/${id}`, { method: "DELETE" });
}

export function listPlants(limit = 500): Promise<Plant[]> {
  return apiFetch(`/api/plants?limit=${limit}`);
}

export function getPlant(slug: string): Promise<PlantDetail> {
  return apiFetch(`/api/plants/${encodeURIComponent(slug)}`);
}

export function createPlant(plant: PlantCreate): Promise<Plant> {
  return apiFetch(`/api/plants`, {
    method: "POST",
    body: JSON.stringify(plant),
  });
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
