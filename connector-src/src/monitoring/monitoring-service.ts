import { randomUUID } from "node:crypto";
import type { MachineClient } from "../machine-client.js";
import {
  ConnectorDatabase,
  type MonitoredDeviceConfig,
  type OutboxEvent,
} from "../persistence/database.js";
import { ping } from "./ping.js";
import { transitionDevice } from "./state-machine.js";
import { RouterOsApiAdapter } from "../mikrotik/routeros-api-adapter.js";
import {
  provisionService,
  type ServiceProvisionPayload,
} from "../mikrotik/service-provisioner.js";

export class MonitoringService {
  private timer: NodeJS.Timeout | undefined;
  private syncTimer: NodeJS.Timeout | undefined;
  private outboxTimer: NodeJS.Timeout | undefined;
  private sampleTimer: NodeJS.Timeout | undefined;
  private retentionTimer: NodeJS.Timeout | undefined;
  private jobTimer: NodeJS.Timeout | undefined;
  private readonly lastChecks = new Map<string, number>();
  private running = false;

  constructor(
    private readonly client: MachineClient,
    private readonly database: ConnectorDatabase,
  ) {}

  async start(): Promise<void> {
    await this.sync().catch(logError("configuration.sync"));
    this.timer = setInterval(() => void this.checkDevices(), 1_000);
    this.syncTimer = setInterval(() => void this.sync(), 60_000);
    this.outboxTimer = setInterval(() => void this.flushOutbox(), 5_000);
    this.sampleTimer = setInterval(() => void this.flushSamples(), 30_000);
    this.retentionTimer = setInterval(
      () => this.database.purgeMonitoringData(),
      24 * 60 * 60_000,
    );
    this.jobTimer = setInterval(() => void this.jobs(), 2_000);
    this.database.aggregateSamples();
    void this.flushSamples();
  }

  stop(): void {
    for (const timer of [
      this.timer,
      this.syncTimer,
      this.outboxTimer,
      this.sampleTimer,
      this.retentionTimer,
      this.jobTimer,
    ]) {
      if (timer) clearInterval(timer);
    }
  }

  private async sync(): Promise<void> {
    this.database.replaceDevices(await this.client.configuration());
  }

  private async checkDevices(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      for (const device of this.database.devices()) {
        const last = this.lastChecks.get(device.id) ?? 0;
        if (Date.now() - last < device.intervalSeconds * 1_000) continue;
        this.lastChecks.set(device.id, Date.now());
        await this.check(device);
      }
    } finally {
      this.running = false;
    }
  }

  private async check(device: MonitoredDeviceConfig): Promise<void> {
    const result = await ping(device.address, device.packetCount, device.timeoutMs);
    this.database.recordCheck(device.id, {
      id: `check:${device.id}:${randomUUID()}`,
      startedAt: result.startedAt,
      completedAt: result.completedAt,
      sent: result.sent,
      received: result.received,
      minimumLatencyMs: result.minimumLatencyMs,
      averageLatencyMs: result.averageLatencyMs,
      maximumLatencyMs: result.maximumLatencyMs,
      jitterMs: result.jitterMs,
      packetLossPercent: result.packetLossPercent,
    });
    this.database.aggregateSamples(new Date(result.completedAt));
    const current = this.database.state(device.id);
    const transition = transitionDevice(
      current,
      {
        reachable: result.reachable,
        packetLossPercent: result.packetLossPercent,
        averageLatencyMs: result.averageLatencyMs,
      },
      device,
    );
    this.database.saveState(device.id, transition.state);
    if (transition.event) {
      const event: OutboxEvent = {
        eventId: `evt_${randomUUID()}`,
        type: transition.event,
        schemaVersion: 1,
        sequence: this.database.nextSequence(),
        occurredAt: new Date().toISOString(),
        deviceId: device.id,
        severity: transition.event === "device.down" ? "critical" : "info",
        payload: {
          address: device.address,
          previousState: current.status,
          currentState: transition.state.status,
          packetLossPercent: result.packetLossPercent,
          averageLatencyMs: result.averageLatencyMs,
        },
      };
      this.database.enqueue(event);
    }
  }

  private async flushOutbox(): Promise<void> {
    const events = this.database.pendingEvents();
    if (!events.length) return;
    try {
      this.database.markDelivered(await this.client.sendEvents(events));
    } catch (cause) {
      this.database.markAttempt(events.map((event) => event.eventId));
      logError("outbox.flush")(cause);
    }
  }

  private async flushSamples(): Promise<void> {
    this.database.aggregateSamples();
    const samples = this.database.pendingSamples();
    if (!samples.length) return;
    try {
      this.database.markSamplesDelivered(
        await this.client.sendMonitoringSamples(samples),
      );
    } catch (cause) {
      this.database.markSamplesAttempted(
        samples.map((sample) => sample.sampleId),
      );
      logError("monitoring.samples.flush")(cause);
    }
  }

  private async jobs(): Promise<void> {
    try {
      for (const job of await this.client.claimJobs()) {
        if (new Date(job.expiresAt) <= new Date()) continue;
        await this.client.startJob(job.id);
        try {
          const result =
            ["monitoring.ping", "network.ping_server"].includes(job.type) &&
            job.payload.target?.address
              ? await ping(
                  job.payload.target.address,
                  job.payload.count ?? 5,
                  job.payload.timeoutMs ?? 1_000,
                )
              : job.type === "mikrotik.test_connection" && job.payload.router
                ? await testMikrotik(job.payload.router)
              : job.type === "mikrotik.apply_service" && job.payload.router
                  ? await provisionService(job.payload as unknown as ServiceProvisionPayload)
                : job.type === "monitoring.request_backfill" &&
                    job.payload.periodStartedAt &&
                    job.payload.periodEndedAt
                  ? await this.sendBackfill(
                      job.payload.periodStartedAt,
                      job.payload.periodEndedAt,
                      job.payload.deviceIds,
                    )
                : (() => {
                    throw new Error("Unsupported job type");
                  })();
          await this.client.completeJob(job.id, result);
        } catch (cause) {
          const message = cause instanceof Error ? cause.message : "Unknown error";
          await this.client.failJob(job.id, message);
        }
      }
    } catch (cause) {
      logError("jobs.poll")(cause);
    }
  }

  private async sendBackfill(
    periodStartedAt: string,
    periodEndedAt: string,
    deviceIds?: string[],
  ) {
    this.database.aggregateSamples();
    const samples = this.database.samplesForPeriod(
      periodStartedAt,
      periodEndedAt,
      deviceIds,
    );
    const accepted: string[] = [];
    for (let offset = 0; offset < samples.length; offset += 100) {
      accepted.push(
        ...await this.client.sendMonitoringSamples(
          samples.slice(offset, offset + 100),
        ),
      );
    }
    this.database.markSamplesDelivered(accepted);
    return {
      requested: samples.length,
      accepted: accepted.length,
      periodStartedAt,
      periodEndedAt,
    };
  }
}

async function testMikrotik(credentials: {
  host: string;
  port: number;
  tls: boolean;
  username: string;
  password: string;
}) {
  const adapter = new RouterOsApiAdapter(credentials);
  try {
    await adapter.connect();
    const info = await adapter.getSystemInfo();
    return {
      reachable: true,
      identity: info.identity,
      version: info.version,
      boardName: info.boardName,
      architecture: info.architecture,
      serialNumber: info.serialNumber,
      uptime: info.uptime,
      testedAt: new Date().toISOString(),
    };
  } finally {
    await adapter.disconnect();
  }
}

function logError(operation: string): (cause: unknown) => void {
  return (cause) => {
    const message = cause instanceof Error ? cause.message : "unknown error";
    console.error(JSON.stringify({
      timestamp: new Date().toISOString(),
      level: "error",
      service: "ispcontrol-connector",
      operation,
      message,
    }));
  };
}
