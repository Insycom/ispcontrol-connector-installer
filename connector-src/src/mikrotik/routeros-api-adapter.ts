import {
  RouterOsClient,
  type RouterCredentials,
} from "../routeros-client.js";
import type {
  RouterAdapter,
  RouterInterface,
  RouterResources,
  RouterSystemInfo,
} from "./router-adapter.js";

export class RouterOsApiAdapter implements RouterAdapter {
  private readonly client: RouterOsClient;

  constructor(credentials: RouterCredentials) {
    this.client = new RouterOsClient(credentials);
  }

  connect(): Promise<void> { return this.client.connect(); }
  disconnect(): Promise<void> { return this.client.close(); }

  async testConnection() {
    const info = await this.getSystemInfo();
    return { reachable: true, identity: info.identity };
  }

  async getSystemInfo(): Promise<RouterSystemInfo> {
    const [identity] = await this.client.print("/system/identity", {}, "name");
    const [resource] = await this.client.print(
      "/system/resource",
      {},
      "version,board-name,architecture-name,uptime",
    );
    const [routerboard] = await this.client.print(
      "/system/routerboard",
      {},
      "serial-number",
    );
    return {
      identity: identity?.name ?? "unknown",
      version: resource?.version ?? "unknown",
      boardName: resource?.["board-name"] ?? null,
      architecture: resource?.["architecture-name"] ?? null,
      serialNumber: routerboard?.["serial-number"] ?? null,
      uptime: resource?.uptime ?? "unknown",
    };
  }

  async getResources(): Promise<RouterResources> {
    const [row] = await this.client.print(
      "/system/resource",
      {},
      "cpu-load,free-memory,total-memory,free-hdd-space,total-hdd-space",
    );
    return {
      cpuLoadPercent: Number(row?.["cpu-load"] ?? 0),
      freeMemoryBytes: Number(row?.["free-memory"] ?? 0),
      totalMemoryBytes: Number(row?.["total-memory"] ?? 0),
      freeStorageBytes: Number(row?.["free-hdd-space"] ?? 0),
      totalStorageBytes: Number(row?.["total-hdd-space"] ?? 0),
    };
  }

  async getInterfaces(): Promise<RouterInterface[]> {
    const rows = await this.client.print(
      "/interface",
      {},
      ".id,name,type,running,disabled,mac-address",
    );
    return rows.map((row) => ({
      id: row[".id"] ?? "",
      name: row.name ?? "",
      type: row.type ?? "unknown",
      running: row.running === "true",
      disabled: row.disabled === "true",
      macAddress: row["mac-address"] ?? null,
    }));
  }

  async getIpAddresses() {
    const rows = await this.client.print("/ip/address", {}, "address,interface");
    return rows.map((row) => ({
      address: row.address ?? "",
      interface: row.interface ?? "",
    }));
  }

  async getRoutes() {
    const rows = await this.client.print(
      "/ip/route",
      {},
      "dst-address,gateway,active",
    );
    return rows.map((row) => ({
      destination: row["dst-address"] ?? "",
      gateway: row.gateway ?? null,
      active: row.active === "true",
    }));
  }

  async getPppoeSessions() {
    const rows = await this.client.print(
      "/ppp/active",
      {},
      "name,address,uptime,service",
    );
    return rows
      .filter((row) => row.service === "pppoe")
      .map((row) => ({
        username: row.name ?? "",
        address: row.address ?? null,
        uptime: row.uptime ?? null,
      }));
  }

  async getPppSecrets() {
    const rows = await this.client.print(
      "/ppp/secret",
      {},
      "name,service,disabled",
    );
    return rows.map((row) => ({
      name: row.name ?? "",
      service: row.service ?? "any",
      disabled: row.disabled === "true",
    }));
  }
}
