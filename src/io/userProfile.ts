// Server-authoritative profile cache. Read-only while anonymous, live while a
// token exists. Reads server state only (no local store); anonymous callers get
// a null/empty profile so the UI never overwrites identity data.
import type { UserProfile } from "./authTypes";
import { EMPTY_USER_PROFILE } from "./authTypes";

export type { UserProfile };

let cachedProfile: UserProfile = { ...EMPTY_USER_PROFILE };
let isSignedIn = false;

export function getProfile(): UserProfile {
  return cachedProfile;
}

export function setSignedIn(signedIn: boolean, profile: UserProfile | null): void {
  isSignedIn = signedIn;
  if (signedIn && profile) {
    cachedProfile = { ...profile };
  } else {
    cachedProfile = { ...EMPTY_USER_PROFILE };
  }
}

export function clearProfile(): void {
  isSignedIn = false;
  cachedProfile = { ...EMPTY_USER_PROFILE };
}

export function isSignedInProfile(): boolean {
  return isSignedIn;
}
