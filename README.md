# pino-file-transport

A high-performance Pino transport for file logging with configurable rotation, archiving, and retention. Built on [SonicBoom](https://github.com/pinojs/sonic-boom) for optimized I/O. Designed for Node.js and Bun projects.

## Features

- 🚀 **High Performance** — Built on SonicBoom for extremely fast file writes
- 📁 **Configurable Log Rotation** — Daily or hourly rotation frequency
- 📏 **Max File Size Rotation** — Automatically rotates logs when they exceed a configurable size limit
- 🗜️ **Flexible Archiving** — Archive logs hourly, daily, weekly, or monthly into `.tar.gz` files
- 🧹 **Log Retention** — Automatically delete old logs and archives based on retention policy
- 🔒 **Multi-Process Safe** — Lock-based coordination for clustered environments
- 🧵 **Non-Blocking Workers** — Archiving and retention run in separate worker threads

## Installation

```bash
# npm
npm install pino-file-transport

# yarn
yarn add pino-file-transport

# pnpm
pnpm add pino-file-transport

# bun
bun add pino-file-transport
```

## Quick Start

### Using as a Pino Transport (Recommended)

```typescript
import pino from "pino";

const logger = pino({
  transport: {
    target: "pino-file-transport",
    options: {
      path: "./logs",
    },
  },
});

logger.info("Hello, world!");
logger.warn({ userId: 123 }, "User logged in");
logger.error({ err: new Error("Something went wrong") }, "An error occurred");
```

### Using as a Direct Stream

```typescript
import pino from "pino";
import createTransport from "pino-file-transport";

const stream = createTransport({
  path: "./logs",
  rotation: { maxSize: 50, frequency: "daily" },
  archive: { enabled: true, frequency: "monthly" },
  retention: { enabled: true, duration: "30d" },
});

const logger = pino(stream);

logger.info("Direct stream logging");

// Clean up when done
stream.end();
```

## Configuration

The transport accepts a configuration object with the following properties:

```typescript
import pino from "pino";
import type { TransportOptions } from "pino-file-transport";

const options: TransportOptions = {
  // Required: Directory to write logs
  path: "./logs",

  // Rotation options
  rotation: {
    maxSize: 100,           // Max file size in MB before rotation (default: 100, 0 to disable)
    frequency: "daily",     // "hourly" | "daily" (default: "daily")
    logging: false,         // Log rotation events to .meta/rotation.log (default: false)
  },

  // Archive options
  archive: {
    enabled: true,          // Enable archiving (default: true)
    path: "archives",       // Archive directory relative to log path (default: "archives")
    frequency: "monthly",   // "hourly" | "daily" | "weekly" | "monthly" (default: "monthly")
    runOnCreation: true,    // Run archive check on transport creation (default: true)
    logging: false,         // Log archive operations (default: false)
  },

  // Retention options
  retention: {
    enabled: true,          // Enable retention (default: true)
    duration: "30d",        // Delete logs/archives older than this (default: undefined)
    logging: false,         // Log retention operations (default: false)
  },

  // SonicBoom options (optional - fine-tune the underlying stream)
  sonicBoom: {
    minLength: 0,           // Minimum buffer length before flushing
    maxLength: 16384,       // Maximum buffer length
    sync: false,            // Enable synchronous writes
  },
};

const logger = pino({
  transport: {
    target: "pino-file-transport",
    options,
  },
});
```

### Options Reference

#### Base Options

| Option | Type | Required | Description |
|--------|------|----------|-------------|
| `path` | `string` | ✅ | Directory for log files |

#### Rotation Options (`rotation`)

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `maxSize` | `number` | `100` | Max file size in MB before overflow rotation (0 to disable) |
| `frequency` | `"hourly" \| "daily"` | `"daily"` | How often to rotate log files |
| `logging` | `boolean` | `false` | Log rotation events to `.meta/rotation.log` |

#### Archive Options (`archive`)

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `enabled` | `boolean` | `true` | Enable archiving |
| `path` | `string` | `"archives"` | Archive directory relative to log path |
| `frequency` | `"hourly" \| "daily" \| "weekly" \| "monthly"` | `"monthly"` | How often to archive logs |
| `runOnCreation` | `boolean` | `true` | Archive needed files immediately on startup |
| `logging` | `boolean` | `false` | Log archiver operations |

#### Retention Options (`retention`)

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `enabled` | `boolean` | `true` | Enable retention |
| `duration` | `DurationFormat` | `undefined` | Retention period (e.g., "7d", "3m", "1y") |
| `logging` | `boolean` | `false` | Log retention operations |

#### SonicBoom Options (`sonicBoom`)

You can pass any [SonicBoom options](https://github.com/pinojs/sonic-boom#sonicboomopts) to fine-tune the underlying stream. Note that `dest`, `fd`, `mkdir`, and `append` are managed internally by the transport and cannot be overridden.

### Retention Duration Format

The `retention.duration` option accepts a string in the format `<number><unit>`:

| Unit | Description | Example |
|------|-------------|---------|
| `h` | Hours | `"12h"`, `"24h"` |
| `d` | Days | `"7d"`, `"30d"`, `"90d"` |
| `w` | Weeks | `"2w"`, `"4w"` |
| `m` | Months | `"3m"`, `"6m"` |
| `y` | Years | `"1y"`, `"2y"` |

The unit also determines the check frequency:
- `"90d"` = rolling 90 days, checked daily at 1 AM
- `"3m"` = calendar-based 3 months, checked on 1st of month at 1 AM
- `"24h"` = rolling 24 hours, checked every hour at 5 minutes past

### Constraint Hierarchy

The following constraints are enforced at transport creation:

```
retention.duration >= archive.frequency >= rotation.frequency
```

**Examples:**

✅ Valid configurations:
- `rotation.frequency: "hourly"` + `archive.frequency: "daily"` + `retention.duration: "7d"`
- `rotation.frequency: "daily"` + `archive.frequency: "monthly"` + `retention.duration: "100d"`

❌ Invalid configurations:
- `rotation.frequency: "daily"` + `archive.frequency: "hourly"` (can't archive incomplete days)
- `archive.frequency: "monthly"` + `retention.duration: "1w"` (1 week < 1 month)
- `rotation.frequency: "daily"` + `retention.duration: "12h"` (can't delete mid-day)

## Log File Structure

### Daily Rotation (default)

```
logs/
├── 2025-01-01.log              # Daily log file
├── 2025-01-01~15-59-59.log     # Overflow file (when max size exceeded)
├── 2025-01-01~15-59-59~123.log # Overflow with milliseconds (rare, high-throughput)
├── 2025-01-02.log              # Today's log file
├── .meta/
│   └── rotation.log            # Rotation events (when rotation.logging: true)
├── .locks/                     # Internal lock files (auto-managed)
└── archives/
    ├── 2024-12-archive.tar.gz  # Monthly archive
    └── 2024-11-archive.tar.gz
```

### Hourly Rotation

```
logs/
├── 2025-01-01~00.log           # Hourly log file (midnight hour)
├── 2025-01-01~01.log           # Hourly log file (1 AM hour)
├── 2025-01-01~15-30-00.log     # Overflow file (when max size exceeded)
└── archives/
    ├── 2025-01-01-archive.tar.gz  # Daily archive (when archive.frequency: "daily")
    └── 2024-12-archive.tar.gz     # Monthly archive
```

### Archive Naming Convention

| archive.frequency | Archive Name Format |
|-------------------|---------------------|
| `"hourly"` | `YYYY-MM-DD~HH-archive.tar.gz` |
| `"daily"` | `YYYY-MM-DD-archive.tar.gz` |
| `"weekly"` | `YYYY-MM-DD-archive.tar.gz` (Monday date) |
| `"monthly"` | `YYYY-MM-archive.tar.gz` |

### Log Format

Logs are written as JSON lines (NDJSON) for easy parsing:

```json
{"level":30,"time":1704067800000,"msg":"User logged in"}
{"level":50,"time":1704067801000,"err":{"message":"Connection failed"},"msg":"Database error"}
```

## Usage Examples

### Basic File Logging

```typescript
import pino from "pino";

const logger = pino({
  transport: {
    target: "pino-file-transport",
    options: {
      path: "./logs",
    },
  },
});

logger.info("Application started");
logger.error({ err: new Error("Oops") }, "Something went wrong");
```

### Hourly Rotation with Daily Archiving

```typescript
const logger = pino({
  transport: {
    target: "pino-file-transport",
    options: {
      path: "./logs",
      rotation: { frequency: "hourly" },
      archive: { frequency: "daily" },
      retention: { duration: "7d" },
    },
  },
});
```

### High-Volume Logging

```typescript
const logger = pino({
  transport: {
    target: "pino-file-transport",
    options: {
      path: "./logs",
      rotation: {
        frequency: "hourly",
        maxSize: 200,  // 200MB per file
      },
      archive: { frequency: "hourly" },
      retention: { duration: "24h" },  // Only keep last 24 hours
    },
  },
});
```

### Disable Size-Based Rotation

```typescript
const logger = pino({
  transport: {
    target: "pino-file-transport",
    options: {
      path: "./logs",
      rotation: {
        maxSize: 0,  // Disable size-based rotation
        frequency: "daily",
      },
    },
  },
});
```

### Disable Archiving

```typescript
const logger = pino({
  transport: {
    target: "pino-file-transport",
    options: {
      path: "./logs",
      archive: { enabled: false },
      retention: { duration: "30d" },  // Still deletes old logs
    },
  },
});
```

### Multi-Destination Logging (File + Console)

```typescript
import pino from "pino";

const logger = pino({
  transport: {
    targets: [
      {
        target: "pino-file-transport",
        options: { path: "./logs" },
        level: "info",
      },
      {
        target: "pino-pretty",
        options: { colorize: true },
        level: "debug",
      },
    ],
  },
});
```

### With Express/Hono Middleware

```typescript
import { Hono } from "hono";
import pino from "pino";

const app = new Hono();

const logger = pino({
  transport: {
    target: "pino-file-transport",
    options: { path: "./logs" },
  },
});

app.use("*", async (c, next) => {
  const start = Date.now();
  await next();
  const duration = Date.now() - start;
  
  logger.info({
    method: c.req.method,
    path: c.req.path,
    status: c.res.status,
    duration,
  }, "Request completed");
});
```

### Direct Stream with Graceful Shutdown

```typescript
import pino from "pino";
import createTransport from "pino-file-transport";

const stream = createTransport({
  path: "./logs",
  rotation: { frequency: "daily" },
});

const logger = pino(stream);

process.on("SIGTERM", async () => {
  logger.info("Shutting down gracefully");
  stream.flush();
  stream.end();
  process.exit(0);
});
```

### Separate Logs by Service/Component

```typescript
// Each service gets its own log directory and configuration:
const apiLogger = pino({
  transport: {
    target: "pino-file-transport",
    options: { path: "./logs/api" },
  },
});

const workerLogger = pino({
  transport: {
    target: "pino-file-transport",
    options: { path: "./logs/worker" },
  },
});

const schedulerLogger = pino({
  transport: {
    target: "pino-file-transport",
    options: { path: "./logs/scheduler" },
  },
});
```

Results in:
```
logs/
├── api/
│   ├── 2025-01-01.log
│   └── archives/
├── worker/
│   ├── 2025-01-01.log
│   └── archives/
└── scheduler/
    ├── 2025-01-01.log
    └── archives/
```

## Multi-Worker / Cluster Usage

When running in a clustered environment, this transport handles coordination automatically using filesystem-based locks.

### How It Works

1. **Rotation Locking** — When a log file needs to rotate, an atomic `mkdir`-based lock ensures only one process performs the rotation
2. **Worker Locking** — Archive and retention workers use heartbeat-based locks to prevent duplicate work
3. **Stale Lock Detection** — Locks from crashed processes are automatically detected and cleaned up

### Cluster Example

```typescript
import cluster from "node:cluster";
import pino from "pino";

if (cluster.isPrimary) {
  // Fork workers
  for (let i = 0; i < 4; i++) {
    cluster.fork();
  }
} else {
  // All workers use the same log directory
  // Coordination is handled automatically
  const logger = pino({
    transport: {
      target: "pino-file-transport",
      options: { path: "./logs" },
    },
  });

  logger.info({ workerId: cluster.worker?.id }, "Worker started");
}
```

Note: While the transport uses filesystem locks to coordinate log file rotation and minimize conflicts in a clustered environment, it is still possible under high load (100K+ logs/sec) and due to submillisecond timing—that multiple processes or threads could perform max size rotation simultaneously. This is extremely rare, but can result in multiple overflow log files for a given rotation interval. The transport is designed to safely handle this situation and log integrity is maintained, but you may see occasional extra rotated files in these scenarios.

### Lock Behavior

| Lock Type | Timeout | Purpose |
|-----------|---------|---------|
| Rotation | 10s | Coordinate log file rotation between processes |
| Archive Worker | 20s | Ensure only one process runs archiving |
| Retention Worker | 20s | Ensure only one process runs retention cleanup |

### High-Load Considerations

Under very high load, log files may slightly exceed `maxSize` before rotation occurs (typically within ~1.2x the configured limit). This is expected behavior and doesn't affect log integrity.

For extremely high-throughput workloads, consider:
- Increasing `maxSize` (e.g., 200-500MB) to reduce rotation frequency
- Using a centralized logging service (e.g., Datadog, Elasticsearch)
- Implementing a dedicated log aggregation layer

## Benchmarks

The transport has been benchmarked using `autocannon` to verify performance. You can run benchmarks yourself:

```bash
# Clone the repository
git clone https://github.com/DiiiaZoTe/pino-file-transport
cd pino-file-transport

# Install dependencies and build
bun install
bun run build

# Run single-threaded benchmark
bun run benchmark

# Run multi-core benchmark (uses all CPU cores)
bun run benchmark:multi-core
```

The benchmark compares:
1. No logger (baseline)
2. Pino with silent mode
3. Pino with native file destination
4. pino-file-transport (direct stream)
5. pino-file-transport (worker thread)

## TypeScript Support

Full TypeScript support with exported types:

```typescript
import type {
  TransportOptions,
  RotationFrequency,
  ArchiveFrequency,
  DurationFormat,
  SonicBoomOptions,
} from "pino-file-transport";
```

## API Reference

### Default Export

```typescript
export default function createTransport(options: TransportOptions): SonicBoom;
```

Creates a SonicBoom stream configured for file logging with rotation, archiving, and retention.

**Parameters:**
- `options` — Transport configuration (see [Configuration](#configuration))

**Returns:**
- A `SonicBoom` instance that can be used directly with Pino

**Example:**

```typescript
import createTransport from "pino-file-transport";
import pino from "pino";

const stream = createTransport({ path: "./logs" });
const logger = pino(stream);

// Clean up
stream.end();
```

### Type Exports

| Type | Description |
|------|-------------|
| `TransportOptions` | Full transport configuration |
| `RotationFrequency` | `"hourly" \| "daily"` |
| `ArchiveFrequency` | `"hourly" \| "daily" \| "weekly" \| "monthly"` |
| `DurationFormat` | Duration string like `"7d"`, `"3m"`, `"1y"` |
| `SonicBoomOptions` | SonicBoom configuration options |

## License

MIT © DiiiaZoTe
