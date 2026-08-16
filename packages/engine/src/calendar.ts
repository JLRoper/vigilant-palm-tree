import type { CalendarParts } from "@heroes/contracts";

export const DAYS_PER_WEEK = 7;
export const DAYS_PER_MONTH = 30;

export function calendarFromDay(day: number): CalendarParts {
  const d = Math.max(1, Math.floor(day));
  return {
    week: Math.floor((d - 1) / DAYS_PER_WEEK) + 1,
    dayOfWeek: ((d - 1) % DAYS_PER_WEEK) + 1,
    month: Math.floor((d - 1) / DAYS_PER_MONTH) + 1,
    dayOfMonth: ((d - 1) % DAYS_PER_MONTH) + 1,
  };
}

const MONTH_NAMES: readonly string[] = [
  "Frostmoon", "Thawmist", "Greenrise", "Bloomtide", "Sunpeak", "Goldfall",
  "Harvest", "Emberveil", "Hollowmoon", "Stillrime", "Longnight", "Stormwane",
];

export function monthName(month: number): string {
  if (month < 1) return MONTH_NAMES[0];
  return MONTH_NAMES[(month - 1) % MONTH_NAMES.length];
}
