import { useEffect, useState, type FormEvent } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { MapPin, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogPopup,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";
import {
  createIrrigationPart,
  deleteIrrigationConnection,
  deleteIrrigationPart,
  deleteIrrigationPartInstance,
  updateIrrigationPart,
  type IrrigationConnection,
  type IrrigationPart,
  type IrrigationPartInstance,
  type IrrigationPartType,
} from "@/api/client";
import type { ArmedIrrigationTarget } from "./IrrigationLayer";

interface AddPartFormState {
  name: string;
  partType: string;
  quantityOnHand: string;
}

/** One catalog part's own row (#209/#254, ported from the now-retired
 * `PipeNetworkDialog.tsx`'s `PartRow`) - inline-editable connector size/
 * quantity (blur-to-save, same UX `EquipmentPanel.tsx`'s `ZoneRow` name
 * field already uses), a "needs purchase" pill driven by how many instances
 * of this part exist (placed or not) vs `quantity_on_hand`, delete, and -
 * new for #250 - an "Arm to place" button (`MapPin`) instead of the old
 * dialog's "Add instance to diagram": arming a part here doesn't create an
 * instance by itself anymore, it's the toolbar-button-then-click-to-place
 * gesture's first half (`IrrigationLayer.tsx`'s `onPlace` creates the
 * instance the moment the canvas click actually lands). */
function PartRow({
  part,
  instanceCount,
  isArmed,
  onArm,
  onUpdateField,
  onDelete,
}: {
  part: IrrigationPart;
  instanceCount: number;
  isArmed: boolean;
  onArm: () => void;
  onUpdateField: (patch: { connector_size_mm?: number | null; quantity_on_hand?: number }) => void;
  onDelete: () => void;
}) {
  const [connectorSize, setConnectorSize] = useState(part.connector_size_mm != null ? String(part.connector_size_mm) : "");
  const [quantity, setQuantity] = useState(String(part.quantity_on_hand));
  useEffect(() => setConnectorSize(part.connector_size_mm != null ? String(part.connector_size_mm) : ""), [part.connector_size_mm]);
  useEffect(() => setQuantity(String(part.quantity_on_hand)), [part.quantity_on_hand]);

  const needsPurchase = instanceCount > part.quantity_on_hand;

  return (
    <div className={`flex flex-col gap-1 rounded px-1.5 py-1.5 text-sm ${isArmed ? "bg-accent" : ""}`}>
      <div className="flex items-center justify-between">
        <div className="flex-1">
          <div className="font-medium">{part.name}</div>
          <div className="text-xs text-muted-foreground">{part.part_type}</div>
        </div>
        <Button variant="ghost" size="icon-sm" aria-label={`Delete ${part.name}`} onClick={onDelete}>
          <Trash2 />
        </Button>
      </div>
      {needsPurchase && (
        <span className="w-fit rounded-full bg-destructive/10 px-2 py-0.5 text-xs font-medium text-destructive">
          Needs purchase · have {part.quantity_on_hand}, placed {instanceCount}
        </span>
      )}
      <div className="flex items-center gap-1.5">
        <Input
          className="h-6 w-16 text-xs"
          type="number"
          placeholder="mm"
          value={connectorSize}
          onChange={(e) => setConnectorSize(e.target.value)}
          onBlur={() => {
            const next = connectorSize.trim() === "" ? null : Number(connectorSize);
            if (next !== part.connector_size_mm) onUpdateField({ connector_size_mm: next });
          }}
        />
        <Input
          className="h-6 w-14 text-xs"
          type="number"
          placeholder="qty"
          value={quantity}
          onChange={(e) => setQuantity(e.target.value)}
          onBlur={() => {
            const next = Number(quantity);
            if (!Number.isNaN(next) && next !== part.quantity_on_hand) onUpdateField({ quantity_on_hand: next });
          }}
        />
        <Button variant={isArmed ? "default" : "secondary"} size="xs" className="ml-auto" onClick={onArm}>
          <MapPin /> {isArmed ? "Armed" : "Place"}
        </Button>
      </div>
    </div>
  );
}

interface IrrigationPartsPanelProps {
  parts: IrrigationPart[];
  partTypes: IrrigationPartType[];
  instances: IrrigationPartInstance[];
  connections: IrrigationConnection[];
  armedTarget: ArmedIrrigationTarget | null;
  onArm: (target: ArmedIrrigationTarget) => void;
  onClearArmed: () => void;
  selectedInstance: IrrigationPartInstance | null;
  selectedConnection: IrrigationConnection | null;
  onCloseSelection: () => void;
}

/** The Equipment tab's irrigation-parts catalog + placement side panel
 * (#250) - the real-canvas merge's destination for what used to be
 * `PipeNetworkDialog.tsx`'s left-panel parts list (see this ticket's own
 * research doc, section 1: "the Equipment tab already has a reserved
 * side-panel region... nothing about EquipmentPanel's own layout is
 * architecturally different from what PartRow already does"). Rendered
 * alongside `EquipmentPanel` on the Equipment tab (`Layout.tsx`), not in
 * place of it - `BedEquipment` (trellises, drip lines, zones) and
 * `IrrigationPart`/`IrrigationPartInstance` (the pipe-network graph) are
 * different data models that happen to share a tab.
 *
 * Also carries #250's own migration path: `instances` created before this
 * merge (still only holding the old schematic `diagram_x`/`diagram_y`, no
 * `bed_id`/`garden_id`/`geometry`) show up in the "Unplaced" section below
 * rather than silently vanishing from view now that the dialog that used to
 * show them is gone - arming one from there re-places that *same* instance
 * (keeping its existing connections), rather than losing them by deleting
 * and recreating it (see `ArmedIrrigationTarget`'s own doc). */
export function IrrigationPartsPanel({
  parts,
  partTypes,
  instances,
  connections,
  armedTarget,
  onArm,
  onClearArmed,
  selectedInstance,
  selectedConnection,
  onCloseSelection,
}: IrrigationPartsPanelProps) {
  const queryClient = useQueryClient();
  const [addForm, setAddForm] = useState<AddPartFormState>({ name: "", partType: "", quantityOnHand: "0" });
  const [addError, setAddError] = useState<string | null>(null);
  const [confirmDeletePart, setConfirmDeletePart] = useState<IrrigationPart | null>(null);
  const [confirmDeleteInstance, setConfirmDeleteInstance] = useState<IrrigationPartInstance | null>(null);

  const partsById = new Map(parts.filter((p) => p.id != null).map((p) => [p.id as number, p]));
  const instanceCountByPart = new Map<number, number>();
  for (const i of instances) {
    if (i.part_id == null) continue;
    instanceCountByPart.set(i.part_id, (instanceCountByPart.get(i.part_id) ?? 0) + 1);
  }
  const connectionCountByInstance = new Map<number, number>();
  for (const c of connections) {
    connectionCountByInstance.set(c.from_instance_id, (connectionCountByInstance.get(c.from_instance_id) ?? 0) + 1);
    connectionCountByInstance.set(c.to_instance_id, (connectionCountByInstance.get(c.to_instance_id) ?? 0) + 1);
  }
  // #250's migration case - see this component's own doc above.
  const unplaced = instances.filter((i) => i.bed_id == null && i.garden_id == null);

  const createPartMutation = useMutation({
    mutationFn: () =>
      createIrrigationPart({
        name: addForm.name.trim(),
        part_type: addForm.partType.trim(),
        quantity_on_hand: addForm.quantityOnHand.trim() === "" ? 0 : Number(addForm.quantityOnHand),
        notes: "",
        connector_size_mm: null,
      }),
    onSuccess: (created) => {
      queryClient.setQueryData<IrrigationPart[]>(["irrigation-parts"], (old) => (old ? [...old, created] : [created]));
      setAddForm({ name: "", partType: "", quantityOnHand: "0" });
    },
    onError: (err: unknown) => setAddError(err instanceof Error ? err.message : "Failed to add part"),
  });

  const updatePartMutation = useMutation({
    mutationFn: ({ id, patch }: { id: number; patch: Parameters<typeof updateIrrigationPart>[1] }) => updateIrrigationPart(id, patch),
    onSuccess: (updated) => {
      queryClient.setQueryData<IrrigationPart[]>(["irrigation-parts"], (old) => (old ? old.map((p) => (p.id === updated.id ? updated : p)) : old));
    },
  });

  const deletePartMutation = useMutation({
    mutationFn: (id: number) => deleteIrrigationPart(id),
    onSuccess: (_void, id) => {
      queryClient.setQueryData<IrrigationPart[]>(["irrigation-parts"], (old) => old?.filter((p) => p.id !== id));
      // The backend cascades every instance of this part (and their own
      // connections) on delete - refetch rather than hand-pruning those
      // caches.
      queryClient.invalidateQueries({ queryKey: ["irrigation-part-instances"] });
      queryClient.invalidateQueries({ queryKey: ["irrigation-connections"] });
      if (selectedInstance?.part_id === id) onCloseSelection();
      if (armedTarget && (armedTarget.mode === "create" ? armedTarget.part.id : armedTarget.instance.part_id) === id) onClearArmed();
    },
  });

  const deleteInstanceMutation = useMutation({
    mutationFn: (id: number) => deleteIrrigationPartInstance(id),
    onSuccess: (_void, id) => {
      queryClient.setQueryData<IrrigationPartInstance[]>(["irrigation-part-instances"], (old) => old?.filter((i) => i.id !== id));
      // The backend only removes this one instance's own connections, not
      // any sibling instance's - refetch rather than hand-pruning.
      queryClient.invalidateQueries({ queryKey: ["irrigation-connections"] });
      if (selectedInstance?.id === id) onCloseSelection();
    },
  });

  const deleteConnectionMutation = useMutation({
    mutationFn: (id: number) => deleteIrrigationConnection(id),
    onSuccess: (_void, id) => {
      queryClient.setQueryData<IrrigationConnection[]>(["irrigation-connections"], (old) => old?.filter((c) => c.id !== id));
      if (selectedConnection?.id === id) onCloseSelection();
    },
  });

  function submitAddPart(e: FormEvent) {
    e.preventDefault();
    setAddError(null);
    if (!addForm.name.trim() || !addForm.partType.trim()) {
      setAddError("Name and part type are required.");
      return;
    }
    createPartMutation.mutate();
  }

  function requestDeleteInstance(instance: IrrigationPartInstance) {
    if (instance.id == null) return;
    const count = connectionCountByInstance.get(instance.id) ?? 0;
    if (count > 0) setConfirmDeleteInstance(instance);
    else deleteInstanceMutation.mutate(instance.id);
  }

  function requestDeletePart(part: IrrigationPart) {
    if (part.id == null) return;
    const count = instanceCountByPart.get(part.id) ?? 0;
    if (count > 0) setConfirmDeletePart(part);
    else deletePartMutation.mutate(part.id);
  }

  function isArmedForPart(partId: number | null | undefined): boolean {
    if (!armedTarget || partId == null) return false;
    if (armedTarget.mode === "create") return armedTarget.part.id === partId;
    return armedTarget.instance.part_id === partId;
  }

  return (
    <Card className="flex w-80 flex-col gap-3 p-3">
      <h2 className="text-sm font-medium">Irrigation parts</h2>

      {(selectedInstance || selectedConnection) && (
        <div className="flex items-center justify-between rounded border bg-muted/40 px-2 py-1.5 text-xs">
          {selectedConnection ? (
            <>
              <span>
                {partsById.get(instances.find((i) => i.id === selectedConnection.from_instance_id)?.part_id ?? -1)?.name ?? "?"} ↔{" "}
                {partsById.get(instances.find((i) => i.id === selectedConnection.to_instance_id)?.part_id ?? -1)?.name ?? "?"}
              </span>
              <Button
                variant="ghost"
                size="xs"
                onClick={() => selectedConnection.id != null && deleteConnectionMutation.mutate(selectedConnection.id)}
              >
                Remove
              </Button>
            </>
          ) : (
            selectedInstance && (
              <>
                <span>{partsById.get(selectedInstance.part_id)?.name ?? "?"}</span>
                <Button variant="ghost" size="xs" onClick={() => requestDeleteInstance(selectedInstance)}>
                  Remove from canvas
                </Button>
              </>
            )
          )}
        </div>
      )}

      <form className="flex flex-col gap-1.5 border-b pb-3" onSubmit={submitAddPart}>
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-muted-foreground">Name</span>
          <Input value={addForm.name} onChange={(e) => setAddForm((f) => ({ ...f, name: e.target.value }))} />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-muted-foreground">Part type</span>
          <Input list="irrigation-part-types" value={addForm.partType} onChange={(e) => setAddForm((f) => ({ ...f, partType: e.target.value }))} />
          <datalist id="irrigation-part-types">
            {/* Suggestions come from the live IrrigationPartType catalog
                (active resource packs only) - not a hardcoded list. Typing a
                part type that isn't in the catalog still saves fine (free
                text backend field), so an empty/near-empty datalist
                (expected until a resource pack is actually seeded) doesn't
                block adding a part. */}
            {partTypes.map((t) => (
              <option key={t.id ?? t.slug} value={t.slug} label={t.name} />
            ))}
          </datalist>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-muted-foreground">Quantity on hand</span>
          <Input type="number" value={addForm.quantityOnHand} onChange={(e) => setAddForm((f) => ({ ...f, quantityOnHand: e.target.value }))} />
        </label>
        {addError && <p className="text-xs text-destructive">{addError}</p>}
        <Button type="submit" size="sm" disabled={createPartMutation.isPending}>
          <Plus /> Add part
        </Button>
      </form>

      <div className="flex flex-1 flex-col gap-1 overflow-y-auto">
        {parts.length === 0 && <p className="text-xs text-muted-foreground">No irrigation parts yet - add one above.</p>}
        {parts.map((part) => (
          <PartRow
            key={part.id}
            part={part}
            instanceCount={part.id != null ? (instanceCountByPart.get(part.id) ?? 0) : 0}
            isArmed={isArmedForPart(part.id)}
            onArm={() => {
              if (isArmedForPart(part.id)) {
                onClearArmed();
              } else {
                onArm({ mode: "create", part });
              }
            }}
            onUpdateField={(patch) => part.id != null && updatePartMutation.mutate({ id: part.id, patch })}
            onDelete={() => requestDeletePart(part)}
          />
        ))}
      </div>

      {unplaced.length > 0 && (
        <div className="flex flex-col gap-1 border-t pt-2">
          <h3 className="text-xs font-medium text-muted-foreground">
            Unplaced ({unplaced.length}) - existing pipe-network data with no real position yet
          </h3>
          <div className="flex max-h-32 flex-col gap-1 overflow-y-auto">
            {unplaced.map((instance) => {
              const part = instance.part_id != null ? partsById.get(instance.part_id) : undefined;
              const armed = armedTarget?.mode === "position" && armedTarget.instance.id === instance.id;
              return (
                <div key={instance.id} className={`flex items-center justify-between gap-1 rounded px-1.5 py-1 text-xs ${armed ? "bg-accent" : ""}`}>
                  <span>{part?.name ?? "Unknown part"}</span>
                  <div className="flex items-center gap-0.5">
                    <Button
                      variant={armed ? "default" : "secondary"}
                      size="xs"
                      onClick={() => (armed ? onClearArmed() : onArm({ mode: "position", instance, part }))}
                    >
                      <MapPin /> {armed ? "Armed" : "Place"}
                    </Button>
                    <Button variant="ghost" size="icon-sm" aria-label="Remove" onClick={() => requestDeleteInstance(instance)}>
                      <Trash2 />
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <AlertDialog open={confirmDeletePart != null} onOpenChange={(next) => !next && setConfirmDeletePart(null)}>
        <AlertDialogPopup>
          <AlertDialogTitle>Delete "{confirmDeletePart?.name}"?</AlertDialogTitle>
          <AlertDialogDescription>
            This part has {confirmDeletePart?.id != null ? (instanceCountByPart.get(confirmDeletePart.id) ?? 0) : 0} instance(s) - deleting it
            removes those instances and their connections too.
          </AlertDialogDescription>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                if (confirmDeletePart?.id != null) deletePartMutation.mutate(confirmDeletePart.id);
                setConfirmDeletePart(null);
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogPopup>
      </AlertDialog>

      <AlertDialog open={confirmDeleteInstance != null} onOpenChange={(next) => !next && setConfirmDeleteInstance(null)}>
        <AlertDialogPopup>
          <AlertDialogTitle>Remove this instance?</AlertDialogTitle>
          <AlertDialogDescription>
            This instance has {confirmDeleteInstance?.id != null ? (connectionCountByInstance.get(confirmDeleteInstance.id) ?? 0) : 0} connection(s)
            - removing it removes those too. Other instances of the same part keep their own connections.
          </AlertDialogDescription>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                if (confirmDeleteInstance?.id != null) deleteInstanceMutation.mutate(confirmDeleteInstance.id);
                setConfirmDeleteInstance(null);
              }}
            >
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogPopup>
      </AlertDialog>
    </Card>
  );
}
