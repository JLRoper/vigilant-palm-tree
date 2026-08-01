import { apiFetch } from "./api";

const TOKEN_KEY = "heroesJs.authToken";
const EMAIL_KEY = "heroesJs.authEmail";

export type AuthState = {
  token: string;
  email: string;
};

function readCache(): AuthState | null {
  try {
    const token = localStorage.getItem(TOKEN_KEY);
    const email = localStorage.getItem(EMAIL_KEY);
    if (!token || !email) return null;
    return { token, email };
  } catch {
    return null;
  }
}

function writeCache(state: AuthState | null): void {
  try {
    if (state) {
      localStorage.setItem(TOKEN_KEY, state.token);
      localStorage.setItem(EMAIL_KEY, state.email);
    } else {
      localStorage.removeItem(TOKEN_KEY);
      localStorage.removeItem(EMAIL_KEY);
    }
  } catch {
    // ignore (private mode / quota)
  }
}

export function getCachedAuth(): AuthState | null {
  return readCache();
}

export function clearAuth(): void {
  writeCache(null);
}

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

export async function verifyLoginCode(email: string, code: string): Promise<AuthState> {
  const res = await apiFetch(`${apiBase()}/auth/verify-code`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, code }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`verify-code failed: ${res.status} ${text}`);
  }
  const data = (await res.json()) as { email: string; token: string };
  const state: AuthState = { email: data.email, token: data.token };
  writeCache(state);
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
}

function apiBase(): string {
  return "/api";
}

export function authHeader(token: string): Record<string, string> {
  return withAuthHeaders({}, token);
}
