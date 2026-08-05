import { createServer, type Server } from "node:http";
import type { ConnectionState } from "./connection-state.js";

export class HealthServer {
  private readonly server: Server;

  constructor(
    private readonly port: number,
    private readonly connectionState: ConnectionState,
  ) {
    this.server = createServer((request, response) => {
      if (request.method !== "GET") {
        response.writeHead(404).end();
        return;
      }
      const snapshot = this.connectionState.read();
      if (request.url === "/version") {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({
          version: "0.1.0",
          protocolVersion: 1,
          architecture: process.arch,
          buildDate: process.env.BUILD_DATE ?? "development",
          commit: process.env.BUILD_COMMIT ?? "unknown",
        }));
        return;
      }
      if (request.url === "/metrics") {
        response.writeHead(200, { "content-type": "text/plain; version=0.0.4" });
        response.end(
          `connector_api_connected ${snapshot.apiConnected ? 1 : 0}\n`,
        );
        return;
      }
      if (request.url !== "/health" && request.url !== "/ready") {
        response.writeHead(404).end();
        return;
      }
      const ready = request.url === "/health" || snapshot.apiConnected;
      response.writeHead(ready ? 200 : 503, {
        "content-type": "application/json",
      });
      response.end(
        JSON.stringify({
          status: ready ? "ok" : "degraded",
          ...snapshot,
        }),
      );
    });
  }

  start(): void {
    this.server.listen(this.port, "0.0.0.0", () => {
      console.log(`Connector health endpoint listening on port ${this.port}`);
    });
  }

  close(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.server.close((error) => (error ? reject(error) : resolve()));
    });
  }
}
