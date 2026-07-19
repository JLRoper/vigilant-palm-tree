"""Combat module for Fallows of Elysium."""

from __future__ import annotations

import random
from dataclasses import dataclass, field
from typing import TYPE_CHECKING, List, Tuple

if TYPE_CHECKING:
    from game.player import Player


@dataclass
class Enemy:
    name: str
    hp: int
    max_hp: int
    attack: int
    defense: int
    xp_reward: int
    gold_reward: int
    loot: List[str] = field(default_factory=list)

    def is_alive(self) -> bool:
        return self.hp > 0

    def take_damage(self, amount: int) -> int:
        damage = max(1, amount - self.defense)
        self.hp = max(0, self.hp - damage)
        return damage


ENEMY_TEMPLATES = [
    {"name": "Blighted Crow",   "hp": 20,  "attack": 8,  "defense": 1, "xp": 15,  "gold": 3},
    {"name": "Fallow Wraith",   "hp": 35,  "attack": 12, "defense": 3, "xp": 30,  "gold": 7},
    {"name": "Grave Thicket",   "hp": 50,  "attack": 10, "defense": 6, "xp": 45,  "gold": 10},
    {"name": "Elysian Hound",   "hp": 60,  "attack": 15, "defense": 5, "xp": 60,  "gold": 15},
    {"name": "Ashen Revenant",  "hp": 80,  "attack": 18, "defense": 8, "xp": 90,  "gold": 22},
]


def spawn_enemy(difficulty: int = 1) -> Enemy:
    """Spawn a random enemy scaled loosely to the given difficulty tier."""
    tier = min(difficulty - 1, len(ENEMY_TEMPLATES) - 1)
    pool = ENEMY_TEMPLATES[: tier + 1]
    template = random.choice(pool)
    return Enemy(
        name=template["name"],
        hp=template["hp"],
        max_hp=template["hp"],
        attack=template["attack"],
        defense=template["defense"],
        xp_reward=template["xp"],
        gold_reward=random.randint(template["gold"] // 2, template["gold"]),
    )


def do_combat_round(player: Player, enemy: Enemy) -> Tuple[str, bool]:
    """
    Execute one full combat round (player attacks, then enemy attacks if alive).
    Returns (log_text, combat_over).
    """
    lines = []

    # Player attacks
    dmg_to_enemy = enemy.take_damage(player.attack + random.randint(-2, 4))
    lines.append(f"  You strike {enemy.name} for {dmg_to_enemy} damage! ({enemy.hp}/{enemy.max_hp} HP)")

    if not enemy.is_alive():
        lines.append(f"  {enemy.name} has been defeated!")
        return "\n".join(lines), True

    # Enemy attacks back
    dmg_to_player = player.take_damage(enemy.attack + random.randint(-2, 3))
    lines.append(f"  {enemy.name} hits you for {dmg_to_player} damage! ({player.hp}/{player.max_hp} HP)")

    if not player.is_alive():
        lines.append("  You have been slain...")
        return "\n".join(lines), True

    return "\n".join(lines), False
