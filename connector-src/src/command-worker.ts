import type { ConnectorApiClient, ConnectorCommand } from "./api-client.js";
import { RouterOsClient } from "./routeros-client.js";

export class CommandWorker {
  private timer: NodeJS.Timeout | undefined;
  private running = false;

  constructor(
    private readonly api: ConnectorApiClient,
    private readonly intervalMs = 2_000,
  ) {}

  start(): void {
    void this.poll();
    this.timer = setInterval(() => void this.poll(), this.intervalMs);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
  }

  private async poll(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const command = await this.api.nextCommand();
      if (!command) return;
      try {
        await execute(command);
        await this.api.reportCommand(command.id, { success: true });
      } catch (cause: unknown) {
        const error = cause instanceof Error ? cause.message : "Unknown error";
        await this.api.reportCommand(command.id, { success: false, error });
      }
    } catch (cause: unknown) {
      const message = cause instanceof Error ? cause.message : "Unknown error";
      console.error(`Command polling failed: ${message}`);
    } finally {
      this.running = false;
    }
  }
}

async function execute(command: ConnectorCommand): Promise<void> {
  const router = new RouterOsClient(command.router);
  await router.connect();
  try {
    if (command.type === "SUSPEND") {
      await ensureAddress(
        router,
        command.service.suspendedAddressListName,
        command.service.ipAddress,
        command.service.name,
      );
      await removeAddress(
        router,
        command.service.addressListName,
        command.service.ipAddress,
      );
      if (command.service.managementMode === "SIMPLE_QUEUE") {
        await setQueue(router, command, true);
      }
      return;
    }
    await removeAddress(
      router,
      command.service.suspendedAddressListName,
      command.service.ipAddress,
    );
    await ensureAddress(
      router,
      command.service.addressListName,
      command.service.ipAddress,
      command.service.name,
    );
    if (command.service.managementMode === "SIMPLE_QUEUE") {
      await setQueue(router, command, false);
    }
  } finally {
    await router.close();
  }
}

async function ensureAddress(
  router: RouterOsClient,
  list: string,
  address: string,
  comment: string,
): Promise<void> {
  const found = await router.print(
    "/ip/firewall/address-list",
    { list, address },
    ".id,list,address",
  );
  if (!found.length) {
    await router.add("/ip/firewall/address-list", { list, address, comment });
  }
}

async function removeAddress(
  router: RouterOsClient,
  list: string,
  address: string,
): Promise<void> {
  const found = await router.print(
    "/ip/firewall/address-list",
    { list, address },
    ".id",
  );
  for (const item of found) {
    if (item[".id"]) {
      await router.remove("/ip/firewall/address-list", item[".id"]);
    }
  }
}

async function setQueue(
  router: RouterOsClient,
  command: ConnectorCommand,
  disabled: boolean,
): Promise<void> {
  const found = await router.print(
    "/queue/simple",
    { name: command.service.name },
    ".id,name",
  );
  const attributes: Record<string, string> = {
    target: `${command.service.ipAddress}/32`,
    "max-limit": `${command.service.uploadKbps}k/${command.service.downloadKbps}k`,
    disabled: disabled ? "yes" : "no",
    comment: `Managed by IspControl (${command.service.id})`,
  };
  if (
    command.service.burstUploadKbps &&
    command.service.burstDownloadKbps
  ) {
    attributes["burst-limit"] =
      `${command.service.burstUploadKbps}k/${command.service.burstDownloadKbps}k`;
  }
  const id = found[0]?.[".id"];
  if (id) await router.set("/queue/simple", id, attributes);
  else await router.add("/queue/simple", { name: command.service.name, ...attributes });
}
