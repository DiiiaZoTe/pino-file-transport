import type { ArchiveFrequency, DurationUnit, RotationFrequency } from "../types";

/**
 * Get the current period string based on rotation frequency.
 * - Daily: YYYY-MM-DD
 * - Hourly: YYYY-MM-DD~HH
 */
export function getCurrentRotationPeriod(frequency: RotationFrequency): string {
  const now = new Date();
  const date = now.toISOString().slice(0, 10); // YYYY-MM-DD

  if (frequency === "hourly") {
    const hour = String(now.getHours()).padStart(2, "0");
    return `${date}~${hour}`;
  }

  return date;
}

/**
 * Get the current period string based on archive frequency.
 * - Hourly: YYYY-MM-DD~HH
 * - Daily: YYYY-MM-DD
 * - Weekly: YYYY-MM-DD (Monday of the week)
 * - Monthly: YYYY-MM
 */
export function getCurrentArchivePeriod(frequency: ArchiveFrequency): string {
  const now = new Date();
  const dateStr = now.toISOString().slice(0, 10);
  const hour = String(now.getHours()).padStart(2, "0");

  switch (frequency) {
    case "hourly":
      return `${dateStr}~${hour}`;
    case "daily":
      return dateStr;
    case "weekly":
      return getMondayOfWeek(now);
    case "monthly":
      return dateStr.slice(0, 7);
  }
}

/**
 * Get the Monday of the week for a given date.
 * Used for weekly archive grouping.
 */
export function getMondayOfWeek(date: Date): string {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  d.setDate(diff);
  return d.toISOString().slice(0, 10);
}

/**
 * Calculate the cutoff date based on duration value and unit.
 */
export function getCutoffDate(now: Date, value: number, unit: DurationUnit): Date {
  const cutoff = new Date(now);

  switch (unit) {
    case "h":
      cutoff.setHours(cutoff.getHours() - value);
      break;
    case "d":
      cutoff.setDate(cutoff.getDate() - value);
      break;
    case "w":
      cutoff.setDate(cutoff.getDate() - value * 7);
      break;
    case "m":
      cutoff.setMonth(cutoff.getMonth() - value);
      break;
    case "y":
      cutoff.setFullYear(cutoff.getFullYear() - value);
      break;
  }

  return cutoff;
}

/**
 * Convert rotation/archive frequency to hours for comparison purposes.
 */
export function frequencyToHours(frequency: RotationFrequency | ArchiveFrequency): number {
  switch (frequency) {
    case "hourly":
      return 1;
    case "daily":
      return 24;
    case "weekly":
      return 24 * 7;
    case "monthly":
      return 24 * 31;
  }
}

/**
 * Convert duration to hours for comparison purposes.
 */
export function durationToHours(value: number, unit: DurationUnit): number {
  switch (unit) {
    case "h":
      return value;
    case "d":
      return value * 24;
    case "w":
      return value * 24 * 7;
    case "m":
      return value * 24 * 31;
    case "y":
      return value * 24 * 366;
  }
}

/**
 * Get ISO timestamp string
 */
export function getISOTimestamp(): string {
  return new Date().toISOString();
}
