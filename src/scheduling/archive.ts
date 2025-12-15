import { Worker } from "node:worker_threads";
import cron from "node-cron";
import { getArchiveCron, LOCK_SETTINGS } from "../config";
import { checkStaleLock, tryAcquireWorkerLock } from "../locks/worker";
import type { ResolvedTransportOptions } from "../types";
import { logArchive } from "../utils/meta-log";
import { resolveWorkerPath } from "../utils/worker-path";

/**
 * Spawn the archive worker in a separate thread.
 */
function spawnArchiveWorker(options: ResolvedTransportOptions): void {
  try {
    const workerPath = resolveWorkerPath("archive.worker");
    new Worker(workerPath, { workerData: options });
  } catch (err) {
    if (options.archive.logging) {
      logArchive(options.path, `Failed to spawn archive worker: ${err}`);
    }
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
      logArchive(logDir, `Acquired archive lock, spawning worker (attempt: ${lockData.attempt})`);
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
        logArchive(
          logDir,
          `Archive worker stale (last heartbeat: ${staleLock.heartbeat}), retrying...`,
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
  const cronSchedule = getArchiveCron(archive.frequency, archive.executionHour);

  if (archive.logging) {
    logArchive(
      options.path,
      `Scheduling archive (frequency: ${archive.frequency}, cron: ${cronSchedule})`,
    );
  }

  const task = cron.schedule(cronSchedule, () => {
    tryRunArchive(options);
  });

  return () => {
    task.stop();
    if (archive.logging) {
      logArchive(options.path, "Archive scheduler stopped");
    }
  };
}
