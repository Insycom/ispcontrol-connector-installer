import { randomBytes, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";

export type ConnectorIdentity = {
  connectorId: string;
  apiKey?: string;
  accessToken?: string;
  refreshToken?: string;
  mode?: "TENANT_LOCAL" | "GLOBAL" | "DEVELOPMENT";
};

export type IdentityResult = {
  identity: ConnectorIdentity;
  created: boolean;
};

export async function loadOrCreateIdentity(
  directory: string,
): Promise<IdentityResult> {
  const identityPath = join(directory, "identity.json");
  const stored = await readIdentity(identityPath);

  if (stored) return { identity: stored, created: false };

  await mkdir(directory, { recursive: true, mode: 0o700 });
  const identity = createIdentity();

  await writeFile(identityPath, JSON.stringify(identity), {
    encoding: "utf8",
    mode: 0o600,
    flag: "wx",
  });

  return { identity, created: true };
}

export function showApiKeyOnce(identity: ConnectorIdentity): void {
  if (!identity.apiKey) return;
  console.log("");
  console.log("IspControl connector API key (shown only once):");
  console.log(identity.apiKey);
  console.log("Enter this key in the main IspControl system.");
  console.log("");
}

export async function saveIdentity(
  directory: string,
  identity: ConnectorIdentity,
): Promise<void> {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const identityPath = join(directory, "identity.json");
  const temporaryPath = join(directory, "identity.json.tmp");
  await writeFile(temporaryPath, JSON.stringify(identity), {
    encoding: "utf8",
    mode: 0o600,
  });
  await rename(temporaryPath, identityPath);
}

async function readIdentity(
  identityPath: string,
): Promise<ConnectorIdentity | undefined> {
  try {
    const parsed: unknown = JSON.parse(await readFile(identityPath, "utf8"));
    if (!isConnectorIdentity(parsed)) {
      throw new Error(`Invalid connector identity at ${identityPath}`);
    }
    return parsed;
  } catch (error: unknown) {
    if (isFileNotFound(error)) return undefined;
    throw error;
  }
}

function createIdentity(): ConnectorIdentity {
  const connectorId = randomUUID();
  const secret = randomBytes(32).toString("base64url");
  return {
    connectorId,
    apiKey: `icpc_${connectorId}.${secret}`,
  };
}

function isConnectorIdentity(value: unknown): value is ConnectorIdentity {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.connectorId === "string" &&
    (typeof candidate.apiKey === "string" ||
      (typeof candidate.accessToken === "string" &&
        typeof candidate.refreshToken === "string"))
  );
}

function isFileNotFound(error: unknown): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    (error as NodeJS.ErrnoException).code === "ENOENT"
  );
}
