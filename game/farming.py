"""Farming module for Fallows of Elysium."""

import random
from typing import Optional


FIELD_PLOTS = ["North Field", "South Field", "East Field"]
HARVEST_TURNS = 3  # turns to wait between planting and harvesting


def plant(player, plot_name: str) -> str:
    """Plant seeds on a plot. Returns status message."""
    if plot_name not in FIELD_PLOTS:
        return f"'{plot_name}' is not a valid plot. Available: {', '.join(FIELD_PLOTS)}"
    if plot_name in player.fields:
        return f"{plot_name} is already planted (ready in {HARVEST_TURNS - player.fields[plot_name]} turn(s))."
    player.fields[plot_name] = 0
    return f"You plant seeds in {plot_name}. Come back in {HARVEST_TURNS} turns to harvest."


def harvest(player, plot_name: str) -> str:
    """Attempt to harvest a planted plot. Returns status message."""
    if plot_name not in FIELD_PLOTS:
        return f"'{plot_name}' is not a valid plot."
    if plot_name not in player.fields:
        return f"{plot_name} has not been planted yet."
    turns_grown = player.fields[plot_name]
    if turns_grown < HARVEST_TURNS:
        remaining = HARVEST_TURNS - turns_grown
        return f"{plot_name} is not ready yet — {remaining} more turn(s) needed."
    # Harvest!
    del player.fields[plot_name]
    yield_amount = random.randint(3, 8)
    player.grain += yield_amount
    gold_bonus = random.randint(0, 3)
    player.gold += gold_bonus
    bonus_msg = f" (+{gold_bonus}g from a passing merchant)" if gold_bonus else ""
    return f"You harvest {yield_amount} grain from {plot_name}!{bonus_msg} (Total grain: {player.grain})"


def advance_crops(player) -> Optional[str]:  # type: ignore[return]
    """Called each game turn to advance crop growth. Returns notice if any crop matures."""
    matured = []
    for plot in list(player.fields.keys()):
        player.fields[plot] += 1
        if player.fields[plot] >= HARVEST_TURNS:
            matured.append(plot)
    if matured:
        return f"[Farm] The following plots are ready to harvest: {', '.join(matured)}"
    return None


def field_status(player) -> str:
    """Return a summary of all field plots."""
    lines = []
    for plot in FIELD_PLOTS:
        if plot in player.fields:
            turns_grown = player.fields[plot]
            if turns_grown >= HARVEST_TURNS:
                lines.append(f"  {plot}: READY TO HARVEST")
            else:
                lines.append(f"  {plot}: growing ({turns_grown}/{HARVEST_TURNS} turns)")
        else:
            lines.append(f"  {plot}: fallow (unplanted)")
    return "\n".join(lines)
