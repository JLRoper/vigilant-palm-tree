import type { PlayerId } from "@heroes/contracts";

let current: PlayerId = 0;

export function setViewSeat(seat: PlayerId | null): void {
  current = seat ?? 0;
}

export function viewSeat(): PlayerId {
  return current;
}