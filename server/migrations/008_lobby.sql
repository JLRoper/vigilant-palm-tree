-- LAN multiplayer lobby metadata.
-- Shape: { seats: number; humanSlots: number; claimed: Record<seatIndex, { handle: string; claimedAt: string }>; startedAt?: string }
-- Default '{}' keeps existing rows working; lobby endpoints read/write this column.
ALTER TABLE games
  ADD COLUMN IF NOT EXISTS lobby JSONB NOT NULL DEFAULT '{}'::jsonb;
