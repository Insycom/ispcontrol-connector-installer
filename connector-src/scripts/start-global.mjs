import "dotenv/config";
import { createHash, randomBytes } from "node:crypto";
import { access, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { PrismaClient } from "@prisma/client";

const repositoryRoot = resolve(import.meta.dirname, "../../..");
const dataDirectory =
  process.env.ISPCONTROL_GLOBAL_CONNECTOR_DATA_DIR ??
  resolve(repositoryRoot, ".runtime/global-connector");
const identityPath = resolve(dataDirectory, "identity.json");

await mkdir(dataDirectory, { recursive: true, mode: 0o700 });

process.env.ISPCONTROL_API_URL ??= "http://ispcontrol.local";
process.env.ISPCONTROL_ALLOW_INSECURE_HTTP ??= "true";
process.env.ISPCONTROL_DATA_DIR = dataDirectory;
process.env.ISPCONTROL_CONNECTOR_NAME ??= "Conector global del sistema";
process.env.PORT ??= "9080";

if (!(await exists(identityPath))) {
  const prisma = new PrismaClient();
  try {
    const actor = await prisma.user.findFirst({
      where: { platformRole: "SUPERADMIN", active: true },
      orderBy: { createdAt: "asc" },
      select: { id: true },
    });
    if (!actor) throw new Error("An active superadmin is required");

    const connector = await prisma.connector.upsert({
      where: { publicId: "ispcontrol-global-system" },
      create: {
        publicId: "ispcontrol-global-system",
        name: "Conector global del sistema",
        ownership: "PLATFORM",
        mode: "GLOBAL",
        status: "PENDING",
        enabled: true,
      },
      update: {
        ownership: "PLATFORM",
        mode: "GLOBAL",
        status: "PENDING",
        enabled: true,
      },
      select: { id: true },
    });
    const enrollmentToken = `icpe_${randomBytes(48).toString("base64url")}`;
    const tokenHash = createHash("sha256").update(enrollmentToken).digest("hex");
    await prisma.$transaction([
      prisma.connectorEnrollmentToken.updateMany({
        where: { connectorId: connector.id, usedAt: null, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
      prisma.connectorEnrollmentToken.create({
        data: {
          connectorId: connector.id,
          tokenHash,
          expiresAt: new Date(Date.now() + 30 * 60_000),
          createdById: actor.id,
        },
      }),
    ]);
    process.env.ISPCONTROL_ENROLLMENT_TOKEN = enrollmentToken;
  } finally {
    await prisma.$disconnect();
  }
}

await import("../dist/main.js");

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}
