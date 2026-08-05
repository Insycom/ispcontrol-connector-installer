export type ConnectionSnapshot = {
  apiConnected: boolean;
  lastHeartbeatAt: string | null;
};

export class ConnectionState {
  private snapshot: ConnectionSnapshot = {
    apiConnected: false,
    lastHeartbeatAt: null,
  };

  connected(): void {
    this.snapshot = {
      apiConnected: true,
      lastHeartbeatAt: new Date().toISOString(),
    };
  }

  disconnected(): void {
    this.snapshot = {
      ...this.snapshot,
      apiConnected: false,
    };
  }

  read(): Readonly<ConnectionSnapshot> {
    return this.snapshot;
  }
}
