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

    // Handle errors
    this.sonic.on("error", (err) => {
      console.error(`[${DEFAULT_PACKAGE_NAME}] SonicBoom error:`, err);
    });
  }

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
    const sizeExceeded =
      this.maxSizeBytes > 0 && this.bytesWritten + lineBytes >= this.maxSizeBytes;

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
    return this.sonic.write(line);
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
      // Flush current buffer
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

      // Update period
      this.currentPeriod = getCurrentRotationPeriod(this.options.rotation.frequency);

      // Find new file path
      const newPath = this.findAvailableLogPath(reason === "size");

      // Reopen SonicBoom with new path
      this.sonic.reopen(newPath);

      // Update tracking
      this.currentFilePath = newPath;
      this.bytesWritten = getFileSizeSync(newPath);

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
      this.sonic.write(line);
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
