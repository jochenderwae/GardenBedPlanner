from sqlmodel import Field, SQLModel


class IrrigationConnection(SQLModel, table=True):
    """Records that one physically-placed IrrigationPartInstance connects to
    another (e.g. a nozzle plugs into a T-junction) - the "pipe network"
    edge list #37 asks for, so the exact watering layout can eventually be
    drawn out rather than only reasoned about in the abstract. A flat edge
    list (two FKs into irrigation_part_instance), not a general graph model
    - matches this garden's actual scale (a handful of parts), same
    reasoning as IrrigationZone's own docstring on why a flat FK is enough
    here.

    #254: originally pointed at irrigation_part directly (one diagram node
    per part type), which couldn't represent owning several physical units
    of the same part connected to different neighbors - re-pointed at
    IrrigationPartInstance so each physical unit has its own independent
    set of connections. from_instance_id/to_instance_id are undirected in
    practice (a connection is just "these two instances are connected", not
    implying a flow direction) - named from_/to_ only to give each end a
    distinct column name, not to encode directionality."""

    __tablename__ = "irrigation_connection"

    id: int | None = Field(default=None, primary_key=True)
    from_instance_id: int = Field(foreign_key="irrigation_part_instance.id")
    to_instance_id: int = Field(foreign_key="irrigation_part_instance.id")
    notes: str = ""
