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
  --enrollment-token TOKEN
  --allow-insecure-http true|false
  --port 9080
  --install-dir /opt/ispcontrol-connector
USAGE
}
log(){ printf '\033[1;32m[ispcontrol]\033[0m %s\n' "$*"; }
die(){ printf '\033[1;31m[ispcontrol]\033[0m %s\n' "$*" >&2; exit 1; }

API_URL=""
DNS_SERVER="172.31.0.1"
CONNECTOR_NAME="IspControl Connector"
ENROLLMENT_TOKEN=""
PORT="9080"
ALLOW_INSECURE_HTTP="false"
INSTALL_DIR="${XDG_DATA_HOME:-$HOME/.local/share}/ispcontrol-connector"

while [ $# -gt 0 ]; do
  case "$1" in
    --api-url) API_URL="${2:-}"; shift 2 ;;
    --dns) DNS_SERVER="${2:-}"; shift 2 ;;
    --name) CONNECTOR_NAME="${2:-}"; shift 2 ;;
    --enrollment-token) ENROLLMENT_TOKEN="${2:-}"; shift 2 ;;
    --allow-insecure-http) ALLOW_INSECURE_HTTP="${2:-false}"; shift 2 ;;
    --port) PORT="${2:-9080}"; shift 2 ;;
    --install-dir) INSTALL_DIR="${2:-$INSTALL_DIR}"; shift 2 ;;
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

mkdir -p "$INSTALL_DIR"
if [ ! -d "$INSTALL_DIR/.git" ]; then
  git clone https://github.com/Insycom/ispcontrol-connector-installer.git "$INSTALL_DIR"
else
  git -C "$INSTALL_DIR" pull --ff-only
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
cd "$INSTALL_DIR"
log "Construyendo y levantando el conector..."
docker compose up -d --build
log "Listo. Salud local en http://127.0.0.1:${PORT}/health"
