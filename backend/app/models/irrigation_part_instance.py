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
    # diagram", same semantics as before the move.
    diagram_x: float | None = None
    diagram_y: float | None = None
