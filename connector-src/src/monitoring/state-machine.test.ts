import assert from "node:assert/strict";
import test from "node:test";
import type {
  MonitoredDeviceConfig,
  PersistedDeviceState,
} from "../persistence/database.js";
import { transitionDevice } from "./state-machine.js";

const policy: MonitoredDeviceConfig = {
  id: "device-1",
  name: "Radio",
  address: "192.0.2.1",
  enabled: true,
  intervalSeconds: 30,
  timeoutMs: 1000,
  packetCount: 3,
  failureThreshold: 3,
  recoveryThreshold: 2,
  highLatencyThresholdMs: 100,
  packetLossThresholdPercent: 30,
  updatedAt: new Date().toISOString(),
};

test("requires consecutive failures before declaring down", () => {
  let state: PersistedDeviceState = {
    status: "online",
    failures: 0,
    recoveries: 0,
    sequence: 0,
  };
  state = transitionDevice(state, failed(), policy).state;
  assert.equal(state.status, "suspectedDown");
  state = transitionDevice(state, failed(), policy).state;
  assert.equal(state.status, "suspectedDown");
  const result = transitionDevice(state, failed(), policy);
  assert.equal(result.state.status, "down");
  assert.equal(result.event, "device.down");
});

test("emits a single recovery after the configured threshold", () => {
  let state = { status: "down" as const, failures: 3, recoveries: 0, sequence: 1 };
  let result = transitionDevice(state, online(), policy);
  assert.equal(result.state.status, "recovering");
  assert.equal(result.event, undefined);
  result = transitionDevice(result.state, online(), policy);
  assert.equal(result.state.status, "online");
  assert.equal(result.event, "device.recovered");
});

function failed() {
  return { reachable: false, packetLossPercent: 100, averageLatencyMs: null };
}

function online() {
  return { reachable: true, packetLossPercent: 0, averageLatencyMs: 2 };
}
