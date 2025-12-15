import type { ArchiveFrequency, DurationUnit, ResolvedTransportOptions } from "./types";

export const DEFAULT_PACKAGE_NAME = "pino-file-transport";

/** Default execution hour for scheduled jobs (1 AM) */
export const DEFAULT_EXECUTION_HOUR = 1;

/** Default transport options */
export const DEFAULT_OPTIONS: ResolvedTransportOptions = {
  path: "logs",
  rotation: {
    maxSize: 100, // 100 MB
    frequency: "daily",
    logging: false,
  },
  archive: {
    enabled: true,
    path: "archives",
    frequency: "monthly",
    runOnCreation: true,
    executionHour: DEFAULT_EXECUTION_HOUR,
    logging: false,
  },
  retention: {
    duration: undefined, // No retention by default
    executionHour: DEFAULT_EXECUTION_HOUR,
    logging: false,
  },
  meta: {
    retention: 7, // Keep 7 days of meta logs by default
    error: true, // Log errors to .meta/error by default
    executionHour: DEFAULT_EXECUTION_HOUR,
    logging: false,
  },
};

/** Lock settings */
export const LOCK_SETTINGS = {
  /** Rotation lock stale timeout (short-lived operation) */
  ROTATION_STALE_MS: 10_000, // 10 seconds
  /** Rotation lock retry interval */
  ROTATION_RETRY_MS: 20,
  /** Rotation lock max retries */
  ROTATION_MAX_RETRIES: 50, // 50 * 20ms = 1s max wait

  /** Worker lock stale timeout (heartbeat-based) */
  WORKER_STALE_MS: 20_000, // 20 seconds
  /** Worker heartbeat interval */
  WORKER_HEARTBEAT_MS: 5_000, // 5 seconds
  /** Worker heartbeat check interval */
  WORKER_CHECK_MS: 10_000, // 10 seconds
} as const;

/** Lock directories */
export const LOCK_PATHS = {
  LOCKS_DIR: ".locks",
  ROTATION_LOCK: "rotation",
  ARCHIVE_LOCK: "archive.json",
  RETENTION_LOCK: "retention.json",
  META_LOCK: "meta.json",
} as const;

/** Meta directory for internal logging */
export const META_DIR = ".meta";

/** Meta log subdirectories */
export const META_SUBDIRS = ["rotation", "archive", "retention", "error"] as const;

/**
 * Generate archive cron schedule based on frequency and execution hour.
 * Hourly always runs at the top of each hour (minute 0).
 */
export function getArchiveCron(frequency: ArchiveFrequency, executionHour: number): string {
  switch (frequency) {
    case "hourly":
      return "0 * * * *"; // Top of every hour
    case "daily":
      return `0 ${executionHour} * * *`; // Daily at executionHour
    case "weekly":
      return `0 ${executionHour} * * 1`; // Monday at executionHour
    case "monthly":
      return `0 ${executionHour} 1 * *`; // 1st of month at executionHour
  }
}

/**
 * Generate retention cron schedule based on duration unit and execution hour.
 * Hourly always runs at the top of each hour (minute 0).
 */
export function getRetentionCron(unit: DurationUnit, executionHour: number): string {
  switch (unit) {
    case "h":
      return "0 * * * *"; // Top of every hour
    case "d":
      return `0 ${executionHour} * * *`; // Daily at executionHour
    case "w":
      return `0 ${executionHour} * * 1`; // Monday at executionHour
    case "m":
      return `0 ${executionHour} 1 * *`; // 1st of month at executionHour
    case "y":
      return `0 ${executionHour} 1 1 *`; // Jan 1st at executionHour
  }
}

/**
 * Generate meta cleanup cron schedule based on execution hour.
 * Runs daily at the specified hour.
 */
export function getMetaCleanupCron(executionHour: number): string {
  return `0 ${executionHour} * * *`; // Daily at executionHour
}

/** README content for the .locks folder */
export const LOCKS_README_CONTENT = `# DO NOT DELETE THIS FOLDER

This folder contains lock files used by pino-file-transport to coordinate
file rotation, archiving, and retention operations across multiple processes.

**Deleting this folder while the application is running can cause:**
- Data corruption
- Race conditions
- Multiple workers processing the same files
- Log file conflicts

The locks are automatically cleaned up when operations complete.
If you see stale lock files, the application will handle them automatically.

For more info: https://www.npmjs.com/package/pino-file-transport
`;
