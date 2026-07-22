from sqlmodel import Field, SQLModel


class IrrigationZone(SQLModel, table=True):
    """Groups one or more BedEquipment rows (drip lines/emitters) that share
    a water source/valve, so the garden's watering setup can be planned and
    queried per zone (#36, a root CLAUDE.md core-scope item) rather than
    equipment-by-equipment. A flat id/name lookup with a nullable zone_id FK
    on BedEquipment (see that model), not a many-to-many join table - matches
    the garden's actual scale (a handful of planters/beds/valves) and the
    real-world constraint that one drip line/emitter run is fed by exactly
    one valve, so a single FK is enough to express "in this zone or not"."""

    __tablename__ = "irrigation_zone"

    id: int | None = Field(default=None, primary_key=True)
    name: str
    notes: str | None = None
