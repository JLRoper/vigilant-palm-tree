import type { PoolClient } from "pg";
import type { Queryable } from "./gameRepo";

// Canonical row shape for users; TIMESTAMPTZ columns arrive as Date.
export interface UserRow {
  id: number;
  account_name: string;
  email: string;
  email_verified_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

export interface UserStatsRow {
  user_id: number;
  games_started: number;
  last_played_at: Date | null;
}

export class UserNotFoundError extends Error {
  constructor(userId: number) {
    super(`user not found: ${userId}`);
    this.name = "UserNotFoundError";
  }
}

export class DuplicateUserError extends Error {
  constructor() {
    super("duplicate user (account_name or email already registered)");
    this.name = "DuplicateUserError";
  }
}

// One row per user for the profile scheme. `users` carries identity
// (account_name + email); `user_stats` carries counters.
export interface UserRepo {
  createUser(accountName: string, email: string): Promise<UserRow>;
  getUserByEmail(email: string): Promise<UserRow | null>;
  getUserByAccountName(accountName: string): Promise<UserRow | null>;
  getUser(userId: number): Promise<UserRow | null>;
  // Atomic increment — single statement, race-free. Returns the new
  // games_started count, or null if the user_stats row does not exist yet
  // (pre-alpha0: caller ensures the users row exists first at verify-code).
  incrementGamesStarted(client: PoolClient, userId: number): Promise<number | null>;
}

export function createUserRepo(db: Queryable): UserRepo {
  return {
    async createUser(accountName, email) {
      const r = await db.query<UserRow>(
        `INSERT INTO users (account_name, email)
         VALUES ($1, $2)
         RETURNING id, account_name, email, email_verified_at, created_at, updated_at`,
        [accountName, email]
      );
      if (r.rowCount === 0) throw new DuplicateUserError();
      return r.rows[0];
    },

    async getUserByEmail(email) {
      const r = await db.query<UserRow>(
        `SELECT id, account_name, email, email_verified_at, created_at, updated_at
         FROM users WHERE lower(email) = lower($1)`,
        [email]
      );
      return r.rows[0] ?? null;
    },

    async getUserByAccountName(accountName) {
      const r = await db.query<UserRow>(
        `SELECT id, account_name, email, email_verified_at, created_at, updated_at
         FROM users WHERE lower(trim(account_name)) = lower(trim($1))`,
        [accountName]
      );
      return r.rows[0] ?? null;
    },

    async getUser(userId) {
      const r = await db.query<UserRow>(
        `SELECT id, account_name, email, email_verified_at, created_at, updated_at
         FROM users WHERE id = $1`,
        [userId]
      );
      return r.rows[0] ?? null;
    },

    async incrementGamesStarted(client, userId) {
      const r = await client.query<{ games_started: number }>(
        `INSERT INTO user_stats (user_id, games_started, last_played_at)
         VALUES ($1, 1, now())
         ON CONFLICT (user_id) DO UPDATE
           SET games_started = user_stats.games_started + 1,
               last_played_at = now()
         RETURNING games_started`,
        [userId]
      );
      return r.rows[0]?.games_started ?? null;
    },
  };
}
