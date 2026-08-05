import { readFile } from "node:fs/promises";
import { join } from "node:path";

type ConnectorIdentity = {
  connectorId: string;
  apiKey?: string;
  accessToken?: string;
  refreshToken?: string;
  mode?: string;
};

const directory = process.argv[2];
if (!directory) {
  console.error("Uso: node dist/utils/identity-view.js <data-dir>");
  process.exit(1);
}

const identityPath = join(directory, "identity.json");
const identity = JSON.parse(await readFile(identityPath, "utf8")) as ConnectorIdentity;

console.log(JSON.stringify(identity, null, 2));
