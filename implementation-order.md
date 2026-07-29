# Kingdom Rule — Implementation Order (adjusted for FighterGame overlap)

Cross-referenced against FighterGame's actual implemented features (economy/
resources, collector-style mines, settlement capture, turn/round loop, and
trade are already ✅ there). **Phase 1 (Economy Foundation)** and **Phase 8
(Trade)** are removed outright since both are fully built in FighterGame and
can be ported/adapted rather than built fresh. The rest is kept, with partial
overlaps flagged so nothing gets duplicated.

---

## 1. Combat Resolution Engine
*(was Phase 2 — no dependencies; now the starting point since Economy is no
longer a blocking prerequisite you need to build)*

FighterGame only has auto-resolve combat, not a real hex-battle engine, so
this still has to be built from scratch here.

---

## 2. Castle Actions
*(was Phase 3 — now depends on the ported economy code instead of a
from-scratch Phase 1)*

FighterGame's city-view mine placement is a useful reference, but the
"build/repair/upgrade/send-supplies as a turn action" pattern doesn't exist
there — still net-new.

---

## 3. Hero Action Expansion
*(was Phase 4 — needs #1's combat resolver, and castle/collector state
from #2)*

The walk-into-castle capture logic is essentially already solved in
FighterGame (ownership flips on contact) — port that piece directly. Gather,
pillage, and folding bandit/tavern into turn actions are still net-new
(FighterGame has none of these).

---

## 4. Political Layer (Favor)
*(was Phase 5 — needs ported tax/economy, #1 revolt combat, #2 castle/tax
settings, #3 capture events)*

Nothing to remove — Favor doesn't exist in FighterGame at all.

---

## 5. Movement & Upkeep
*(was Phase 6 — needs ported stockpiles, #2 send-supplies, #3
round-consuming actions)*

FighterGame's A* movement and flat weekly gold upkeep are surface-similar
but don't cover the food/water/fatigue/desertion system Kingdom Rule needs —
still mostly net-new, though the movement-points-per-round bookkeeping
pattern is worth referencing.

---

## 6. Day/Night Cycle
*(was Phase 7 — needs #1's combat modifier hook)*

Nothing to remove — not present in FighterGame.

---

## 7. Client/UX Catch-Up
*(was Phase 9 — trails each phase above by one step)*

FighterGame's save/load and sprite pipeline are the only genuinely reusable
pieces here; the rest (collector HUD, combat screen, Favor indicator) is
bespoke to Kingdom Rule's systems.

---

## Net effect on the dependency chain

Since Economy and Trade are now "port, don't build," the first from-scratch
implementation work starts at Combat (#1) instead of running Economy/Combat
in parallel — you lose that parallelism but skip two whole phases of net-new
code.
