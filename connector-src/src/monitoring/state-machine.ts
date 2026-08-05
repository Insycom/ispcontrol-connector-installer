import type {
  MonitoredDeviceConfig,
  MonitoringState,
  PersistedDeviceState,
} from "../persistence/database.js";

export type CheckResult = {
  reachable: boolean;
  packetLossPercent: number;
  averageLatencyMs: number | null;
};

export type Transition = {
  state: PersistedDeviceState;
  event?: "device.online" | "device.down" | "device.recovered" | "device.degraded";
};

export function transitionDevice(
  current: PersistedDeviceState,
  result: CheckResult,
  policy: MonitoredDeviceConfig,
): Transition {
  if (!policy.enabled) return changed(current, "disabled");
  if (!result.reachable) {
    const failures = current.failures + 1;
    if (current.status === "down") {
      return { state: { ...current, failures, recoveries: 0 } };
    }
    if (failures >= policy.failureThreshold) {
      return changed({ ...current, failures, recoveries: 0 }, "down", "device.down");
    }
    return changed({ ...current, failures, recoveries: 0 }, "suspectedDown");
  }
  const degraded =
    result.packetLossPercent >= policy.packetLossThresholdPercent ||
    (result.averageLatencyMs ?? 0) >= policy.highLatencyThresholdMs;
  if (current.status === "down" || current.status === "recovering") {
    const recoveries = current.recoveries + 1;
    if (recoveries >= policy.recoveryThreshold) {
      return changed(
        { ...current, failures: 0, recoveries },
        degraded ? "degraded" : "online",
        "device.recovered",
      );
    }
    return changed({ ...current, recoveries, failures: 0 }, "recovering");
  }
  if (degraded) {
    return changed(
      { ...current, failures: 0, recoveries: 0 },
      "degraded",
      current.status === "degraded" ? undefined : "device.degraded",
    );
  }
  return changed(
    { ...current, failures: 0, recoveries: 0 },
    "online",
    current.status === "unknown" ? "device.online" : undefined,
  );
}

function changed(
  current: PersistedDeviceState,
  status: MonitoringState,
  event?: Transition["event"],
): Transition {
  return {
    state: { ...current, status, sequence: current.sequence + (event ? 1 : 0) },
    ...(event ? { event } : {}),
  };
}
