#!/usr/bin/env bash
set -euo pipefail

API_URL=""
DNS_SERVER="172.31.0.1"
CONNECTOR_NAME="IspControl Connector"
ENROLLMENT_TOKEN=""
PORT="9080"
ALLOW_INSECURE_HTTP="false"

while [ $# -gt 0 ]; do
  case "$1" in
    --api-url) API_URL="${2:-}"; shift 2 ;;
    --dns) DNS_SERVER="${2:-}"; shift 2 ;;
    --name) CONNECTOR_NAME="${2:-}"; shift 2 ;;
    --enrollment-token) ENROLLMENT_TOKEN="${2:-}"; shift 2 ;;
    --allow-insecure-http) ALLOW_INSECURE_HTTP="${2:-false}"; shift 2 ;;
    --port) PORT="${2:-9080}"; shift 2 ;;
    -h|--help)
      cat <<'EOF'
Uso:
  ./install.sh --api-url http://ispcontrol.local:3000 --dns 172.31.0.1 --name "Conector"
EOF
      exit 0
      ;;
    *) printf 'Argumento desconocido: %s\n' "$1" >&2; exit 1 ;;
  esac
done

[ -n "$API_URL" ] || { printf '%s\n' "--api-url es obligatorio" >&2; exit 1; }

cat >.env <<EOF
ISPCONTROL_API_URL=${API_URL}
ISPCONTROL_ALLOW_INSECURE_HTTP=${ALLOW_INSECURE_HTTP}
ISPCONTROL_CONNECTOR_NAME=${CONNECTOR_NAME}
ISPCONTROL_ENROLLMENT_TOKEN=${ENROLLMENT_TOKEN}
ISPCONTROL_GLOBAL_CONNECTOR_DATA_DIR=/var/lib/ispcontrol
ISPCONTROL_DNS_SERVER=${DNS_SERVER}
PORT=${PORT}
EOF

docker compose up -d
