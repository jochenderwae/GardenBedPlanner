from sqlmodel import Field, SQLModel


class IrrigationPartType(SQLModel, table=True):
    """Reference lookup for IrrigationPart.part_type's real-world shape
    (#251) - the drip-irrigation equivalent of EquipmentType
    (app/models/equipment_type.py) for BedEquipment.equipment_type, same
    "seeded catalog, matched by normalized string, not a hard FK" pattern.

    connection_count is how many physical ports the part has (a
    T-junction has 3, a straight connector 2, an end cap 1, ...) - needed
    to eventually validate/render the pipe network diagram (#245-C/#245-F
    referenced by this ticket). part_number is the vendor's own SKU/name,
    for shopping-list generation (#245-F). icon_key is an opaque string a
    future frontend icon set keys off of (#245-C) - not an enum here since
    the actual icon set doesn't exist yet and this table shouldn't need a
    migration every time one is added.

    Unlike EquipmentType, this table's slug IS matched against
    IrrigationPart.part_type the same non-FK way (a part_type string with
    no matching row here still works, just without a rendered
    default/connection count - see that model's own docstring), but each
    row here DOES carry a hard FK to the ResourcePack it belongs to
    (resource_pack_id) - a part type is only ever offered as a suggestion
    while its pack is active (see app/api/routes/irrigation_part_types.py)."""

    __tablename__ = "irrigation_part_type"

    id: int | None = Field(default=None, primary_key=True)
    resource_pack_id: int = Field(foreign_key="resource_pack.id", index=True)
    slug: str = Field(unique=True, index=True)
    name: str
    connection_count: int
    part_number: str | None = None
    icon_key: str | None = None
