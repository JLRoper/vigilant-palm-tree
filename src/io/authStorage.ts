// Pure localStorage-backed auth token cache. Deliberately zero imports --
// src/io/auth.ts imports apiFetch from ./api, so api.ts attaching the
// Authorization header itself (see apiFetch in api.ts) needs to read the
// cached token from a module api.ts can import without creating an
// api.ts -> auth.ts -> api.ts cycle (dependency-cruiser.cjs's "no-circular"
// rule is severity: "error").

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

export function setCachedAuth(state: AuthState): void {
  writeCache(state);
}

export function clearAuth(): void {
  writeCache(null);
}
