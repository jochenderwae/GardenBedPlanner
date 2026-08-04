from sqlmodel import Field, SQLModel


class ResourcePack(SQLModel, table=True):
    """A named grouping of IrrigationPartType rows - e.g. "Gardena" - the
    user can toggle active/inactive as a whole (#251). Modeling a real
    IrrigationPartType catalog as a single flat table would force every
    vendor's parts into one undifferentiated list with no way to say "I
    don't own any Gardena gear, hide those suggestions"; a pack is the
    minimal grouping that lets several vendors' parts coexist without one
    hardcoded vendor baked into the schema.

    is_active is a plain toggle (no DB constraint requiring at least one
    active pack) - same "soft invariant enforced at the API layer, not the
    DB" spirit as Garden.is_active, except here having zero (or several)
    active packs at once is a perfectly legitimate state, not something
    that needs enforcing at all. IrrigationPartType.resource_pack_id is a
    real FK (unlike EquipmentType/IrrigationPart's slug-matched,
    non-FK precedent) since a part type only exists in the context of
    belonging to exactly one pack - there's no free-text part-type-without-
    a-pack case to preserve here the way there is for BedEquipment/
    IrrigationPart matching against their respective catalogs by string."""

    __tablename__ = "resource_pack"

    id: int | None = Field(default=None, primary_key=True)
    name: str = Field(unique=True, index=True)
    is_active: bool = True
