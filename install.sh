#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'USAGE'
Uso:
  curl -fsSL https://github.com/Insycom/ispcontrol-connector-installer/releases/download/v1.0.2/install.sh | bash -s -- \
    --api-url http://ispcontrol.local \
    --dns 172.31.0.1 \
    --name "Conector sucursal norte"

Opcionales:
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
    -h|--help) usage; exit 0 ;;
    *) die "Argumento desconocido: $1" ;;
  esac
done

[ -n "$API_URL" ] || die "--api-url es obligatorio"

if ! command -v docker >/dev/null 2>&1; then
  die "Docker no está instalado"
fi
if ! docker compose version >/dev/null 2>&1; then
  die "Docker Compose no está disponible"
fi
if ! docker info >/dev/null 2>&1; then
  die "No tengo permisos para usar Docker. Revisá el grupo docker o ejecutá con sudo."
fi
if ! command -v git >/dev/null 2>&1; then
  die "git no está instalado"
fi

if [ -z "$INSTALL_DIR" ]; then
  INSTALL_DIR="${XDG_DATA_HOME:-$HOME/.local/share}/ispcontrol-connector"
fi
REPO_DIR="$INSTALL_DIR/repo"
mkdir -p "$INSTALL_DIR"
if [ ! -d "$REPO_DIR/.git" ]; then
  git clone https://github.com/Insycom/ispcontrol-connector-installer.git "$REPO_DIR"
else
  git -C "$REPO_DIR" pull --ff-only
fi

cat > "$INSTALL_DIR/.env" <<EOFENV
ISPCONTROL_API_URL=$API_URL
ISPCONTROL_ALLOW_INSECURE_HTTP=$ALLOW_INSECURE_HTTP
ISPCONTROL_CONNECTOR_NAME=$CONNECTOR_NAME
ISPCONTROL_ENROLLMENT_TOKEN=$ENROLLMENT_TOKEN
ISPCONTROL_GLOBAL_CONNECTOR_DATA_DIR=$INSTALL_DIR/data
ISPCONTROL_DNS_SERVER=$DNS_SERVER
PORT=$PORT
EOFENV

mkdir -p "$INSTALL_DIR/data"

if [ "$USE_DOCKER_RUN" = "true" ]; then
  log "Construyendo y ejecutando en modo docker run..."
  docker build -t ispcontrol-connector:local "$REPO_DIR/connector-src"
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
    -e ISPCONTROL_GLOBAL_CONNECTOR_DATA_DIR="$INSTALL_DIR/data" \
    -e ISPCONTROL_DNS_SERVER="$DNS_SERVER" \
    -p "127.0.0.1:${PORT}:9080" \
    --tmpfs /tmp \
    --tmpfs /run \
    ispcontrol-connector:local
  log "Listo. Salud local en http://127.0.0.1:${PORT}/health"
  exit 0
fi

cat > "$INSTALL_DIR/docker-compose.yml" <<EOFYML
services:
  connector:
    build:
      context: ./repo/connector-src
    restart: unless-stopped
    read_only: true
    security_opt:
      - no-new-privileges:true
    dns:
      - ${DNS_SERVER}
    environment:
      ISPCONTROL_API_URL: ${API_URL}
      ISPCONTROL_ALLOW_INSECURE_HTTP: ${ALLOW_INSECURE_HTTP}
      ISPCONTROL_CONNECTOR_NAME: ${CONNECTOR_NAME}
      ISPCONTROL_ENROLLMENT_TOKEN: ${ENROLLMENT_TOKEN}
      ISPCONTROL_GLOBAL_CONNECTOR_DATA_DIR: ${INSTALL_DIR}/data
      ISPCONTROL_DNS_SERVER: ${DNS_SERVER}
    volumes:
      - connector_identity:${INSTALL_DIR}/data
    ports:
      - "127.0.0.1:${PORT}:9080"

volumes:
  connector_identity:
EOFYML

cd "$INSTALL_DIR"
log "Levantando el conector..."
docker compose up -d --build
log "Listo. Salud local en http://127.0.0.1:${PORT}/health"
