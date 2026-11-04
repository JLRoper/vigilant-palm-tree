// What a REAL hero battle is called on the manual arena's own chrome.
//
// openManualBattleArena defaults its top-bar title to the dev sandbox's
// ("Test Battle — Manual Fight") and documents that a production caller passes
// its own — the settlement assault passes "Assault on <Settlement name>". The
// hero-vs-hero path passed neither a title nor a side label, so every real hero
// battle was titled like the sandbox while the settlement fight beside it named
// its defender (playthrough round 4, F5: re-measured on 0.53.10 with the arena
// mounted the way that path opens it — top bar "Test Battle — Manual Fight",
// side chip "You: Red").
//
// One hero is named the way the rest of the battle flow names it — its own
// `name`, falling back to its id — so the arena's title, its rail header and
// the battle modal cannot disagree about who is fighting.
export interface HeroBattleSide {
  id: string;
  name?: string | null;
}

/** `Hero Alaric Ironheart` — the flow's own name for one side of a battle. */
export function heroBattleSideLabel(side: HeroBattleSide): string {
  return `Hero ${heroBattleSideName(side)}`;
}

/** The arena options that make a real fight read as itself, not as the sandbox. */
export function heroBattleArenaChrome(
  attacker: HeroBattleSide,
  defender: HeroBattleSide,
): { title: string; attackerLabel: string; defenderLabel: string } {
  return {
    title: `Hero battle — ${heroBattleSideName(attacker)} vs ${heroBattleSideName(defender)}`,
    attackerLabel: heroBattleSideLabel(attacker),
    defenderLabel: heroBattleSideLabel(defender),
  };
}

function heroBattleSideName(side: HeroBattleSide): string {
  const name = side.name?.trim();
  return name ? name : side.id;
}
