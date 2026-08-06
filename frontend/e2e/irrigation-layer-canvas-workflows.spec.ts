import { test, expect, type APIRequestContext, type Page } from "@playwright/test";

/**
 * Real-browser coverage for #250 ("Merge the drip irrigation editor into
 * the main garden canvas editor") plus its phase-2 follow-ups #278 ("show
 * connection length as a real physical cm figure") and #280 ("wire
 * irrigation instance drag/placement into undo/redo"). #250's own outcome
 * comment verified the interactive flows manually via a throwaway Playwright
 * script, not a committed spec - this is the first real regression coverage
 * for `IrrigationLayer.tsx`/`IrrigationPartsPanel.tsx`'s click-to-place,
 * drag-move, anchor-to-anchor connection-drag, unplaced-instance migration
 * path, and delete-with-cascade-confirmation gestures, none of which a
 * typecheck or Vitest/jsdom test can exercise (the coordinate-space-agnostic
 * anchor/curve math itself already has solid coverage in
 * `irrigationConnectionGeometry.test.ts`).
 *
 * Deliberately never places an instance in *open garden space*
 * (`garden_id`, as opposed to a bed's `bed_id`) - doing so needs a real
 * `Garden` singleton to exist first, and `Garden` has no DELETE endpoint
 * (see `onboarding-prompt.spec.ts`'s own doc on why creating one for real
 * here would permanently change every other spec's "no garden yet"
 * assumption for good). Every placement below lands inside a bed this file
 * creates and cascade-deletes itself instead - `completePlacement`'s
 * bed-anchored and garden-anchored branches differ only in which
 * `containerOffset` they use (`IrrigationLayer.tsx`), so this still
 * exercises the real code path.
 *
 * Coordinate math throughout assumes this editor's own `CM_TO_PX = 1`
 * (`geometry.ts`) and the canvas's default zoom/pan (scale 1, no offset) -
 * the same assumption every other canvas-drag spec in this directory
 * already relies on (see e.g. `undo-redo.spec.ts`'s bed-drag test, which
 * asserts an exact post-drag world position off a pixel-space mouse move).
 * `ICON_SIZE_PX = 22` and 2 anchors (top/bottom, per
 * `pointOnRectPerimeter`'s own t=0/t=0.5 math) for a freshly-placed instance
 * with no connections and no matching `IrrigationPartType` (this file never
 * seeds one) are both `IrrigationLayer.tsx`/`irrigationConnectionGeometry.ts`
 * constants relied on directly - see inline comments at each anchor
 * coordinate below.
 */

// The Equipment tab stacks EquipmentPanel above IrrigationPartsPanel in the
// same side-panel column (#250's own outcome comment) - at this suite's
// default viewport height the "Irrigation parts" Card's own bottom rows
// (including its "Place" button) render clipped by an ancestor's
// overflow-hidden rather than merely scrolled off (Playwright's own
// scroll-into-view during a click doesn't reach them), causing "element
// intercepts pointer events" click failures. A taller viewport sidesteps
// that entirely rather than fighting the panel's internal layout.
test.use({ viewport: { width: 1400, height: 1400 } });

type Rect = { type: "rectangle"; x: number; y: number; width: number; height: number; rotation: number };

function rect(x: number, y: number, width: number, height: number): Rect {
  return { type: "rectangle", x, y, width, height, rotation: 0 };
}

async function createBed(request: APIRequestContext, name: string, geometry: Rect): Promise<{ id: number }> {
  const res = await request.post("/api/beds", { data: { name, border_geometry: geometry } });
  expect(res.ok(), `failed to create bed "${name}": ${res.status()} ${await res.text()}`).toBeTruthy();
  return res.json();
}

async function dismissOnboardingIfPresent(page: Page): Promise<void> {
  const startFromScratch = page.getByRole("button", { name: "Start from scratch" });
  if (await startFromScratch.isVisible().catch(() => false)) {
    await startFromScratch.click();
  }
}

async function openEquipmentTab(page: Page): Promise<void> {
  await page.goto("/layout");
  await page.locator("canvas").first().waitFor();
  await dismissOnboardingIfPresent(page);
  await page.getByRole("tab", { name: "Equipment" }).click();
  await expect(page.getByRole("heading", { name: "Irrigation parts" })).toBeVisible();
}

async function canvasBox(page: Page) {
  const box = await page.locator("canvas").first().boundingBox();
  if (!box) throw new Error("canvas not visible");
  return box;
}

interface ApiInstance {
  id: number;
  part_id: number;
  bed_id: number | null;
  garden_id: number | null;
  geometry: Rect | null;
  diagram_x: number | null;
  diagram_y: number | null;
}

async function createPart(
  request: APIRequestContext,
  name: string,
  partType: string,
  quantityOnHand = 5,
): Promise<{ id: number }> {
  const res = await request.post("/api/irrigation-parts", {
    data: { name, part_type: partType, quantity_on_hand: quantityOnHand, notes: "", connector_size_mm: null },
  });
  expect(res.ok(), `failed to create irrigation part "${name}": ${res.status()} ${await res.text()}`).toBeTruthy();
  return res.json();
}

async function createInstance(
  request: APIRequestContext,
  data: Partial<ApiInstance> & { part_id: number },
): Promise<ApiInstance> {
  const res = await request.post("/api/irrigation-part-instances", {
    data: { bed_id: null, garden_id: null, geometry: null, diagram_x: null, diagram_y: null, ...data },
  });
  expect(res.ok(), `failed to create irrigation part instance: ${res.status()} ${await res.text()}`).toBeTruthy();
  return res.json();
}

async function getInstance(request: APIRequestContext, id: number): Promise<ApiInstance> {
  return (await request.get(`/api/irrigation-part-instances/${id}`)).json();
}

async function cleanupInstance(request: APIRequestContext, id: number | undefined): Promise<void> {
  if (id != null) await request.delete(`/api/irrigation-part-instances/${id}`).catch(() => {});
}

async function cleanupPart(request: APIRequestContext, id: number | undefined): Promise<void> {
  if (id != null) await request.delete(`/api/irrigation-parts/${id}`).catch(() => {});
}

test.describe("Irrigation canvas layer: placement, drag, undo/redo (#250, #280)", () => {
  test("arming a part and clicking a bed places a real instance there (not itself undoable - #280 only tracks drag-move and re-placing a previously-unplaced instance); dragging it afterward is undoable/redoable", async ({
    page,
    request,
  }) => {
    const stamp = Date.now();
    const bed = await createBed(request, `E2E Irrigation Place Bed ${stamp}`, rect(200, 200, 400, 300));
    const partName = `E2E Nozzle ${stamp}`;
    let instanceId: number | undefined;

    try {
      await openEquipmentTab(page);

      // --- Add a catalog part via the side panel form ---
      await page.getByLabel("Name").fill(partName);
      await page.getByLabel("Part type").fill(`e2e-nozzle-type-${stamp}`);
      await page.getByLabel("Quantity on hand").fill("2");
      await page.getByRole("button", { name: "Add part" }).click();
      await expect(page.getByText(partName, { exact: true })).toBeVisible();

      // --- Arm it and click inside the bed to place a real instance ---
      // Scoped to this part's own row (via its Delete button's aria-label,
      // same anchor-on-an-always-in-sync-label pattern
      // irrigation-zone-management.spec.ts's ZoneRow lookup already uses) -
      // not a bare page-wide "Place" button lookup, which is ambiguous the
      // moment more than one irrigation part exists (e.g. a stray part left
      // behind by an interrupted prior run sharing this same garden_test
      // database).
      const partRow = page.getByRole("button", { name: `Delete ${partName}` }).locator("xpath=../..");
      const undoButton = page.getByRole("button", { name: "Undo" });
      const redoButton = page.getByRole("button", { name: "Redo" });
      await expect(undoButton).toBeDisabled();

      await partRow.getByRole("button", { name: "Place" }).click();
      await expect(partRow.getByRole("button", { name: "Armed" })).toBeVisible();

      const box = await canvasBox(page);
      // World (300,300) -> bed-local (100,100) (bed at world (200,200)) ->
      // snaps to the nearest 10cm grid step (already exact) -> footprint
      // centered there, per `footprintGeometryAt` (6cm square, #271's own
      // "small rectangle centered on the point" convention).
      await page.mouse.click(box.x + 300, box.y + 300);

      await expect
        .poll(async () => (await (await request.get(`/api/irrigation-part-instances?part_id=${await partIdFor(request, partName)}`)).json()).length, {
          message: "no irrigation part instance was ever created by the click-to-place gesture",
        })
        .toBe(1);
      const partId = await partIdFor(request, partName);
      const instances = (await (await request.get(`/api/irrigation-part-instances?part_id=${partId}`)).json()) as ApiInstance[];
      instanceId = instances[0].id;
      expect(instances[0].bed_id).toBe(bed.id);
      expect(instances[0].garden_id).toBeNull();
      expect(instances[0].geometry).toEqual(rect(97, 97, 6, 6));

      // Creating a brand-new instance (armed a *catalog part*, not a
      // previously-unplaced instance) is deliberately NOT undo-tracked -
      // #280's own scope note: "creating a brand-new instance ... [is] not
      // [in scope], matching how planting creation isn't undoable either".
      // Only the drag below should enable Undo.
      await expect(undoButton).toBeDisabled();

      // --- Drag it +40cm right ---
      await page.mouse.move(box.x + 300, box.y + 300);
      await page.mouse.down();
      await page.mouse.move(box.x + 320, box.y + 300, { steps: 5 });
      await page.mouse.move(box.x + 340, box.y + 300, { steps: 5 });
      await page.mouse.up();

      await expect
        .poll(async () => (await getInstance(request, instanceId!)).geometry, {
          message: "drag-move never persisted a new geometry",
        })
        .toEqual(rect(137, 97, 6, 6));

      // --- Undo once: the drag reverts, the instance stays placed ---
      await expect(undoButton).toBeEnabled();
      await undoButton.click();
      await expect
        .poll(async () => (await getInstance(request, instanceId!)).geometry, { message: "undoing the drag never reverted geometry" })
        .toEqual(rect(97, 97, 6, 6));
      expect((await getInstance(request, instanceId!)).bed_id).toBe(bed.id);
      // Nothing left to undo now - the placement itself was never tracked.
      await expect(undoButton).toBeDisabled();

      // --- Redo: re-applies the drag ---
      await expect(redoButton).toBeEnabled();
      await redoButton.click();
      await expect
        .poll(async () => (await getInstance(request, instanceId!)).geometry, { message: "redoing the drag never restored the moved geometry" })
        .toEqual(rect(137, 97, 6, 6));
    } finally {
      await cleanupInstance(request, instanceId);
      const partId = await partIdFor(request, partName).catch(() => undefined);
      await cleanupPart(request, partId);
      await request.delete(`/api/beds/${bed.id}?cascade=true`).catch(() => {});
    }
  });
});

async function partIdFor(request: APIRequestContext, name: string): Promise<number> {
  const parts = (await (await request.get("/api/irrigation-parts")).json()) as { id: number; name: string }[];
  const match = parts.find((p) => p.name === name);
  if (!match) throw new Error(`no irrigation part named "${name}" found`);
  return match.id;
}

test.describe("Irrigation canvas layer: unplaced (pre-merge) instance migration path (#250)", () => {
  test("an instance with only the old schematic diagram_x/diagram_y shows in the Unplaced tray; placing it keeps its existing connection", async ({
    page,
    request,
  }) => {
    const stamp = Date.now();
    const bed = await createBed(request, `E2E Irrigation Unplaced Bed ${stamp}`, rect(100, 100, 400, 300));
    const partName = `E2E Legacy Part ${stamp}`;
    const part = await createPart(request, partName, `e2e-legacy-type-${stamp}`);

    // A normally-placed anchor instance, and a "legacy" instance that only
    // ever got a diagram position (#250's own migration scenario - created
    // before this merge shipped).
    const placedInstance = await createInstance(request, {
      part_id: part.id,
      bed_id: bed.id,
      geometry: rect(97, 97, 6, 6),
    });
    const legacyInstance = await createInstance(request, {
      part_id: part.id,
      diagram_x: 40,
      diagram_y: 40,
    });
    const connectionRes = await request.post("/api/irrigation-connections", {
      data: { from_instance_id: placedInstance.id, to_instance_id: legacyInstance.id, notes: "" },
    });
    expect(connectionRes.ok(), `failed to seed connection: ${connectionRes.status()}`).toBeTruthy();
    const connection = await connectionRes.json();

    try {
      await openEquipmentTab(page);

      const unplacedHeading = page.getByRole("heading", { name: /^Unplaced \(1\)/ });
      await expect(unplacedHeading).toBeVisible();
      const unplacedSection = unplacedHeading.locator("..");
      await expect(unplacedSection.getByText(partName, { exact: true })).toBeVisible();

      await unplacedSection.getByRole("button", { name: "Place" }).click();
      // Both the catalog PartRow and the Unplaced-tray row for this same
      // part show "Armed" once armed (`isArmedForPart` matches on part id
      // regardless of mode) - scope to the Unplaced row specifically.
      await expect(unplacedSection.getByRole("button", { name: "Armed" })).toBeVisible();

      const box = await canvasBox(page);
      // World (300,250) -> bed-local (200,150) (bed at world (100,100)).
      await page.mouse.click(box.x + 300, box.y + 250);

      await expect
        .poll(async () => (await getInstance(request, legacyInstance.id)).bed_id, {
          message: "placing the legacy/unplaced instance from its own tray never set bed_id",
        })
        .toBe(bed.id);
      const placedLegacy = await getInstance(request, legacyInstance.id);
      expect(placedLegacy.geometry).toEqual(rect(197, 147, 6, 6));

      // The Unplaced tray is now empty - the same instance moved out of it,
      // not a new one created alongside it.
      await expect(page.getByRole("heading", { name: /^Unplaced/ })).toHaveCount(0);
      const allInstancesForPart = (await (await request.get(`/api/irrigation-part-instances?part_id=${part.id}`)).json()) as ApiInstance[];
      expect(allInstancesForPart).toHaveLength(2);

      // The connection seeded between the two instances before placement
      // survived - re-placing patches the existing row's bed_id/geometry,
      // it doesn't delete-and-recreate it.
      const connectionsAfter = (await (await request.get("/api/irrigation-connections")).json()) as {
        id: number;
        from_instance_id: number;
        to_instance_id: number;
      }[];
      expect(connectionsAfter.some((c) => c.id === connection.id)).toBe(true);

      // #280: unlike creating a brand-new instance (see the other describe
      // block above), re-placing a previously-unplaced instance IS
      // undo-tracked - explicitly in scope per that ticket's own note.
      const undoButton = page.getByRole("button", { name: "Undo" });
      await expect(undoButton).toBeEnabled();
      await undoButton.click();
      await expect
        .poll(async () => (await getInstance(request, legacyInstance.id)).bed_id, {
          message: "undoing the unplaced-instance placement never cleared bed_id again",
        })
        .toBeNull();
      const revertedLegacy = await getInstance(request, legacyInstance.id);
      expect(revertedLegacy.garden_id).toBeNull();
      expect(revertedLegacy.geometry).toBeNull();
      // Back in the Unplaced tray.
      await expect(page.getByRole("heading", { name: /^Unplaced \(1\)/ })).toBeVisible();

      const redoButton = page.getByRole("button", { name: "Redo" });
      await expect(redoButton).toBeEnabled();
      await redoButton.click();
      await expect
        .poll(async () => (await getInstance(request, legacyInstance.id)).bed_id, {
          message: "redoing the unplaced-instance placement never restored bed_id",
        })
        .toBe(bed.id);
      expect((await getInstance(request, legacyInstance.id)).geometry).toEqual(rect(197, 147, 6, 6));
    } finally {
      await request.delete(`/api/irrigation-connections/${connection.id}`).catch(() => {});
      await cleanupInstance(request, placedInstance.id);
      await cleanupInstance(request, legacyInstance.id);
      await cleanupPart(request, part.id);
      await request.delete(`/api/beds/${bed.id}?cascade=true`).catch(() => {});
    }
  });
});

test.describe("Irrigation canvas layer: anchor-to-anchor connection drag + delete cascade confirmation (#250)", () => {
  test("dragging from one instance's anchor to another's creates a connection; deleting a connected instance asks for confirmation and cascades", async ({
    page,
    request,
  }) => {
    const stamp = Date.now();
    const bed = await createBed(request, `E2E Irrigation Connect Bed ${stamp}`, rect(200, 200, 400, 300));
    const partName = `E2E Connect Part ${stamp}`;
    const part = await createPart(request, partName, `e2e-connect-type-${stamp}`, 2);

    // Two instances, 200cm apart, both bed-local - world (300,300) and
    // (500,300) respectively (bed at world (200,200)).
    const instanceA = await createInstance(request, { part_id: part.id, bed_id: bed.id, geometry: rect(97, 97, 6, 6) });
    const instanceB = await createInstance(request, { part_id: part.id, bed_id: bed.id, geometry: rect(297, 97, 6, 6) });
    let connectionId: number | undefined;

    try {
      await openEquipmentTab(page);
      await expect(page.getByText(partName, { exact: true }).first()).toBeVisible();

      const box = await canvasBox(page);
      // Neither instance has any connection yet, and this test seeds no
      // matching IrrigationPartType, so `anchorCountFor` falls back to its
      // no-catalog-match heuristic: 2 anchors, at t=0 (top, offset (0,-11))
      // and t=0.5 (bottom, offset (0,+11)) of a 22px icon - see
      // `pointOnRectPerimeter`. Instance A's world center is (300,300),
      // instance B's is (500,300); dragging from A's top anchor to B's top
      // anchor lands well within the 12px anchor-drop tolerance
      // (`ANCHOR_DROP_RADIUS_PX`) since it's the exact same point.
      const anchorAX = box.x + 300;
      const anchorAY = box.y + 300 - 11;
      const anchorBX = box.x + 500;
      const anchorBY = box.y + 300 - 11;

      await page.mouse.move(anchorAX, anchorAY);
      await page.mouse.down();
      await page.mouse.move((anchorAX + anchorBX) / 2, anchorAY, { steps: 5 });
      await page.mouse.move(anchorBX, anchorBY, { steps: 5 });
      await page.mouse.up();

      await expect
        .poll(async () => {
          const conns = (await (await request.get(`/api/irrigation-connections?instance_id=${instanceA.id}`)).json()) as {
            id: number;
            from_instance_id: number;
            to_instance_id: number;
          }[];
          return conns.find(
            (c) =>
              (c.from_instance_id === instanceA.id && c.to_instance_id === instanceB.id) ||
              (c.from_instance_id === instanceB.id && c.to_instance_id === instanceA.id),
          )?.id;
        }, { message: "dragging anchor-to-anchor never created a connection between A and B" })
        .toBeDefined();
      const conns = (await (await request.get(`/api/irrigation-connections?instance_id=${instanceA.id}`)).json()) as {
        id: number;
        from_instance_id: number;
        to_instance_id: number;
      }[];
      connectionId = conns[0].id;

      // Reload so the panel's own `["irrigation-connections"]` query cache
      // picks up the connection just created via the drag gesture above -
      // without this, `requestDeleteInstance`'s own connection-count check
      // below can read a stale 0 and skip the confirmation dialog entirely
      // even though the connection is already real server-side (confirmed
      // by the poll above).
      await openEquipmentTab(page);
      const boxAfterReload = await canvasBox(page);

      // --- Select instance A on the canvas, then remove it: with a real
      // connection attached, this must prompt for confirmation rather than
      // deleting silently. ---
      await page.mouse.click(boxAfterReload.x + 300, boxAfterReload.y + 300);
      await expect(page.getByRole("button", { name: "Remove from canvas" })).toBeVisible();
      await page.getByRole("button", { name: "Remove from canvas" }).click();

      const confirmDialog = page.getByRole("alertdialog");
      await expect(confirmDialog).toBeVisible();
      await expect(confirmDialog.getByText("Remove this instance?")).toBeVisible();
      await expect(confirmDialog.getByText(/1 connection/)).toBeVisible();

      await confirmDialog.getByRole("button", { name: "Remove" }).click();
      await expect(confirmDialog).toHaveCount(0);

      await expect
        .poll(async () => (await request.get(`/api/irrigation-part-instances/${instanceA.id}`)).status(), {
          message: "removing instance A from the canvas (after confirming) never actually deleted it server-side",
        })
        .toBe(404);

      // The connection was cascade-removed along with the instance, and
      // instance B (a sibling, untouched) survives with no dangling
      // connection of its own.
      const connAfter = await request.get(`/api/irrigation-connections/${connectionId}`);
      expect(connAfter.status()).toBe(404);
      const bStillThere = await getInstance(request, instanceB.id);
      expect(bStillThere.id).toBe(instanceB.id);
      const bConns = (await (await request.get(`/api/irrigation-connections?instance_id=${instanceB.id}`)).json()) as unknown[];
      expect(bConns).toHaveLength(0);

      connectionId = undefined; // already gone, skip in finally
    } finally {
      await cleanupInstance(request, instanceA.id);
      await cleanupInstance(request, instanceB.id);
      if (connectionId != null) await request.delete(`/api/irrigation-connections/${connectionId}`).catch(() => {});
      await cleanupPart(request, part.id);
      await request.delete(`/api/beds/${bed.id}?cascade=true`).catch(() => {});
    }
  });
});
