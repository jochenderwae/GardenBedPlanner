import { useEffect, useRef } from "react";
import { Group, Rect, Text, Transformer } from "react-konva";
import type Konva from "konva";
import type { Bed } from "@/api/client";
import { BED_TYPE_COLORS, snapToGrid } from "./geometry";

const MIN_SIZE_CM = 20;

interface BedNodeProps {
  bed: Bed;
  isSelected: boolean;
  onSelect: () => void;
  onChange: (patch: { pos_x: number; pos_y: number; width_cm?: number; length_cm?: number }) => void;
}

export function BedNode({ bed, isSelected, onSelect, onChange }: BedNodeProps) {
  const shapeRef = useRef<Konva.Rect>(null);
  const trRef = useRef<Konva.Transformer>(null);

  useEffect(() => {
    if (isSelected && trRef.current && shapeRef.current) {
      trRef.current.nodes([shapeRef.current]);
      trRef.current.getLayer()?.batchDraw();
    }
  }, [isSelected]);

  const colors = BED_TYPE_COLORS[bed.bed_type];

  return (
    <>
      <Group>
        <Rect
          ref={shapeRef}
          x={bed.pos_x}
          y={bed.pos_y}
          width={bed.width_cm}
          height={bed.length_cm}
          fill={colors.fill}
          stroke={isSelected ? "#1d4ed8" : colors.stroke}
          strokeWidth={isSelected ? 2.5 : 1.5}
          dash={bed.bed_type === "compost_bin" ? [6, 4] : undefined}
          draggable
          dragBoundFunc={(pos) => ({ x: snapToGrid(pos.x), y: snapToGrid(pos.y) })}
          onClick={onSelect}
          onTap={onSelect}
          onDragEnd={(e) => onChange({ pos_x: e.target.x(), pos_y: e.target.y() })}
          onTransformEnd={() => {
            const node = shapeRef.current;
            if (!node) return;
            const scaleX = node.scaleX();
            const scaleY = node.scaleY();
            node.scaleX(1);
            node.scaleY(1);
            onChange({
              pos_x: node.x(),
              pos_y: node.y(),
              width_cm: Math.max(MIN_SIZE_CM, Math.round(node.width() * scaleX)),
              length_cm: Math.max(MIN_SIZE_CM, Math.round(node.height() * scaleY)),
            });
          }}
        />
        <Text
          x={bed.pos_x + 4}
          y={bed.pos_y + 4}
          text={bed.name}
          fontSize={12}
          fill="#1f2937"
          listening={false}
        />
        {bed.has_greenhouse && (
          <Text
            x={bed.pos_x + 4}
            y={bed.pos_y + bed.length_cm - 16}
            text="greenhouse"
            fontSize={10}
            fill="#1f2937"
            opacity={0.7}
            listening={false}
          />
        )}
      </Group>
      {isSelected && (
        <Transformer
          ref={trRef}
          rotateEnabled={false}
          boundBoxFunc={(oldBox, newBox) => {
            if (newBox.width < MIN_SIZE_CM || newBox.height < MIN_SIZE_CM) return oldBox;
            return newBox;
          }}
        />
      )}
    </>
  );
}
