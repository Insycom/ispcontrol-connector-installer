# Conector

Agente Docker que inicia una conexión HTTPS saliente hacia la API de IspControl
y ejecuta acciones autorizadas sobre equipos alcanzables desde su red local.

## Requisitos de red

- No necesita IP pública ni IP fija.
- No necesita NAT, port forwarding ni puertos entrantes.
- Funciona detrás de CGNAT.
- Necesita DNS y salida HTTPS al dominio de la API principal.
- Necesita conectividad LAN hacia los equipos asignados.

El puerto de salud `9080` se publica únicamente en `127.0.0.1` del host. No debe
exponerse a Internet.

El contenedor monta `/var/run/docker.sock` y `/docker/ispcontrol` para poder
administrar módulos locales por tenant. Por eso este conector debe instalarse en
un host de confianza y no exponerse a Internet.

El heartbeat autenticado se envía a
`/api/v1/connector/v1/heartbeat`. En producción la URL configurada debe usar
HTTPS para que la API key nunca viaje en texto claro.

Para probar temporalmente contra una API HTTP de la red local se debe definir
`ISPCONTROL_ALLOW_INSECURE_HTTP=true`. Esta excepción es solo para desarrollo y
debe quitarse al publicar la API detrás del proxy HTTPS.

## Instalación en otra máquina Linux

Se puede instalar con un solo comando cuando publiques el script:

```bash
curl -fsSL https://<tu-dominio>/install-connector.sh | bash -s -- \
  --api-url https://ispcontrol.sys.ar \
  --dns 172.31.0.1 \
  --name "Conector sucursal norte"
```

Si querés un install directo desde GitHub:

```bash
curl -fsSL https://raw.githubusercontent.com/Insycom/ispcontrol-connector-installer/main/install.sh | bash -s -- \
  --api-url https://ispcontrol.sys.ar \
  --dns 172.31.0.1 \
  --name "Conector sucursal norte"
```

El instalador crea el compose, monta `docker.sock`, monta `/docker/ispcontrol`
y levanta el contenedor con reinicio automático.
