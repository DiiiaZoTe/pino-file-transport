import fs from "node:fs";
import fsPromises from "node:fs/promises";
import path from "node:path";
import { LOCK_PATHS } from "../config";

/** README content for the .locks folder */
const LOCKS_README_CONTENT = `# DO NOT DELETE THIS FOLDER

This folder contains lock files used by pino-file-transport to coordinate
file rotation, archiving, and retention operations across multiple processes.

**Deleting this folder while the application is running can cause:**
- Data corruption
- Race conditions
- Multiple workers processing the same files
- Log file conflicts

The locks are automatically cleaned up when operations complete.
If you see stale lock files, the application will handle them automatically.

For more info: https://www.npmjs.com/package/pino-file-transport
`;

/**
 * Ensure the .locks directory exists with a README.md file (async)
 * Creates the directory and README if they don't exist.
 */
export async function ensureLocksDir(logDir: string): Promise<string> {
  const locksDir = path.join(logDir, LOCK_PATHS.LOCKS_DIR);
  const readmePath = path.join(locksDir, "README.md");

  await ensureDir(locksDir);

  // Create README.md if it doesn't exist
  if (!(await fileExists(readmePath))) {
    try {
      await fsPromises.writeFile(readmePath, LOCKS_README_CONTENT, "utf-8");
    } catch {
      // Ignore errors (race condition with another process)
    }
  }

  return locksDir;
}

/**
 * Ensure the .locks directory exists with a README.md file (sync)
 * Creates the directory and README if they don't exist.
 */
export function ensureLocksDirSync(logDir: string): string {
  const locksDir = path.join(logDir, LOCK_PATHS.LOCKS_DIR);
  const readmePath = path.join(locksDir, "README.md");

  ensureDirSync(locksDir);

  // Create README.md if it doesn't exist
  if (!fileExistsSync(readmePath)) {
    try {
      fs.writeFileSync(readmePath, LOCKS_README_CONTENT, "utf-8");
    } catch {
      // Ignore errors (race condition with another process)
    }
  }

  return locksDir;
}

/**
 * Check if a file exists (async)
 */
export async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fsPromises.access(filePath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Check if a file exists (sync)
 */
export function fileExistsSync(filePath: string): boolean {
  return fs.existsSync(filePath);
}

/**
 * Ensure a directory exists, creating it if necessary (async)
 */
export async function ensureDir(dirPath: string): Promise<void> {
  try {
    await fsPromises.mkdir(dirPath, { recursive: true });
  } catch (err) {
    // Ignore if already exists
    if ((err as NodeJS.ErrnoException).code !== "EEXIST") {
      throw err;
    }
  }
}

/**
 * Ensure a directory exists, creating it if necessary (sync)
 */
export function ensureDirSync(dirPath: string): void {
  try {
    if (!fs.existsSync(dirPath)) {
      fs.mkdirSync(dirPath, { recursive: true });
    }
  } catch (err) {
    // Ignore if already exists
    if ((err as NodeJS.ErrnoException).code !== "EEXIST") {
      throw err;
    }
  }
}

/**
 * Get file size in bytes (sync)
 */
export function getFileSizeSync(filePath: string): number {
  try {
    return fs.statSync(filePath).size;
  } catch {
    return 0;
  }
}

/**
 * Read JSON file (async)
 */
export async function readJsonFile<T>(filePath: string): Promise<T | null> {
  try {
    const content = await fsPromises.readFile(filePath, "utf-8");
    return JSON.parse(content) as T;
  } catch {
    return null;
  }
}

/**
 * Write JSON file (async)
 */
export async function writeJsonFile<T>(filePath: string, data: T): Promise<void> {
  await fsPromises.writeFile(filePath, JSON.stringify(data, null, 2), "utf-8");
}

/**
 * Append to a file (async)
 */
export async function appendToFile(filePath: string, content: string): Promise<void> {
  await fsPromises.appendFile(filePath, content, "utf-8");
}
