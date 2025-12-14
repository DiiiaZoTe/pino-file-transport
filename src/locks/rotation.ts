import fs from "node:fs";
import path from "node:path";
import { LOCK_PATHS, LOCK_SETTINGS } from "../config";

/**
 * Rotation lock using atomic mkdir.
 * Short-lived lock for file rotation operations.
 */

/**
 * Get the rotation lock path for a log directory.
 */
export function getRotationLockPath(logDir: string): string {
  return path.join(logDir, LOCK_PATHS.LOCKS_DIR, LOCK_PATHS.ROTATION_LOCK);
}

/**
 * Try to acquire rotation lock using atomic mkdir.
 * Returns true if lock acquired, false if another process holds it.
 * Handles stale locks from crashed processes.
 */
export function tryAcquireRotationLock(logDir: string): boolean {
  const lockPath = getRotationLockPath(logDir);

  try {
    // Check for stale lock (crashed process)
    try {
      const stats = fs.statSync(lockPath);
      const lockAge = Date.now() - stats.mtimeMs;
      if (lockAge > LOCK_SETTINGS.ROTATION_STALE_MS) {
        // Lock is stale, remove it
        fs.rmdirSync(lockPath);
      }
    } catch {
      // Lock doesn't exist, that's fine
    }

    // Ensure parent directory exists
    const locksDir = path.dirname(lockPath);
    if (!fs.existsSync(locksDir)) {
      fs.mkdirSync(locksDir, { recursive: true });
    }

    // Try to create lock directory (atomic operation)
    fs.mkdirSync(lockPath);
    return true;
  } catch {
    // Lock already exists (another process is rotating)
    return false;
  }
}

/**
 * Release rotation lock.
 */
export function releaseRotationLock(logDir: string): void {
  const lockPath = getRotationLockPath(logDir);
  try {
    fs.rmdirSync(lockPath);
  } catch {
    // Lock might already be released or never acquired
  }
}

/**
 * Wait for rotation lock with retries.
 * Returns true if lock acquired, false if timed out.
 */
export async function waitForRotationLock(logDir: string): Promise<boolean> {
  for (let i = 0; i < LOCK_SETTINGS.ROTATION_MAX_RETRIES; i++) {
    if (tryAcquireRotationLock(logDir)) {
      return true;
    }
    // Wait before retry
    await new Promise((resolve) => setTimeout(resolve, LOCK_SETTINGS.ROTATION_RETRY_MS));
  }
  return false;
}
