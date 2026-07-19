"""Player module for Fallows of Elysium."""

from dataclasses import dataclass, field
from typing import Dict, List, Optional


@dataclass
class Player:
    name: str
    hp: int = 100
    max_hp: int = 100
    attack: int = 10
    defense: int = 5
    level: int = 1
    xp: int = 0
    gold: int = 20
    inventory: List[str] = field(default_factory=list)
    fields: Dict[str, int] = field(default_factory=dict)  # plot_name -> turns_planted

    # Resource stores
    grain: int = 0
    wood: int = 0
    stone: int = 0

    def xp_to_next_level(self) -> int:
        return self.level * 100

    def gain_xp(self, amount: int) -> Optional[str]:
        """Award XP and return a level-up message if the player levelled up."""
        self.xp += amount
        if self.xp >= self.xp_to_next_level():
            return self._level_up()
        return None

    def _level_up(self) -> str:
        self.xp -= self.xp_to_next_level()
        self.level += 1
        self.max_hp += 15
        self.hp = self.max_hp
        self.attack += 3
        self.defense += 2
        return f"*** Level Up! You are now level {self.level}! ***"

    def is_alive(self) -> bool:
        return self.hp > 0

    def heal(self, amount: int) -> int:
        """Heal the player; returns actual HP restored."""
        before = self.hp
        self.hp = min(self.hp + amount, self.max_hp)
        return self.hp - before

    def take_damage(self, amount: int) -> int:
        """Apply damage after defense reduction; returns damage taken."""
        damage = max(1, amount - self.defense)
        self.hp = max(0, self.hp - damage)
        return damage

    def status(self) -> str:
        lines = [
            f"  Name   : {self.name}",
            f"  Level  : {self.level}  (XP {self.xp}/{self.xp_to_next_level()})",
            f"  HP     : {self.hp}/{self.max_hp}",
            f"  Attack : {self.attack}   Defense: {self.defense}",
            f"  Gold   : {self.gold}g",
            f"  Grain  : {self.grain}  Wood: {self.wood}  Stone: {self.stone}",
            f"  Items  : {', '.join(self.inventory) if self.inventory else '(none)'}",
        ]
        return "\n".join(lines)
