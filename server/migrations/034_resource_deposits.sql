-- Hero resource pickups on the adventure map.
--
-- Shape: { "<q>,<r>": <amount still on the floor> } -- one entry per resource
-- tile a hero has picked from, absent for a tile nobody has touched. A tile's
-- pristine amount is a hash of the map seed and the tile
-- (packages/engine/src/map/resourceTiles.ts's resourceAmountFor), so only what
-- has been TAKEN needs storing; that keeps terrain generation exactly as it
-- was for an existing seed and needs no MapGenVersion bump.
--
-- Default '{}' keeps existing rows working: every tile then reads its pristine
-- amount, which is the correct pre-pickup world.
ALTER TABLE games
  ADD COLUMN IF NOT EXISTS resource_deposits JSONB NOT NULL DEFAULT '{}'::jsonb;
