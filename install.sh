#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Uso:
  curl -fsSL https://<tu-dominio>/install-connector.sh | bash -s -- \
    --api-url http://ispcontrol.local \
    --dns 172.31.0.1 \
    --name "Conector sucursal norte" \
    --data-dir /var/lib/ispcontrol

Opcionales:
  --enrollment-token TOKEN
  --portal-api-key KEY
  --allow-insecure-http true|false
  --port 9080
  --compose-url URL_DEL_COMPOSE

El instalador:
  - detecta la distro,
  - instala Docker si hace falta,
  - instala Docker Compose si hace falta,
  - descarga el compose del conector,
  - crea el .env,
  - levanta el contenedor.
EOF
}

log() { printf '\033[1;32m[ispcontrol]\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[ispcontrol]\033[0m %s\n' "$*" >&2; }
die() { printf '\033[1;31m[ispcontrol]\033[0m %s\n' "$*" >&2; exit 1; }

need_root() {
  if [ "${EUID:-$(id -u)}" -ne 0 ]; then
    die "Ejecutá este instalador como root (sudo)."
  fi
}

API_URL=""
DNS_SERVER="172.31.0.1"
CONNECTOR_NAME="IspControl Connector"
DATA_DIR="/var/lib/ispcontrol"
ENROLLMENT_TOKEN=""
PORT="9080"
ALLOW_INSECURE_HTTP="false"
COMPOSE_URL=""

while [ $# -gt 0 ]; do
  case "$1" in
    --api-url) API_URL="${2:-}"; shift 2 ;;
    --dns) DNS_SERVER="${2:-}"; shift 2 ;;
    --name) CONNECTOR_NAME="${2:-}"; shift 2 ;;
    --data-dir) DATA_DIR="${2:-}"; shift 2 ;;
    --enrollment-token) ENROLLMENT_TOKEN="${2:-}"; shift 2 ;;
    --allow-insecure-http) ALLOW_INSECURE_HTTP="${2:-false}"; shift 2 ;;
    --port) PORT="${2:-9080}"; shift 2 ;;
    --compose-url) COMPOSE_URL="${2:-}"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) die "Argumento desconocido: $1" ;;
  esac
done

need_root

if [ -z "$API_URL" ]; then
  die "--api-url es obligatorio"
fi

detect_pm() {
  if command -v apt-get >/dev/null 2>&1; then echo apt; return; fi
  if command -v dnf >/dev/null 2>&1; then echo dnf; return; fi
  if command -v yum >/dev/null 2>&1; then echo yum; return; fi
  if command -v pacman >/dev/null 2>&1; then echo pacman; return; fi
  die "No pude detectar un gestor de paquetes compatible"
}

install_docker() {
  if command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1; then
    log "Docker y Docker Compose ya están instalados."
    return
  fi

  local pm
  pm="$(detect_pm)"
  log "Instalando dependencias con $pm..."

  case "$pm" in
    apt)
      export DEBIAN_FRONTEND=noninteractive
      apt-get update -y
      apt-get install -y ca-certificates curl gnupg lsb-release
      install -m 0755 -d /etc/apt/keyrings
      if [ ! -f /etc/apt/keyrings/docker.gpg ]; then
        curl -fsSL https://download.docker.com/linux/$(. /etc/os-release && echo "$ID")/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
      fi
      chmod a+r /etc/apt/keyrings/docker.gpg
      local codename
      codename="$(. /etc/os-release && echo "${VERSION_CODENAME:-}")"
      if [ -z "$codename" ]; then
        codename="$(lsb_release -cs)"
      fi
      echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/$(. /etc/os-release && echo "$ID") $codename stable" >/etc/apt/sources.list.d/docker.list
      apt-get update -y
      apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
      ;;
    dnf)
      dnf -y install dnf-plugins-core
      dnf config-manager --add-repo https://download.docker.com/linux/centos/docker-ce.repo
      dnf -y install docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
      ;;
    yum)
      yum -y install yum-utils
      yum-config-manager --add-repo https://download.docker.com/linux/centos/docker-ce.repo
      yum -y install docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
      ;;
    pacman)
      pacman -Sy --noconfirm docker docker-compose
      ;;
  esac

  systemctl enable --now docker || true
}

compose_path="/opt/ispcontrol-connector"
install_dir="$compose_path"

download_compose() {
  mkdir -p "$install_dir"
  if [ -n "$COMPOSE_URL" ]; then
    curl -fsSL "$COMPOSE_URL" -o "$install_dir/docker-compose.yml"
    return
  fi

  COMPOSE_URL="https://raw.githubusercontent.com/Insycom/ispcontrol-connector-installer/main/docker-compose.yml"
  curl -fsSL "$COMPOSE_URL" -o "$install_dir/docker-compose.yml"
  return

  cat >"$install_dir/docker-compose.yml" <<EOF
services:
  connector:
    image: ghcr.io/insycom/ispcontrol-connector:latest
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
      ISPCONTROL_GLOBAL_CONNECTOR_DATA_DIR: ${DATA_DIR}
      ISPCONTROL_DNS_SERVER: ${DNS_SERVER}
    volumes:
      - connector_identity:${DATA_DIR}
    ports:
      - "127.0.0.1:${PORT}:9080"

volumes:
  connector_identity:
EOF
}

write_env() {
  cat >"$install_dir/.env" <<EOF
ISPCONTROL_API_URL=${API_URL}
ISPCONTROL_ALLOW_INSECURE_HTTP=${ALLOW_INSECURE_HTTP}
ISPCONTROL_CONNECTOR_NAME=${CONNECTOR_NAME}
ISPCONTROL_ENROLLMENT_TOKEN=${ENROLLMENT_TOKEN}
ISPCONTROL_GLOBAL_CONNECTOR_DATA_DIR=${DATA_DIR}
ISPCONTROL_DNS_SERVER=${DNS_SERVER}
EOF
}

main() {
  install_docker
  download_compose
  write_env
  mkdir -p "$DATA_DIR"
  log "Levantando el conector..."
  cd "$install_dir"
  docker compose up -d
  log "Listo. Salud local en http://127.0.0.1:${PORT}/health"
}

main
