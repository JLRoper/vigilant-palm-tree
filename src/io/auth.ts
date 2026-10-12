import { apiFetch } from "./api";
import { getCachedAuth, setCachedAuth, clearAuth, type AuthState } from "./authStorage";
import { setSignedIn, clearProfile } from "./userProfile";
import type { UserProfile } from "./authTypes";

export { getCachedAuth, clearAuth, type AuthState };

function withAuthHeaders(extra: Record<string, string> = {}, token?: string): Record<string, string> {
  const headers: Record<string, string> = { ...extra };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  return headers;
}

export async function requestLoginCode(email: string): Promise<{ devCode?: string; expiresAt: string }> {
  const res = await apiFetch(`${apiBase()}/auth/request-code`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`request-code failed: ${res.status} ${text}`);
  }
  const data = (await res.json()) as { devCode?: string; expiresAt: string };
  return { devCode: data.devCode, expiresAt: data.expiresAt };
}

export async function verifyLoginCode(email: string, code: string, accountName?: string): Promise<AuthState> {
  const res = await apiFetch(`${apiBase()}/auth/verify-code`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, code, ...(accountName ? { account_name: accountName } : {}) }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`verify-code failed: ${res.status} ${text}`);
  }
  const data = (await res.json()) as { email: string; token: string };
  const state: AuthState = { email: data.email, token: data.token };
  setCachedAuth(state);
  return state;
}

export async function checkSession(token: string): Promise<AuthState | null> {
  const res = await apiFetch(`${apiBase()}/auth/session`, {
    headers: withAuthHeaders({}, token),
  });
  if (res.status === 401) return null;
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`session check failed: ${res.status} ${text}`);
  }
  const data = (await res.json()) as { email: string };
  return { token, email: data.email };
}

export async function logout(token: string): Promise<void> {
  await apiFetch(`${apiBase()}/auth/logout`, {
    method: "POST",
    headers: withAuthHeaders({}, token),
  }).catch(() => {});
  clearAuth();
  clearProfile();
}

export async function register(accountName: string, email: string): Promise<UserProfile> {
  const res = await apiFetch(`${apiBase()}/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ account_name: accountName, email }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`register failed: ${res.status} ${text}`);
  }
  const data = (await res.json()) as { id: number; account_name: string; email: string; email_verified_at: string | null };
  const profile: UserProfile = {
    id: data.id,
    account_name: data.account_name,
    email: data.email,
    email_verified_at: data.email_verified_at,
    games_started: 0,
    games_won: 0,
    last_played_at: null,
  };
  setSignedIn(true, profile);
  return profile;
}

export async function getMe(token: string): Promise<UserProfile> {
  const res = await apiFetch(`${apiBase()}/auth/me`, {
    headers: withAuthHeaders({}, token),
  });
  if (res.status === 401) {
    clearProfile();
    throw new Error("unauthorized");
  }
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`getMe failed: ${res.status} ${text}`);
  }
  const data = (await res.json()) as UserProfile;
  setSignedIn(true, data);
  return data;
}

export async function updateMe(token: string, accountName: string): Promise<UserProfile> {
  const res = await apiFetch(`${apiBase()}/auth/me`, {
    method: "PATCH",
    headers: withAuthHeaders({ "Content-Type": "application/json" }, token),
    body: JSON.stringify({ account_name: accountName }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`updateMe failed: ${res.status} ${text}`);
  }
  const data = (await res.json()) as UserProfile;
  setSignedIn(true, data);
  return data;
}

function apiBase(): string {
  return "/api";
}

export function authHeader(token: string): Record<string, string> {
  return withAuthHeaders({}, token);
}
