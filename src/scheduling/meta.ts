import { Worker } from "node:worker_threads";
import cron from "node-cron";
import { LOCK_SETTINGS, META_CLEANUP_CRON } from "../config";
import { checkStaleLock, tryAcquireWorkerLock } from "../locks/worker";
import type { ResolvedTransportOptions } from "../types";
import { logMeta } from "../utils/meta-log";
import { resolveWorkerPath } from "../utils/worker-path";

/**
 * Spawn the meta cleanup worker in a separate thread.
 */
function spawnMetaWorker(options: ResolvedTransportOptions): void {
  try {
    const workerPath = resolveWorkerPath("meta.worker");
    new Worker(workerPath, { workerData: options });
  } catch (err) {
    if (options.meta.logging) {
      logMeta(options.path, `Failed to spawn meta cleanup worker: ${err}`);
    }
  }
}

/**
 * Try to run the meta cleanup worker.
 * Acquires lock, spawns worker, then monitors heartbeat for retry.
 */
async function tryRunMetaCleanup(options: ResolvedTransportOptions): Promise<void> {
  const { path: logDir, meta } = options;

  // Try to acquire lock
  const lockData = await tryAcquireWorkerLock(logDir, "meta");

  if (lockData) {
    // We got the lock, spawn the worker
    if (meta.logging) {
      logMeta(logDir, `Acquired meta lock, spawning worker (attempt: ${lockData.attempt})`);
    }
    spawnMetaWorker(options);
  }

  // Start monitoring for stale lock (worker crash)
  scheduleHeartbeatCheck(options);
}

/**
 * Schedule periodic heartbeat check for stale locks.
 */
function scheduleHeartbeatCheck(options: ResolvedTransportOptions): void {
  const { path: logDir, meta } = options;

  // Check after worker stale timeout
  setTimeout(async () => {
    const staleLock = await checkStaleLock(logDir, "meta");
    if (staleLock) {
      if (meta.logging) {
        logMeta(
          logDir,
          `Meta cleanup worker stale (last heartbeat: ${staleLock.heartbeat}), retrying...`,
        );
      }
      // Try to take over and retry
      await tryRunMetaCleanup(options);
    }
  }, LOCK_SETTINGS.WORKER_CHECK_MS);
}

/**
 * Start the meta cleanup scheduler.
 * Returns a function to stop the scheduler.
 */
export function startMetaScheduler(options: ResolvedTransportOptions): () => void {
  const { meta } = options;

  // Run immediately on creation
  tryRunMetaCleanup(options);

  if (meta.logging) {
    logMeta(
      options.path,
      `Scheduling meta cleanup (retention: ${meta.retention} days, cron: ${META_CLEANUP_CRON})`,
    );
  }

  const task = cron.schedule(META_CLEANUP_CRON, () => {
    tryRunMetaCleanup(options);
  });

  return () => {
    task.stop();
    if (meta.logging) {
      logMeta(options.path, "Meta cleanup scheduler stopped");
    }
  };
}
