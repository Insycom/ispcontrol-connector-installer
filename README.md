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

El heartbeat autenticado se envía a
`/api/v1/connector/v1/heartbeat`. En producción la URL configurada debe usar
HTTPS para que la API key nunca viaje en texto claro.

Para probar temporalmente contra una API HTTP de la red local se debe definir
`ISPCONTROL_ALLOW_INSECURE_HTTP=true`. Esta excepción es solo para desarrollo y
debe quitarse al publicar la API detrás del proxy HTTPS.

En el arranque global local se asume por defecto `http://ispcontrol.local`.

## Instalación en otra máquina Linux

Se puede instalar con un solo comando cuando publiques el script:

```bash
curl -fsSL https://<tu-dominio>/install-connector.sh | bash -s -- \
  --api-url http://ispcontrol.local \
  --dns 172.31.0.1 \
  --name "Conector sucursal norte"
```

El instalador instala Docker si hace falta, crea el compose y levanta el
contenedor con reinicio automático.
