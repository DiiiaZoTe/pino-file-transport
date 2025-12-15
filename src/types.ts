import type { SonicBoomOpts } from "sonic-boom";

/** Rotation frequency options */
export type RotationFrequency = "hourly" | "daily";

/**
 * SonicBoom options that users can configure.
 * Excludes `dest`, `fd`, `mkdir`, and `append` which are managed by the transport.
 */
export type SonicBoomOptions = Omit<SonicBoomOpts, "dest" | "fd" | "mkdir" | "append">;

/** Archive frequency options */
export type ArchiveFrequency = "hourly" | "daily" | "weekly" | "monthly";

/** Duration unit options */
export type DurationUnit = "h" | "d" | "w" | "m" | "y";

/** Duration format (e.g., "7d", "3m", "1y") */
export type DurationFormat = `${number}${DurationUnit}`;

/** Parsed duration value */
export type ParsedDuration = {
  value: number;
  unit: DurationUnit;
};

// ============================================================================
// Transport Options (Public API)
// ============================================================================

/**
 * Rotation configuration options.
 */
export type RotationConfig = {
  /**
   * Maximum file size in megabytes before rotation.
   * Set to 0 to disable size-based rotation.
   * @default 100
   */
  maxSize?: number;
  /**
   * Rotation frequency.
   * - "hourly": Creates files like `YYYY-MM-DD~HH.log`
   * - "daily": Creates files like `YYYY-MM-DD.log`
   * @default "daily"
   */
  frequency?: RotationFrequency;
  /**
   * Whether to log rotation events to `.meta/rotation.log`.
   * @default false
   */
  logging?: boolean;
};

/**
 * Archive configuration options.
 */
export type ArchiveConfig = {
  /**
   * Whether archiving is enabled.
   * @default true
   */
  enabled?: boolean;
  /**
   * Archive directory path (relative to log path).
   * @default "archives"
   */
  path?: string;
  /**
   * Archive frequency.
   * - "hourly": Archives hourly log files
   * - "daily": Archives daily log files
   * - "weekly": Archives weekly log files (Monday-based)
   * - "monthly": Archives monthly log files
   * @default "monthly"
   */
  frequency?: ArchiveFrequency;
  /**
   * Whether to run archiving immediately on transport creation.
   * @default true
   */
  runOnCreation?: boolean;
  /**
   * Whether to log archiving events.
   * @default false
   */
  logging?: boolean;
};

/**
 * Retention configuration options.
 */
export type RetentionConfig = {
  /**
   * Retention duration. Deletes logs and archives older than this duration.
   * Format: <number><unit> where unit is:
   * - "h" (hours)
   * - "d" (days)
   * - "w" (weeks)
   * - "m" (months)
   * - "y" (years)
   *
   * Examples: "12h", "7d", "2w", "3m", "1y"
   * @default undefined (no retention - logs kept indefinitely)
   */
  duration?: DurationFormat;
  /**
   * Whether to log retention events.
   * @default false
   */
  logging?: boolean;
};

/**
 * Meta logs configuration options.
 * Controls internal logging for rotation, archive, retention events and errors.
 */
export type MetaConfig = {
  /**
   * Number of days to keep meta logs (rotation, archive, retention, error logs in `.meta/`).
   * Meta logs are rotated daily and cleaned up by a separate worker.
   *
   * @default 7
   */
  retention?: number;
  /**
   * Whether to log internal errors to `.meta/error/`.
   * Errors are logged with context (operation, error type, message) without sensitive data.
   *
   * @default true
   */
  error?: boolean;
  /**
   * Whether to log meta cleanup events.
   * @default false
   */
  logging?: boolean;
};

/**
 * Transport options for pino-file-transport.
 *
 * @example
 * ```ts
 * import pino from "pino";
 *
 * const logger = pino({
 *   transport: {
 *     target: "pino-file-transport",
 *     options: {
 *       path: "./logs",
 *       rotation: { maxSize: 100, frequency: "daily" },
 *       archive: { enabled: true, frequency: "monthly" },
 *       retention: { duration: "30d" },
 *     },
 *   },
 * });
 * ```
 */
export type TransportOptions = {
  /**
   * Log directory path (required).
   */
  path: string;
  /**
   * Rotation configuration.
   * @default { maxSize: 100, frequency: "daily", logging: false }
   */
  rotation?: RotationConfig;
  /**
   * Archive configuration.
   * @default { enabled: true, path: "archives", frequency: "monthly", runOnCreation: true, logging: false }
   */
  archive?: ArchiveConfig;
  /**
   * Retention configuration.
   * @default { duration: undefined, logging: false }
   */
  retention?: RetentionConfig;
  /**
   * Meta logs configuration.
   * @default { retention: 7, error: true, logging: false }
   */
  meta?: MetaConfig;
  /**
   * SonicBoom stream configuration.
   * Allows fine-tuning the underlying SonicBoom stream.
   *
   * Available options:
   * - `minLength`: Minimum buffer length before flushing
   * - `maxLength`: Maximum buffer length (data dropped if exceeded)
   * - `maxWrite`: Maximum bytes per write (default: 16384)
   * - `periodicFlush`: Auto-flush interval in milliseconds
   * - `sync`: Enable synchronous writes (like console.log)
   * - `fsync`: Perform fsync after each write
   * - `mode`: File mode when creating the file
   * - `retryEAGAIN`: Function to handle EAGAIN/EBUSY errors
   *
   * Note: `dest`, `fd`, `mkdir`, and `append` are managed by the transport.
   */
  sonicBoom?: SonicBoomOptions;
};

// ============================================================================
// Resolved Options (Internal - all defaults applied)
// ============================================================================

/** Rotation config with all defaults applied */
export type ResolvedRotationConfig = {
  maxSize: number;
  frequency: RotationFrequency;
  logging: boolean;
};

/** Archive config with all defaults applied */
export type ResolvedArchiveConfig = {
  enabled: boolean;
  path: string;
  frequency: ArchiveFrequency;
  runOnCreation: boolean;
  logging: boolean;
};

/** Retention config with all defaults applied */
export type ResolvedRetentionConfig = {
  duration?: DurationFormat;
  logging: boolean;
};

/** Meta config with all defaults applied */
export type ResolvedMetaConfig = {
  retention: number;
  error: boolean;
  logging: boolean;
};

/**
 * Transport options with all defaults applied.
 * Used internally after validation.
 */
export type ResolvedTransportOptions = {
  path: string;
  rotation: ResolvedRotationConfig;
  archive: ResolvedArchiveConfig;
  retention: ResolvedRetentionConfig;
  meta: ResolvedMetaConfig;
  sonicBoom?: SonicBoomOptions;
};

// ============================================================================
// Lock Types
// ============================================================================

/** Worker lock file content */
export type WorkerLockData = {
  /** Process ID of the worker */
  pid: number;
  /** When the work started */
  startedAt: string;
  /** Last heartbeat timestamp */
  heartbeat: string;
  /** Retry attempt number */
  attempt: number;
};

// ============================================================================
// Cron Schedule Types
// ============================================================================

/** Default archive cron schedules */
export const DEFAULT_ARCHIVE_CRON: Record<ArchiveFrequency, string> = {
  hourly: "5 * * * *", // 5 mins past every hour
  daily: "0 1 * * *", // 1 AM daily
  weekly: "0 1 * * 1", // 1 AM Monday
  monthly: "0 1 1 * *", // 1 AM, 1st of month
};

/** Default retention cron schedules based on duration unit */
export const DEFAULT_RETENTION_CRON: Record<DurationUnit, string> = {
  h: "5 * * * *", // 5 mins past every hour
  d: "0 1 * * *", // 1 AM daily
  w: "0 1 * * 1", // 1 AM Monday
  m: "0 1 1 * *", // 1 AM, 1st of month
  y: "0 1 1 1 *", // 1 AM, Jan 1st
};
