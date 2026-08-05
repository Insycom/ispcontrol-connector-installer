export type RouterSystemInfo = {
  identity: string;
  version: string;
  boardName: string | null;
  architecture: string | null;
  serialNumber: string | null;
  uptime: string;
};

export type RouterResources = {
  cpuLoadPercent: number;
  freeMemoryBytes: number;
  totalMemoryBytes: number;
  freeStorageBytes: number;
  totalStorageBytes: number;
};

export type RouterInterface = {
  id: string;
  name: string;
  type: string;
  running: boolean;
  disabled: boolean;
  macAddress: string | null;
};

export interface RouterAdapter {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  testConnection(): Promise<{ reachable: boolean; identity?: string }>;
  getSystemInfo(): Promise<RouterSystemInfo>;
  getResources(): Promise<RouterResources>;
  getInterfaces(): Promise<RouterInterface[]>;
  getIpAddresses(): Promise<Array<{ address: string; interface: string }>>;
  getRoutes(): Promise<Array<{ destination: string; gateway: string | null; active: boolean }>>;
  getPppoeSessions(): Promise<Array<{ username: string; address: string | null; uptime: string | null }>>;
  getPppSecrets(): Promise<Array<{ name: string; service: string; disabled: boolean }>>;
}
