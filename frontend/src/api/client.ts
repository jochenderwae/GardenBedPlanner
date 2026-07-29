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
export type SeedResultResponse = components["schemas"]["SeedResultResponse"];

export type Planting = components["schemas"]["Planting"];
export type PlantingCreate = components["schemas"]["PlantingCreate"];
export type PlantingUpdate = components["schemas"]["PlantingUpdate"];
export type PlacementType = components["schemas"]["PlacementType"];
export type BedEquipment = components["schemas"]["BedEquipment"];
export type BedEquipmentCreate = components["schemas"]["BedEquipmentCreate"];
export type BedEquipmentUpdate = components["schemas"]["BedEquipmentUpdate"];
export type EquipmentType = components["schemas"]["EquipmentType"];
export type EquipmentCategory = components["schemas"]["EquipmentCategory"];

export type IrrigationZone = components["schemas"]["IrrigationZone"];
export type IrrigationZoneCreate = components["schemas"]["IrrigationZoneCreate"];
export type IrrigationZoneUpdate = components["schemas"]["IrrigationZoneUpdate"];
export type IrrigationZoneDetail = components["schemas"]["IrrigationZoneDetail"];

export type Action = components["schemas"]["Action"];
export type ActionCreate = components["schemas"]["ActionCreate"];
export type ActionUpdate = components["schemas"]["ActionUpdate"];
export type ActionType = components["schemas"]["ActionType"];
export type ActionStatus = components["schemas"]["ActionStatus"];

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
export type SeedInventoryItem = components["schemas"]["SeedInventoryItem"];
export type SeedInventoryItemCreate = components["schemas"]["SeedInventoryItemCreate"];
export type SeedInventoryItemUpdate = components["schemas"]["SeedInventoryItemUpdate"];

/** Thrown by `apiFetch` on a non-ok response - carries the HTTP status so
 * callers can branch on a specific code (e.g. `BedPanel.tsx`'s delete flow
 * distinguishing a 409-dependents-exist response from any other failure)
 * instead of string-matching the message. Still an `Error`, so existing
 * `err instanceof Error ? err.message : ...` call sites keep working
 * unchanged. */
export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  if (!res.ok) {
    throw new ApiError(`${init?.method ?? "GET"} ${path} failed: ${res.status}`, res.status);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export function listBeds(): Promise<Bed[]> {
  return apiFetch(`/api/beds`);
}

/** Single-bed fetch - used by the technical-drawing view (#193), which is
 * reached by bed id (e.g. `/layout/beds/:bedId/technical-drawing`) rather
 * than already holding the bed from a `listBeds()` call. */
export function getBed(id: number): Promise<Bed> {
  return apiFetch(`/api/beds/${id}`);
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

export function deleteBed(id: number, cascade = false): Promise<void> {
  return apiFetch(`/api/beds/${id}${cascade ? "?cascade=true" : ""}`, { method: "DELETE" });
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

/** Seeds the real database from the same fixture `getExampleGarden` only
 * previews - see the "Onboarding UI" backlog item's OnboardingPrompt.tsx,
 * the frontend half of a pair split from #25 (backend half: #108's new
 * POST /api/example-garden/seed route). Idempotent get-or-create by bed
 * name, same as the standalone import script it wraps. */
export function seedExampleGarden(): Promise<SeedResultResponse> {
  return apiFetch(`/api/example-garden/seed`, { method: "POST" });
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

/** Reference lookup for an equipment type's real-world default shape/height
 * and bed-bound vs. garden-bound categorization (#207/#208) - `equipment_
 * type` on `BedEquipment` stays free text, matched against this list's
 * `slug` by string at render time (see `EquipmentLayer.tsx`), not a joined
 * FK - an exotic/one-off type with no matching row here is expected and
 * falls back to the old fixed-size rendering. */
export function listEquipmentTypes(): Promise<EquipmentType[]> {
  return apiFetch(`/api/equipment-types`);
}

export function listIrrigationZones(): Promise<IrrigationZone[]> {
  return apiFetch(`/api/irrigation-zones`);
}

/** The single-zone detail response (#36/#200) - member equipment plus
 * `total_water_delivery_lph`, summed server-side (see
 * `backend/app/api/routes/irrigation_zones.py`'s own doc on why it's `null`
 * rather than 0 when no member equipment has a rate set at all). */
export function getIrrigationZone(id: number): Promise<IrrigationZoneDetail> {
  return apiFetch(`/api/irrigation-zones/${id}`);
}

export function createIrrigationZone(zone: IrrigationZoneCreate): Promise<IrrigationZone> {
  return apiFetch(`/api/irrigation-zones`, {
    method: "POST",
    body: JSON.stringify(zone),
  });
}

export function updateIrrigationZone(id: number, patch: IrrigationZoneUpdate): Promise<IrrigationZone> {
  return apiFetch(`/api/irrigation-zones/${id}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
}

export function deleteIrrigationZone(id: number): Promise<void> {
  return apiFetch(`/api/irrigation-zones/${id}`, { method: "DELETE" });
}

/** Garden work items (#181/#192) - `dueFrom`/`dueTo` filter on the due
 * *window* (`due_date_start >= dueFrom`, `due_date_end <= dueTo`), matching
 * the backend's own `due_from`/`due_to` query params (see
 * `backend/app/api/routes/actions.py`), not a single `due_date` the way an
 * earlier pre-#192 version of this model had. */
export function listActions(filter?: {
  dueFrom?: string;
  dueTo?: string;
  status?: ActionStatus;
  actionType?: ActionType;
}): Promise<Action[]> {
  const params = new URLSearchParams();
  if (filter?.dueFrom) params.set("due_from", filter.dueFrom);
  if (filter?.dueTo) params.set("due_to", filter.dueTo);
  if (filter?.status) params.set("status", filter.status);
  if (filter?.actionType) params.set("action_type", filter.actionType);
  const query = params.toString();
  return apiFetch(`/api/actions${query ? `?${query}` : ""}`);
}

export function getAction(id: number): Promise<Action> {
  return apiFetch(`/api/actions/${id}`);
}

export function createAction(action: ActionCreate): Promise<Action> {
  return apiFetch(`/api/actions`, {
    method: "POST",
    body: JSON.stringify(action),
  });
}

export function updateAction(id: number, patch: ActionUpdate): Promise<Action> {
  return apiFetch(`/api/actions/${id}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
}

export function deleteAction(id: number): Promise<void> {
  return apiFetch(`/api/actions/${id}`, { method: "DELETE" });
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

export function listSeedInventoryItems(): Promise<SeedInventoryItem[]> {
  return apiFetch(`/api/seed-inventory-items`);
}

export function createSeedInventoryItem(item: SeedInventoryItemCreate): Promise<SeedInventoryItem> {
  return apiFetch(`/api/seed-inventory-items`, {
    method: "POST",
    body: JSON.stringify(item),
  });
}

export function updateSeedInventoryItem(id: number, patch: SeedInventoryItemUpdate): Promise<SeedInventoryItem> {
  return apiFetch(`/api/seed-inventory-items/${id}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
}

export function deleteSeedInventoryItem(id: number): Promise<void> {
  return apiFetch(`/api/seed-inventory-items/${id}`, { method: "DELETE" });
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

export type RotationWarning = components["schemas"]["RotationWarning"];

/** Same-family crop-rotation check for a candidate plant in a given bed -
 * see backend/app/services/rotation.py's own docstring for the exact
 * semantics (family-based, not exact-species; ignores undated plantings).
 * `asOf`/`lookbackDaysOverride` are optional - the backend defaults `as_of`
 * to today and `lookback_days` to `DEFAULT_LOOKBACK_DAYS` (730) when
 * omitted, matching what most callers want. */
export function checkRotation(
  bedId: number,
  plantSlug: string,
  options?: { asOf?: string; lookbackDaysOverride?: number },
): Promise<RotationWarning> {
  const params = new URLSearchParams({ plant_slug: plantSlug });
  if (options?.asOf) params.set("as_of", options.asOf);
  if (options?.lookbackDaysOverride != null) params.set("lookback_days", String(options.lookbackDaysOverride));
  return apiFetch(`/api/beds/${bedId}/rotation-check?${params.toString()}`);
}

export type CompanionMatch = components["schemas"]["CompanionMatch"];
export type ShadeWarning = components["schemas"]["ShadeWarning"];
export type PlacementCheck = components["schemas"]["PlacementCheck"];

/** Companion/antagonist/shade-casting check for a candidate plant placement
 * (not necessarily saved yet - `geometry` is supplied directly, not a
 * Planting id) against every other active planting in the *whole garden*
 * (distance-based, not bed-scoped like `checkRotation` above) - see
 * backend/app/services/placement.py's own docstring for the exact
 * semantics. #174's design spec (see that issue's own comment thread)
 * covers what geometry a caller should supply before a real position
 * exists: an approximate bed-centroid point while a plant is merely
 * "armed", the live drag rectangle's centroid while row/field-drawing, and
 * the real committed geometry once a placement is actually saved. */
export function checkPlacement(
  bedId: number,
  plantSlug: string,
  geometry: Geometry,
  options?: { asOf?: string; neighborDistanceCm?: number; excludePlantingId?: number | null },
): Promise<PlacementCheck> {
  return apiFetch(`/api/beds/${bedId}/placement-check`, {
    method: "POST",
    body: JSON.stringify({
      plant_slug: plantSlug,
      geometry,
      ...(options?.asOf ? { as_of: options.asOf } : {}),
      ...(options?.neighborDistanceCm != null ? { neighbor_distance_cm: options.neighborDistanceCm } : {}),
      ...(options?.excludePlantingId != null ? { exclude_planting_id: options.excludePlantingId } : {}),
    }),
  });
}

export type PushSubscription = components["schemas"]["PushSubscription"];
export type PushSubscriptionRegister = components["schemas"]["PushSubscriptionRegister"];

/** The backend's GET /vapid-public-key just returns a plain `dict` (see
 * backend/app/api/routes/push_subscriptions.py), so openapi-typescript can't
 * infer a structured response shape for it the way every SQLModel-backed
 * route above gets - `public_key` is `null` until an operator has actually
 * configured VAPID keys server-side. */
export interface VapidPublicKeyResponse {
  public_key: string | null;
}

/** The frontend needs this to call `PushManager.subscribe({applicationServerKey})`
 * (see #47/useWebPushSubscription) - a public value, not a secret. */
export function getVapidPublicKey(): Promise<VapidPublicKeyResponse> {
  return apiFetch(`/api/push-subscriptions/vapid-public-key`);
}

/** Registers (or, by endpoint, re-registers/updates) this browser's Web
 * Push subscription with the backend - see #46 for the send side. */
export function registerPushSubscription(payload: PushSubscriptionRegister): Promise<PushSubscription> {
  return apiFetch(`/api/push-subscriptions`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}
