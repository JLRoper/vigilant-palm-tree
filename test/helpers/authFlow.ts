// Drives the real magic-link auth flow over HTTP against a running test
// server (issue #179) -- server/auth.ts's POST /auth/request-code returns
// `devCode` whenever NODE_ENV !== "production", so tests never need to mock
// email delivery or the auth system itself.

export function uniqueTestEmail(label: string): string {
  return `test-${label}-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;
}

export async function loginViaMagicLink(baseUrl: string, email: string): Promise<string> {
  const reqRes = await fetch(`${baseUrl}/auth/request-code`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email }),
  });
  if (!reqRes.ok) {
    throw new Error(`request-code failed: ${reqRes.status} ${await reqRes.text().catch(() => "")}`);
  }
  const { devCode } = (await reqRes.json()) as { devCode?: string };
  if (!devCode) {
    throw new Error("request-code did not return devCode -- is NODE_ENV=production in this test run?");
  }
  const verifyRes = await fetch(`${baseUrl}/auth/verify-code`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, code: devCode }),
  });
  if (!verifyRes.ok) {
    throw new Error(`verify-code failed: ${verifyRes.status} ${await verifyRes.text().catch(() => "")}`);
  }
  const { token } = (await verifyRes.json()) as { token: string };
  return token;
}

export async function claimSeat(
  baseUrl: string,
  token: string,
  gameName: string,
  seat: number,
  handle: string,
): Promise<void> {
  const res = await fetch(`${baseUrl}/games/${gameName}/lobby/claim`, {
    method: "POST",
    headers: { "content-type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ seat, handle }),
  });
  if (!res.ok) {
    throw new Error(`lobby/claim failed: ${res.status} ${await res.text().catch(() => "")}`);
  }
}

// Convenience wrapper for the common case: log in a fresh test email and
// claim the given seat on the given game in one call.
export async function loginAndClaim(
  baseUrl: string,
  gameName: string,
  seat: number,
  label = `seat${seat}`,
): Promise<string> {
  const token = await loginViaMagicLink(baseUrl, uniqueTestEmail(label));
  await claimSeat(baseUrl, token, gameName, seat, label);
  return token;
}

export function authHeader(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}` };
}
