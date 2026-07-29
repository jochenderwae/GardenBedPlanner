from sqlmodel import Field, SQLModel


class IrrigationPart(SQLModel, table=True):
    """A Gardena-style drip irrigation part the user owns as stock (nozzles,
    T-junctions, connectors, valves, hose/pipe segments), tracked at the
    catalog level - one row per distinct part type ("Gardena 13mm
    T-junction"), not one row per physical item, matching #37's technical
    analysis: a gardener thinks "I have 6 of these", not in terms of six
    individually-tracked rows. Additive to IrrigationZone (#36's zone-level
    grouping) and BedEquipment (placed equipment) - this table is about
    unplaced part-level inventory and how parts connect to each other
    (see IrrigationConnection), not placement on the canvas.

    "Needs purchase" is deliberately not a stored column here - it's derived
    by comparing quantity_on_hand against how many times a part is
    referenced by IrrigationConnection rows, computed at read time (see
    app/api/routes/irrigation_parts.py), same spirit as #41's seed-buying
    agenda deriving "need to buy" from existing data rather than a stored
    flag."""

    __tablename__ = "irrigation_part"

    id: int | None = Field(default=None, primary_key=True)
    name: str
    # Open-ended (nozzle | t_junction | connector | valve | hose_segment |
    # ...), same free-text-not-enum precedent as Bed.category/
    # BedEquipment.equipment_type - an exotic/one-off part type still works.
    part_type: str
    quantity_on_hand: int = 0
    notes: str = ""
