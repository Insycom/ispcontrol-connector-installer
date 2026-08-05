#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Uso:
  curl -fsSL https://<tu-dominio>/install-connector.sh | bash -s -- \
    --api-url http://ispcontrol.local \
    --dns 172.31.0.1 \
    --name "Conector sucursal norte" \
    --install-dir /var/lib/ispcontrol

Opcionales:
  --enrollment-token TOKEN
  --portal-api-key KEY
  --allow-insecure-http true|false
  --port 9080
  --compose-url URL_DEL_COMPOSE
  --install-dir RUTA
  --docker-run

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

API_URL=""
DNS_SERVER="172.31.0.1"
CONNECTOR_NAME="IspControl Connector"
DATA_DIR=""
INSTALL_DIR=""
ENROLLMENT_TOKEN=""
PORT="9080"
ALLOW_INSECURE_HTTP="false"
COMPOSE_URL=""
USE_DOCKER_RUN="false"

while [ $# -gt 0 ]; do
  case "$1" in
    --api-url) API_URL="${2:-}"; shift 2 ;;
    --dns) DNS_SERVER="${2:-}"; shift 2 ;;
    --name) CONNECTOR_NAME="${2:-}"; shift 2 ;;
    --install-dir) INSTALL_DIR="${2:-}"; shift 2 ;;
    --data-dir) INSTALL_DIR="${2:-}"; shift 2 ;;
    --enrollment-token) ENROLLMENT_TOKEN="${2:-}"; shift 2 ;;
    --allow-insecure-http) ALLOW_INSECURE_HTTP="${2:-false}"; shift 2 ;;
    --port) PORT="${2:-9080}"; shift 2 ;;
    --compose-url) COMPOSE_URL="${2:-}"; shift 2 ;;
    --docker-run) USE_DOCKER_RUN="true"; shift 1 ;;
    -h|--help) usage; exit 0 ;;
    *) die "Argumento desconocido: $1" ;;
  esac
done

if [ -z "$API_URL" ]; then
  die "--api-url es obligatorio"
fi

IS_ROOT=0
if [ "${EUID:-$(id -u)}" -eq 0 ]; then
  IS_ROOT=1
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

  if [ "$IS_ROOT" -ne 1 ]; then
    die "No encontré Docker/Compose. Instalalo o ejecutá este script como root para que pueda instalarlo."
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

if [ -n "$INSTALL_DIR" ]; then
  install_dir="$INSTALL_DIR"
elif [ "$IS_ROOT" -eq 1 ]; then
  install_dir="/opt/ispcontrol-connector"
else
  install_dir="${XDG_DATA_HOME:-$HOME/.local/share}/ispcontrol-connector"
fi

if [ -z "$DATA_DIR" ]; then
  DATA_DIR="$install_dir/data"
fi

download_compose() {
  mkdir -p "$install_dir"
  if [ -n "$COMPOSE_URL" ]; then
    curl -fsSL "$COMPOSE_URL" -o "$install_dir/docker-compose.yml"
    return
  fi

  COMPOSE_URL="https://raw.githubusercontent.com/Insycom/ispcontrol-connector-installer/main/docker-compose.yml"
  curl -fsSL "$COMPOSE_URL" -o "$install_dir/docker-compose.yml"
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
  local repo_dir
  repo_dir="$install_dir/repo"
  mkdir -p "$install_dir"
  if [ ! -d "$repo_dir/.git" ]; then
    git clone https://github.com/Insycom/ispcontrol-connector-installer.git "$repo_dir"
  else
    git -C "$repo_dir" pull --ff-only
  fi

  if [ "$USE_DOCKER_RUN" = "true" ] || [ -z "$INSTALL_DIR" ]; then
    log "Ejecutando en modo contenedor independiente (docker run)."
    docker build -t ispcontrol-connector:local "$repo_dir/connector-src"
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
      ispcontrol-connector:local
    log "Listo. Salud local en http://127.0.0.1:${PORT}/health"
    return
  fi
  download_compose
  write_env
  mkdir -p "$DATA_DIR"
  log "Levantando el conector..."
  cd "$install_dir"
  docker compose up -d
  log "Listo. Salud local en http://127.0.0.1:${PORT}/health"
}

main
