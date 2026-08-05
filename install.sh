#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Uso:
  curl -fsSL https://raw.githubusercontent.com/Insycom/ispcontrol-connector-installer/main/install.sh | bash -s -- \
    --api-url http://ispcontrol.local:3000 \
    --dns 172.31.0.1 \
    --name "Conector sucursal norte"

Opcionales:
  --version VERSION | --commit SHA
  --image REPO/NAME:TAG
  --install-dir RUTA
  --docker-run
  --enrollment-token TOKEN
  --allow-insecure-http true|false
  --port 9080
EOF
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
IMAGE="fponce1996/ispcontrol-connector:latest"

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
    --image) IMAGE="${2:-}"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) die "Argumento desconocido: $1" ;;
  esac
done

[ -n "$API_URL" ] || die "--api-url es obligatorio"

REPO_URL="https://github.com/Insycom/ispcontrol-connector-installer.git"
REPO_RAW="https://raw.githubusercontent.com/Insycom/ispcontrol-connector-installer"

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
  if command -v gh >/dev/null 2>&1; then
    gh api repos/Insycom/ispcontrol-connector-installer/commits/main --jq .sha
    return
  fi
  curl -fsSL "https://api.github.com/repos/Insycom/ispcontrol-connector-installer/commits/main" | python3 -c 'import json,sys; print(json.load(sys.stdin)["sha"])'
}

REF="$(resolve_ref)"
[ -n "$REF" ] || die "No pude resolver la versión más nueva"

WORKDIR="${XDG_DATA_HOME:-$HOME/.local/share}/ispcontrol-connector-installer-$REF"
mkdir -p "$WORKDIR"

if [ ! -d "$WORKDIR/repo/.git" ]; then
  git clone "$REPO_URL" "$WORKDIR/repo"
fi
git -C "$WORKDIR/repo" checkout --force "$REF" >/dev/null 2>&1 || git -C "$WORKDIR/repo" checkout --force origin/main

if [ "$USE_DOCKER_RUN" = "true" ]; then
  log "Ejecutando con docker run..."
  docker pull "$IMAGE"
  docker rm -f ispcontrol-connector >/dev/null 2>&1 || true
  docker run -d \
    --name ispcontrol-connector \
    --restart unless-stopped \
    --read-only \
    --security-opt no-new-privileges:true \
    --dns "$DNS_SERVER" \
    -e ISPCONTROL_API_URL="$API_URL" \
    -e ISPCONTROL_ALLOW_INSECURE_HTTP="$ALLOW_INSECURE_HTTP" \
    -e ISPCONTROL_CONNECTOR_NAME="$CONNECTOR_NAME" \
    -e ISPCONTROL_ENROLLMENT_TOKEN="$ENROLLMENT_TOKEN" \
    -e ISPCONTROL_GLOBAL_CONNECTOR_DATA_DIR="/var/lib/ispcontrol" \
    -e ISPCONTROL_DNS_SERVER="$DNS_SERVER" \
    -p "127.0.0.1:${PORT}:9080" \
    --tmpfs /tmp \
    --tmpfs /run \
    "$IMAGE"
  log "Listo. Salud local en http://127.0.0.1:${PORT}/health"
  exit 0
fi

if [ -z "$INSTALL_DIR" ]; then
  if [ "$(id -u)" -eq 0 ]; then
    INSTALL_DIR="/opt/ispcontrol-connector"
  else
    INSTALL_DIR="${XDG_DATA_HOME:-$HOME/.local/share}/ispcontrol-connector"
  fi
fi

mkdir -p "$INSTALL_DIR"
cp "$WORKDIR/repo/docker-compose.yml" "$INSTALL_DIR/docker-compose.yml"
cat >"$INSTALL_DIR/.env" <<EOF
ISPCONTROL_API_URL=${API_URL}
ISPCONTROL_ALLOW_INSECURE_HTTP=${ALLOW_INSECURE_HTTP}
ISPCONTROL_CONNECTOR_NAME=${CONNECTOR_NAME}
ISPCONTROL_ENROLLMENT_TOKEN=${ENROLLMENT_TOKEN}
ISPCONTROL_GLOBAL_CONNECTOR_DATA_DIR=/var/lib/ispcontrol
ISPCONTROL_DNS_SERVER=${DNS_SERVER}
PORT=${PORT}
ISPCONTROL_CONNECTOR_IMAGE=${IMAGE}
EOF

log "Levantando el conector..."
cd "$INSTALL_DIR"
docker compose up -d
log "Listo. Salud local en http://127.0.0.1:${PORT}/health"
