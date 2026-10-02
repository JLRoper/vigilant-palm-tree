import { types } from "pg";

// node-postgres returns NUMERIC (OID 1700) as a raw STRING unless a type
// parser is registered for it. Migration 027_numeric_columns.sql widened every
// numeric game column (games.gold; settlements/hero gold + morale;
// settlement_resources.amount; the #89 snapshot/transaction tables) from
// INTEGER to NUMERIC so the engine's 2-decimal floats persist at full
// precision — without this parser every such read would surface "6.4" (a
// string) where GameRow/HeroState/SettlementState and the engine expect the
// number 6.4.
//
// parseFloat round-trips Postgres's plain-decimal NUMERIC output exactly for
// game-scale values (Postgres stores the exact decimal it was given; the
// shortest string repr parses back to the identical double), and the null
// guard keeps NULL columns NULL rather than NaN. Registered once per process
// at import time: it is module-global pg state, so the shared pool in
// ../persistence/db.ts, eventsNotifier's LISTEN client, and any pool the
// tests build (test/smoke.ts, test/settlements.e2e.ts) all inherit it by
// importing this module.
types.setTypeParser(1700, (v) => (v === null ? null : parseFloat(v)));
