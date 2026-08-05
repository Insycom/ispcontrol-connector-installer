import { readFile, writeFile, rename } from "node:fs/promises";
import { join } from "node:path";

type ConnectorIdentity = {
  connectorId: string;
  apiKey?: string;
  accessToken?: string;
  refreshToken?: string;
  mode?: "TENANT_LOCAL" | "GLOBAL" | "DEVELOPMENT";
};

const [directory, apiKey, connectorId] = process.argv.slice(2);
if (!directory) {
  console.error("Uso: node dist/utils/identity-update.js <data-dir> [apiKey] [connectorId]");
  process.exit(1);
}

const identityPath = join(directory, "identity.json");
const current = JSON.parse(await readFile(identityPath, "utf8")) as ConnectorIdentity;
const next: ConnectorIdentity = {
  ...current,
  ...(apiKey ? { apiKey } : {}),
  ...(connectorId ? { connectorId } : {}),
};

const temporaryPath = join(directory, "identity.json.tmp");
await writeFile(temporaryPath, JSON.stringify(next, null, 2), { encoding: "utf8", mode: 0o600 });
await rename(temporaryPath, identityPath);
console.log(JSON.stringify(next, null, 2));
