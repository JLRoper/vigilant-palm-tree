import type { PoolClient } from "pg";
import type { Queryable } from "./gameRepo";

export interface UserRow {
  id: number;
  account_name: string;
  email: string;
  email_verified_at: Date | null;
  created_at: Date;
  updated_at: Date;
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

export interface UserRepo {
  createUser(accountName: string, email: string): Promise<UserRow>;
  getUserByEmail(email: string): Promise<UserRow | null>;
  getUserByAccountName(accountName: string): Promise<UserRow | null>;
  getUser(userId: number): Promise<UserRow | null>;
  incrementGamesStarted(client: PoolClient, userId: number): Promise<number>;
}

export function createUserRepo(db: Queryable): UserRepo {
  function isPgError(err: unknown, code: string): boolean {
    return (err as { code?: string }).code === code;
  }

  return {
    async createUser(accountName, email) {
      const normalizedAccount = accountName.trim();
      const normalizedEmail = email.trim().toLowerCase();
      try {
        const r = await db.query<UserRow>(
          `INSERT INTO users (account_name, email)
           VALUES ($1, $2)
           RETURNING id, account_name, email, email_verified_at, created_at, updated_at`,
          [normalizedAccount, normalizedEmail]
        );
        return r.rows[0];
      } catch (err) {
        if (isPgError(err, "23505")) throw new DuplicateUserError();
        throw err;
      }
    },

    async getUserByEmail(email: string) {
      const r = await db.query<UserRow>(
        `SELECT id, account_name, email, email_verified_at, created_at, updated_at
         FROM users WHERE lower(email) = lower($1)`,
        [email]
      );
      return r.rows[0] ?? null;
    },

    async getUserByAccountName(accountName: string) {
      const r = await db.query<UserRow>(
        `SELECT id, account_name, email, email_verified_at, created_at, updated_at
         FROM users WHERE lower(trim(account_name)) = lower(trim($1))`,
        [accountName]
      );
      return r.rows[0] ?? null;
    },

    async getUser(userId: number) {
      const r = await db.query<UserRow>(
        `SELECT id, account_name, email, email_verified_at, created_at, updated_at
         FROM users WHERE id = $1`,
        [userId]
      );
      return r.rows[0] ?? null;
    },

    async incrementGamesStarted(client: PoolClient, userId: number) {
      try {
        const r = await client.query<{ games_started: number }>(
          `INSERT INTO user_stats (user_id, games_started, last_played_at)
           VALUES ($1, 1, now())
           ON CONFLICT (user_id) DO UPDATE
             SET games_started = user_stats.games_started + 1,
                 last_played_at = now()
           RETURNING games_started`,
          [userId]
        );
        return r.rows[0].games_started;
      } catch (err) {
        if (isPgError(err, "23503")) throw new UserNotFoundError(userId);
        throw err;
      }
    },
  };
}
