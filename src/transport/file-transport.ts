import fs from "node:fs";
import path from "node:path";
import SonicBoom from "sonic-boom";
import { DEFAULT_PACKAGE_NAME, META_DIR } from "../config";
import { releaseRotationLock, waitForRotationLock } from "../locks/rotation";
import type { ResolvedTransportOptions } from "../types";
import { ensureDirSync, getFileSizeSync } from "../utils/file";
import { generateOverflowFilename, getLogPath, getOverflowPattern } from "../utils/parsing";
import { getCurrentRotationPeriod, getISOTimestamp } from "../utils/time";

/**
 * File transport using SonicBoom with rotation support.
 */
export class FileTransport {
  private options: ResolvedTransportOptions;
  private sonic: SonicBoom;
  private sonicWrite: (data: string) => boolean;
  private currentPeriod: string;
  private currentFilePath: string;
  private bytesWritten: number = 0;
  private maxSizeBytes: number;

  private isRotating: boolean = false;
  private pendingWrites: string[] = [];

  constructor(options: ResolvedTransportOptions) {
    this.options = options;
    this.maxSizeBytes = options.rotation.maxSize * 1024 * 1024;

    // Ensure log directory exists
    ensureDirSync(options.path);

    // Get current period and file path
    this.currentPeriod = getCurrentRotationPeriod(options.rotation.frequency);
    this.currentFilePath = this.findAvailableLogPath();

    // Initialize bytes written from existing file
    this.bytesWritten = getFileSizeSync(this.currentFilePath);

    // Create SonicBoom instance with user options
    this.sonic = new SonicBoom({
      ...options.sonicBoom,
      sync: options.sonicBoom?.sync ?? false,
      dest: this.currentFilePath,
      mkdir: true,
      append: true,
    });

    // Store original write method before any override
    // This prevents infinite recursion when stream.write is overridden externally
    this.sonicWrite = this.sonic.write.bind(this.sonic);

    // Handle errors
    this.sonic.on("error", (err) => {
      console.error(`[${DEFAULT_PACKAGE_NAME}] SonicBoom error:`, err);
    });
  }

  // Adaptive disk check interval - adjusts based on throughput
  private lastDiskCheckTime = Date.now();
  private lastDiskSize = 0;
  private nextCheckIntervalMs = 500; // Start at middle value for fast adaptation both ways
  private static readonly MIN_CHECK_INTERVAL_MS = 50; // Floor - don't check more often than this
  private static readonly MAX_CHECK_INTERVAL_MS = 2000; // Ceiling - always check at least this often
  private static readonly ROTATION_THRESHOLD_PERCENT = 0.98; // Trigger rotation at 98% full

  /**
   * Write a log line.
   * This is the main write interface for pino.
   */
  write(data: string): boolean {
    const line = data.endsWith("\n") ? data : `${data}\n`;

    // During rotation, buffer writes
    if (this.isRotating) {
      this.pendingWrites.push(line);
      return true;
    }

    const lineBytes = Buffer.byteLength(line, "utf8");

    // Check if rotation is needed
    const currentPeriod = getCurrentRotationPeriod(this.options.rotation.frequency);
    const periodChanged = currentPeriod !== this.currentPeriod;

    // For size check: use adaptive interval that adjusts based on throughput
    // This handles multi-process scenarios where other workers may have written to the file
    let sizeExceeded = false;
    if (this.maxSizeBytes > 0) {
      const now = Date.now();

      // Adaptive disk check - interval adjusts based on throughput and remaining space
      if (now - this.lastDiskCheckTime >= this.nextCheckIntervalMs) {
        // Flush SonicBoom buffer first so disk size is accurate
        this.sonic.flush();

        const actualSize = getFileSizeSync(this.currentFilePath);
        const elapsedMs = now - this.lastDiskCheckTime;

        // Calculate throughput from actual disk growth
        const bytesGrown = actualSize - this.lastDiskSize;
        const bytesPerMs = elapsedMs > 0 ? bytesGrown / elapsedMs : 0;

        // Calculate remaining space
        const bytesRemaining = this.maxSizeBytes - actualSize;
        const fillPercent = actualSize / this.maxSizeBytes;

        if (actualSize >= this.maxSizeBytes) {
          // Already at or over limit
          sizeExceeded = true;
        } else if (fillPercent >= FileTransport.ROTATION_THRESHOLD_PERCENT) {
          // Very close to limit (98%+) - trigger rotation to avoid rapid-fire checks
          sizeExceeded = true;
        } else if (bytesPerMs > 0 && bytesRemaining > 0) {
          // Estimate time to fill remaining space
          const msToFill = bytesRemaining / bytesPerMs;
          // Check again at 25% of estimated fill time, clamped to min/max
          this.nextCheckIntervalMs = Math.max(
            FileTransport.MIN_CHECK_INTERVAL_MS,
            Math.min(FileTransport.MAX_CHECK_INTERVAL_MS, msToFill / 4),
          );
        }

        // Update tracking
        this.lastDiskSize = actualSize;
        this.lastDiskCheckTime = now;
        this.bytesWritten = actualSize;
      }

      // Also check in-memory estimate (for fast single-process detection)
      if (!sizeExceeded && this.bytesWritten + lineBytes >= this.maxSizeBytes) {
        sizeExceeded = true;
      }
    }

    if (periodChanged || sizeExceeded) {
      // Start rotation
      this.isRotating = true;
      this.pendingWrites.push(line);

      this.rotate(sizeExceeded ? "size" : "period")
        .then(() => this.processPendingWrites())
        .catch((err) => console.error(`[${DEFAULT_PACKAGE_NAME}] Rotation failed:`, err))
        .finally(() => {
          this.isRotating = false;
        });

      return true;
    }

    // Normal write
    this.bytesWritten += lineBytes;
    return this.sonicWrite(line);
  }

  /**
   * Flush pending writes and end the stream.
   */
  async end(): Promise<void> {
    return new Promise((resolve) => {
      this.sonic.end();
      this.sonic.once("close", resolve);
    });
  }

  /**
   * Flush the stream.
   */
  flush(): void {
    this.sonic.flush();
  }

  /**
   * Get the underlying SonicBoom instance.
   */
  get stream(): SonicBoom {
    return this.sonic;
  }

  /**
   * Find an available log file path.
   * Checks main log and overflow files for space.
   */
  private findAvailableLogPath(excludeCurrentFile: boolean = false): string {
    const mainLogPath = getLogPath(this.options.path, this.currentPeriod);

    // Check main log file
    const isCurrentFileMainLog = this.currentFilePath === mainLogPath;
    if (!(excludeCurrentFile && isCurrentFileMainLog)) {
      const mainSize = getFileSizeSync(mainLogPath);
      if (this.maxSizeBytes === 0 || mainSize < this.maxSizeBytes) {
        return mainLogPath;
      }
    }

    // Main log is full, look for overflow files with space
    const overflowPattern = getOverflowPattern(this.currentPeriod, this.options.rotation.frequency);

    try {
      const files = fs.readdirSync(this.options.path);
      const overflowFiles = files
        .filter((f) => overflowPattern.test(f))
        .sort()
        .reverse();

      for (const overflowFile of overflowFiles) {
        const overflowPath = path.join(this.options.path, overflowFile);

        if (excludeCurrentFile && overflowPath === this.currentFilePath) {
          continue;
        }

        const size = getFileSizeSync(overflowPath);
        if (this.maxSizeBytes === 0 || size < this.maxSizeBytes) {
          return overflowPath;
        }
      }
    } catch {
      // Directory might not exist yet
    }

    // Create new overflow file
    return generateOverflowFilename(this.options.path);
  }

  /**
   * Rotate to a new log file.
   */
  private async rotate(reason: "period" | "size"): Promise<void> {
    // Acquire rotation lock
    const gotLock = await waitForRotationLock(this.options.path);

    try {
      // Update period first (needed for findAvailableLogPath)
      this.currentPeriod = getCurrentRotationPeriod(this.options.rotation.frequency);

      // === CRITICAL: Recheck if rotation is still needed after acquiring lock ===
      // Another worker might have rotated while we were waiting
      if (reason === "size" && this.maxSizeBytes > 0) {
        const currentSize = getFileSizeSync(this.currentFilePath);
        if (currentSize < this.maxSizeBytes * FileTransport.ROTATION_THRESHOLD_PERCENT) {
          // Current file now has space (another worker must have rotated)
          // Just sync our tracking and skip rotation
          this.bytesWritten = currentSize;
          this.lastDiskSize = currentSize;
          this.lastDiskCheckTime = Date.now();
          return;
        }
      }

      // Current file is truly full - find the best available file
      // This might be an overflow file another worker just created
      const newPath = this.findAvailableLogPath(reason === "size");

      // Check if we're already on the best file (edge case)
      if (newPath === this.currentFilePath) {
        // We're already on the best file but it's full
        // This means we need a brand new file - findAvailableLogPath should handle this
        // via generateOverflowFilename, but double-check
        const size = getFileSizeSync(newPath);
        if (size < this.maxSizeBytes) {
          // Actually has space, just sync and return
          this.bytesWritten = size;
          this.lastDiskSize = size;
          return;
        }
      }

      // Flush current buffer before switching files
      this.sonic.flush();

      // Wait for drain event indicating buffer is flushed
      await new Promise<void>((resolve) => {
        // If write returns true, buffer is not full and we can proceed
        // Otherwise wait for drain
        const drained = this.sonic.write("");
        if (drained) {
          resolve();
        } else {
          this.sonic.once("drain", resolve);
        }
      });

      // Ensure the new file exists on disk BEFORE reopen
      // This is critical: sonic.reopen() is async, and without this,
      // other workers doing readdirSync might not see the file yet
      fs.closeSync(fs.openSync(newPath, "a"));

      // Reopen SonicBoom with new path
      this.sonic.reopen(newPath);

      // Update tracking
      this.currentFilePath = newPath;
      this.bytesWritten = getFileSizeSync(newPath);

      // Reset disk size tracking for new file, but KEEP the learned check interval
      // This ensures high-throughput scenarios continue with aggressive checking
      this.lastDiskSize = this.bytesWritten;
      this.lastDiskCheckTime = Date.now();
      // Note: intentionally NOT resetting nextCheckIntervalMs - carry over learned throughput

      // Log rotation event if enabled
      if (this.options.rotation.logging) {
        await this.logRotationEvent(newPath, reason);
      }
    } finally {
      if (gotLock) {
        releaseRotationLock(this.options.path);
      }
    }
  }

  /**
   * Process writes that accumulated during rotation.
   * Checks size limits and triggers additional rotations if needed.
   */
  private processPendingWrites(): void {
    // Move pending writes to local array and clear immediately
    // This ensures any new writes during processing go to a fresh pendingWrites array
    const pending = this.pendingWrites;
    this.pendingWrites = [];

    for (const line of pending) {
      const lineBytes = Buffer.byteLength(line, "utf8");

      // Check if this write would exceed size limit
      if (this.maxSizeBytes > 0 && this.bytesWritten + lineBytes >= this.maxSizeBytes) {
        // Need another rotation - prepend remaining lines to any new writes that arrived
        this.pendingWrites = [...pending.slice(pending.indexOf(line)), ...this.pendingWrites];

        this.rotate("size")
          .then(() => this.processPendingWrites())
          .catch((err) => console.error(`[${DEFAULT_PACKAGE_NAME}] Rotation failed:`, err));

        return;
      }

      // Write to current file
      this.bytesWritten += lineBytes;
      this.sonicWrite(line);
    }
  }

  /**
   * Log rotation event to meta file.
   */
  private async logRotationEvent(newPath: string, reason: string): Promise<void> {
    try {
      const metaDir = path.join(this.options.path, META_DIR);
      ensureDirSync(metaDir);

      const metaFile = path.join(metaDir, "rotation.log");
      const entry = `[${getISOTimestamp()}] Rotated to ${path.basename(newPath)} (reason: ${reason})\n`;

      fs.appendFileSync(metaFile, entry, "utf-8");
    } catch {
      // Ignore meta logging errors
    }
  }
}
