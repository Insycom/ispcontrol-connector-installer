import type { ConnectorApiClient } from "./api-client.js";
import type { ConnectionState } from "./connection-state.js";

export class Heartbeat {
  private timer: NodeJS.Timeout | undefined;

  constructor(
    private readonly apiClient: ConnectorApiClient,
    private readonly connectionState: ConnectionState,
    private readonly intervalMs: number,
  ) {}

  async start(): Promise<void> {
    await this.send();
    this.timer = setInterval(() => void this.send(), this.intervalMs);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
  }

  private async send(): Promise<void> {
    try {
      const result = await this.apiClient.sendHeartbeat();
      if (result.accepted) {
        this.connectionState.connected();
        return;
      }

      this.connectionState.disconnected();
      console.error(`Heartbeat rejected with status ${result.status}`);
    } catch (error: unknown) {
      this.connectionState.disconnected();
      const message = error instanceof Error ? error.message : "unknown error";
      console.error(`Heartbeat failed: ${message}`);
    }
  }
}
