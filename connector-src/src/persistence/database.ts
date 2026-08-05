import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

export class ConnectorDatabase {
  readonly db: DatabaseSync;

  constructor(directory: string) {
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(join(directory, "connector.sqlite"));
    this.db.exec("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;");
    this.migrate();
  }

  close(): void {
    this.db.close();
  }

  replaceDevices(devices: MonitoredDeviceConfig[]): void {
    const upsert = this.db.prepare(`
      INSERT INTO monitored_devices (
        id, name, address, enabled, policy_json, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        name=excluded.name, address=excluded.address,
        enabled=excluded.enabled, policy_json=excluded.policy_json,
        updated_at=excluded.updated_at
    `);
    const ids = new Set(devices.map((device) => device.id));
    this.db.exec("BEGIN IMMEDIATE");
    try {
      for (const device of devices) {
        upsert.run(
          device.id,
          device.name,
          device.address,
          device.enabled ? 1 : 0,
          JSON.stringify(device),
          device.updatedAt,
        );
      }
      const existing = this.db
        .prepare("SELECT id FROM monitored_devices")
        .all() as Array<{ id: string }>;
      const remove = this.db.prepare("DELETE FROM monitored_devices WHERE id=?");
      for (const row of existing) if (!ids.has(row.id)) remove.run(row.id);
      this.db.exec("COMMIT");
    } catch (cause) {
      this.db.exec("ROLLBACK");
      throw cause;
    }
  }

  devices(): MonitoredDeviceConfig[] {
    const rows = this.db
      .prepare("SELECT policy_json FROM monitored_devices WHERE enabled=1")
      .all() as Array<{ policy_json: string }>;
    return rows.map((row) => JSON.parse(row.policy_json) as MonitoredDeviceConfig);
  }

  state(deviceId: string): PersistedDeviceState {
    const row = this.db
      .prepare("SELECT * FROM device_states WHERE device_id=?")
      .get(deviceId) as Record<string, unknown> | undefined;
    return row
      ? {
          status: String(row.status) as MonitoringState,
          failures: Number(row.failures),
          recoveries: Number(row.recoveries),
          sequence: Number(row.sequence),
        }
      : { status: "unknown", failures: 0, recoveries: 0, sequence: 0 };
  }

  saveState(deviceId: string, state: PersistedDeviceState): void {
    this.db
      .prepare(`
        INSERT INTO device_states(device_id,status,failures,recoveries,sequence)
        VALUES(?,?,?,?,?)
        ON CONFLICT(device_id) DO UPDATE SET status=excluded.status,
          failures=excluded.failures,recoveries=excluded.recoveries,
          sequence=excluded.sequence
      `)
      .run(deviceId, state.status, state.failures, state.recoveries, state.sequence);
  }

  recordCheck(deviceId: string, result: MonitoringCheck): void {
    this.db.prepare(`
      INSERT INTO monitoring_checks(
        id, device_id, started_at, completed_at, sent, received,
        minimum_latency_ms, average_latency_ms, maximum_latency_ms,
        jitter_ms, packet_loss_percent
      ) VALUES(?,?,?,?,?,?,?,?,?,?,?)
    `).run(
      result.id,
      deviceId,
      result.startedAt,
      result.completedAt,
      result.sent,
      result.received,
      result.minimumLatencyMs,
      result.averageLatencyMs,
      result.maximumLatencyMs,
      result.jitterMs,
      result.packetLossPercent,
    );
  }

  aggregateSamples(now = new Date(), intervalMinutes = 20): number {
    const intervalMs = intervalMinutes * 60_000;
    const currentPeriodStart = Math.floor(now.getTime() / intervalMs) * intervalMs;
    const rows = this.db.prepare(`
      SELECT
        device_id,
        CAST(strftime('%s', completed_at) AS INTEGER) * 1000 completed_at_ms,
        sent, received, minimum_latency_ms, average_latency_ms,
        maximum_latency_ms, jitter_ms, packet_loss_percent
      FROM monitoring_checks
      WHERE aggregated_at IS NULL
        AND CAST(strftime('%s', completed_at) AS INTEGER) * 1000 < ?
      ORDER BY completed_at
    `).all(currentPeriodStart) as Array<{
      device_id: string;
      completed_at_ms: number;
      sent: number;
      received: number;
      minimum_latency_ms: number | null;
      average_latency_ms: number | null;
      maximum_latency_ms: number | null;
      jitter_ms: number | null;
      packet_loss_percent: number;
    }>;
    const groups = new Map<string, typeof rows>();
    for (const row of rows) {
      const periodStart = Math.floor(row.completed_at_ms / intervalMs) * intervalMs;
      const key = `${row.device_id}:${periodStart}`;
      groups.set(key, [...(groups.get(key) ?? []), row]);
    }
    const insert = this.db.prepare(`
      INSERT OR IGNORE INTO monitoring_sample_outbox(
        sample_id, device_id, period_started_at, period_ended_at, checks,
        minimum_latency_ms, average_latency_ms, maximum_latency_ms, jitter_ms,
        packet_loss_percent, availability_percent, attempts, next_attempt_at
      ) VALUES(?,?,?,?,?,?,?,?,?,?,?,0,?)
    `);
    const mark = this.db.prepare(`
      UPDATE monitoring_checks SET aggregated_at=?
      WHERE device_id=? AND aggregated_at IS NULL
        AND completed_at>=? AND completed_at<?
    `);
    this.db.exec("BEGIN IMMEDIATE");
    try {
      for (const [key, checks] of groups) {
        const separator = key.lastIndexOf(":");
        const deviceId = key.slice(0, separator);
        const periodStart = Number(key.slice(separator + 1));
        const periodEnd = periodStart + intervalMs;
        const sent = checks.reduce((total, item) => total + item.sent, 0);
        const received = checks.reduce((total, item) => total + item.received, 0);
        const latencyValues = checks
          .map((item) => item.average_latency_ms)
          .filter((value): value is number => value !== null);
        insert.run(
          `sample:${deviceId}:${new Date(periodStart).toISOString()}`,
          deviceId,
          new Date(periodStart).toISOString(),
          new Date(periodEnd).toISOString(),
          checks.length,
          nullableMinimum(checks.map((item) => item.minimum_latency_ms)),
          nullableAverage(latencyValues),
          nullableMaximum(checks.map((item) => item.maximum_latency_ms)),
          nullableAverage(checks.map((item) => item.jitter_ms).filter((value): value is number => value !== null)),
          sent ? ((sent - received) / sent) * 100 : 100,
          sent ? (received / sent) * 100 : 0,
          Date.now(),
        );
        mark.run(
          new Date().toISOString(),
          deviceId,
          new Date(periodStart).toISOString(),
          new Date(periodEnd).toISOString(),
        );
      }
      this.db.exec("COMMIT");
      return groups.size;
    } catch (cause) {
      this.db.exec("ROLLBACK");
      throw cause;
    }
  }

  pendingSamples(limit = 100): MonitoringSample[] {
    const rows = this.db.prepare(`
      SELECT * FROM monitoring_sample_outbox
      WHERE delivered_at IS NULL AND next_attempt_at<=?
      ORDER BY period_started_at LIMIT ?
    `).all(Date.now(), limit) as Array<Record<string, unknown>>;
    return rows.map(sampleFromRow);
  }

  samplesForPeriod(
    periodStartedAt: string,
    periodEndedAt: string,
    deviceIds?: string[],
    limit = 5_000,
  ): MonitoringSample[] {
    const rows = this.db.prepare(`
      SELECT * FROM monitoring_sample_outbox
      WHERE period_ended_at>? AND period_started_at<?
      ORDER BY period_started_at LIMIT ?
    `).all(periodStartedAt, periodEndedAt, limit) as Array<Record<string, unknown>>;
    const allowed = deviceIds?.length ? new Set(deviceIds) : null;
    return rows.map(sampleFromRow).filter((sample) => !allowed || allowed.has(sample.deviceId));
  }

  markSamplesDelivered(sampleIds: string[]): void {
    const statement = this.db.prepare(
      "UPDATE monitoring_sample_outbox SET delivered_at=? WHERE sample_id=?",
    );
    for (const id of sampleIds) statement.run(Date.now(), id);
  }

  markSamplesAttempted(sampleIds: string[]): void {
    const statement = this.db.prepare(`
      UPDATE monitoring_sample_outbox SET attempts=attempts+1,
      next_attempt_at=? + MIN(300000, (1 << MIN(attempts, 8)) * 1000)
      WHERE sample_id=?
    `);
    for (const id of sampleIds) statement.run(Date.now(), id);
  }

  purgeMonitoringData(now = new Date()): void {
    const rawCutoff = new Date(now.getTime() - 7 * 24 * 60 * 60_000).toISOString();
    const sampleCutoff = now.getTime() - 90 * 24 * 60 * 60_000;
    this.db.prepare(
      "DELETE FROM monitoring_checks WHERE aggregated_at IS NOT NULL AND completed_at<?",
    ).run(rawCutoff);
    this.db.prepare(
      "DELETE FROM monitoring_sample_outbox WHERE delivered_at IS NOT NULL AND delivered_at<?",
    ).run(sampleCutoff);
    this.db.prepare(
      "DELETE FROM outbox WHERE delivered_at IS NOT NULL AND delivered_at<?",
    ).run(sampleCutoff);
  }

  enqueue(event: OutboxEvent): void {
    this.db
      .prepare(`
        INSERT OR IGNORE INTO outbox(
          event_id, sequence, type, payload_json, occurred_at, attempts, next_attempt_at
        ) VALUES(?,?,?,?,?,0,?)
      `)
      .run(
        event.eventId,
        event.sequence,
        event.type,
        JSON.stringify(event),
        event.occurredAt,
        Date.now(),
      );
  }

  pendingEvents(limit = 100): OutboxEvent[] {
    const rows = this.db
      .prepare(`
        SELECT payload_json FROM outbox
        WHERE delivered_at IS NULL AND next_attempt_at <= ?
        ORDER BY sequence LIMIT ?
      `)
      .all(Date.now(), limit) as Array<{ payload_json: string }>;
    return rows.map((row) => JSON.parse(row.payload_json) as OutboxEvent);
  }

  markDelivered(eventIds: string[]): void {
    const statement = this.db.prepare(
      "UPDATE outbox SET delivered_at=? WHERE event_id=?",
    );
    for (const id of eventIds) statement.run(Date.now(), id);
  }

  markAttempt(eventIds: string[]): void {
    const statement = this.db.prepare(`
      UPDATE outbox SET attempts=attempts+1,
      next_attempt_at=? + MIN(300000, (1 << MIN(attempts, 8)) * 1000)
      WHERE event_id=?
    `);
    for (const id of eventIds) statement.run(Date.now(), id);
  }

  pendingCount(): number {
    const row = this.db
      .prepare("SELECT COUNT(*) count FROM outbox WHERE delivered_at IS NULL")
      .get() as { count: number };
    return Number(row.count);
  }

  nextSequence(): number {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.db
        .prepare(
          "UPDATE connector_metadata SET value=CAST(value AS INTEGER)+1 WHERE key='event_sequence'",
        )
        .run();
      const row = this.db
        .prepare("SELECT value FROM connector_metadata WHERE key='event_sequence'")
        .get() as { value: string };
      this.db.exec("COMMIT");
      return Number(row.value);
    } catch (cause) {
      this.db.exec("ROLLBACK");
      throw cause;
    }
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS schema_migrations(
        version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS connector_metadata(
        key TEXT PRIMARY KEY, value TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS monitored_devices(
        id TEXT PRIMARY KEY, name TEXT NOT NULL, address TEXT NOT NULL,
        enabled INTEGER NOT NULL, policy_json TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS device_states(
        device_id TEXT PRIMARY KEY, status TEXT NOT NULL,
        failures INTEGER NOT NULL, recoveries INTEGER NOT NULL,
        sequence INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS outbox(
        event_id TEXT PRIMARY KEY, sequence INTEGER NOT NULL UNIQUE,
        type TEXT NOT NULL, payload_json TEXT NOT NULL, occurred_at TEXT NOT NULL,
        attempts INTEGER NOT NULL, next_attempt_at INTEGER NOT NULL,
        delivered_at INTEGER
      );
      CREATE TABLE IF NOT EXISTS completed_jobs(
        job_id TEXT PRIMARY KEY, result_json TEXT NOT NULL, completed_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS monitoring_checks(
        id TEXT PRIMARY KEY, device_id TEXT NOT NULL,
        started_at TEXT NOT NULL, completed_at TEXT NOT NULL,
        sent INTEGER NOT NULL, received INTEGER NOT NULL,
        minimum_latency_ms REAL, average_latency_ms REAL,
        maximum_latency_ms REAL, jitter_ms REAL,
        packet_loss_percent REAL NOT NULL, aggregated_at TEXT,
        FOREIGN KEY(device_id) REFERENCES monitored_devices(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS monitoring_checks_period
      ON monitoring_checks(device_id, completed_at, aggregated_at);
      CREATE TABLE IF NOT EXISTS monitoring_sample_outbox(
        sample_id TEXT PRIMARY KEY, device_id TEXT NOT NULL,
        period_started_at TEXT NOT NULL, period_ended_at TEXT NOT NULL,
        checks INTEGER NOT NULL, minimum_latency_ms REAL,
        average_latency_ms REAL, maximum_latency_ms REAL, jitter_ms REAL,
        packet_loss_percent REAL NOT NULL, availability_percent REAL NOT NULL,
        attempts INTEGER NOT NULL, next_attempt_at INTEGER NOT NULL,
        delivered_at INTEGER,
        FOREIGN KEY(device_id) REFERENCES monitored_devices(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS monitoring_samples_pending
      ON monitoring_sample_outbox(delivered_at, next_attempt_at, period_started_at);
      INSERT OR IGNORE INTO schema_migrations(version,applied_at)
      VALUES(1, datetime('now'));
      INSERT OR IGNORE INTO schema_migrations(version,applied_at)
      VALUES(2, datetime('now'));
      INSERT OR IGNORE INTO connector_metadata(key,value)
      VALUES('event_sequence','0');
    `);
  }
}

export type MonitoringState =
  | "unknown"
  | "online"
  | "suspectedDown"
  | "down"
  | "recovering"
  | "degraded"
  | "disabled";

export type PersistedDeviceState = {
  status: MonitoringState;
  failures: number;
  recoveries: number;
  sequence: number;
};

export type MonitoredDeviceConfig = {
  id: string;
  name: string;
  address: string;
  enabled: boolean;
  intervalSeconds: number;
  timeoutMs: number;
  packetCount: number;
  failureThreshold: number;
  recoveryThreshold: number;
  highLatencyThresholdMs: number;
  packetLossThresholdPercent: number;
  updatedAt: string;
};

export type OutboxEvent = {
  eventId: string;
  type: string;
  schemaVersion: 1;
  sequence: number;
  occurredAt: string;
  deviceId: string;
  severity: "info" | "warning" | "critical";
  payload: Record<string, unknown>;
};

export type MonitoringCheck = {
  id: string;
  startedAt: string;
  completedAt: string;
  sent: number;
  received: number;
  minimumLatencyMs: number | null;
  averageLatencyMs: number | null;
  maximumLatencyMs: number | null;
  jitterMs: number | null;
  packetLossPercent: number;
};

export type MonitoringSample = {
  sampleId: string;
  deviceId: string;
  periodStartedAt: string;
  periodEndedAt: string;
  checks: number;
  minimumLatencyMs?: number;
  averageLatencyMs?: number;
  maximumLatencyMs?: number;
  jitterMs?: number;
  packetLossPercent: number;
  availabilityPercent: number;
};

function sampleFromRow(row: Record<string, unknown>): MonitoringSample {
  return {
    sampleId: String(row.sample_id),
    deviceId: String(row.device_id),
    periodStartedAt: String(row.period_started_at),
    periodEndedAt: String(row.period_ended_at),
    checks: Number(row.checks),
    ...optionalNumber("minimumLatencyMs", row.minimum_latency_ms),
    ...optionalNumber("averageLatencyMs", row.average_latency_ms),
    ...optionalNumber("maximumLatencyMs", row.maximum_latency_ms),
    ...optionalNumber("jitterMs", row.jitter_ms),
    packetLossPercent: Number(row.packet_loss_percent),
    availabilityPercent: Number(row.availability_percent),
  };
}

function optionalNumber(key: string, value: unknown): Record<string, number> {
  return value === null || value === undefined ? {} : { [key]: Number(value) };
}

function nullableAverage(values: number[]): number | null {
  return values.length
    ? values.reduce((total, value) => total + value, 0) / values.length
    : null;
}

function nullableMinimum(values: Array<number | null>): number | null {
  const present = values.filter((value): value is number => value !== null);
  return present.length ? Math.min(...present) : null;
}

function nullableMaximum(values: Array<number | null>): number | null {
  const present = values.filter((value): value is number => value !== null);
  return present.length ? Math.max(...present) : null;
}
