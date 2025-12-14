import fs from "node:fs/promises";
import path from "node:path";
import { workerData } from "node:worker_threads";
import { DEFAULT_PACKAGE_NAME } from "../config";
import { releaseWorkerLock, startHeartbeat } from "../locks/worker";
import type { ResolvedTransportOptions } from "../types";
import { fileExists } from "../utils/file";
import { parseArchiveFilename, parseDuration, parseLogFilename } from "../utils/parsing";
import { getCutoffDate } from "../utils/time";

/**
 * Retention worker - deletes old log files and archives.
 * Updates heartbeat while running for crash detection.
 */
export async function runRetentionWorker(options: ResolvedTransportOptions): Promise<void> {
  const { path: logDir, archive, retention } = options;

  // No duration configured - nothing to do
  if (!retention.duration) {
    return;
  }

  // Start heartbeat
  const heartbeatInterval = startHeartbeat(logDir, "retention");

  try {
    const { value, unit } = parseDuration(retention.duration);
    const now = new Date();
    const cutoffDate = getCutoffDate(now, value, unit);

    if (retention.logging) {
      console.log(
        `[${DEFAULT_PACKAGE_NAME}] Running retention worker (duration: ${retention.duration}) - deleting files older than ${cutoffDate.toISOString()}`,
      );
    }

    let deletedLogs = 0;
    let deletedArchives = 0;

    // Process log files
    const logFiles = (await fs.readdir(logDir)).filter((f) => f.endsWith(".log"));

    for (const file of logFiles) {
      const fileDate = parseLogFilename(file);
      if (!fileDate) continue;

      if (fileDate < cutoffDate) {
        const filePath = path.join(logDir, file);
        try {
          await fs.unlink(filePath);
          deletedLogs++;
          if (retention.logging) {
            console.log(`[${DEFAULT_PACKAGE_NAME}] Deleted log file: ${file}`);
          }
        } catch (err) {
          console.error(`[${DEFAULT_PACKAGE_NAME}] Failed to delete log file ${file}:`, err);
        }
      }
    }

    // Process archive files
    const archivePath = path.join(logDir, archive.path);
    if (await fileExists(archivePath)) {
      const archiveFiles = (await fs.readdir(archivePath)).filter((f) => f.endsWith(".tar.gz"));

      for (const file of archiveFiles) {
        const fileDate = parseArchiveFilename(file);
        if (!fileDate) continue;

        if (fileDate < cutoffDate) {
          const filePath = path.join(archivePath, file);
          try {
            await fs.unlink(filePath);
            deletedArchives++;
            if (retention.logging) {
              console.log(`[${DEFAULT_PACKAGE_NAME}] Deleted archive file: ${file}`);
            }
          } catch (err) {
            console.error(`[${DEFAULT_PACKAGE_NAME}] Failed to delete archive file ${file}:`, err);
          }
        }
      }
    }

    if (retention.logging) {
      if (deletedLogs > 0 || deletedArchives > 0) {
        console.log(
          `[${DEFAULT_PACKAGE_NAME}] Retention complete: deleted ${deletedLogs} logs, ${deletedArchives} archives`,
        );
      } else {
        console.log(`[${DEFAULT_PACKAGE_NAME}] Retention complete: no files to delete`);
      }
    }
  } catch (err) {
    console.error(`[${DEFAULT_PACKAGE_NAME}] Retention worker error:`, err);
  } finally {
    // Stop heartbeat and release lock
    clearInterval(heartbeatInterval);
    await releaseWorkerLock(logDir, "retention");
  }
}

// Run if this is the worker entry point
if (workerData) {
  runRetentionWorker(workerData as ResolvedTransportOptions);
}
