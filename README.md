# DriverLogin · simulador

Cómo abre y cierra sesión el chofer en la ticketera TCONTUR, con la lógica del APK `portable-bus-printer`.

```bash
npm install
npm run dev    # http://localhost:5178
npm test
```

## La pantalla

- **Circuito**: lado A (ida) arriba de izquierda a derecha, lado B (vuelta) abajo de derecha a izquierda. En cada
  extremo el bus se detiene en el terminal y gira al otro lado: así se prueban `retorno_auto_b` (al cerrar A) y
  `retorno_auto_a` (al cerrar B).
- **Paraderos**: letreros con su número de orden y su radio sobre la calle. **T** = terminal, **$** = liquidar. Clic en
  uno para editar radio, terminal, liquidar y activo. **Geocercas**: 10 al azar; son solo referencia, el login no las usa.
- **Sesión del equipo** dentro del circuito, bajo cada lado: azul A, naranja B, rayado = equipo apagado, con marcas de
  login, cierre, sesión de la central, descartada y apagado.
- **Línea de tiempo**: arrastra para volver a cualquier momento; ◀ ▶ saltan entre eventos. Play o cualquier acción
  sigue desde ahí y descarta lo que venía después.
- **Log** con las mismas líneas que escribe `LogManager` (en violeta la central, en gris notas del simulador).

## Variables que cubre (y de dónde salen en el APK)

| Variable | Qué cambia | Código |
|---|---|---|
| Lado del login | lado del paradero **orden 1 más cercano** (ambos lados); sin él, A | `DriverSessionPolicy.calculateLado` |
| Cierre en terminal | si lado de la sesión = lado del paradero y es `terminal` **o** `liquidar` | `ParaderoManager.observeAutoLogouts` |
| Paradero `activo` / radio | inactivo = no existe; el radio decide cuándo "llegó" | `procesarParaderosFiltrados`, `paraderoEnRadio` |
| `retorno_auto_a` / `_b` | reabre el lado contrario tras cerrar en terminal; solo el booleano `true` | `DriverSessionPolicy.autoRetorno` |
| Credenciales en Room | sin dni/clave guardados no hay autoretorno | `SessionDriver.toEntity` |
| Terminar venta / cierre remoto | cierran sin autoretorno | `TerminarVentaViewModel`, `processOperation` |
| `login-conductor` / `logout-conductor` | login y logout pedidos por la central | `processOperation` |
| `operation` vs `android_command` | con eco + reenvío cada 5 min (id fijo) vs sin eco | `SocketMessageDispatcher`, `OperationDeduper` |
| Batería ≤10% sin carga | logout forzado + apagado | `ProtectorViewModel.monitorCriticalBattery` |
| Batería ≤16% sin carga 3 min | logout forzado (ENERGY) | `monitorEnergyInactivity` |
| 02:30–03:00 | logout forzado (NIGHT) | `monitorNightShutdown` |
| Logout forzado | el próximo `driver_login` que llegue se descarta | `LogoutIntents.blockIncomingLogin` |
| Conexión | sin socket los mensajes se pierden (no hay cola) | `SocketService.send`, `executeLogout` |
| Login del vehículo | sin `protoLogin` no sale ni `driver_login` ni `driver_logout` | `SocketHelper.sendMessage` |
| GPS | sin señal queda la última posición; sin fix usa (0,0) | `GpsRepository.locationState` |
| Datos de ruta | sin routes-data no hay paraderos ni config | `FetchManager` |
| Apagado / encendido | se pierde la memoria; Room y DataStore quedan | — |
| Nueva salida / día siguiente | restaura la sesión pendiente o cierra la de un día anterior | `GpsViewModel.cargarUltimaSesionSinFinalizar` |
| Pantalla de login | DNI ≥ 6 dígitos, clave requerida, espera 20 s; solo se ve sin sesión | `LoginDriverViewModel`, `NavTicket` |

La central es lo único que no sale del APK; sus reglas vienen de los logs de campo: valida DNI (8 dígitos) y clave,
rechaza si la unidad tiene sesión abierta con otro chofer, si el chofer ya tiene una abierta devuelve esa
("Ha reingresado…") y al cerrar una A crea sola la B (se puede apagar).

## Reproducir un log real

Arrastra un log de `LogManager` (el `.txt` que sube la ticketera) sobre la ventana, o usa **Reproducir un log real…**.
No corre la lógica del simulador: reconstruye lo que pasó solo con las líneas del log, así sirve para cualquier versión
(1.0.57 en adelante; si el log trae las líneas nuevas de 1.0.69 las usa, si no deduce la sesión de `driver_login`,
"Primera sesión obtenida" y los boletos).

- **Hallazgos**: cierres sin respuesta (y si el socket se cortó en el mismo segundo o siguió vivo, si se reintentó al
  reconectar), sesión que siguió abierta y boletos vendidos con ella, órdenes `operation` / `android_command` sin
  procesar, sesiones que la central pide cerrar y el equipo nunca recibió, viaje de un lado con sesión del otro,
  reconexiones por watchdog, logins descartados y cierres forzados. Clic en uno para ir a ese momento.
- **Circuito**: la ruta con los paraderos que aparecen en el log (por orden, a su distancia real), el bus ubicado por
  `report`, `device_status` y paradero cercano, y la sesión del equipo pintada sobre la última pasada por cada lado.
- **Línea de tiempo** con carriles: viaje (trip y lado), conexión (cada socket SID, cortes por watchdog, huecos sin red),
  sesión del equipo, sesión de la central (rayada = cierre sin confirmar, punteada = deducida), mensajes de sesión y
  boletos (en rojo los vendidos con una sesión que la central ya no tenía). Zoom todo / 2 h / 30 min / 5 min.
- **Mensajes de sesión** como diagrama equipo ↔ central y el **log real** sincronizado con el cursor.

Código en `src/log/` (`leer.js` lee y clasifica líneas, `reconstruir.js` arma carriles, hallazgos y el estado en cada
instante) y `src/ReproduccionLog.jsx`. Fixture anonimizado en `test/fixtures/` (padrón 132, 25-09, logout sin respuesta).

## Archivos

```
src/logica.js      port 1:1 de DriverSessionPolicy.kt + LogoutIntents
src/simulador.js   ruta, bus, reloj, equipo (Repository / Coordinator / ParaderoManager / Protector / Dispatcher), central
src/App.jsx        panel, estado, circuito, línea de tiempo y log; arrastrar un log abre la reproducción
src/log/           lectura y reconstrucción de logs reales
src/ReproduccionLog.jsx  pantalla de reproducción de un log real
test/              simulador (22 casos) y logs reales (14)
```

Si cambia la lógica en Android, se cambia `src/logica.js` (o el paso correspondiente en `src/simulador.js`) y se corre
`npm test`. El simulador anterior (mapa real, análisis de logs, escenarios) quedó en la rama `respaldo-simulador-v1`.
