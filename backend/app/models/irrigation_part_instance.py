from sqlalchemy import Column
from sqlalchemy.dialects.postgresql import JSONB
from sqlmodel import Field, SQLModel


class IrrigationPartInstance(SQLModel, table=True):
    """One physically-placed unit of an IrrigationPart catalog/stock row -
    #254's fix for the "I own 6 of these, each connected to a different
    neighbor in the real network" gap: IrrigationPart stays the catalog-
    level "how many I own" stock row (its own docstring), while each
    IrrigationPartInstance is a single physical item of that part type with
    its own diagram position and its own independent set of
    IrrigationConnection edges. Deleting one instance only removes that
    instance's own connections, not every connection involving the part
    type - see irrigation_part_instances.py's delete route.

    part_id references the stock row this instance is one physical unit
    of. How many instances exist for a part vs its quantity_on_hand is
    surfaced, not enforced - same "needs purchase" derived-not-blocked
    reasoning #37/#209 already use at the part level (see instance_count/
    needs_purchase on IrrigationPartDetail in irrigation_parts.py) - a
    legitimate workflow exists where you place instances ahead of buying
    the stock to match, same as recording a connection ahead of buying the
    part it needs today."""

    __tablename__ = "irrigation_part_instance"

    id: int | None = Field(default=None, primary_key=True)
    part_id: int = Field(foreign_key="irrigation_part.id")
    # Node position on the pipe-network diagram canvas (#209), moved here
    # from IrrigationPart by #254 - None means "not yet added to the
    # diagram", same semantics as before the move. Kept as-is by #271
    # alongside the new bed/garden-space fields below: #253 (anchor
    # snapping) and #256 (curved pipe routing/length calculation) both
    # depend on this diagram-local coordinate space, so it stays a distinct
    # concept from "where this part physically sits in the garden", not
    # replaced by it.
    diagram_x: float | None = None
    diagram_y: float | None = None
    # #271: real garden/bed-space placement, needed to merge the irrigation
    # editor into the main garden canvas (#250) - the same bed_id/garden_id
    # mutual-exclusivity split BedEquipment already uses (#207), see that
    # model's own docstring. Both null means "not yet placed in garden
    # space" (still fine on the standalone diagram via diagram_x/diagram_y),
    # same "unplaced inventory" semantics BedEquipment already gives that
    # state.
    bed_id: int | None = Field(default=None, foreign_key="bed.id")
    garden_id: int | None = Field(default=None, foreign_key="garden.id")
    # jsonb Geometry (rectangle|polygon - app/models/geometry.py), bed-local
    # if bed_id is set or garden-space if garden_id is set, same two-space
    # split docs/schema.md's "Geometry format" section already documents
    # for BED_EQUIPMENT/PLANTING. Irrigation parts are point-placed (a
    # nozzle, a T-junction) rather than area-placed, so the frontend is
    # expected to store a small rectangle centered on the placement point -
    # the same "individual placements use a small rectangle centered on the
    # point rather than a literal point type" convention PLANTING.geometry
    # already establishes, rather than introducing a third geometry variant
    # for this one column. Null while unplaced, same as BedEquipment.geometry.
    geometry: dict | None = Field(default=None, sa_column=Column(JSONB, nullable=True))
