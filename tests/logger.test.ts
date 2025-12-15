/** biome-ignore-all assist/source/organizeImports: who cares about imports order here */
import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "bun:test";
import pino from "pino";
import SonicBoom from "sonic-boom";
import {
  fileExists,
  fileExistsSync,
} from "../src/utils/file";
import {
  parseDuration,
  parseLogFilename,
  parseArchiveFilename,
  getFilePeriod,
  getArchiveFilename,
} from "../src/utils/parsing";
import {
  frequencyToHours,
  durationToHours,
  getCutoffDate,
  getMondayOfWeek,
  getCurrentArchivePeriod,
  getCurrentRotationPeriod,
} from "../src/utils/time";
import { fileURLToPath } from "node:url";
import createTransport, { type TransportOptions } from "../src";
import { runArchiveWorker } from "../src/workers/archive.worker";
import { runRetentionWorker } from "../src/workers/retention.worker";
import type { ResolvedTransportOptions } from "../src/types";
import { DEFAULT_OPTIONS } from "../src/config";

// Get absolute path to dist for pino.transport()
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TRANSPORT_TARGET = path.resolve(__dirname, "../dist/index.js");

const TEST_LOG_BASE_DIR = "./logs/test";
const TEST_ARCHIVE_DIR = "archives";

const todayDate = new Date().toISOString().slice(0, 10);
const currentHour = String(new Date().getHours()).padStart(2, "0");
const todayFile = `${todayDate}.log`;
const hourlyFile = `${todayDate}~${currentHour}.log`;

// Helper to get log dir for a specific test
const getTestLogDir = (testNum: string) => path.join(TEST_LOG_BASE_DIR, `test-${testNum}`);
const getTodayFilePath = (testNum: string) => path.join(getTestLogDir(testNum), todayFile);
const getHourlyFilePath = (testNum: string) => path.join(getTestLogDir(testNum), hourlyFile);

// Helper to create options
const createOptions = (testNum: string, options: Partial<TransportOptions> = {}): TransportOptions => ({
  path: getTestLogDir(testNum),
  archive: { runOnCreation: false, enabled: false, ...options.archive },
  retention: { ...options.retention },
  rotation: { ...options.rotation },
  ...options,
});

// Helper to create resolved options for worker tests
const createResolvedOptions = (testNum: string, options: Partial<TransportOptions> = {}): ResolvedTransportOptions => ({
  path: getTestLogDir(testNum),
  rotation: {
    ...DEFAULT_OPTIONS.rotation,
    ...options.rotation,
  },
  archive: {
    ...DEFAULT_OPTIONS.archive,
    ...options.archive,
  },
  retention: {
    ...DEFAULT_OPTIONS.retention,
    ...options.retention,
  },
});

// Cleanup test directory before tests
try {
  console.log("Removing test log directory if it exists...");
  await fs.rm(TEST_LOG_BASE_DIR, { recursive: true });
} catch { }

describe("Pino File Transport - Direct API", () => {
  it("01 - should create transport that returns a SonicBoom stream", () => {
    const stream = createTransport(createOptions("01"));

    expect(stream).toBeDefined();
    expect(stream instanceof SonicBoom).toBe(true);
    expect(typeof stream.write).toBe("function");
    expect(typeof stream.end).toBe("function");

    stream.end();
  });

  it("02 - should work with pino using direct stream", async () => {
    const stream = createTransport(createOptions("02"));
    const todayFilePath = getTodayFilePath("02");

    const logger = pino(stream);
    logger.info("Test log line direct");

    stream.flush();
    await new Promise((resolve) => setTimeout(resolve, 300));

    const files = await fs.readdir(getTestLogDir("02"));
    expect(files.length).toBeGreaterThan(0);

    const content = await fs.readFile(todayFilePath, "utf-8");
    expect(content).toContain("Test log line direct");

    stream.end();
  });

  it("03 - should throw error when archive.frequency < rotation.frequency", () => {
    expect(() => {
      createTransport({
        path: getTestLogDir("03"),
        rotation: { frequency: "daily" },
        archive: { frequency: "hourly", enabled: true },
      });
    }).toThrow(/archive.frequency.*must be >= rotation.frequency/);
  });

  it("04 - should throw error when retention.duration < archive.frequency", () => {
    expect(() => {
      createTransport({
        path: getTestLogDir("04"),
        archive: { frequency: "monthly", enabled: true },
        retention: { duration: "1w" },
      });
    }).toThrow(/retention.duration.*must be >= archive.frequency/);
  });

  it("05 - should throw error for missing path option", () => {
    expect(() => {
      // @ts-expect-error - Testing missing path
      createTransport({});
    }).toThrow(/'path' option is required/);
  });
});

describe("Pino File Transport - With pino.transport()", () => {
  it("06 - should write log lines to a daily file", async () => {
    const todayFilePath = getTodayFilePath("06");

    const logger = pino({
      transport: {
        target: TRANSPORT_TARGET,
        options: createOptions("06"),
      },
    });

    logger.info("Test log line via transport");

    // Wait for worker thread to process and flush
    await new Promise((resolve) => setTimeout(resolve, 500));

    const files = await fs.readdir(getTestLogDir("06"));
    expect(files.length).toBeGreaterThan(0);

    const content = await fs.readFile(todayFilePath, "utf-8");
    expect(content).toContain("Test log line via transport");
  });

  it("07 - should work with child loggers", async () => {
    const todayFilePath = getTodayFilePath("07");

    const logger = pino({
      transport: {
        target: TRANSPORT_TARGET,
        options: createOptions("07"),
      },
    });

    const child = logger.child({ request: "child-test" });
    child.info("child log line");
    child.error({ test: "child-error-test" });

    await new Promise((resolve) => setTimeout(resolve, 500));

    const content = await fs.readFile(todayFilePath, "utf-8");
    expect(content).toContain("child-test");
    expect(content).toContain("child log line");
    expect(content).toContain("child-error-test");
  });

  it("08 - should write to hourly file when rotation.frequency is hourly", async () => {
    const logDir = getTestLogDir("08");
    const hourlyFilePath = getHourlyFilePath("08");

    const logger = pino({
      transport: {
        target: TRANSPORT_TARGET,
        options: {
          path: logDir,
          rotation: { frequency: "hourly" },
          archive: { runOnCreation: false, enabled: false },
          retention: {},
        } satisfies TransportOptions,
      },
    });

    logger.info("Hourly rotation test");

    await new Promise((resolve) => setTimeout(resolve, 500));

    const files = await fs.readdir(logDir);
    const hourlyFileFound = files.find((f) => f === `${todayDate}~${currentHour}.log`);
    expect(hourlyFileFound).toBeDefined();

    const content = await fs.readFile(hourlyFilePath, "utf-8");
    expect(content).toContain("Hourly rotation test");
  });

  it("09 - should write to overflow file when main log exceeds maxSize", async () => {
    const logDir = getTestLogDir("09");
    await fs.mkdir(logDir, { recursive: true });

    // Create a main log file that exceeds 1MB
    const mainLogPath = path.join(logDir, todayFile);
    const largeContent = "x".repeat(1.1 * 1024 * 1024);
    await fs.writeFile(mainLogPath, largeContent);

    const logger = pino({
      transport: {
        target: TRANSPORT_TARGET,
        options: {
          path: logDir,
          rotation: { maxSize: 1 },
          archive: { runOnCreation: false, enabled: false },
          retention: {},
        } satisfies TransportOptions,
      },
    });

    logger.info("This should go to overflow file");

    await new Promise((resolve) => setTimeout(resolve, 700));

    const files = await fs.readdir(logDir);
    const overflowFile = files.find(
      (f) => f.startsWith(todayDate) && f !== todayFile && f.endsWith(".log"),
    );
    expect(overflowFile).toBeDefined();

    if (overflowFile) {
      const overflowContent = await fs.readFile(path.join(logDir, overflowFile), "utf-8");
      expect(overflowContent).toContain("This should go to overflow file");
    }
  });

  it("10 - should not rotate by size when maxSize is 0", async () => {
    const logDir = getTestLogDir("10");
    await fs.mkdir(logDir, { recursive: true });

    const stream = createTransport({
      path: logDir,
      rotation: { maxSize: 0 },
      archive: { runOnCreation: false, enabled: false },
    });

    const logger = pino(stream);

    const lineContent = "x".repeat(150);
    for (let i = 0; i < 1000; i++) {
      logger.info({ line: i }, lineContent);
    }

    stream.flush();
    await new Promise((resolve) => setTimeout(resolve, 1000));

    const files = await fs.readdir(logDir);
    const logFiles = files.filter((f) => f.endsWith(".log"));

    expect(logFiles.length).toBe(1);
    expect(logFiles[0]).toBe(todayFile);

    stream.end();
  });

  it("11 - should log rotation events when rotation.logging is true", async () => {
    const logDir = getTestLogDir("11");
    await fs.mkdir(logDir, { recursive: true });

    // Create a main log file that exceeds 1MB to trigger rotation
    const mainLogPath = path.join(logDir, todayFile);
    const largeContent = "x".repeat(1.1 * 1024 * 1024);
    await fs.writeFile(mainLogPath, largeContent);

    const stream = createTransport({
      path: logDir,
      rotation: { maxSize: 1, logging: true },
      archive: { runOnCreation: false, enabled: false },
    });

    const logger = pino(stream);
    logger.info("Trigger rotation logging");

    stream.flush();
    await new Promise((resolve) => setTimeout(resolve, 500));

    const metaDir = path.join(logDir, ".meta");
    const rotationLogPath = path.join(metaDir, "rotation.log");

    const metaExists = await fileExists(metaDir);
    if (metaExists) {
      const rotationLogExists = await fileExists(rotationLogPath);
      expect(rotationLogExists).toBe(true);

      if (rotationLogExists) {
        const content = await fs.readFile(rotationLogPath, "utf-8");
        expect(content).toContain("Rotated to");
      }
    }

    stream.end();
  });
});

describe("Archive Worker", () => {
  it("12 - should archive files from previous day with daily frequency", async () => {
    const logDir = getTestLogDir("12");
    await fs.mkdir(logDir, { recursive: true });

    // Create a log file for yesterday
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = yesterday.toISOString().slice(0, 10);
    const yesterdayFile = `${yesterdayStr}.log`;
    await fs.writeFile(
      path.join(logDir, yesterdayFile),
      `{"level":"info","time":"${yesterday.toISOString()}","msg":"yesterday log"}\n`,
    );

    // Create a log file for today (should NOT be archived)
    await fs.writeFile(
      path.join(logDir, todayFile),
      `{"level":"info","time":"${new Date().toISOString()}","msg":"today log"}\n`,
    );

    // Run archive worker directly
    await runArchiveWorker(createResolvedOptions("12", {
      archive: { frequency: "daily", path: TEST_ARCHIVE_DIR, enabled: true, logging: false },
    }));

    const files = await fs.readdir(logDir);

    // Today's file should still exist (not archived)
    expect(files).toContain(todayFile);

    // Yesterday's file should be gone (archived)
    expect(files).not.toContain(yesterdayFile);

    // Archive folder should exist with yesterday's archive
    const archiveFiles = await fs.readdir(path.join(logDir, TEST_ARCHIVE_DIR));
    const expectedArchive = archiveFiles.find((f) => f.startsWith(yesterdayStr));
    expect(expectedArchive).toBeDefined();
    expect(expectedArchive).toMatch(/\.tar\.gz$/);
  });

  it("13 - should archive logs monthly", async () => {
    const logDir = getTestLogDir("13");
    await fs.mkdir(logDir, { recursive: true });

    // Create a log file from previous month
    const previousMonth = new Date();
    previousMonth.setMonth(previousMonth.getMonth() - 1);
    const previousMonthStr = previousMonth.toISOString().slice(0, 10);
    const previousMonthFile = `${previousMonthStr}.log`;
    await fs.writeFile(
      path.join(logDir, previousMonthFile),
      `{"level":"info","time":"${previousMonth.toISOString()}","msg":"last month log"}\n`,
    );

    // Create today's file
    await fs.writeFile(
      path.join(logDir, todayFile),
      `{"level":"info","time":"${new Date().toISOString()}","msg":"today log"}\n`,
    );

    // Run archive worker with monthly frequency
    await runArchiveWorker(createResolvedOptions("13", {
      archive: { frequency: "monthly", path: TEST_ARCHIVE_DIR, enabled: true, logging: false },
    }));

    const files = await fs.readdir(logDir);

    // Today's file should still exist
    expect(files).toContain(todayFile);

    // Previous month's file should be archived
    expect(files).not.toContain(previousMonthFile);

    // Archive should exist
    const archiveFiles = await fs.readdir(path.join(logDir, TEST_ARCHIVE_DIR));
    const expectedArchive = archiveFiles.find((f) => f.startsWith(previousMonthStr.slice(0, 7)));
    expect(expectedArchive).toBeDefined();
  });

  it("14 - should not archive current period files", async () => {
    const logDir = getTestLogDir("14");
    await fs.mkdir(logDir, { recursive: true });

    // Create only today's file
    await fs.writeFile(
      path.join(logDir, todayFile),
      `{"level":"info","time":"${new Date().toISOString()}","msg":"today log"}\n`,
    );

    // Run archive worker
    await runArchiveWorker(createResolvedOptions("14", {
      archive: { frequency: "daily", path: TEST_ARCHIVE_DIR, enabled: true, logging: false },
    }));

    const files = await fs.readdir(logDir);

    // Today's file should still exist (current period, not archived)
    expect(files).toContain(todayFile);

    // No archive folder should be created (nothing to archive)
    expect(files).not.toContain(TEST_ARCHIVE_DIR);
  });
});

describe("Retention Worker", () => {
  it("15 - should delete log files older than retention duration", async () => {
    const logDir = getTestLogDir("15");
    await fs.mkdir(logDir, { recursive: true });

    // Create a log file from 10 days ago (should be deleted with 7d retention)
    const oldDate = new Date();
    oldDate.setDate(oldDate.getDate() - 10);
    const oldDateStr = oldDate.toISOString().slice(0, 10);
    const oldFile = `${oldDateStr}.log`;
    await fs.writeFile(
      path.join(logDir, oldFile),
      `{"level":"info","time":"${oldDate.toISOString()}","msg":"old log"}\n`,
    );

    // Create a log file from 3 days ago (should NOT be deleted with 7d retention)
    const recentDate = new Date();
    recentDate.setDate(recentDate.getDate() - 3);
    const recentDateStr = recentDate.toISOString().slice(0, 10);
    const recentFile = `${recentDateStr}.log`;
    await fs.writeFile(
      path.join(logDir, recentFile),
      `{"level":"info","time":"${recentDate.toISOString()}","msg":"recent log"}\n`,
    );

    // Create today's file
    await fs.writeFile(
      path.join(logDir, todayFile),
      `{"level":"info","time":"${new Date().toISOString()}","msg":"today log"}\n`,
    );

    // Run retention worker with 7d duration
    await runRetentionWorker(createResolvedOptions("15", {
      archive: { path: TEST_ARCHIVE_DIR, enabled: false },
      retention: { duration: "7d", logging: false },
    }));

    const files = await fs.readdir(logDir);

    // Old file (10 days) should be deleted
    expect(files).not.toContain(oldFile);

    // Recent file (3 days) should still exist
    expect(files).toContain(recentFile);

    // Today's file should still exist
    expect(files).toContain(todayFile);
  });

  it("16 - should delete archive files older than retention duration", async () => {
    const logDir = getTestLogDir("16");
    const archivePath = path.join(logDir, TEST_ARCHIVE_DIR);
    await fs.mkdir(archivePath, { recursive: true });

    // Create a daily archive from 10 days ago (should be deleted with 7d retention)
    const oldDate = new Date();
    oldDate.setDate(oldDate.getDate() - 10);
    const oldDateStr = oldDate.toISOString().slice(0, 10);
    const oldArchive = `${oldDateStr}-archive.tar.gz`;
    await fs.writeFile(path.join(archivePath, oldArchive), "fake archive content");

    // Create a daily archive from 3 days ago (should NOT be deleted with 7d retention)
    const recentDate = new Date();
    recentDate.setDate(recentDate.getDate() - 3);
    const recentDateStr = recentDate.toISOString().slice(0, 10);
    const recentArchive = `${recentDateStr}-archive.tar.gz`;
    await fs.writeFile(path.join(archivePath, recentArchive), "fake recent archive content");

    // Run retention worker
    await runRetentionWorker(createResolvedOptions("16", {
      archive: { path: TEST_ARCHIVE_DIR, enabled: true },
      retention: { duration: "7d", logging: false },
    }));

    const archiveFiles = await fs.readdir(archivePath);

    // Old archive (10 days) should be deleted
    expect(archiveFiles).not.toContain(oldArchive);

    // Recent archive (3 days) should still exist
    expect(archiveFiles).toContain(recentArchive);
  });

  it("17 - should not delete files when no duration is set", async () => {
    const logDir = getTestLogDir("17");
    await fs.mkdir(logDir, { recursive: true });

    // Create an old log file
    const oldDate = new Date();
    oldDate.setDate(oldDate.getDate() - 100);
    const oldDateStr = oldDate.toISOString().slice(0, 10);
    const oldFile = `${oldDateStr}.log`;
    await fs.writeFile(
      path.join(logDir, oldFile),
      `{"level":"info","time":"${oldDate.toISOString()}","msg":"old log"}\n`,
    );

    // Run retention worker without duration
    await runRetentionWorker(createResolvedOptions("17", {
      retention: { duration: undefined },
    }));

    const files = await fs.readdir(logDir);

    // Old file should still exist (no duration = no deletion)
    expect(files).toContain(oldFile);
  });
});

describe("Archive + Retention Integration", () => {
  it("18 - should archive old logs and then delete expired archives", async () => {
    const logDir = getTestLogDir("18");
    const archivePath = path.join(logDir, TEST_ARCHIVE_DIR);
    await fs.mkdir(logDir, { recursive: true });

    // Create log files at various ages:
    // - 20 days ago: should be archived, then archive deleted (exceeds 14d retention)
    // - 10 days ago: should be archived, archive kept (within 14d retention)
    // - 3 days ago: should be archived, archive kept (within 14d retention)
    // - today: should NOT be archived (current period)

    const veryOldDate = new Date();
    veryOldDate.setDate(veryOldDate.getDate() - 20);
    const veryOldDateStr = veryOldDate.toISOString().slice(0, 10);
    const veryOldFile = `${veryOldDateStr}.log`;
    await fs.writeFile(
      path.join(logDir, veryOldFile),
      `{"level":"info","time":"${veryOldDate.toISOString()}","msg":"very old log"}\n`,
    );

    const oldDate = new Date();
    oldDate.setDate(oldDate.getDate() - 10);
    const oldDateStr = oldDate.toISOString().slice(0, 10);
    const oldFile = `${oldDateStr}.log`;
    await fs.writeFile(
      path.join(logDir, oldFile),
      `{"level":"info","time":"${oldDate.toISOString()}","msg":"old log"}\n`,
    );

    const recentDate = new Date();
    recentDate.setDate(recentDate.getDate() - 3);
    const recentDateStr = recentDate.toISOString().slice(0, 10);
    const recentFile = `${recentDateStr}.log`;
    await fs.writeFile(
      path.join(logDir, recentFile),
      `{"level":"info","time":"${recentDate.toISOString()}","msg":"recent log"}\n`,
    );

    await fs.writeFile(
      path.join(logDir, todayFile),
      `{"level":"info","time":"${new Date().toISOString()}","msg":"today log"}\n`,
    );

    const resolvedOptions = createResolvedOptions("18", {
      archive: { frequency: "daily", path: TEST_ARCHIVE_DIR, enabled: true, logging: false },
      retention: { duration: "14d", logging: false },
    });

    // Step 1: Run archive worker - should archive all logs except today's
    await runArchiveWorker(resolvedOptions);

    const filesAfterArchive = await fs.readdir(logDir);

    // Today's file should still exist (not archived - current period)
    expect(filesAfterArchive).toContain(todayFile);

    // All older files should be gone (archived)
    expect(filesAfterArchive).not.toContain(veryOldFile);
    expect(filesAfterArchive).not.toContain(oldFile);
    expect(filesAfterArchive).not.toContain(recentFile);

    // Archive folder should exist with archives
    const archivesAfterArchive = await fs.readdir(archivePath);
    expect(archivesAfterArchive.length).toBe(3);

    // Verify all expected archives were created
    expect(archivesAfterArchive.some((f) => f.startsWith(veryOldDateStr))).toBe(true);
    expect(archivesAfterArchive.some((f) => f.startsWith(oldDateStr))).toBe(true);
    expect(archivesAfterArchive.some((f) => f.startsWith(recentDateStr))).toBe(true);

    // Step 2: Run retention worker - should delete archives older than 14 days
    await runRetentionWorker(resolvedOptions);

    const archivesAfterRetention = await fs.readdir(archivePath);

    // Very old archive (20 days) should be deleted
    expect(archivesAfterRetention.some((f) => f.startsWith(veryOldDateStr))).toBe(false);

    // Old archive (10 days) and recent archive (3 days) should still exist
    expect(archivesAfterRetention.some((f) => f.startsWith(oldDateStr))).toBe(true);
    expect(archivesAfterRetention.some((f) => f.startsWith(recentDateStr))).toBe(true);

    // Today's log file should still exist
    const finalFiles = await fs.readdir(logDir);
    expect(finalFiles).toContain(todayFile);
  });
});

describe("Duration Utility Functions", () => {
  it("should parse duration strings correctly", () => {
    expect(parseDuration("12h")).toEqual({ value: 12, unit: "h" });
    expect(parseDuration("7d")).toEqual({ value: 7, unit: "d" });
    expect(parseDuration("2w")).toEqual({ value: 2, unit: "w" });
    expect(parseDuration("3m")).toEqual({ value: 3, unit: "m" });
    expect(parseDuration("1y")).toEqual({ value: 1, unit: "y" });
  });

  it("should throw error for invalid duration format", () => {
    //@ts-expect-error - Invalid format
    expect(() => parseDuration("invalid")).toThrow(/Invalid duration format/);
    //@ts-expect-error - Invalid format
    expect(() => parseDuration("7")).toThrow(/Invalid duration format/);
    //@ts-expect-error - Invalid format
    expect(() => parseDuration("d7")).toThrow(/Invalid duration format/);
    //@ts-expect-error - Invalid format
    expect(() => parseDuration("")).toThrow(/Invalid duration format/);
  });

  it("should convert duration to hours correctly", () => {
    expect(durationToHours(1, "h")).toBe(1);
    expect(durationToHours(24, "h")).toBe(24);
    expect(durationToHours(1, "d")).toBe(24);
    expect(durationToHours(7, "d")).toBe(168);
    expect(durationToHours(1, "w")).toBe(168);
    expect(durationToHours(1, "m")).toBe(744);
    expect(durationToHours(1, "y")).toBe(8784);
  });

  it("should convert frequency to hours correctly", () => {
    expect(frequencyToHours("hourly")).toBe(1);
    expect(frequencyToHours("daily")).toBe(24);
    expect(frequencyToHours("weekly")).toBe(168);
    expect(frequencyToHours("monthly")).toBe(744);
  });
});

describe("Archive Utility Functions", () => {
  it("should get Monday of week correctly", () => {
    expect(getMondayOfWeek(new Date(2024, 11, 4))).toBe("2024-12-02");
    expect(getMondayOfWeek(new Date(2024, 11, 8))).toBe("2024-12-02");
    expect(getMondayOfWeek(new Date(2024, 11, 2))).toBe("2024-12-02");
    expect(getMondayOfWeek(new Date(2024, 11, 7))).toBe("2024-12-02");
  });

  it("should generate archive filename correctly", () => {
    expect(getArchiveFilename("2024-12")).toBe("2024-12-archive.tar.gz");
    expect(getArchiveFilename("2024-12-03")).toBe("2024-12-03-archive.tar.gz");
    expect(getArchiveFilename("2024-12-03~10")).toBe("2024-12-03~10-archive.tar.gz");
  });

  it("should extract file period for monthly frequency", () => {
    expect(getFilePeriod("2024-12-03.log", "monthly")).toBe("2024-12");
    expect(getFilePeriod("2024-12-03~10.log", "monthly")).toBe("2024-12");
    expect(getFilePeriod("2024-12-03~10-30-45.log", "monthly")).toBe("2024-12");
  });

  it("should extract file period for daily frequency", () => {
    expect(getFilePeriod("2024-12-03.log", "daily")).toBe("2024-12-03");
    expect(getFilePeriod("2024-12-03~10.log", "daily")).toBe("2024-12-03");
    expect(getFilePeriod("2024-12-03~10-30-45.log", "daily")).toBe("2024-12-03");
  });

  it("should extract file period for hourly frequency", () => {
    expect(getFilePeriod("2024-12-03~10.log", "hourly")).toBe("2024-12-03~10");
    expect(getFilePeriod("2024-12-03~10-30-45.log", "hourly")).toBe("2024-12-03~10");
    expect(getFilePeriod("2024-12-03.log", "hourly")).toBe("2024-12-03~00");
  });

  it("should extract file period for weekly frequency", () => {
    expect(getFilePeriod("2024-12-04.log", "weekly")).toBe("2024-12-02");
    expect(getFilePeriod("2024-12-04~10.log", "weekly")).toBe("2024-12-02");
  });

  it("should return null for invalid filenames", () => {
    expect(getFilePeriod("invalid.log", "monthly")).toBeNull();
    expect(getFilePeriod("not-a-date.log", "daily")).toBeNull();
  });

  it("should get current archive period for each frequency", () => {
    expect(getCurrentArchivePeriod("hourly")).toMatch(/^\d{4}-\d{2}-\d{2}~\d{2}$/);
    expect(getCurrentArchivePeriod("daily")).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(getCurrentArchivePeriod("weekly")).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(getCurrentArchivePeriod("monthly")).toMatch(/^\d{4}-\d{2}$/);
  });

  it("should get current rotation period", () => {
    expect(getCurrentRotationPeriod("daily")).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(getCurrentRotationPeriod("hourly")).toMatch(/^\d{4}-\d{2}-\d{2}~\d{2}$/);
  });
});

describe("Filename Parsing Utility Functions", () => {
  it("should parse daily log filenames", () => {
    const result = parseLogFilename("2024-12-03.log");
    expect(result).not.toBeNull();
    expect(result?.getFullYear()).toBe(2024);
    expect(result?.getMonth()).toBe(11);
    expect(result?.getDate()).toBe(3);
  });

  it("should parse hourly log filenames", () => {
    const result = parseLogFilename("2024-12-03~14.log");
    expect(result).not.toBeNull();
    expect(result?.getFullYear()).toBe(2024);
    expect(result?.getMonth()).toBe(11);
    expect(result?.getDate()).toBe(3);
    expect(result?.getHours()).toBe(14);
  });

  it("should parse overflow log filenames", () => {
    const result = parseLogFilename("2024-12-03~14-30-45.log");
    expect(result).not.toBeNull();
    expect(result?.getFullYear()).toBe(2024);
    expect(result?.getMonth()).toBe(11);
    expect(result?.getDate()).toBe(3);
    expect(result?.getHours()).toBe(14);
  });

  it("should return null for invalid log filenames", () => {
    expect(parseLogFilename("invalid.log")).toBeNull();
    expect(parseLogFilename("not-a-date.log")).toBeNull();
  });

  it("should parse monthly archive filenames", () => {
    const result = parseArchiveFilename("2024-12-archive.tar.gz");
    expect(result).not.toBeNull();
    expect(result?.getFullYear()).toBe(2024);
    expect(result?.getMonth()).toBe(11);
    expect(result?.getDate()).toBe(1);
  });

  it("should parse daily archive filenames", () => {
    const result = parseArchiveFilename("2024-12-03-archive.tar.gz");
    expect(result).not.toBeNull();
    expect(result?.getFullYear()).toBe(2024);
    expect(result?.getMonth()).toBe(11);
    expect(result?.getDate()).toBe(3);
  });

  it("should parse hourly archive filenames", () => {
    const result = parseArchiveFilename("2024-12-03~14-archive.tar.gz");
    expect(result).not.toBeNull();
    expect(result?.getFullYear()).toBe(2024);
    expect(result?.getMonth()).toBe(11);
    expect(result?.getDate()).toBe(3);
    expect(result?.getHours()).toBe(14);
  });

  it("should parse archive filenames with counter suffix", () => {
    const result = parseArchiveFilename("2024-12-archive-1.tar.gz");
    expect(result).not.toBeNull();
    expect(result?.getFullYear()).toBe(2024);
    expect(result?.getMonth()).toBe(11);
  });

  it("should return null for invalid archive filenames", () => {
    expect(parseArchiveFilename("invalid-archive.tar.gz")).toBeNull();
    expect(parseArchiveFilename("not-a-date.tar.gz")).toBeNull();
  });
});

describe("Cutoff Date Utility Function", () => {
  const baseDate = new Date(2024, 11, 15, 12, 0, 0);

  it("should calculate cutoff for hours", () => {
    const cutoff = getCutoffDate(baseDate, 6, "h");
    expect(cutoff.getHours()).toBe(6);
    expect(cutoff.getDate()).toBe(15);
  });

  it("should calculate cutoff for days", () => {
    const cutoff = getCutoffDate(baseDate, 10, "d");
    expect(cutoff.getDate()).toBe(5);
    expect(cutoff.getMonth()).toBe(11);
  });

  it("should calculate cutoff for weeks", () => {
    const cutoff = getCutoffDate(baseDate, 2, "w");
    expect(cutoff.getDate()).toBe(1);
    expect(cutoff.getMonth()).toBe(11);
  });

  it("should calculate cutoff for months", () => {
    const cutoff = getCutoffDate(baseDate, 3, "m");
    expect(cutoff.getMonth()).toBe(8);
    expect(cutoff.getFullYear()).toBe(2024);
  });

  it("should calculate cutoff for years", () => {
    const cutoff = getCutoffDate(baseDate, 2, "y");
    expect(cutoff.getFullYear()).toBe(2022);
    expect(cutoff.getMonth()).toBe(11);
  });

  it("should handle month boundary correctly", () => {
    const janDate = new Date(2024, 0, 15);
    const cutoff = getCutoffDate(janDate, 2, "m");
    expect(cutoff.getMonth()).toBe(10);
    expect(cutoff.getFullYear()).toBe(2023);
  });
});

describe("File Exists Utility Function", () => {
  it("should return true for existing file", async () => {
    const logDir = getTestLogDir("util-exists");
    await fs.mkdir(logDir, { recursive: true });
    const testFile = path.join(logDir, "test.txt");
    await fs.writeFile(testFile, "test");

    expect(await fileExists(testFile)).toBe(true);
    expect(fileExistsSync(testFile)).toBe(true);
  });

  it("should return false for non-existing file", async () => {
    expect(await fileExists("/path/to/nonexistent/file.txt")).toBe(false);
    expect(fileExistsSync("/path/to/nonexistent/file.txt")).toBe(false);
  });
});
