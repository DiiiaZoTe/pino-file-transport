import fs from "node:fs";
import path from "node:path";
import { META_DIR } from "../config";
import { ensureDirSync } from "./file";

/** Rotation log entry */
export interface RotationLogEntry {
  time: string;
  pid: number;
  reason: string;
  file: string;
}

/** Archive/Retention/Meta log entry */
export interface WorkerLogEntry {
  time: string;
  pid: number;
  msg: string;
}

/** Error log entry */
export interface ErrorLogEntry {
  time: string;
  pid: number;
  context: string;
  error: string;
  msg: string;
}

/**
 * Get today's date string for meta log filename (YYYY-MM-DD).
 */
function getTodayDateString(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Log a rotation event to `.meta/rotation/YYYY-MM-DD.log` as JSON.
 */
export function logRotation(logDir: string, reason: string, file: string): void {
  const entry: RotationLogEntry = {
    time: new Date().toISOString(),
    pid: process.pid,
    reason,
    file,
  };
  writeMetaLog(logDir, "rotation", entry);
}

/**
 * Log an archive event to `.meta/archive/YYYY-MM-DD.log` as JSON.
 */
export function logArchive(logDir: string, msg: string): void {
  const entry: WorkerLogEntry = {
    time: new Date().toISOString(),
    pid: process.pid,
    msg,
  };
  writeMetaLog(logDir, "archive", entry);
}

/**
 * Log a retention event to `.meta/retention/YYYY-MM-DD.log` as JSON.
 */
export function logRetention(logDir: string, msg: string): void {
  const entry: WorkerLogEntry = {
    time: new Date().toISOString(),
    pid: process.pid,
    msg,
  };
  writeMetaLog(logDir, "retention", entry);
}

/**
 * Log a meta cleanup event to `.meta/meta/YYYY-MM-DD.log` as JSON.
 */
export function logMeta(logDir: string, msg: string): void {
  const entry: WorkerLogEntry = {
    time: new Date().toISOString(),
    pid: process.pid,
    msg,
  };
  writeMetaLog(logDir, "meta", entry);
}

/**
 * Log an error event to `.meta/error/YYYY-MM-DD.log` as JSON.
 * Extracts error name and message without sensitive stack traces.
 *
 * @param logDir - The log directory path
 * @param context - The operation context (e.g., "archive", "retention", "rotation")
 * @param error - The error object or message
 * @param enabled - Whether error logging is enabled (from metaError config)
 */
export function logError(
  logDir: string,
  context: string,
  error: unknown,
  enabled: boolean = true,
): void {
  if (!enabled) return;

  const errorName = error instanceof Error ? error.name : "Error";
  const errorMsg = error instanceof Error ? error.message : String(error);

  const entry: ErrorLogEntry = {
    time: new Date().toISOString(),
    pid: process.pid,
    context,
    error: errorName,
    msg: errorMsg,
  };
  writeMetaLog(logDir, "error", entry);
}

/**
 * Write a JSON log entry to a dated meta file (fire-and-forget, non-blocking).
 * Files are organized in subdirectories: .meta/{type}/YYYY-MM-DD.log
 */
function writeMetaLog(logDir: string, type: string, entry: object): void {
  try {
    const typeDir = path.join(logDir, META_DIR, type);
    ensureDirSync(typeDir);

    const dateStr = getTodayDateString();
    const metaFile = path.join(typeDir, `${dateStr}.log`);
    const line = `${JSON.stringify(entry)}\n`;

    // Fire-and-forget: non-blocking append, errors silently ignored
    fs.appendFile(metaFile, line, "utf-8", () => { });
  } catch {
    // Ignore meta logging errors (e.g., ensureDirSync failure)
  }
}
