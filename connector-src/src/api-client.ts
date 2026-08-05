import type { ConnectorIdentity } from "./identity.js";

export type HeartbeatResult =
  | { accepted: true }
  | { accepted: false; status: number };

export type ConnectorCommand = {
  id: string;
  type: "SYNC" | "ACTIVATE" | "SUSPEND" | "CHANGE_SPEED";
  router: {
    host: string;
    port: number;
    tls: boolean;
    username: string;
    password: string;
  };
  service: {
    id: string;
    name: string;
    ipAddress: string;
    managementMode: "SIMPLE_QUEUE" | "ADDRESS_LIST";
    addressListName: string;
    suspendedAddressListName: string;
    uploadKbps: number;
    downloadKbps: number;
    burstUploadKbps: number | null;
    burstDownloadKbps: number | null;
  };
};

export class ConnectorApiClient {
  constructor(
    private readonly apiUrl: URL,
    private readonly identity: ConnectorIdentity,
  ) {}

  async sendHeartbeat(): Promise<HeartbeatResult> {
    const response = await fetch(
      new URL("/api/v1/connector/v1/heartbeat", this.apiUrl),
      {
        method: "POST",
        redirect: "error",
        headers: {
          authorization: `Bearer ${this.identity.apiKey}`,
          "content-type": "application/json",
        },
body: JSON.stringify({
          connectorId: this.identity.connectorId,
          version: "0.2.1",
          capabilities: [],
        }),
        signal: AbortSignal.timeout(10_000),
      },
    );

    return response.ok
      ? { accepted: true }
      : { accepted: false, status: response.status };
  }

  async nextCommand(): Promise<ConnectorCommand | null> {
    const response = await fetch(
      new URL("/api/v1/connector/v1/commands/next", this.apiUrl),
      {
        redirect: "error",
        headers: { authorization: `Bearer ${this.identity.apiKey}` },
        signal: AbortSignal.timeout(15_000),
      },
    );
    if (!response.ok) throw new Error(`Command API returned ${response.status}`);
    return (await response.json()) as ConnectorCommand | null;
  }

  async reportCommand(
    commandId: string,
    result: { success: boolean; error?: string },
  ): Promise<void> {
    const response = await fetch(
      new URL(
        `/api/v1/connector/v1/commands/${encodeURIComponent(commandId)}/result`,
        this.apiUrl,
      ),
      {
        method: "POST",
        redirect: "error",
        headers: {
          authorization: `Bearer ${this.identity.apiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify(result),
        signal: AbortSignal.timeout(10_000),
      },
    );
    if (!response.ok) throw new Error(`Result API returned ${response.status}`);
  }
}
