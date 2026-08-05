import type {
  RouterAdapter,
  RouterInterface,
  RouterResources,
  RouterSystemInfo,
} from "./router-adapter.js";

export class RouterOsMockAdapter implements RouterAdapter {
  connect(): Promise<void> { return Promise.resolve(); }
  disconnect(): Promise<void> { return Promise.resolve(); }
  testConnection() { return Promise.resolve({ reachable: true, identity: "mock" }); }
  getSystemInfo(): Promise<RouterSystemInfo> {
    return Promise.resolve({
      identity: "mock", version: "7.mock", boardName: "CHR",
      architecture: "x86_64", serialNumber: "MOCK", uptime: "1d",
    });
  }
  getResources(): Promise<RouterResources> {
    return Promise.resolve({
      cpuLoadPercent: 1, freeMemoryBytes: 1, totalMemoryBytes: 2,
      freeStorageBytes: 1, totalStorageBytes: 2,
    });
  }
  getInterfaces(): Promise<RouterInterface[]> { return Promise.resolve([]); }
  getIpAddresses() { return Promise.resolve([]); }
  getRoutes() { return Promise.resolve([]); }
  getPppoeSessions() { return Promise.resolve([]); }
  getPppSecrets() { return Promise.resolve([]); }
}
