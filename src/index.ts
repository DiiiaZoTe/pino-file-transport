import type SonicBoom from "sonic-boom";
import { DEFAULT_OPTIONS, DEFAULT_PACKAGE_NAME } from "./config";
import { startArchiveScheduler } from "./scheduling/archive";
import { startRetentionScheduler } from "./scheduling/retention";
import { FileTransport } from "./transport/file-transport";
import type {
  ArchiveFrequency,
  DurationFormat,
  ResolvedTransportOptions,
  RotationFrequency,
  SonicBoomOptions,
  TransportOptions,
} from "./types";
import { parseDuration } from "./utils/parsing";
import { durationToHours, frequencyToHours } from "./utils/time";

// Re-export types for consumers
export type {
  TransportOptions,
  RotationFrequency,
  ArchiveFrequency,
  DurationFormat,
  SonicBoomOptions,
};

/**
 * Validate and resolve transport options with defaults.
 */
function resolveOptions(options: TransportOptions): ResolvedTransportOptions {
  if (!options.path) {
    throw new Error(`[${DEFAULT_PACKAGE_NAME}] 'path' option is required`);
  }

  let maxSize = options.rotation?.maxSize === undefined ? DEFAULT_OPTIONS.rotation.maxSize : options.rotation.maxSize;
  if (maxSize === 0) { }
  else if (maxSize < 1) {
    maxSize = 1;
    console.warn(`[${DEFAULT_PACKAGE_NAME}] 'rotation.maxSize' is less than 1, setting to 1`);
  }

  const resolved: ResolvedTransportOptions = {
    path: options.path,
    rotation: {
      maxSize,
      frequency: options.rotation?.frequency ?? DEFAULT_OPTIONS.rotation.frequency,
      logging: options.rotation?.logging ?? DEFAULT_OPTIONS.rotation.logging,
    },
    archive: {
      enabled: options.archive?.enabled ?? DEFAULT_OPTIONS.archive.enabled,
      path: options.archive?.path ?? DEFAULT_OPTIONS.archive.path,
      frequency: options.archive?.frequency ?? DEFAULT_OPTIONS.archive.frequency,
      runOnCreation: options.archive?.runOnCreation ?? DEFAULT_OPTIONS.archive.runOnCreation,
      logging: options.archive?.logging ?? DEFAULT_OPTIONS.archive.logging,
    },
    retention: {
      enabled: options.retention?.enabled ?? DEFAULT_OPTIONS.retention.enabled,
      duration: options.retention?.duration ?? DEFAULT_OPTIONS.retention.duration,
      logging: options.retention?.logging ?? DEFAULT_OPTIONS.retention.logging,
    },
    sonicBoom: options.sonicBoom,
  };

  // Validate constraints
  validateConstraints(resolved);

  return resolved;
}

/**
 * Validate constraint hierarchy:
 * retention.duration >= archive.frequency >= rotation.frequency
 */
function validateConstraints(options: ResolvedTransportOptions): void {
  const rotationHours = frequencyToHours(options.rotation.frequency);
  const archiveHours = frequencyToHours(options.archive.frequency);

  // archive.frequency >= rotation.frequency
  if (options.archive.enabled && archiveHours < rotationHours) {
    throw new Error(
      `[${DEFAULT_PACKAGE_NAME}] Invalid configuration: archive.frequency ("${options.archive.frequency}") ` +
      `must be >= rotation.frequency ("${options.rotation.frequency}"). ` +
      `Cannot archive incomplete rotation periods.`,
    );
  }

  // retention.duration >= archive.frequency (when both enabled)
  if (options.retention.enabled && options.retention.duration) {
    const { value, unit } = parseDuration(options.retention.duration);
    const retentionHours = durationToHours(value, unit);

    if (options.archive.enabled && retentionHours < archiveHours) {
      throw new Error(
        `[${DEFAULT_PACKAGE_NAME}] Invalid configuration: retention.duration ("${options.retention.duration}") ` +
        `must be >= archive.frequency ("${options.archive.frequency}"). ` +
        `Cannot delete files before they can be archived.`,
      );
    }

    if (retentionHours < rotationHours) {
      throw new Error(
        `[${DEFAULT_PACKAGE_NAME}] Invalid configuration: retention.duration ("${options.retention.duration}") ` +
        `must be >= rotation.frequency ("${options.rotation.frequency}"). ` +
        `Cannot delete files before rotation period ends.`,
      );
    }

    // Additional check: hourly retention with daily rotation
    if (unit === "h" && options.rotation.frequency === "daily") {
      throw new Error(
        `[${DEFAULT_PACKAGE_NAME}] Invalid configuration: retention.duration with hours ("${options.retention.duration}") ` +
        `cannot be used with daily rotation. Use "d" (days) or higher units.`,
      );
    }
  }
}

/**
 * Pino file transport with rotation, archiving, and retention.
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
 *       retention: { enabled: true, duration: "30d" },
 *     },
 *   },
 * });
 * ```
 */
export default function (options: TransportOptions): SonicBoom {
  // Resolve options with defaults and validation
  const resolved = resolveOptions(options);

  // Create file transport
  const transport = new FileTransport(resolved);

  // Start archive scheduler if enabled
  let stopArchive: (() => void) | undefined;
  if (resolved.archive.enabled) {
    stopArchive = startArchiveScheduler(resolved);
  }

  // Start retention scheduler if enabled and duration is set
  let stopRetention: (() => void) | undefined;
  if (resolved.retention.enabled && resolved.retention.duration) {
    stopRetention = startRetentionScheduler(resolved);
  }

  // Get the underlying SonicBoom stream
  const stream = transport.stream;

  // Override write to route through FileTransport (for rotation logic)
  stream.write = (data: string): boolean => {
    return transport.write(data);
  };

  // Override end to clean up schedulers
  const originalEnd = stream.end.bind(stream);
  stream.end = (...args: Parameters<typeof originalEnd>): ReturnType<typeof originalEnd> => {
    stopArchive?.();
    stopRetention?.();
    return originalEnd(...args);
  };

  return stream;
}
