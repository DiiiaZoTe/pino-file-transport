import type { ArchiveFrequency, DurationFormat, DurationUnit, ParsedDuration } from "../types";
import { getMondayOfWeek } from "./time";

/**
 * Parse a duration string (e.g., "7d", "3m", "1y") into its components.
 * @throws Error if the duration string is invalid
 */
export function parseDuration(duration: DurationFormat): ParsedDuration {
  const match = duration.match(/^(\d+)([hdwmy])$/);
  if (!match) {
    throw new Error(
      `Invalid duration format: "${duration}". Expected format: <number><unit> (e.g., "7d", "3m", "1y")`,
    );
  }
  return {
    value: parseInt(match[1], 10),
    unit: match[2] as DurationUnit,
  };
}

/**
 * Get the log file path for a period.
 */
export function getLogPath(logDir: string, period: string): string {
  return `${logDir}/${period}.log`;
}

/**
 * Get the archive filename based on period.
 */
export function getArchiveFilename(period: string): string {
  return `${period}-archive.tar.gz`;
}

/**
 * Extract the period from a log filename based on archive frequency.
 * Supports daily (YYYY-MM-DD.log), hourly (YYYY-MM-DD~HH.log),
 * and overflow files (YYYY-MM-DD~HH-mm-ss.log).
 */
export function getFilePeriod(filename: string, frequency: ArchiveFrequency): string | null {
  const baseName = filename.replace(/\.log$/, "");

  // Try to parse the date from the filename
  const dateMatch = baseName.match(/^(\d{4}-\d{2}-\d{2})/);
  if (!dateMatch) return null;

  const dateStr = dateMatch[1];
  const date = new Date(dateStr);
  if (Number.isNaN(date.getTime())) return null;

  // Extract hour if present
  const hourMatch = baseName.match(/^(\d{4}-\d{2}-\d{2})~(\d{2})/);

  switch (frequency) {
    case "hourly":
      if (hourMatch) {
        return `${dateStr}~${hourMatch[2]}`;
      }
      return `${dateStr}~00`;

    case "daily":
      return dateStr;

    case "weekly":
      return getMondayOfWeek(date);

    case "monthly":
      return dateStr.slice(0, 7);
  }
}

/**
 * Parse a log filename to extract its date/time period.
 * Supports: YYYY-MM-DD.log, YYYY-MM-DD~HH.log, YYYY-MM-DD~HH-mm-ss*.log
 */
export function parseLogFilename(filename: string): Date | null {
  const baseName = filename.replace(/\.log$/, "");

  // Try hourly/overflow format: YYYY-MM-DD~HH or YYYY-MM-DD~HH-mm-ss
  const hourlyMatch = baseName.match(/^(\d{4})-(\d{2})-(\d{2})~(\d{2})/);
  if (hourlyMatch) {
    const [, year, month, day, hour] = hourlyMatch;
    return new Date(
      parseInt(year, 10),
      parseInt(month, 10) - 1,
      parseInt(day, 10),
      parseInt(hour, 10),
    );
  }

  // Try daily format: YYYY-MM-DD
  const dailyMatch = baseName.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (dailyMatch) {
    const [, year, month, day] = dailyMatch;
    return new Date(parseInt(year, 10), parseInt(month, 10) - 1, parseInt(day, 10));
  }

  return null;
}

/**
 * Parse an archive filename to extract its period.
 * Supports: YYYY-MM-DD~HH-archive.tar.gz, YYYY-MM-DD-archive.tar.gz, YYYY-MM-archive.tar.gz
 */
export function parseArchiveFilename(filename: string): Date | null {
  const baseName = filename.replace(/-archive(-\d+)?\.tar\.gz$/, "");

  // Hourly archive: YYYY-MM-DD~HH
  const hourlyMatch = baseName.match(/^(\d{4})-(\d{2})-(\d{2})~(\d{2})$/);
  if (hourlyMatch) {
    const [, year, month, day, hour] = hourlyMatch;
    return new Date(
      parseInt(year, 10),
      parseInt(month, 10) - 1,
      parseInt(day, 10),
      parseInt(hour, 10),
    );
  }

  // Daily/Weekly archive: YYYY-MM-DD
  const dailyMatch = baseName.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (dailyMatch) {
    const [, year, month, day] = dailyMatch;
    return new Date(parseInt(year, 10), parseInt(month, 10) - 1, parseInt(day, 10));
  }

  // Monthly archive: YYYY-MM
  const monthlyMatch = baseName.match(/^(\d{4})-(\d{2})$/);
  if (monthlyMatch) {
    const [, year, month] = monthlyMatch;
    return new Date(parseInt(year, 10), parseInt(month, 10) - 1, 1);
  }

  return null;
}

/**
 * Get regex pattern to match overflow files for a period.
 * Overflow files have format: YYYY-MM-DD~HH-mm-ss*.log
 */
export function getOverflowPattern(period: string, frequency: "hourly" | "daily"): RegExp {
  if (frequency === "hourly") {
    const [date, hour] = period.split("~");
    return new RegExp(`^${date}~${hour}-\\d{2}-\\d{2}.*\\.log$`);
  }
  // Daily: match any overflow file for the date
  return new RegExp(`^${period}~\\d{2}-\\d{2}-\\d{2}.*\\.log$`);
}

/**
 * Generate a unique overflow filename.
 */
export function generateOverflowFilename(logDir: string): string {
  const now = new Date();
  const date = now.toISOString().slice(0, 10);
  const hh = String(now.getHours()).padStart(2, "0");
  const mm = String(now.getMinutes()).padStart(2, "0");
  const ss = String(now.getSeconds()).padStart(2, "0");
  const ms = String(now.getMilliseconds()).padStart(3, "0");

  return `${logDir}/${date}~${hh}-${mm}-${ss}~${ms}.log`;
}
