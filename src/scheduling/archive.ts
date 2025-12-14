import { Worker } from "node:worker_threads";
import cron from "node-cron";
import { DEFAULT_PACKAGE_NAME, LOCK_SETTINGS } from "../config";
import { checkStaleLock, tryAcquireWorkerLock } from "../locks/worker";
import { DEFAULT_ARCHIVE_CRON, type ResolvedTransportOptions } from "../types";
import { resolveWorkerPath } from "../utils/worker-path";

/**
 * Spawn the archive worker in a separate thread.
 */
function spawnArchiveWorker(options: ResolvedTransportOptions): void {
  try {
    const workerPath = resolveWorkerPath("archive.worker");
    new Worker(workerPath, { workerData: options });
  } catch (err) {
    console.error(`[${DEFAULT_PACKAGE_NAME}] Failed to spawn archive worker:`, err);
  }
}

/**
 * Try to run the archive worker.
 * Acquires lock, spawns worker, then monitors heartbeat for retry.
 */
async function tryRunArchive(options: ResolvedTransportOptions): Promise<void> {
  const { path: logDir, archive } = options;

  // Try to acquire lock
  const lockData = await tryAcquireWorkerLock(logDir, "archive");

  if (lockData) {
    // We got the lock, spawn the worker
    if (archive.logging) {
      console.log(
        `[${DEFAULT_PACKAGE_NAME}] Acquired archive lock, spawning worker (attempt: ${lockData.attempt})`,
      );
    }
    spawnArchiveWorker(options);
  }

  // Start monitoring for stale lock (worker crash)
  // Even the process that spawned the worker monitors it
  scheduleHeartbeatCheck(options);
}

/**
 * Schedule periodic heartbeat check for stale locks.
 */
function scheduleHeartbeatCheck(options: ResolvedTransportOptions): void {
  const { path: logDir, archive } = options;

  // Check after worker stale timeout
  setTimeout(async () => {
    const staleLock = await checkStaleLock(logDir, "archive");
    if (staleLock) {
      if (archive.logging) {
        console.log(
          `[${DEFAULT_PACKAGE_NAME}] Archive worker stale (last heartbeat: ${staleLock.heartbeat}), retrying...`,
        );
      }
      // Try to take over and retry
      await tryRunArchive(options);
    }
  }, LOCK_SETTINGS.WORKER_CHECK_MS);
}

/**
 * Start the archive scheduler.
 * Returns a function to stop the scheduler.
 */
export function startArchiveScheduler(options: ResolvedTransportOptions): () => void {
  const { archive } = options;

  // Run on creation if enabled
  if (archive.runOnCreation) {
    tryRunArchive(options);
  }

  // Schedule cron job
  const cronSchedule = DEFAULT_ARCHIVE_CRON[archive.frequency];

  if (archive.logging) {
    console.log(
      `[${DEFAULT_PACKAGE_NAME}] Scheduling archive (frequency: ${archive.frequency}, cron: ${cronSchedule})`,
    );
  }

  const task = cron.schedule(cronSchedule, () => {
    tryRunArchive(options);
  });

  return () => {
    task.stop();
    if (archive.logging) {
      console.log(`[${DEFAULT_PACKAGE_NAME}] Archive scheduler stopped`);
    }
  };
}
