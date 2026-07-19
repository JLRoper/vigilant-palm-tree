"""Main game loop for Fallows of Elysium - Alpha v0.0.1."""

import random
import sys

from game import GAME_TITLE, VERSION
from game.combat import do_combat_round, spawn_enemy
from game.farming import advance_crops, field_status, harvest, plant, FIELD_PLOTS
from game.items import SHOP_ITEMS, use_item
from game.player import Player
from game.world import LOCATIONS, get_location


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _input(prompt: str = "") -> str:
    """Thin wrapper so tests can monkey-patch input easily."""
    return input(prompt)


def _print(*args, **kwargs) -> None:  # noqa: A001
    print(*args, **kwargs)


def divider(char: str = "-", width: int = 50) -> str:
    return char * width


def header(title: str) -> None:
    _print(f"\n{divider('=')}")
    _print(f"  {title}")
    _print(divider("="))


def banner() -> None:
    _print(divider("*"))
    _print(f"  {GAME_TITLE}  —  Alpha v{VERSION}")
    _print("  A world of fallow fields and forgotten glory.")
    _print(divider("*"))


# ---------------------------------------------------------------------------
# Sub-menus
# ---------------------------------------------------------------------------

def _travel_menu(current_location_name: str) -> str:
    """Let the player pick a new location. Returns new location name (or same)."""
    header("Travel")
    for i, loc in enumerate(LOCATIONS, 1):
        marker = " <-- (here)" if loc.name == current_location_name else ""
        _print(f"  {i}. {loc.name}{marker}")
    _print("  0. Stay here")
    choice = _input("\nWhere do you want to go? ").strip()
    if choice == "0":
        return current_location_name
    try:
        idx = int(choice) - 1
        if 0 <= idx < len(LOCATIONS):
            new_loc = LOCATIONS[idx]
            _print(f"\nYou travel to {new_loc.name}.")
            _print(f"  {new_loc.description}")
            return new_loc.name
    except ValueError:
        pass
    _print("Invalid choice.")
    return current_location_name


def _shop_menu(player: Player) -> None:
    """Shop interaction."""
    header("Greyveil Market — Shop")
    _print(f"  Your gold: {player.gold}g\n")
    items = list(SHOP_ITEMS.values())
    for i, item in enumerate(items, 1):
        _print(f"  {i}. {item.name} ({item.cost}g) — {item.description}")
    _print("  0. Leave shop")

    choice = _input("\nBuy what? ").strip()
    if choice == "0":
        return
    try:
        idx = int(choice) - 1
        if 0 <= idx < len(items):
            item = items[idx]
            if player.gold >= item.cost:
                player.gold -= item.cost
                player.inventory.append(item.name)
                _print(f"\nYou buy {item.name}. Gold remaining: {player.gold}g")
            else:
                _print("Not enough gold.")
        else:
            _print("Invalid choice.")
    except ValueError:
        _print("Invalid choice.")


def _use_item_menu(player: Player) -> None:
    """Use an item from inventory."""
    if not player.inventory:
        _print("Your inventory is empty.")
        return
    header("Use Item")
    for i, name in enumerate(player.inventory, 1):
        _print(f"  {i}. {name}")
    _print("  0. Cancel")

    choice = _input("\nUse which item? ").strip()
    if choice == "0":
        return
    try:
        idx = int(choice) - 1
        if 0 <= idx < len(player.inventory):
            item_name = player.inventory[idx]
            msg = use_item(item_name, player)
            _print(f"\n{msg}")
        else:
            _print("Invalid choice.")
    except ValueError:
        _print("Invalid choice.")


def _farm_menu(player: Player) -> None:
    """Farm management sub-menu."""
    header("Farm — The Homestead")
    _print(field_status(player))
    _print("\n  1. Plant a field")
    _print("  2. Harvest a field")
    _print("  0. Back")

    choice = _input("\nAction? ").strip()
    if choice == "0":
        return
    elif choice == "1":
        _print("  Which plot?")
        for i, p in enumerate(FIELD_PLOTS, 1):
            _print(f"    {i}. {p}")
        pc = _input("  Plot: ").strip()
        try:
            pidx = int(pc) - 1
            if 0 <= pidx < len(FIELD_PLOTS):
                _print(plant(player, FIELD_PLOTS[pidx]))
            else:
                _print("Invalid plot.")
        except ValueError:
            _print("Invalid choice.")
    elif choice == "2":
        _print("  Which plot?")
        for i, p in enumerate(FIELD_PLOTS, 1):
            _print(f"    {i}. {p}")
        pc = _input("  Plot: ").strip()
        try:
            pidx = int(pc) - 1
            if 0 <= pidx < len(FIELD_PLOTS):
                _print(harvest(player, FIELD_PLOTS[pidx]))
            else:
                _print("Invalid plot.")
        except ValueError:
            _print("Invalid choice.")
    else:
        _print("Invalid choice.")


def _combat_encounter(player: Player, location_name: str) -> None:
    """Run a full combat encounter."""
    location = get_location(location_name)
    difficulty = location.danger_level if location else 1
    enemy = spawn_enemy(difficulty)

    header(f"Encounter — {enemy.name}")
    _print(f"  A {enemy.name} blocks your path! (HP {enemy.hp})")
    _print(f"  Your HP: {player.hp}/{player.max_hp}\n")

    while player.is_alive() and enemy.is_alive():
        _print("  [1] Attack   [2] Use item   [3] Flee")
        choice = _input("  > ").strip()

        if choice == "1":
            log, over = do_combat_round(player, enemy)
            _print(log)
            if over:
                break
        elif choice == "2":
            _use_item_menu(player)
        elif choice == "3":
            if random.random() < 0.5:
                _print("  You manage to escape!")
                return
            else:
                _print("  You can't get away! The enemy strikes back.")
                dmg = player.take_damage(enemy.attack)
                _print(f"  {enemy.name} hits you for {dmg}! (HP: {player.hp}/{player.max_hp})")
                if not player.is_alive():
                    break
        else:
            _print("  Invalid choice.")

    if not enemy.is_alive():
        xp_msg = player.gain_xp(enemy.xp_reward)
        player.gold += enemy.gold_reward
        _print(f"\n  Victory! +{enemy.xp_reward} XP, +{enemy.gold_reward}g")
        if xp_msg:
            _print(f"  {xp_msg}")
    elif not player.is_alive():
        _print("\n  GAME OVER — You have fallen in the fallows of Elysium.")
        sys.exit(0)


# ---------------------------------------------------------------------------
# Main loop
# ---------------------------------------------------------------------------

def _explore(player: Player, location_name: str) -> None:
    """Trigger a random event in a dangerous zone."""
    location = get_location(location_name)
    if location is None or location.danger_level == 0:
        _print("The area is quiet. Nothing happens.")
        return

    roll = random.random()
    if roll < 0.65:
        _combat_encounter(player, location_name)
    elif roll < 0.80:
        found = random.randint(2, 8)
        player.gold += found
        _print(f"You search the area and find {found} gold in the ruins.")
    else:
        _print("You explore carefully but find nothing of note.")


def game_loop(player: Player) -> None:
    current_location = "The Homestead"
    turn = 0

    location = get_location(current_location)
    _print(f"\nYou find yourself at: {location.name}")
    _print(f"  {location.description}")

    while True:
        turn += 1

        # Advance crops each turn
        crop_notice = advance_crops(player)
        if crop_notice:
            _print(f"\n{crop_notice}")

        location = get_location(current_location)
        header(f"Turn {turn}  —  {current_location}")
        _print(f"  HP: {player.hp}/{player.max_hp}  |  Gold: {player.gold}g  |  Level: {player.level}")

        # Build context-sensitive menu
        options = ["1. Travel", "2. Explore / Forage"]
        if location and location.has_fields:
            options.append("3. Manage farm")
        if location and location.has_shop:
            options.append("4. Visit shop")
        options += ["5. View status", "6. Use item", "0. Quit"]

        for opt in options:
            _print(f"  {opt}")

        choice = _input("\nAction? ").strip()

        if choice == "0":
            _print("\nFarewell, settler. The fallows await your return.")
            break
        elif choice == "1":
            current_location = _travel_menu(current_location)
        elif choice == "2":
            _explore(player, current_location)
        elif choice == "3" and location and location.has_fields:
            _farm_menu(player)
        elif choice == "4" and location and location.has_shop:
            _shop_menu(player)
        elif choice == "5":
            header("Character Status")
            _print(player.status())
        elif choice == "6":
            _use_item_menu(player)
        else:
            _print("Invalid choice — try again.")


def new_game() -> None:
    banner()
    _print("\nWelcome to the fallows.\n")
    name = _input("Enter your settler's name: ").strip()
    if not name:
        name = "Settler"
    player = Player(name=name)
    _print(f"\nVery well, {player.name}. Your homestead awaits.")
    game_loop(player)


def main() -> None:
    banner()
    _print("\n  1. New Game")
    _print("  0. Quit")
    choice = _input("\n> ").strip()
    if choice == "1":
        new_game()
    else:
        _print("Farewell.")
        sys.exit(0)


if __name__ == "__main__":
    main()
