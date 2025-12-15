import fsPromises from "node:fs/promises";
import path from "node:path";
import { LOCK_PATHS, LOCK_SETTINGS } from "../config";
import type { WorkerLockData } from "../types";
import { ensureDir, fileExists, readJsonFile, writeJsonFile } from "../utils/file";
import { getISOTimestamp } from "../utils/time";

export type WorkerType = "archive" | "retention" | "meta";

/** Map worker types to their lock file names */
const WORKER_LOCK_FILES: Record<WorkerType, string> = {
  archive: LOCK_PATHS.ARCHIVE_LOCK,
  retention: LOCK_PATHS.RETENTION_LOCK,
  meta: LOCK_PATHS.META_LOCK,
};

/**
 * Get the worker lock file path.
 */
export function getWorkerLockPath(logDir: string, workerType: WorkerType): string {
  const lockFile = WORKER_LOCK_FILES[workerType];
  return path.join(logDir, LOCK_PATHS.LOCKS_DIR, lockFile);
}

/**
 * Try to acquire a worker lock.
 * Returns the lock data if acquired, null if another worker holds it.
 */
export async function tryAcquireWorkerLock(
  logDir: string,
  workerType: WorkerType,
  attempt: number = 1,
): Promise<WorkerLockData | null> {
  const lockPath = getWorkerLockPath(logDir, workerType);

  // Ensure locks directory exists
  await ensureDir(path.dirname(lockPath));

  // Check if lock exists
  if (await fileExists(lockPath)) {
    // Check if lock is stale
    const existingLock = await readJsonFile<WorkerLockData>(lockPath);
    if (existingLock) {
      const heartbeatAge = Date.now() - new Date(existingLock.heartbeat).getTime();
      if (heartbeatAge < LOCK_SETTINGS.WORKER_STALE_MS) {
        // Lock is fresh, another worker is running
        return null;
      }
      // Lock is stale, we can take over (increment attempt)
      attempt = existingLock.attempt + 1;
    }
  }

  // Create lock
  const lockData: WorkerLockData = {
    pid: process.pid,
    startedAt: getISOTimestamp(),
    heartbeat: getISOTimestamp(),
    attempt,
  };

  try {
    await writeJsonFile(lockPath, lockData);
    return lockData;
  } catch {
    return null;
  }
}

/**
 * Update the heartbeat in the lock file.
 * Called periodically by the worker while it's running.
 */
export async function updateWorkerHeartbeat(
  logDir: string,
  workerType: WorkerType,
): Promise<boolean> {
  const lockPath = getWorkerLockPath(logDir, workerType);

  try {
    const lockData = await readJsonFile<WorkerLockData>(lockPath);
    if (!lockData || lockData.pid !== process.pid) {
      // Lock was taken by another process
      return false;
    }

    lockData.heartbeat = getISOTimestamp();
    await writeJsonFile(lockPath, lockData);
    return true;
  } catch {
    return false;
  }
}

/**
 * Release the worker lock.
 * Called when the worker completes successfully.
 */
export async function releaseWorkerLock(logDir: string, workerType: WorkerType): Promise<void> {
  const lockPath = getWorkerLockPath(logDir, workerType);
  try {
    await fsPromises.unlink(lockPath);
  } catch {
    // Lock might already be released
  }
}

/**
 * Check if a worker lock is stale (worker crashed).
 * Returns the lock data if stale, null if fresh or doesn't exist.
 */
export async function checkStaleLock(
  logDir: string,
  workerType: WorkerType,
): Promise<WorkerLockData | null> {
  const lockPath = getWorkerLockPath(logDir, workerType);

  if (!(await fileExists(lockPath))) {
    return null;
  }

  const lockData = await readJsonFile<WorkerLockData>(lockPath);
  if (!lockData) {
    return null;
  }

  const heartbeatAge = Date.now() - new Date(lockData.heartbeat).getTime();
  if (heartbeatAge > LOCK_SETTINGS.WORKER_STALE_MS) {
    return lockData; // Stale
  }

  return null; // Fresh
}

/**
 * Start a heartbeat interval for a worker.
 * Returns the interval ID for cleanup.
 */
export function startHeartbeat(logDir: string, workerType: WorkerType): NodeJS.Timeout {
  const interval = setInterval(async () => {
    const success = await updateWorkerHeartbeat(logDir, workerType);
    if (!success) {
      // Lost the lock, stop heartbeat
      clearInterval(interval);
    }
  }, LOCK_SETTINGS.WORKER_HEARTBEAT_MS);

  // Don't prevent process exit
  interval.unref?.();

  return interval;
}
