#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'USAGE'
Uso:
  curl -fsSL https://raw.githubusercontent.com/Insycom/ispcontrol-connector-installer/main/install.sh | bash -s -- \
    --api-url http://ispcontrol.local \
    --dns 172.31.0.1 \
    --name "Conector sucursal norte"

Opcionales:
  --version VERSION | --commit SHA
  --install-dir RUTA
  --docker-run
  --enrollment-token TOKEN
  --allow-insecure-http true|false
  --port 9080
USAGE
}

log(){ printf '\033[1;32m[ispcontrol]\033[0m %s\n' "$*"; }
die(){ printf '\033[1;31m[ispcontrol]\033[0m %s\n' "$*" >&2; exit 1; }

API_URL=""
DNS_SERVER="172.31.0.1"
CONNECTOR_NAME="IspControl Connector"
INSTALL_DIR=""
ENROLLMENT_TOKEN=""
PORT="9080"
ALLOW_INSECURE_HTTP="false"
USE_DOCKER_RUN="false"
VERSION=""
COMMIT=""

while [ $# -gt 0 ]; do
  case "$1" in
    --api-url) API_URL="${2:-}"; shift 2 ;;
    --dns) DNS_SERVER="${2:-}"; shift 2 ;;
    --name) CONNECTOR_NAME="${2:-}"; shift 2 ;;
    --install-dir|--data-dir) INSTALL_DIR="${2:-}"; shift 2 ;;
    --enrollment-token) ENROLLMENT_TOKEN="${2:-}"; shift 2 ;;
    --allow-insecure-http) ALLOW_INSECURE_HTTP="${2:-false}"; shift 2 ;;
    --port) PORT="${2:-9080}"; shift 2 ;;
    --docker-run) USE_DOCKER_RUN="true"; shift 1 ;;
    --version) VERSION="${2:-}"; shift 2 ;;
    --commit) COMMIT="${2:-}"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) die "Argumento desconocido: $1" ;;
  esac
done

[ -n "$API_URL" ] || die "--api-url es obligatorio"

REPO="Insycom/ispcontrol-connector-installer"
BASE_RAW="https://raw.githubusercontent.com/$REPO"
API="https://api.github.com/repos/$REPO"

resolve_ref() {
  if [ -n "$COMMIT" ]; then
    printf '%s' "$COMMIT"
    return
  fi
  if [ -n "$VERSION" ]; then
    case "$VERSION" in
      main|latest) : ;;
      *)
        printf '%s' "$VERSION"
        return
        ;;
    esac
  fi
  curl -fsSL "$API/commits/main" | python - <<'PY'
import json,sys
print(json.load(sys.stdin)["sha"])
PY
}

REF="$(resolve_ref)"
[ -n "$REF" ] || die "No pude resolver la versión más nueva"

SCRIPT_URL="$BASE_RAW/$REF/install.sh"
WORKDIR="${XDG_DATA_HOME:-$HOME/.local/share}/ispcontrol-connector-installer-$REF"
mkdir -p "$WORKDIR"
curl -fsSL "$SCRIPT_URL" -o "$WORKDIR/install.real.sh"
chmod +x "$WORKDIR/install.real.sh"
exec bash "$WORKDIR/install.real.sh" \
  --api-url "$API_URL" \
  --dns "$DNS_SERVER" \
  --name "$CONNECTOR_NAME" \
  --install-dir "$INSTALL_DIR" \
  --enrollment-token "$ENROLLMENT_TOKEN" \
  --allow-insecure-http "$ALLOW_INSECURE_HTTP" \
  --port "$PORT" \
  ${USE_DOCKER_RUN:+--docker-run}
