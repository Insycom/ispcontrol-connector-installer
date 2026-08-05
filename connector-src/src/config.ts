export type ConnectorConfig = {
  apiUrl: URL;
  dataDirectory: string;
  healthPort: number;
  heartbeatIntervalMs: number;
  enrollmentToken?: string;
  portalApiKey?: string;
  connectorName: string;
};

export function loadConfig(
  environment: NodeJS.ProcessEnv = process.env,
): ConnectorConfig {
  const enrollmentToken = environment.ISPCONTROL_ENROLLMENT_TOKEN?.trim();
  const portalApiKey = environment.ISPCONTROL_PORTAL_API_KEY?.trim();
  return {
    apiUrl: parseApiUrl(
      required(environment, "ISPCONTROL_API_URL"),
      environment.ISPCONTROL_ALLOW_INSECURE_HTTP === "true",
    ),
    dataDirectory:
      environment.ISPCONTROL_DATA_DIR?.trim() || "/var/lib/ispcontrol",
    healthPort: parsePort(environment.PORT, 9080),
    heartbeatIntervalMs: 30_000,
    ...(enrollmentToken ? { enrollmentToken } : {}),
    ...(portalApiKey ? { portalApiKey } : {}),
    connectorName: environment.ISPCONTROL_CONNECTOR_NAME?.trim() || "IspControl Connector",
  };
}

function required(environment: NodeJS.ProcessEnv, name: string): string {
  const value = environment[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function parseApiUrl(value: string, allowInsecureHttp: boolean): URL {
  const url = new URL(value);
  if (
    url.protocol !== "https:" &&
    url.hostname !== "localhost" &&
    !allowInsecureHttp
  ) {
    throw new Error(
      "ISPCONTROL_API_URL must use HTTPS outside localhost; development HTTP requires ISPCONTROL_ALLOW_INSECURE_HTTP=true",
    );
  }
  return url;
}

function parsePort(value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback;

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65_535) {
    throw new Error("PORT must be an integer between 1 and 65535");
  }
  return parsed;
}
