// Shared client-side type for the user profile scheme.
// Mirrors server/routes.ts's GET /auth/me response shape.

export interface UserProfile {
  id: number;
  account_name: string;
  email: string;
  email_verified_at: string | null;
  games_started: number;
  games_won: number;
  last_played_at: string | null;
}

export const EMPTY_USER_PROFILE: UserProfile = {
  id: 0,
  account_name: "",
  email: "",
  email_verified_at: null,
  games_started: 0,
  games_won: 0,
  last_played_at: null,
};
