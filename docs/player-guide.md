# Player Guide

<!-- docs:verified 2026-10-18 -->

## Start a Game

New Game supports **1–4 human players**, **0–3 AI enemies**, and five map sizes (**Small** 24×18, **Medium** 36×27, **Large** 48×36, **Huge** 72×54, **Epic** 120×90). Pick one of the playable registry factions: Human, Ashen, Ironmark, or Verdant. Neutral monsters are not a selectable player faction. AI seats are not lobby seats; games with AI enemies are driven by the server. The optional **Uncharted mode** toggle starts the map hidden: never-explored tiles render fully dark, and explored tiles stay revealed for your seat as you move.

## Move and Found Settlements

Select your hero, then click a destination to preview and request a path. The route preview shows reachable movement for the current turn; terrain changes movement costs. Double-click a settlement to enter its city view.

To charter a settlement, use a selected hero on your turn and meet the visible requirements: a **2,500 gold** hero purse, **20 wood** and **15 stone** in the friendly provisioning settlement's warehouse, a valid passable target at least **4 hexes** from existing settlements, and no conflicting active charter. The hero travels to the target and construction takes **10 days**. The server-driven AI uses the same charter requirements and travel rules.

## Settlements and Logistics

Build from the city palette, recruit from eligible completed troop buildings, and manage the garrison from the settlement panel. Each settlement has a **worker pool** of `floor(population / 100)` you can assign per building — staff workers to scale production, market gold, recruitment draft recharge (higher-tier units refill more slowly), and town-hall upgrade speed (press `w` in the city view for the workforce panel; assigning `0` shuts a building down). The first assignment in a settlement normalizes it: every building you hadn't staffed drops to `0` until you crew it — settlements you never touch keep their legacy auto-staffing. Each settlement also owes a daily wage of `1 gold per 100 population`; it simply stops when the treasury is empty (no debt, no morale penalty). Six resource types exist: gold, wood, stone, iron, arcane, and food. Food is not generated on world-map tiles; food spots/buildings, stockpiles, consumption, and weekly troop upkeep are live.

Wagons carry physical caravan cargo between compatible routes. New games do not teleport resources through shared storage; deliveries wait for destination capacity. Hero and garrison upkeep is charged weekly, so check food stocks and income before the charge.

## Battles

- As the human attacker in a hero battle, choose **Fight**, **Quick Resolve**, or **Flee**.
- As the human defender of an AI-offered battle, choose **Fight** or **Quick Resolve**; **Flee** is unavailable because the AI move is already committed.
- Against a non-empty settlement garrison, the human attacker chooses **Assault**, **Auto-resolve**, or **Cancel**. Cancel leaves the hero on the settlement tile and does not submit a battle result.
- Defeat removes a hero; retreat relocates the hero with troops lost; surrender relocates the hero with troops retained. Settlement battles use the same hero outcome rules.

## Keyboard and Mouse

| Input | Action |
|---|---|
| `?` | Open keyboard and mouse help |
| `Esc` | Clear the selected hero/settlement panel; in city view, close menus, cancel placement, or leave the city |
| `B` | Toggle the city build palette |
| `Delete` / `Backspace` | Remove the building under the cursor in city view |
| Click / double-click | Select, move, attack, or enter a settlement |
| Drag / wheel | Pan / zoom the map (maximum zoom-out width is configurable from **20 to 34 hexes wide**, default **20**, under Settings → Visual) |

For detailed rules see [heroes](./heroes.md), [settlements](./settlements.md), [army and combat](./army.md), [resources](./resources.md), and [multiplayer](./multiplayer.md).
