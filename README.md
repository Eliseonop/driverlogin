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

### Pestañas del log

| Pestaña | Qué responde |
|---|---|
| **Sesión** | Login, cierre, conexión y central en el tiempo (lo de arriba). |
| **Cuadre** | ¿La liquidación de cada sesión cuadra con los boletos? Compara lo que el equipo liquidó al cerrar (`driver_logout`: total, correlativos `first`–`last`, rango de n° por tarifa) con los boletos que mandó con esa sesión (`tickets`), que es lo que suma la plataforma. Si no cuadra dice por qué: boletos vendidos después de armar la liquidación, correlativos liquidados que no se ven enviados, boletos del rango con otra sesión, precios, sin ACK. Muestra la regla de correlativos, el cuadre por tarifa, el **momento del cierre** en el orden de las líneas y la lista de boletos. **Liquidación impresa**: el papel de la liquidación automática (sesión o vuelta A+B) reconstruido con los boletos que el equipo tenía al imprimir, como lo arma `LiquidacionPrinter` (suma de nuevo desde Room; no es el `driver_logout`), si la cola lo dio por impreso, y columna Papel en la tabla. Las sesiones que no cuadran salen en Hallazgos y abren esta pestaña. Un boleto es **correlativo + hora**: si un reinicio borra filas de la base del equipo, el correlativo se reutiliza y la central guarda los dos; el cuadre lo detecta (el primer `[VENTA] IMPRESA` tras el arranque repite un correlativo ya impreso), lista los boletos borrados, cuáles llegaron a la central y qué números salieron dos veces, y muestra el **embudo** impreso → central → equipo al cerrar → liquidación. **Cerró** dice cómo: terminal (con su nombre), conductor, remoto (central/soporte), batería, noche o sesión de otro día; del `event` del `driver_logout` o deducido del log. **＋ Pegar sesiones de la plataforma**: el objeto JSON de la sesión (uno, un arreglo o varios seguidos) o filas de la tabla con inicio y fin; se empareja por id o por lado y horario, agrega la columna Plataforma y marca no cuadra si su producción difiere de la liquidación. Se recuerda por archivo en el navegador y alimenta también los paneles de consumo. Debajo, los paneles de sesión de la app de consumo. |
| **Ventas e impresión** | Paneles de la app de consumo: boletos vendidos, impresión por toque, impresora, vendidos sin imprimir, envío a la central, duplicados, errores. |
| **Recorrido** | Mapa: GPS, geocercas y paraderos. |
| **Consumo y red** | Paneles de la app de consumo: datos por día, TrafficMonitor, payload del socket, reinicios, versión y red. |

**📄 Informe de boletos** (arriba a la derecha) abre el informe de la app de consumo; 🖨️ lo imprime.

La app de consumo (`C:\Users\Edu\WebstormProjects\consumo`) corre embebida en un iframe (`public/consumo/`, modo
`?embed`): `embed.js` le pasa el texto del log, reparte sus paneles por pestaña según su título y le pone la paleta
clara. Para traer cambios de esa app: `npm run consumo` (copia `app.js` y `styles.css`; `CONSUMO_DIR` cambia la carpeta
de origen). Un panel nuevo cuyo título no reconozca `embed.js` cae en **Consumo y red** (avisa en la consola). Sin
`?embed`, `/consumo/index.html` es la app de consumo normal.

Código en `src/log/` (`leer.js` lee y clasifica líneas, `reconstruir.js` arma carriles, hallazgos y el estado en cada
instante, `cuadre.js` el cuadre por sesión), `src/ReproduccionLog.jsx`, `src/Cuadre.jsx` y `src/ConsumoFrame.jsx`.
Fixtures anonimizados en `test/fixtures/` (132: logout sin respuesta; 135: boletos vendidos tras la liquidación).

## Archivos

```
src/logica.js      port 1:1 de DriverSessionPolicy.kt + LogoutIntents
src/simulador.js   ruta, bus, reloj, equipo (Repository / Coordinator / ParaderoManager / Protector / Dispatcher), central
src/App.jsx        panel, estado, circuito, línea de tiempo y log; arrastrar un log abre la reproducción
src/log/           lectura y reconstrucción de logs reales
src/ReproduccionLog.jsx  pantalla de reproducción de un log real (pestañas)
src/Cuadre.jsx     pestaña Cuadre
src/ConsumoFrame.jsx     iframe de la app de consumo + informe de boletos
public/consumo/    copia de la app de consumo (npm run consumo) + embed.js / embed.css
test/              simulador, logs reales y cuadre
```

Si cambia la lógica en Android, se cambia `src/logica.js` (o el paso correspondiente en `src/simulador.js`) y se corre
`npm test`. El simulador anterior (mapa real, análisis de logs, escenarios) quedó en la rama `respaldo-simulador-v1`.
