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

/** Archive/Retention log entry */
export interface WorkerLogEntry {
  time: string;
  pid: number;
  msg: string;
}

/**
 * Log a rotation event to `.meta/rotation.log` as JSON.
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
 * Log an archive event to `.meta/archive.log` as JSON.
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
 * Log a retention event to `.meta/retention.log` as JSON.
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
 * Write a JSON log entry to a meta file (fire-and-forget, non-blocking).
 */
function writeMetaLog(logDir: string, type: string, entry: object): void {
  try {
    const metaDir = path.join(logDir, META_DIR);
    ensureDirSync(metaDir);

    const metaFile = path.join(metaDir, `${type}.log`);
    const line = `${JSON.stringify(entry)}\n`;

    // Fire-and-forget: non-blocking append, errors silently ignored
    fs.appendFile(metaFile, line, "utf-8", () => {});
  } catch {
    // Ignore meta logging errors (e.g., ensureDirSync failure)
  }
}
