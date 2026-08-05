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
// The backend's schema regenerated this PUT-body schema's name from
// GardenPut to GardenUpdate as part of #238's multi-garden support (the
// legacy singular PUT /api/garden route now shares its request schema with
// the new PATCH /api/gardens/{id} route) - kept the exported alias name
// GardenPut unchanged here so every existing call site (Layout.tsx,
// GardenPanel.tsx) keeps working without a second, unrelated rename.
export type GardenPut = components["schemas"]["GardenUpdate"];
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
export type EquipmentCondition = components["schemas"]["EquipmentCondition"];

export type HarvestLog = components["schemas"]["HarvestLog"];
export type HarvestLogCreate = components["schemas"]["HarvestLogCreate"];
export type HarvestLogUpdate = components["schemas"]["HarvestLogUpdate"];
export type HarvestQuality = components["schemas"]["HarvestQuality"];

export type GardenPlan = components["schemas"]["GardenPlan"];
export type GardenPlanCreate = components["schemas"]["GardenPlanCreate"];
export type GardenPlanUpdate = components["schemas"]["GardenPlanUpdate"];
export type GardenPlanDetail = components["schemas"]["GardenPlanDetail"];
export type GardenPlanEntry = components["schemas"]["GardenPlanEntry"];
export type GardenPlanEntryCreate = components["schemas"]["GardenPlanEntryCreate"];
export type GardenPlanEntryUpdate = components["schemas"]["GardenPlanEntryUpdate"];

export type CompostFertilizationLog = components["schemas"]["CompostFertilizationLog"];
export type CompostFertilizationLogCreate = components["schemas"]["CompostFertilizationLogCreate"];
export type CompostFertilizationLogUpdate = components["schemas"]["CompostFertilizationLogUpdate"];
export type CompostFertilizationLogType = components["schemas"]["CompostFertilizationLogType"];
export type CompostBin = components["schemas"]["CompostBin"];
export type CompostBinCreate = components["schemas"]["CompostBinCreate"];
export type CompostBinUpdate = components["schemas"]["CompostBinUpdate"];
export type CompostBinFillState = components["schemas"]["CompostBinFillState"];

export type Decoration = components["schemas"]["Decoration"];
export type DecorationCreate = components["schemas"]["DecorationCreate"];
export type DecorationUpdate = components["schemas"]["DecorationUpdate"];

export type IrrigationZone = components["schemas"]["IrrigationZone"];
export type IrrigationZoneCreate = components["schemas"]["IrrigationZoneCreate"];
export type IrrigationZoneUpdate = components["schemas"]["IrrigationZoneUpdate"];
export type IrrigationZoneDetail = components["schemas"]["IrrigationZoneDetail"];

export type IrrigationPart = components["schemas"]["IrrigationPart"];
export type IrrigationPartCreate = components["schemas"]["IrrigationPartCreate"];
export type IrrigationPartUpdate = components["schemas"]["IrrigationPartUpdate"];
export type IrrigationPartDetail = components["schemas"]["IrrigationPartDetail"];
// #254: one physically-placed unit of an IrrigationPart catalog row - see
// that model's own schema.d.ts docstring. diagram_x/diagram_y live here now,
// not on IrrigationPart.
export type IrrigationPartInstance = components["schemas"]["IrrigationPartInstance"];
export type IrrigationPartInstanceCreate = components["schemas"]["IrrigationPartInstanceCreate"];
export type IrrigationPartInstanceUpdate = components["schemas"]["IrrigationPartInstanceUpdate"];
export type IrrigationConnection = components["schemas"]["IrrigationConnection"];
export type IrrigationConnectionCreate = components["schemas"]["IrrigationConnectionCreate"];
// #251/#252: reference lookup for a part_type's real-world port count/icon -
// see that schema's own docstring. IrrigationPart.part_type stays free text
// (matched against this list's slug/name by normalized string, same
// precedent as EquipmentType/BedEquipment.equipment_type) rather than a hard
// FK, so a part_type with no matching row here still works.
export type IrrigationPartType = components["schemas"]["IrrigationPartType"];

export type Action = components["schemas"]["Action"];
export type ActionCreate = components["schemas"]["ActionCreate"];
export type ActionUpdate = components["schemas"]["ActionUpdate"];
export type ActionType = components["schemas"]["ActionType"];
export type ActionStatus = components["schemas"]["ActionStatus"];
export type RecurrenceUnit = components["schemas"]["RecurrenceUnit"];

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

export type GardenWrite = components["schemas"]["GardenWrite"];

/** Real list-style multi-garden CRUD (#238/#239) - every `Garden` row, not
 * just whichever one is currently active (`getGarden`/`putGarden` above
 * stay the "always the active one" singular resource, unchanged). First
 * consumed by the Settings page's active-garden switcher. */
export function listGardens(): Promise<Garden[]> {
  return apiFetch(`/api/gardens`);
}

/** Always creates an *inactive* garden (the backend's own rule - see
 * `app/api/routes/garden.py`'s `create_garden` docstring) - switching to it
 * is the separate `activateGarden` call below. */
export function createGarden(garden: GardenWrite): Promise<Garden> {
  return apiFetch(`/api/gardens`, {
    method: "POST",
    body: JSON.stringify(garden),
  });
}

export function activateGarden(id: number): Promise<Garden> {
  return apiFetch(`/api/gardens/${id}/activate`, { method: "POST" });
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

/** #221: a Planting's own harvest history, or every harvest logged across
 * the whole garden when `plantingId` is omitted. */
export function listHarvestLogs(plantingId?: number): Promise<HarvestLog[]> {
  const query = plantingId != null ? `?planting_id=${plantingId}` : "";
  return apiFetch(`/api/harvest-logs${query}`);
}

export function createHarvestLog(log: HarvestLogCreate): Promise<HarvestLog> {
  return apiFetch(`/api/harvest-logs`, {
    method: "POST",
    body: JSON.stringify(log),
  });
}

export function updateHarvestLog(id: number, patch: HarvestLogUpdate): Promise<HarvestLog> {
  return apiFetch(`/api/harvest-logs/${id}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
}

export function deleteHarvestLog(id: number): Promise<void> {
  return apiFetch(`/api/harvest-logs/${id}`, { method: "DELETE" });
}

/** #220: a season/year's plant wishlist header - see `getGardenPlan` for
 * the plan-plus-entries detail shape. */
export function listGardenPlans(): Promise<GardenPlan[]> {
  return apiFetch(`/api/garden-plans`);
}

export function getGardenPlan(id: number): Promise<GardenPlanDetail> {
  return apiFetch(`/api/garden-plans/${id}`);
}

export function createGardenPlan(plan: GardenPlanCreate): Promise<GardenPlan> {
  return apiFetch(`/api/garden-plans`, {
    method: "POST",
    body: JSON.stringify(plan),
  });
}

export function updateGardenPlan(id: number, patch: GardenPlanUpdate): Promise<GardenPlan> {
  return apiFetch(`/api/garden-plans/${id}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
}

/** `cascade=true` deletes the plan's own entries along with it - a plan
 * with 1+ entries 409s without it, same "explicit cascade=true, not a
 * silent default" convention `deleteBed`/`deleteGardenPlan` share
 * (`app/api/routes/garden_plans.py`). */
export function deleteGardenPlan(id: number, cascade = false): Promise<void> {
  return apiFetch(`/api/garden-plans/${id}${cascade ? "?cascade=true" : ""}`, { method: "DELETE" });
}

export function createGardenPlanEntry(planId: number, entry: GardenPlanEntryCreate): Promise<GardenPlanEntry> {
  return apiFetch(`/api/garden-plans/${planId}/entries`, {
    method: "POST",
    body: JSON.stringify(entry),
  });
}

export function updateGardenPlanEntry(
  planId: number,
  entryId: number,
  patch: GardenPlanEntryUpdate,
): Promise<GardenPlanEntry> {
  return apiFetch(`/api/garden-plans/${planId}/entries/${entryId}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
}

export function deleteGardenPlanEntry(planId: number, entryId: number): Promise<void> {
  return apiFetch(`/api/garden-plans/${planId}/entries/${entryId}`, { method: "DELETE" });
}

/** #223: every log across the whole garden - no `bed_id` query param exists
 * on this route (see `schema.d.ts`), so a caller wanting one bed's own
 * history filters client-side, same convention `BedPanel.tsx`'s own
 * `plantings`/`equipment` props already use. */
export function listCompostFertilizationLogs(): Promise<CompostFertilizationLog[]> {
  return apiFetch(`/api/compost-fertilization-logs`);
}

export function createCompostFertilizationLog(log: CompostFertilizationLogCreate): Promise<CompostFertilizationLog> {
  return apiFetch(`/api/compost-fertilization-logs`, {
    method: "POST",
    body: JSON.stringify(log),
  });
}

export function updateCompostFertilizationLog(
  id: number,
  patch: CompostFertilizationLogUpdate,
): Promise<CompostFertilizationLog> {
  return apiFetch(`/api/compost-fertilization-logs/${id}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
}

export function deleteCompostFertilizationLog(id: number): Promise<void> {
  return apiFetch(`/api/compost-fertilization-logs/${id}`, { method: "DELETE" });
}

/** Every compost bin across the whole garden - 1:1 with whichever `Bed` its
 * own `bed_id` points at (backend enforces the uniqueness, see
 * `CompostBin`'s own schema doc), so at most one bin per bed. */
export function listCompostBins(): Promise<CompostBin[]> {
  return apiFetch(`/api/compost-bins`);
}

export function createCompostBin(bin: CompostBinCreate): Promise<CompostBin> {
  return apiFetch(`/api/compost-bins`, {
    method: "POST",
    body: JSON.stringify(bin),
  });
}

export function updateCompostBin(id: number, patch: CompostBinUpdate): Promise<CompostBin> {
  return apiFetch(`/api/compost-bins/${id}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
}

export function deleteCompostBin(id: number): Promise<void> {
  return apiFetch(`/api/compost-bins/${id}`, { method: "DELETE" });
}

/** Purely cosmetic garden objects (#241/#242) - a path, bench, garden gnome,
 * etc. Same list-everything-then-filter-client-side convention every other
 * garden-wide resource here uses (no bed_id/garden_id to filter by - see
 * `Decoration`'s own backend docstring on why it carries neither). */
export function listDecorations(): Promise<Decoration[]> {
  return apiFetch(`/api/decorations`);
}

export function createDecoration(decoration: DecorationCreate): Promise<Decoration> {
  return apiFetch(`/api/decorations`, {
    method: "POST",
    body: JSON.stringify(decoration),
  });
}

export function updateDecoration(id: number, patch: DecorationUpdate): Promise<Decoration> {
  return apiFetch(`/api/decorations/${id}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
}

export function deleteDecoration(id: number): Promise<void> {
  return apiFetch(`/api/decorations/${id}`, { method: "DELETE" });
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

// Catalog-level irrigation parts/instances/connections (#37/#209/#212/#254)
// - the "pipe network" diagram's own data, distinct from IrrigationZone
// (equipment grouping) and BedEquipment (bed-placed items). `IrrigationPart`
// is catalog-only stock (no `bed_id`/`geometry`, no diagram position) - each
// independently-placed physical unit is its own `IrrigationPartInstance`,
// which owns the `diagram_x`/`diagram_y` for the dialog's own schematic
// canvas - see PipeNetworkDialog.tsx.

export function listIrrigationParts(): Promise<IrrigationPart[]> {
  return apiFetch(`/api/irrigation-parts`);
}

export function getIrrigationPart(id: number): Promise<IrrigationPartDetail> {
  return apiFetch(`/api/irrigation-parts/${id}`);
}

export function createIrrigationPart(part: IrrigationPartCreate): Promise<IrrigationPart> {
  return apiFetch(`/api/irrigation-parts`, {
    method: "POST",
    body: JSON.stringify(part),
  });
}

export function updateIrrigationPart(id: number, patch: IrrigationPartUpdate): Promise<IrrigationPart> {
  return apiFetch(`/api/irrigation-parts/${id}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
}

export function deleteIrrigationPart(id: number): Promise<void> {
  return apiFetch(`/api/irrigation-parts/${id}`, { method: "DELETE" });
}

/** #254: one physically-placed unit of an `IrrigationPart` stock row - see
 * that model's own docstring. `partId` filters to instances of one part. */
export function listIrrigationPartInstances(partId?: number): Promise<IrrigationPartInstance[]> {
  const query = partId != null ? `?part_id=${partId}` : "";
  return apiFetch(`/api/irrigation-part-instances${query}`);
}

export function getIrrigationPartInstance(id: number): Promise<IrrigationPartInstance> {
  return apiFetch(`/api/irrigation-part-instances/${id}`);
}

export function createIrrigationPartInstance(instance: IrrigationPartInstanceCreate): Promise<IrrigationPartInstance> {
  return apiFetch(`/api/irrigation-part-instances`, {
    method: "POST",
    body: JSON.stringify(instance),
  });
}

export function updateIrrigationPartInstance(id: number, patch: IrrigationPartInstanceUpdate): Promise<IrrigationPartInstance> {
  return apiFetch(`/api/irrigation-part-instances/${id}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
}

export function deleteIrrigationPartInstance(id: number): Promise<void> {
  return apiFetch(`/api/irrigation-part-instances/${id}`, { method: "DELETE" });
}

/** No `instanceId` filter passed by the pipe-network dialog - it fetches
 * every connection once, on open, and derives per-instance connection
 * counts/edges client-side rather than issuing one filtered request per
 * instance (simpler at this app's "a handful of parts" scale - see
 * backend's own docstring). */
export function listIrrigationConnections(instanceId?: number): Promise<IrrigationConnection[]> {
  const query = instanceId != null ? `?instance_id=${instanceId}` : "";
  return apiFetch(`/api/irrigation-connections${query}`);
}

/** Defaults to only part types belonging to an active resource pack - the
 * same "active packs only" default the add-part suggestion UI wants (#251)
 * and #252's own anchor-count/icon lookup wants too. */
export function listIrrigationPartTypes(includeInactive?: boolean): Promise<IrrigationPartType[]> {
  const query = includeInactive ? "?include_inactive=true" : "";
  return apiFetch(`/api/irrigation-part-types${query}`);
}

export function createIrrigationConnection(connection: IrrigationConnectionCreate): Promise<IrrigationConnection> {
  return apiFetch(`/api/irrigation-connections`, {
    method: "POST",
    body: JSON.stringify(connection),
  });
}

export function deleteIrrigationConnection(id: number): Promise<void> {
  return apiFetch(`/api/irrigation-connections/${id}`, { method: "DELETE" });
}

/** Garden work items (#181/#192) - `dueFrom`/`dueTo` filter on the due
 * *window* (`due_date_start >= dueFrom`, `due_date_end <= dueTo`), matching
 * the backend's own `due_from`/`due_to` query params (see
 * `backend/app/api/routes/actions.py`), not a single `due_date` the way an
 * earlier pre-#192 version of this model had. `actionableNow` (#192, first
 * consumed by #224's mobile Home tab) maps to the backend's own
 * `actionable_now` flag - pending actions whose window has already opened,
 * pre-sorted by `due_date_end` ascending server-side. */
export function listActions(filter?: {
  dueFrom?: string;
  dueTo?: string;
  status?: ActionStatus;
  actionType?: ActionType;
  actionableNow?: boolean;
}): Promise<Action[]> {
  const params = new URLSearchParams();
  if (filter?.dueFrom) params.set("due_from", filter.dueFrom);
  if (filter?.dueTo) params.set("due_to", filter.dueTo);
  if (filter?.status) params.set("status", filter.status);
  if (filter?.actionType) params.set("action_type", filter.actionType);
  if (filter?.actionableNow) params.set("actionable_now", "true");
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

export type SoilRotationEventCreate = components["schemas"]["SoilRotationEventCreate"];
export type SoilRotationEventDetail = components["schemas"]["SoilRotationEventDetail"];
export type SoilRotationTransfer = components["schemas"]["SoilRotationTransfer"];
export type SoilRotationTransferCreate = components["schemas"]["SoilRotationTransferCreate"];

/** Logs one "moving day" (#228/#229) - an N-way soil-transfer cycle between
 * beds (or from fresh/external soil, `from_bed_id: null`) in one request/one
 * transaction. No PATCH/DELETE exposed here - a logged rotation event is a
 * historical fact, not something this app's UI lets users edit after the
 * fact (see the backend route's own docstring). `list`/`get` exist
 * server-side too but have no frontend call site yet - a rotation-event
 * history view is a deliberately deferred follow-up, not this ticket's
 * scope (see SoilRotationDialog.tsx's own doc). */
export function createSoilRotationEvent(event: SoilRotationEventCreate): Promise<SoilRotationEventDetail> {
  return apiFetch(`/api/soil-rotation-events`, {
    method: "POST",
    body: JSON.stringify(event),
  });
}

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
