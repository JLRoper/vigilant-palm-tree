ALTER TABLE heroes
  ALTER COLUMN movement_remaining TYPE DOUBLE PRECISION USING movement_remaining::DOUBLE PRECISION,
  ALTER COLUMN previous_movement_remaining TYPE DOUBLE PRECISION USING previous_movement_remaining::DOUBLE PRECISION;
