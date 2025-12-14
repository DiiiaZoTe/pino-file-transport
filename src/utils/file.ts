import fs from "node:fs";
import fsPromises from "node:fs/promises";

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
