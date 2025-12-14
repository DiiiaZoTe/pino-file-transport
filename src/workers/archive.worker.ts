import fs from "node:fs/promises";
import path from "node:path";
import { workerData } from "node:worker_threads";
import { c as tar } from "tar";
import { DEFAULT_PACKAGE_NAME } from "../config";
import { releaseWorkerLock, startHeartbeat } from "../locks/worker";
import type { ResolvedTransportOptions } from "../types";
import { ensureDir, fileExists } from "../utils/file";
import { getArchiveFilename, getFilePeriod } from "../utils/parsing";
import { getCurrentArchivePeriod } from "../utils/time";

/**
 * Archive worker - compresses old log files into tar.gz archives.
 * Updates heartbeat while running for crash detection.
 */
export async function runArchiveWorker(options: ResolvedTransportOptions): Promise<void> {
  const { path: logDir, archive } = options;

  // Start heartbeat
  const heartbeatInterval = startHeartbeat(logDir, "archive");

  try {
    if (archive.logging) {
      console.log(
        `[${DEFAULT_PACKAGE_NAME}] Running archive worker (frequency: ${archive.frequency})`,
      );
    }

    // Get log files
    const files = (await fs.readdir(logDir)).filter((f) => f.endsWith(".log"));
    if (files.length === 0) {
      if (archive.logging) {
        console.log(`[${DEFAULT_PACKAGE_NAME}] No log files to archive`);
      }
      return;
    }

    // Get current period (to skip incomplete period)
    const currentPeriod = getCurrentArchivePeriod(archive.frequency);

    // Group files by period
    const filesByPeriod: Record<string, string[]> = {};
    for (const file of files) {
      const period = getFilePeriod(file, archive.frequency);
      if (!period) continue;
      if (period === currentPeriod) continue; // Skip current period

      if (!filesByPeriod[period]) {
        filesByPeriod[period] = [];
      }
      filesByPeriod[period].push(file);
    }

    const periodCount = Object.keys(filesByPeriod).length;
    if (periodCount === 0) {
      if (archive.logging) {
        console.log(`[${DEFAULT_PACKAGE_NAME}] No completed periods to archive`);
      }
      return;
    }

    // Create archive directory
    const archivePath = path.join(logDir, archive.path);
    await ensureDir(archivePath);

    if (archive.logging) {
      console.log(`[${DEFAULT_PACKAGE_NAME}] Found ${periodCount} period(s) to archive`);
    }

    // Archive each period
    for (const period of Object.keys(filesByPeriod).sort()) {
      const periodFiles = filesByPeriod[period];
      if (periodFiles.length === 0) continue;

      // Generate unique archive filename
      let archiveFileName = getArchiveFilename(period);
      let archiveFullPath = path.join(archivePath, archiveFileName);
      let counter = 1;

      while (await fileExists(archiveFullPath)) {
        archiveFileName = `${period}-archive-${counter}.tar.gz`;
        archiveFullPath = path.join(archivePath, archiveFileName);
        counter++;
      }

      if (archive.logging) {
        console.log(
          `[${DEFAULT_PACKAGE_NAME}] Archiving ${periodFiles.length} files for ${period} → ${archiveFileName}`,
        );
      }

      // Create tar.gz archive
      await tar({ gzip: true, file: archiveFullPath, cwd: logDir }, periodFiles);

      // Delete original log files
      await Promise.all(periodFiles.map((f) => fs.unlink(path.join(logDir, f))));

      if (archive.logging) {
        console.log(
          `[${DEFAULT_PACKAGE_NAME}] Archived ${periodFiles.length} files to ${archiveFileName}`,
        );
      }
    }

    if (archive.logging) {
      console.log(`[${DEFAULT_PACKAGE_NAME}] Archive complete`);
    }
  } catch (err) {
    console.error(`[${DEFAULT_PACKAGE_NAME}] Archive worker error:`, err);
  } finally {
    // Stop heartbeat and release lock
    clearInterval(heartbeatInterval);
    await releaseWorkerLock(logDir, "archive");
  }
}

// Run if this is the worker entry point
if (workerData) {
  runArchiveWorker(workerData as ResolvedTransportOptions);
}
