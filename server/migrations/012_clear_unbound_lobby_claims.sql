-- Issue #179: lobby.claimed[seat] gained a required `email` field (identity
-- binding for requireGamePlayer) alongside the existing `handle` (cosmetic
-- display name). Pre-auth claims made before this migration only have
-- { handle, claimedAt } -- no email -- and would otherwise 403 forever under
-- the new membership check. One-shot cleanup: drop any claimed entry missing
-- `email` so its seat goes back to unclaimed and can be re-claimed under the
-- new (authenticated) flow. Idempotent -- re-running is a no-op once every
-- remaining entry has an email.
UPDATE games
   SET lobby = jsonb_set(
     lobby,
     '{claimed}',
     (
       SELECT COALESCE(jsonb_object_agg(key, value), '{}'::jsonb)
         FROM jsonb_each(lobby->'claimed')
        WHERE value ? 'email'
     ),
     false
   )
 WHERE lobby->'claimed' IS NOT NULL
   AND EXISTS (
     SELECT 1 FROM jsonb_each(lobby->'claimed') AS e(key, value)
      WHERE NOT (value ? 'email')
   );
