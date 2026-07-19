let rngState = 0x12345678;

export function rng(): number {
  rngState = (rngState * 1664525 + 1013904223) >>> 0;
  return rngState / 4294967296;
}
