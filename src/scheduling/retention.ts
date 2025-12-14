import { Worker } from "node:worker_threads";
import cron from "node-cron";
import { DEFAULT_PACKAGE_NAME, LOCK_SETTINGS } from "../config";
import { checkStaleLock, tryAcquireWorkerLock } from "../locks/worker";
import { DEFAULT_RETENTION_CRON, type ResolvedTransportOptions } from "../types";
import { parseDuration } from "../utils/parsing";
import { resolveWorkerPath } from "../utils/worker-path";

/**
 * Spawn the retention worker in a separate thread.
 */
function spawnRetentionWorker(options: ResolvedTransportOptions): void {
  try {
    const workerPath = resolveWorkerPath("retention.worker");
    new Worker(workerPath, { workerData: options });
  } catch (err) {
    console.error(`[${DEFAULT_PACKAGE_NAME}] Failed to spawn retention worker:`, err);
  }
}

/**
 * Try to run the retention worker.
 * Acquires lock, spawns worker, then monitors heartbeat for retry.
 */
async function tryRunRetention(options: ResolvedTransportOptions): Promise<void> {
  const { path: logDir, retention } = options;

  // No duration configured - nothing to do
  if (!retention.duration) {
    return;
  }

  // Try to acquire lock
  const lockData = await tryAcquireWorkerLock(logDir, "retention");

  if (lockData) {
    // We got the lock, spawn the worker
    if (retention.logging) {
      console.log(
        `[${DEFAULT_PACKAGE_NAME}] Acquired retention lock, spawning worker (attempt: ${lockData.attempt})`,
      );
    }
    spawnRetentionWorker(options);
  }

  // Start monitoring for stale lock (worker crash)
  scheduleHeartbeatCheck(options);
}

/**
 * Schedule periodic heartbeat check for stale locks.
 */
function scheduleHeartbeatCheck(options: ResolvedTransportOptions): void {
  const { path: logDir, retention } = options;

  if (!retention.duration) return;

  // Check after worker stale timeout
  setTimeout(async () => {
    const staleLock = await checkStaleLock(logDir, "retention");
    if (staleLock) {
      if (retention.logging) {
        console.log(
          `[${DEFAULT_PACKAGE_NAME}] Retention worker stale (last heartbeat: ${staleLock.heartbeat}), retrying...`,
        );
      }
      // Try to take over and retry
      await tryRunRetention(options);
    }
  }, LOCK_SETTINGS.WORKER_CHECK_MS);
}

/**
 * Start the retention scheduler.
 * Returns a function to stop the scheduler.
 */
export function startRetentionScheduler(options: ResolvedTransportOptions): () => void {
  const { retention } = options;

  // No duration configured - nothing to do
  if (!retention.duration) {
    return () => { };
  }

  // Run immediately on creation
  tryRunRetention(options);

  // Get cron schedule based on duration unit
  const { unit } = parseDuration(retention.duration);
  const cronSchedule = DEFAULT_RETENTION_CRON[unit];

  if (retention.logging) {
    console.log(
      `[${DEFAULT_PACKAGE_NAME}] Scheduling retention (duration: ${retention.duration}, cron: ${cronSchedule})`,
    );
  }

  const task = cron.schedule(cronSchedule, () => {
    tryRunRetention(options);
  });

  return () => {
    task.stop();
    if (retention.logging) {
      console.log(`[${DEFAULT_PACKAGE_NAME}] Retention scheduler stopped`);
    }
  };
}
