import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolve } from "import-meta-resolve";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Resolve the worker path for spawning.
 */
export function resolveWorkerPath(workerName: string): string {
  // Try package resolution first
  try {
    const workerPath = resolve(`pino-file-transport/${workerName}`, import.meta.url);
    const resolved = fileURLToPath(workerPath);
    if (existsSync(resolved)) {
      return resolved;
    }
  } catch {
    // Continue to fallback
  }

  // Development fallback
  const devPath = path.resolve(__dirname, `../workers/${workerName}.js`);
  if (existsSync(devPath)) {
    return devPath;
  }

  throw new Error(`Cannot find worker "${workerName}"`);
}
