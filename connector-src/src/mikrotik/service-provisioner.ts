import { RouterOsClient, type RouterCredentials } from "../routeros-client.js";

export type ServiceProvisionPayload = {
  router: RouterCredentials;
  action: "SYNC" | "ACTIVATE" | "SUSPEND" | "CHANGE_SPEED";
  service: {
    id: string;
    name: string;
    ipAddress?: string;
    macAddress?: string;
    connectionType: "STATIC_IP" | "DHCP" | "PPPOE" | "ADDRESS_LIST";
    queueMode: "SIMPLE_QUEUE" | "ADDRESS_LIST_ONLY";
    addressListEnabled: boolean;
    addressListName?: string;
    suspendedAddressListName?: string;
    uploadKbps: number;
    downloadKbps: number;
    burstUploadKbps?: number;
    burstDownloadKbps?: number;
    pppoe?: {
      create: boolean;
      username?: string;
      password?: string;
      profile?: string;
      service?: string;
    };
    dhcp?: {
      createLease: boolean;
      addressList?: string;
      rate?: string;
      leaseTime?: string;
      createQueue: boolean;
    };
  };
};

export async function provisionService(payload: ServiceProvisionPayload) {
  const router = new RouterOsClient(payload.router);
  await router.connect();
  try {
    const suspended = payload.action === "SUSPEND";
    await applyAddressLists(router, payload, suspended);
    await applyQueue(router, payload, suspended);
    await applyPppoe(router, payload, suspended);
    await applyDhcp(router, payload, suspended);
    return {
      reachable: true,
      serviceId: payload.service.id,
      action: payload.action,
      appliedAt: new Date().toISOString(),
    };
  } finally {
    await router.close();
  }
}

async function applyAddressLists(
  router: RouterOsClient,
  payload: ServiceProvisionPayload,
  suspended: boolean,
) {
  const { service } = payload;
  if (!service.ipAddress) return;
  if (service.addressListName) {
    if (suspended) await remove(router, "/ip/firewall/address-list", { list: service.addressListName, address: service.ipAddress });
    else if (service.addressListEnabled) await ensure(router, "/ip/firewall/address-list", { list: service.addressListName, address: service.ipAddress }, { comment: service.name });
  }
  if (service.suspendedAddressListName) {
    if (suspended) await ensure(router, "/ip/firewall/address-list", { list: service.suspendedAddressListName, address: service.ipAddress }, { comment: service.name });
    else await remove(router, "/ip/firewall/address-list", { list: service.suspendedAddressListName, address: service.ipAddress });
  }
}

async function applyQueue(
  router: RouterOsClient,
  payload: ServiceProvisionPayload,
  suspended: boolean,
) {
  const { service } = payload;
  if (!service.ipAddress || service.queueMode !== "SIMPLE_QUEUE") return;
  const attributes: Record<string, string> = {
    target: `${service.ipAddress}/32`,
    "max-limit": `${toBitsPerSecond(service.uploadKbps)}/${toBitsPerSecond(service.downloadKbps)}`,
    disabled: suspended ? "yes" : "no",
    comment: `Managed by IspControl (${service.id})`,
  };
  if (service.burstUploadKbps && service.burstDownloadKbps) {
    attributes["burst-limit"] =
      `${toBitsPerSecond(service.burstUploadKbps)}/${toBitsPerSecond(service.burstDownloadKbps)}`;
  }
  await upsert(router, "/queue/simple", { name: service.name }, attributes);
  await assertExists(router, "/queue/simple", { name: service.name });
}

async function applyPppoe(
  router: RouterOsClient,
  payload: ServiceProvisionPayload,
  suspended: boolean,
) {
  const { service } = payload;
  if (service.connectionType !== "PPPOE" || !service.pppoe?.create) return;
  if (!service.pppoe.username || !service.pppoe.password) {
    throw new Error("PPPoE username and password are required");
  }
  await upsert(router, "/ppp/secret", { name: service.pppoe.username }, {
    password: service.pppoe.password,
    service: service.pppoe.service || "pppoe",
    ...(service.pppoe.profile ? { profile: service.pppoe.profile } : {}),
    ...(service.ipAddress ? { "remote-address": service.ipAddress } : {}),
    disabled: suspended ? "yes" : "no",
    comment: `Managed by IspControl (${service.id})`,
  });
}

async function applyDhcp(
  router: RouterOsClient,
  payload: ServiceProvisionPayload,
  suspended: boolean,
) {
  const { service } = payload;
  if (service.connectionType !== "DHCP" || !service.dhcp?.createLease || !service.macAddress) return;
  const attributes: Record<string, string> = {
    disabled: suspended ? "yes" : "no",
    comment: `Managed by IspControl (${service.id})`,
    ...(service.ipAddress ? { address: service.ipAddress } : {}),
    ...(service.dhcp.addressList ? { "address-list": service.dhcp.addressList } : {}),
    ...(service.dhcp.rate ? { "rate-limit": service.dhcp.rate } : {}),
    ...(service.dhcp.leaseTime ? { "lease-time": service.dhcp.leaseTime } : {}),
  };
  await upsert(router, "/ip/dhcp-server/lease", { "mac-address": service.macAddress }, attributes);
}

async function upsert(
  router: RouterOsClient,
  path: string,
  identity: Record<string, string>,
  attributes: Record<string, string>,
) {
  const rows = await router.print(path, identity, ".id");
  const id = rows[0]?.[".id"];
  if (id) await router.set(path, id, attributes);
  else await router.add(path, { ...identity, ...attributes });
}

async function ensure(
  router: RouterOsClient,
  path: string,
  identity: Record<string, string>,
  attributes: Record<string, string>,
) {
  const rows = await router.print(path, identity, ".id");
  if (!rows.length) await router.add(path, { ...identity, ...attributes });
}

async function assertExists(
  router: RouterOsClient,
  path: string,
  identity: Record<string, string>,
) {
  const rows = await router.print(path, identity, ".id");
  if (!rows.length) {
    throw new Error(`RouterOS did not persist ${path}`);
  }
}

function toBitsPerSecond(kbps: number): string {
  return String(kbps * 1_000);
}

async function remove(
  router: RouterOsClient,
  path: string,
  identity: Record<string, string>,
) {
  const rows = await router.print(path, identity, ".id");
  for (const row of rows) if (row[".id"]) await router.remove(path, row[".id"]);
}
