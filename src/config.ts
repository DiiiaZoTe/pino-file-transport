import type { ResolvedTransportOptions } from "./types";

export const DEFAULT_PACKAGE_NAME = "pino-file-transport";

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
    logging: false,
  },
  retention: {
    enabled: true,
    duration: undefined, // No retention by default
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
} as const;

/** Meta directory for internal logging */
export const META_DIR = ".meta";
