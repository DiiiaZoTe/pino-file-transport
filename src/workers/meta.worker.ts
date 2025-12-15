import fs from "node:fs/promises";
import path from "node:path";
import { workerData } from "node:worker_threads";
import { META_DIR, META_SUBDIRS } from "../config";
import { releaseWorkerLock, startHeartbeat } from "../locks/worker";
import type { ResolvedTransportOptions } from "../types";
import { fileExists } from "../utils/file";
import { logError, logMeta } from "../utils/meta-log";
import { getCutoffDate } from "../utils/time";

/**
 * Parse a meta log filename to extract its date.
 * Format: YYYY-MM-DD.log
 */
function parseMetaLogDate(filename: string): Date | null {
  const match = filename.match(/^(\d{4}-\d{2}-\d{2})\.log$/);
  if (!match) return null;

  const [year, month, day] = match[1].split("-").map(Number);
  return new Date(year, month - 1, day);
}

/**
 * Meta cleanup worker - deletes old meta log files.
 * Updates heartbeat while running for crash detection.
 */
export async function runMetaWorker(options: ResolvedTransportOptions): Promise<void> {
  const { path: logDir, meta } = options;

  // Start heartbeat
  const heartbeatInterval = startHeartbeat(logDir, "meta");

  try {
    const metaDir = path.join(logDir, META_DIR);

    if (!(await fileExists(metaDir))) {
      if (meta.logging) {
        logMeta(logDir, "No meta directory found, nothing to clean up");
      }
      return;
    }

    // Calculate cutoff date (X days ago)
    const cutoffDate = getCutoffDate(new Date(), meta.retention, "d");

    if (meta.logging) {
      logMeta(
        logDir,
        `Running meta cleanup worker (retention: ${meta.retention} days) - deleting files older than ${cutoffDate.toISOString()}`,
      );
    }

    let totalDeleted = 0;

    // Process each meta subdirectory (rotation, archive, retention, meta)
    const subdirs = [...META_SUBDIRS, "meta"];
    for (const subdir of subdirs) {
      const subdirPath = path.join(metaDir, subdir);

      if (!(await fileExists(subdirPath))) {
        continue;
      }

      try {
        const files = await fs.readdir(subdirPath);
        const logFiles = files.filter((f) => f.endsWith(".log"));

        for (const file of logFiles) {
          const fileDate = parseMetaLogDate(file);
          if (!fileDate) continue;

          if (fileDate < cutoffDate) {
            const filePath = path.join(subdirPath, file);
            try {
              await fs.unlink(filePath);
              totalDeleted++;
              if (meta.logging) {
                logMeta(logDir, `Deleted meta log: ${subdir}/${file}`);
              }
            } catch (err) {
              logMeta(logDir, `Failed to delete meta log ${subdir}/${file}: ${err}`);
              logError(logDir, "meta", err, meta.error);
            }
          }
        }
      } catch (err) {
        logMeta(logDir, `Failed to read meta subdirectory ${subdir}: ${err}`);
        logError(logDir, "meta", err, meta.error);
      }
    }

    if (meta.logging) {
      if (totalDeleted > 0) {
        logMeta(logDir, `Meta cleanup complete: deleted ${totalDeleted} files`);
      } else {
        logMeta(logDir, "Meta cleanup complete: no files to delete");
      }
    }
  } catch (err) {
    logMeta(logDir, `Meta cleanup worker error: ${err}`);
    logError(logDir, "meta", err, meta.error);
  } finally {
    // Stop heartbeat and release lock
    clearInterval(heartbeatInterval);
    await releaseWorkerLock(logDir, "meta");
  }
}

// Run if this is the worker entry point
if (workerData) {
  runMetaWorker(workerData as ResolvedTransportOptions);
}
