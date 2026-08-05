import {
  saveIdentity,
  type ConnectorIdentity,
} from "./identity.js";
import type {
  MonitoredDeviceConfig,
  MonitoringSample,
  OutboxEvent,
} from "./persistence/database.js";

export class MachineClient {
  constructor(
    private readonly apiUrl: URL,
    private readonly dataDirectory: string,
    private identity: ConnectorIdentity,
  ) {}

  static async enroll(
    apiUrl: URL,
    dataDirectory: string,
    enrollmentToken: string,
    connectorName: string,
  ): Promise<ConnectorIdentity> {
    const response = await fetch(
      new URL("/connector-api/v1/enrollment/claim", apiUrl),
      {
        method: "POST",
        redirect: "error",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          enrollmentToken,
          connectorName,
          version: "0.1.0",
          architecture: process.arch,
          operatingSystem: process.platform,
          publicKey: `bootstrap:${crypto.randomUUID()}`,
          capabilities: [
            "monitoring.icmp",
            "mikrotik.api.read",
            "mikrotik.service.apply.v1",
          ],
        }),
        signal: AbortSignal.timeout(15_000),
      },
    );
    if (!response.ok) throw new Error(`Enrollment failed with ${response.status}`);
    const result = (await response.json()) as {
      connectorId: string;
      accessToken: string;
      refreshToken: string;
      mode: "TENANT_LOCAL" | "GLOBAL" | "DEVELOPMENT";
    };
    const identity: ConnectorIdentity = result;
    await saveIdentity(dataDirectory, identity);
    return identity;
  }

  async heartbeat(metrics: Record<string, unknown>): Promise<void> {
    await this.request("/connector-api/v1/heartbeat", {
      method: "POST",
      body: JSON.stringify(metrics),
    });
  }

  async configuration(): Promise<MonitoredDeviceConfig[]> {
    const response = await this.request("/connector-api/v1/configuration", {});
    return (await response.json()) as MonitoredDeviceConfig[];
  }

  async sendEvents(events: OutboxEvent[]): Promise<string[]> {
    const response = await this.request("/connector-api/v1/events/batch", {
      method: "POST",
      body: JSON.stringify({ events }),
    });
    return ((await response.json()) as { accepted: string[] }).accepted;
  }

  async sendMonitoringSamples(samples: MonitoringSample[]): Promise<string[]> {
    const response = await this.request(
      "/connector-api/v1/monitoring/samples/batch",
      {
        method: "POST",
        body: JSON.stringify({ samples }),
      },
    );
    return ((await response.json()) as { accepted: string[] }).accepted;
  }

  async claimJobs(): Promise<MachineJob[]> {
    const response = await this.request("/connector-api/v1/jobs/claim", {
      method: "POST",
      body: JSON.stringify({ limit: 5 }),
    });
    return (await response.json()) as MachineJob[];
  }

  async startJob(jobId: string): Promise<void> {
    await this.request(`/connector-api/v1/jobs/${jobId}/start`, {
      method: "POST",
      body: "{}",
    });
  }

  async completeJob(jobId: string, result: Record<string, unknown>): Promise<void> {
    await this.request(`/connector-api/v1/jobs/${jobId}/complete`, {
      method: "POST",
      body: JSON.stringify({ result }),
    });
  }

  async failJob(jobId: string, message: string): Promise<void> {
    await this.request(`/connector-api/v1/jobs/${jobId}/fail`, {
      method: "POST",
      body: JSON.stringify({ code: "EXECUTION_FAILED", message, retryable: false }),
    });
  }

  private async request(path: string, init: RequestInit): Promise<Response> {
    let response = await this.authorized(path, init);
    if (response.status === 401) {
      await this.refresh();
      response = await this.authorized(path, init);
    }
    if (!response.ok) throw new Error(`${path} returned ${response.status}`);
    return response;
  }

  private authorized(path: string, init: RequestInit): Promise<Response> {
    return fetch(new URL(path, this.apiUrl), {
      ...init,
      redirect: "error",
      headers: {
        authorization: `Bearer ${this.identity.accessToken}`,
        "content-type": "application/json",
        ...init.headers,
      },
      signal: AbortSignal.timeout(15_000),
    });
  }

  private async refresh(): Promise<void> {
    const response = await fetch(
      new URL("/connector-api/v1/auth/refresh", this.apiUrl),
      {
        method: "POST",
        redirect: "error",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ refreshToken: this.identity.refreshToken }),
        signal: AbortSignal.timeout(15_000),
      },
    );
    if (!response.ok) throw new Error("Machine token refresh failed");
    const tokens = (await response.json()) as {
      accessToken: string;
      refreshToken: string;
    };
    this.identity = { ...this.identity, ...tokens };
    await saveIdentity(this.dataDirectory, this.identity);
  }
}

export type MachineJob = {
  id: string;
  type: string;
  schemaVersion: number;
  payload: {
    target?: { deviceId?: string; address?: string };
    count?: number;
    timeoutMs?: number;
    intervalMs?: number;
    serverId?: string;
    router?: {
      host: string;
      port: number;
      tls: boolean;
      username: string;
      password: string;
    };
    periodStartedAt?: string;
    periodEndedAt?: string;
    deviceIds?: string[];
  };
  expiresAt: string;
};
