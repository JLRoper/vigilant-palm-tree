"""Items and shop module for Fallows of Elysium."""

from dataclasses import dataclass
from typing import Dict


@dataclass
class Item:
    name: str
    description: str
    cost: int
    heal_amount: int = 0


SHOP_ITEMS: Dict[str, Item] = {
    "Health Potion": Item(
        name="Health Potion",
        description="Restores 30 HP.",
        cost=10,
        heal_amount=30,
    ),
    "Greater Potion": Item(
        name="Greater Potion",
        description="Restores 75 HP.",
        cost=25,
        heal_amount=75,
    ),
    "Elysian Herb": Item(
        name="Elysian Herb",
        description="A rare herb from Elysium. Restores full HP.",
        cost=60,
        heal_amount=9999,
    ),
}


def use_item(item_name: str, player) -> str:  # type: ignore[no-untyped-def]
    """Use a consumable item from the player's inventory. Returns result message."""
    if item_name not in player.inventory:
        return f"You don't have a {item_name}."

    item = SHOP_ITEMS.get(item_name)
    if item is None:
        return f"Unknown item: {item_name}."

    player.inventory.remove(item_name)
    if item.heal_amount > 0:
        restored = player.heal(item.heal_amount)
        return f"You use {item_name} and restore {restored} HP. (HP: {player.hp}/{player.max_hp})"

    return f"You use {item_name}, but nothing happens."
