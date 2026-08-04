import { Layer } from "react-konva";
import type { Decoration, Geometry } from "@/api/client";
import type { Bounds } from "./geometry";
import { DecorationNode } from "./DecorationNode";
import type { Viewport } from "./viewport";

interface DecorationLayerProps {
  decorations: Decoration[];
  selectedId: number | null;
  onSelect: (id: number | null) => void;
  onChange: (decoration: Decoration, geometry: Geometry) => void;
  viewport: Viewport;
  bounds?: Bounds;
}

/** Decorations' own Konva `Layer` (#242) - modeled on `EquipmentLayer.tsx`'s
 * role (a dedicated layer, only mounted while its own tab is active) but
 * genuinely interactive (drag/resize/rotate/select via `DecorationNode`),
 * unlike `EquipmentLayer`'s read-only markers - per this ticket's own design
 * spec, decorations get the same full editing fidelity beds do, equipment
 * doesn't. Only rendered while the Objects tab is active (`Layout.tsx`
 * gates this the same way it gates `EquipmentLayer` to the Equipment tab) -
 * decorations aren't visible/interactive on the Garden/Plants/Equipment
 * tabs at all, not just non-interactive there. */
export function DecorationLayer({ decorations, selectedId, onSelect, onChange, viewport, bounds }: DecorationLayerProps) {
  return (
    <Layer>
      {decorations.map((decoration) => (
        <DecorationNode
          key={decoration.id}
          decoration={decoration}
          isSelected={decoration.id === selectedId}
          onSelect={() => decoration.id != null && onSelect(decoration.id)}
          onChange={(geometry) => onChange(decoration, geometry)}
          interactive
          viewport={viewport}
          bounds={bounds}
        />
      ))}
    </Layer>
  );
}
