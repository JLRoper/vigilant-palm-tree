# Fallows of Elysium

**Alpha v0.0.1** — Proof of concept

> *"The fields lie fallow, but the soil remembers."*

Fallows of Elysium is a text-based RPG where you settle on the blighted edge of a mythical paradise. Farm the cracked earth, explore dangerous ruins, trade at the market, and battle the creatures that haunt the withered land between the mortal world and Elysium.

---

## Getting Started

**Requirements:** Python 3.9+

```bash
python main.py
```

No external dependencies required.

---

## How to Play

At each turn you can:

| Action | Description |
|---|---|
| **Travel** | Move between locations |
| **Explore / Forage** | Search dangerous areas for enemies, loot, or gold |
| **Manage farm** | Plant seeds and harvest grain at The Homestead |
| **Visit shop** | Buy potions and supplies at Greyveil Market |
| **View status** | See your character sheet |
| **Use item** | Consume a potion from your inventory |

### Locations

| Location | Danger | Features |
|---|---|---|
| The Homestead | Safe | Farming |
| Greyveil Market | Safe | Shop |
| The Withered Glades | ⚔ Low | Exploration |
| Ashen Mire | ⚔⚔ Medium | Exploration |
| Elysian Threshold | ⚔⚔⚔ High | Exploration |

### Farming

1. Travel to **The Homestead**
2. Choose **Manage farm → Plant a field**
3. Explore or do other things for **3 turns**
4. Return and choose **Manage farm → Harvest a field**

---

## Running Tests

```bash
python -m pytest tests/ -v
```

---

## Project Structure

```
main.py          — Entry point and game loop
game/
  __init__.py    — Version / title constants
  player.py      — Player character (stats, XP, inventory)
  combat.py      — Enemy definitions and combat logic
  farming.py     — Planting and harvesting mechanics
  items.py       — Items, shop catalogue, item use
  world.py       — Location definitions
tests/
  test_game.py   — Unit tests for all game modules
```