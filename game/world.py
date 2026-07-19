"""World / location module for Fallows of Elysium."""

from dataclasses import dataclass
from typing import List, Optional


@dataclass
class Location:
    name: str
    description: str
    danger_level: int = 0          # 0 = safe, higher = tougher enemies
    has_shop: bool = False
    has_fields: bool = False       # can plant / harvest here


LOCATIONS: List[Location] = [
    Location(
        name="The Homestead",
        description=(
            "Your modest plot on the fallow edge of Elysium. "
            "Cracked earth, overgrown hedgerows, and the faint smell of ash — "
            "yet the soil still holds promise."
        ),
        danger_level=0,
        has_shop=False,
        has_fields=True,
    ),
    Location(
        name="Greyveil Market",
        description=(
            "A ramshackle trading post where wandering merchants hawk "
            "potions, tools, and stolen curios beneath canvas awnings."
        ),
        danger_level=0,
        has_shop=True,
        has_fields=False,
    ),
    Location(
        name="The Withered Glades",
        description=(
            "Ancient woodland rotting from within. "
            "Twisted bark, silence, and the flicker of pale lights between the trees."
        ),
        danger_level=1,
        has_shop=False,
        has_fields=False,
    ),
    Location(
        name="Ashen Mire",
        description=(
            "Boggy flats covered in white silt — the remains of a forgotten city. "
            "Something stirs beneath the grey water."
        ),
        danger_level=2,
        has_shop=False,
        has_fields=False,
    ),
    Location(
        name="Elysian Threshold",
        description=(
            "A crumbling gate between the mortal fallows and the shining fields beyond. "
            "Whatever guards it is not friendly."
        ),
        danger_level=3,
        has_shop=False,
        has_fields=False,
    ),
]


def get_location(name: str) -> Optional[Location]:
    for loc in LOCATIONS:
        if loc.name == name:
            return loc
    return None
