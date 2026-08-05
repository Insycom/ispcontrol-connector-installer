import { spawn } from "node:child_process";

export type PingResult = {
  reachable: boolean;
  sent: number;
  received: number;
  packetLossPercent: number;
  minimumLatencyMs: number | null;
  averageLatencyMs: number | null;
  maximumLatencyMs: number | null;
  jitterMs: number | null;
  resolvedAddress: string;
  startedAt: string;
  completedAt: string;
};

export function ping(
  address: string,
  count: number,
  timeoutMs: number,
): Promise<PingResult> {
  validateTarget(address);
  const startedAt = new Date().toISOString();
  return new Promise((resolve, reject) => {
    const process = spawn(
      "ping",
      ["-n", "-c", String(count), "-W", String(Math.ceil(timeoutMs / 1000)), address],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    let output = "";
    process.stdout.on("data", (chunk: Buffer) => {
      output += chunk.toString("utf8");
    });
    process.once("error", reject);
    process.once("close", () => {
      resolve(parsePing(output, address, startedAt));
    });
  });
}

export function parsePing(
  output: string,
  address: string,
  startedAt: string,
): PingResult {
  const packets =
    /(\d+) packets transmitted, (\d+) (?:packets )?received(?:, \+\d+ errors)?, ([\d.]+)% packet loss/u.exec(
      output,
    );
  const latency =
    /(?:round-trip|rtt) min\/avg\/max\/(?:mdev|stddev) = ([\d.]+)\/([\d.]+)\/([\d.]+)\/([\d.]+)/u.exec(
      output,
    );
  const sent = Number(packets?.[1] ?? 0);
  const received = Number(packets?.[2] ?? 0);
  return {
    reachable: received > 0,
    sent,
    received,
    packetLossPercent: Number(packets?.[3] ?? 100),
    minimumLatencyMs: latency ? Number(latency[1]) : null,
    averageLatencyMs: latency ? Number(latency[2]) : null,
    maximumLatencyMs: latency ? Number(latency[3]) : null,
    jitterMs: latency ? Number(latency[4]) : null,
    resolvedAddress: address,
    startedAt,
    completedAt: new Date().toISOString(),
  };
}

function validateTarget(value: string): void {
  if (!/^(?:[A-Za-z0-9](?:[A-Za-z0-9.-]{0,251}[A-Za-z0-9])?|\d{1,3}(?:\.\d{1,3}){3})$/u.test(value)) {
    throw new Error("Invalid monitoring target");
  }
}
