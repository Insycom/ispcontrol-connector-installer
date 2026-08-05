import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ConnectorDatabase } from "./database.js";

test("persists an outbox event until it is acknowledged", async () => {
  const directory = await mkdtemp(join(tmpdir(), "ispcontrol-db-"));
  try {
    const database = new ConnectorDatabase(directory);
    const sequence = database.nextSequence();
    database.enqueue({
      eventId: "evt_test_0001",
      type: "device.down",
      schemaVersion: 1,
      sequence,
      occurredAt: new Date().toISOString(),
      deviceId: "00000000-0000-4000-8000-000000000001",
      severity: "critical",
      payload: {},
    });
    assert.equal(database.pendingCount(), 1);
    database.close();

    const reopened = new ConnectorDatabase(directory);
    assert.equal(reopened.pendingEvents()[0]?.eventId, "evt_test_0001");
    reopened.markDelivered(["evt_test_0001"]);
    assert.equal(reopened.pendingCount(), 0);
    assert.equal(reopened.nextSequence(), sequence + 1);
    reopened.close();
  } finally {
    await rm(directory, { recursive: true });
  }
});

test("aggregates checks locally and retains samples until acknowledged", async () => {
  const directory = await mkdtemp(join(tmpdir(), "ispcontrol-samples-"));
  try {
    const database = new ConnectorDatabase(directory);
    const deviceId = "00000000-0000-4000-8000-000000000002";
    database.replaceDevices([{
      id: deviceId,
      name: "Connection LAB-001",
      address: "192.0.2.10",
      enabled: true,
      intervalSeconds: 1_200,
      timeoutMs: 1_000,
      packetCount: 5,
      failureThreshold: 2,
      recoveryThreshold: 2,
      highLatencyThresholdMs: 100,
      packetLossThresholdPercent: 20,
      updatedAt: "2026-07-29T10:00:00.000Z",
    }]);
    database.recordCheck(deviceId, {
      id: "check-1",
      startedAt: "2026-07-29T10:00:00.000Z",
      completedAt: "2026-07-29T10:00:05.000Z",
      sent: 5,
      received: 4,
      minimumLatencyMs: 10,
      averageLatencyMs: 15,
      maximumLatencyMs: 20,
      jitterMs: 2,
      packetLossPercent: 20,
    });
    assert.equal(
      database.aggregateSamples(new Date("2026-07-29T10:21:00.000Z")),
      1,
    );
    const [sample] = database.pendingSamples();
    assert.equal(sample?.checks, 1);
    assert.equal(sample?.packetLossPercent, 20);
    assert.equal(sample?.availabilityPercent, 80);
    database.close();

    const reopened = new ConnectorDatabase(directory);
    assert.equal(reopened.pendingSamples().length, 1);
    reopened.markSamplesDelivered([sample!.sampleId]);
    assert.equal(reopened.pendingSamples().length, 0);
    assert.equal(
      reopened.samplesForPeriod(
        "2026-07-29T09:00:00.000Z",
        "2026-07-29T11:00:00.000Z",
      ).length,
      1,
    );
    reopened.close();
  } finally {
    await rm(directory, { recursive: true });
  }
});
