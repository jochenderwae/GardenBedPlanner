from enum import Enum

from sqlmodel import Field, SQLModel


class BedType(str, Enum):
    large_planter = "large_planter"
    small_planter = "small_planter"
    berry_row = "berry_row"
    compost_bin = "compost_bin"
    fruit_tree = "fruit_tree"


class Bed(SQLModel, table=True):
    id: int | None = Field(default=None, primary_key=True)
    name: str
    bed_type: BedType
    width_cm: float
    length_cm: float
    height_cm: float = 0
    has_greenhouse: bool = False
    pos_x: float = 0
    pos_y: float = 0
    notes: str = ""
