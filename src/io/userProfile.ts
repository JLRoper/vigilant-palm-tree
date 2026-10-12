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
