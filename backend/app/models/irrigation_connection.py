from sqlmodel import Field, SQLModel


class IrrigationConnection(SQLModel, table=True):
    """Records that one IrrigationPart physically connects to another (e.g.
    a nozzle plugs into a T-junction) - the "pipe network" edge list #37
    asks for, so the exact watering layout can eventually be drawn out
    rather than only reasoned about in the abstract. A flat edge list (two
    FKs into irrigation_part), not a general graph model - matches this
    garden's actual scale (a handful of parts), same reasoning as
    IrrigationZone's own docstring on why a flat FK is enough here.

    from_part_id/to_part_id are undirected in practice (a connection is
    just "these two parts are connected", not implying a flow direction) -
    named from_/to_ only to give each end a distinct column name, not to
    encode directionality."""

    __tablename__ = "irrigation_connection"

    id: int | None = Field(default=None, primary_key=True)
    from_part_id: int = Field(foreign_key="irrigation_part.id")
    to_part_id: int = Field(foreign_key="irrigation_part.id")
    notes: str = ""
